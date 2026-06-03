"""In-process smoke tests for the PM-Analysis API.

Run from the backend/ directory:  python -m pytest test_api.py   (or just `python test_api.py`)
Uses FastAPI's TestClient, so no running server is required.
"""

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _load_demo() -> str:
    r = client.post("/structures/sample/demo_helix.pdb")
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_summary_classifies_protein():
    sid = _load_demo()
    s = client.get(f"/structures/{sid}/summary").json()
    assert s["components"]["protein_residues"] == 15
    assert any(c["kind"] == "protein" for c in s["chains"])


def test_selection():
    sid = _load_demo()
    r = client.post(f"/structures/{sid}/select", json={"selection": "resid 1 to 4 and name CA"})
    assert r.json()["n_atoms"] == 4


def test_sasa():
    sid = _load_demo()
    d = client.post(f"/structures/{sid}/analysis/sasa", json={}).json()
    assert d["total_sasa"] > 0
    assert d["per_residue"][0]["resname"] == "ALA"


def test_distance_modes():
    sid = _load_demo()
    for mode in ("ca", "com", "cog"):
        d = client.post(
            f"/structures/{sid}/analysis/distance",
            json={"sel_a": "resid 1", "sel_b": "resid 12", "mode": mode},
        ).json()
        assert d["distance"] > 0


def test_distance_matrix():
    sid = _load_demo()
    d = client.post(
        f"/structures/{sid}/analysis/distance",
        json={"sel_a": "resid 1 to 3", "sel_b": "resid 10 to 12", "mode": "ca", "matrix": True},
    ).json()
    assert len(d["matrix"]) == 3 and len(d["matrix"][0]) == 3


def test_selection_tree():
    sid = _load_demo()
    tree = client.get(f"/structures/{sid}/selection-tree").json()
    # master "System" node sits above the categories
    assert tree["system"]["label"] == "System"
    assert tree["system"]["count"] == 21  # 15 protein + 3 water + 3 lipid
    cats = {c["key"]: c for c in tree["categories"]}
    # protein present with human-readable residues
    assert cats["protein"]["present"] and cats["protein"]["count"] == 15
    assert cats["protein"]["residues"][0]["label"] == "Alanine"
    # the demo now bundles TIP3 water + POPE/POPG/cardiolipin lipids
    assert cats["water"]["present"] and cats["water"]["count"] == 3
    assert cats["water"]["residues"][0]["label"] == "Water"
    assert cats["lipids"]["present"] and cats["lipids"]["count"] == 3
    lipid_names = {r["label"] for r in cats["lipids"]["residues"]}
    assert "Cardiolipin" in lipid_names and "POPE" in lipid_names
    # categories genuinely absent still report cleanly
    for absent in ("ions", "nucleic"):
        assert cats[absent]["present"] is False and cats[absent]["count"] == 0
    # nodes carry both viewer and analysis selectors
    assert "ngl" in cats["protein"]["selectors"] and "mda" in cats["protein"]["selectors"]


def test_helix_geometry():
    sid = _load_demo()
    d = client.post(
        f"/structures/{sid}/analysis/helix", json={"selection": "protein", "ref_axis": "z"}
    ).json()
    # the demo is an idealised alpha helix: twist ~100 deg/res, 3.6 residues/turn
    assert abs(d["twist_mean"] - 100.0) < 5
    assert abs(d["residues_per_turn"] - 3.6) < 0.3
    # tilt angles are folded into [0, 90] for every axis
    assert all(0 <= d["tilt"][a] <= 90 for a in ("x", "y", "z"))
    assert len(d["per_window_twist"]) >= 1


def test_helix_too_short_is_400():
    sid = _load_demo()
    r = client.post(f"/structures/{sid}/analysis/helix", json={"selection": "resid 1 to 4"})
    assert r.status_code == 400


def test_radius_of_gyration():
    sid = _load_demo()
    d = client.post(f"/structures/{sid}/analysis/gyration", json={"selection": "protein"}).json()
    assert d["rg"] > 0 and d["n_atoms"] > 0


def test_dssp_finds_helix():
    sid = _load_demo()
    d = client.post(f"/structures/{sid}/analysis/dssp", json={"selection": "protein"}).json()
    # the rebuilt demo is a real alpha helix
    assert d["summary_percent"]["Helix"] > 50
    assert "H" in d["string"]


def test_ramachandran_alpha_region():
    sid = _load_demo()
    d = client.post(f"/structures/{sid}/analysis/ramachandran", json={"selection": "protein"}).json()
    assert d["n_residues"] >= 10
    assert any(p["region"] == "alpha-R" for p in d["per_residue"])


def test_contacts_runs():
    sid = _load_demo()
    d = client.post(f"/structures/{sid}/analysis/contacts", json={"selection": "protein"}).json()
    assert d["n_contacts"] >= 1
    assert isinstance(d["salt_bridges"], list)  # poly-Ala: empty, but present


def test_hbonds_static_inventory():
    sid = _load_demo()
    d = client.post(f"/structures/{sid}/analysis/hbonds", json={"selection": "protein"}).json()
    assert d["n_frames"] == 1
    assert d["n_unique"] >= 1  # backbone i->i+4 H-bonds in the helix
    assert d["survival"]["available"] is False  # single frame -> no survival times


def test_hbond_survival_on_ensemble():
    s = client.post("/structures/sample/demo_ensemble.pdb")
    assert s.status_code == 200, s.text
    sid = s.json()["id"]
    d = client.post(f"/structures/{sid}/analysis/hbonds", json={"selection": "protein"}).json()
    assert d["n_frames"] >= 2
    surv = d["survival"]
    assert surv["available"] is True
    assert surv["autocorrelation"][0] == 1.0  # C(0) == 1
    assert surv["survival_time"] > 0
    assert len(surv["autocorrelation"]) == len(surv["tau"])


def test_rmsf_single_model_note():
    sid = _load_demo()
    d = client.post(f"/structures/{sid}/analysis/rmsf", json={"selection": "name CA"}).json()
    assert d["n_frames"] == 1 and "note" in d


def test_rmsd_self_is_zero():
    sid = _load_demo()
    d = client.post(
        "/analysis/rmsd", json={"ref_id": sid, "mobile_id": sid, "selection": "name CA"}
    ).json()
    assert d["rmsd_superposed"] == 0.0


def test_hole_without_binary_returns_501():
    sid = _load_demo()
    r = client.post(f"/structures/{sid}/analysis/hole", json={"selection": "protein"})
    # 501 when the external `hole` binary is absent, 200 if it happens to be installed.
    assert r.status_code in (200, 501)


def test_bad_selection_is_400():
    sid = _load_demo()
    assert client.post(f"/structures/{sid}/select", json={"selection": "resid bogus"}).status_code == 400


def test_missing_structure_is_404():
    assert client.get("/structures/nope/summary").status_code == 404


if __name__ == "__main__":
    import sys

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
