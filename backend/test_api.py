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
    assert s["components"]["protein_residues"] == 12
    assert s["chains"][0]["kind"] == "protein"


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
