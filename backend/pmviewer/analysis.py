"""Structural analysis: SASA, inter-residue distances, RMSD and RMSF.

Everything here operates on the on-disk structure file and/or its MDAnalysis
``Universe``. Functions raise ``RuntimeError`` with an actionable message when a
required dependency is missing, and ``ValueError`` for bad inputs/selections.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .structure import Structure, StructureStore

# Reference-point modes for "distance between residues".
DISTANCE_MODES = {"ca", "com", "cog"}  # alpha-carbon, centre of mass, centre of geometry


# --- SASA -------------------------------------------------------------------


def sasa(store: StructureStore, sid: str, selection: str | None = None,
         probe_radius: float = 1.4) -> dict[str, Any]:
    try:
        import freesasa
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "freesasa is not installed. Run: pip install freesasa"
        ) from exc

    struct = store.get(sid)
    if struct.fmt != "pdb":
        raise ValueError("SASA currently requires a PDB-format structure.")

    freesasa.setVerbosity(freesasa.silent)
    params = freesasa.Parameters({"probe-radius": probe_radius})
    fs_struct = freesasa.Structure(struct.path)
    result = freesasa.calc(fs_struct, params)

    # Optionally restrict the reported per-residue table to a selection.
    wanted: set[tuple[str, int]] | None = None
    if selection:
        atoms = struct.universe().select_atoms(selection)
        wanted = {(str(getattr(r, "segid", "")), int(r.resid)) for r in atoms.residues}

    per_residue = []
    selected_total = 0.0
    for chain, residues in result.residueAreas().items():
        for resnum, area in residues.items():
            key = (str(chain), int(resnum))
            entry = {
                "chain": str(chain),
                "resid": int(resnum),
                "resname": str(area.residueType),
                "total": float(area.total),
                "polar": float(area.polar),
                "apolar": float(area.apolar),
                "relative_total": (float(area.relativeTotal)
                                   if area.hasRelativeAreas else None),
            }
            if wanted is None or key in wanted or ("", int(resnum)) in wanted:
                per_residue.append(entry)
                selected_total += float(area.total)

    return {
        "probe_radius": probe_radius,
        "total_sasa": float(result.totalArea()),
        "selected_sasa": selected_total if selection else float(result.totalArea()),
        "n_residues": len(per_residue),
        "per_residue": per_residue,
    }


# --- distances --------------------------------------------------------------


def _reference_points(atomgroup, mode: str) -> tuple[np.ndarray, list[dict]]:
    """Per-residue reference coordinate + label list for the given mode."""
    coords = []
    labels = []
    for res in atomgroup.residues:
        if mode == "ca":
            ca = res.atoms.select_atoms("name CA")
            if ca.n_atoms == 0:
                continue
            pt = ca.positions[0]
        elif mode == "com":
            pt = res.atoms.center_of_mass()
        else:  # cog
            pt = res.atoms.center_of_geometry()
        coords.append(pt)
        labels.append(
            {"resname": str(res.resname), "resid": int(res.resid),
             "segid": str(getattr(res, "segid", ""))}
        )
    return np.asarray(coords, dtype=float), labels


def distance(store: StructureStore, sid: str, sel_a: str, sel_b: str,
             mode: str = "ca") -> dict[str, Any]:
    """Single distance between the reference points of two selections."""
    if mode not in DISTANCE_MODES:
        raise ValueError(f"mode must be one of {sorted(DISTANCE_MODES)}")
    u = store.get(sid).universe()
    ga, gb = u.select_atoms(sel_a), u.select_atoms(sel_b)
    if ga.n_atoms == 0 or gb.n_atoms == 0:
        raise ValueError("One of the selections matched no atoms.")

    if mode == "ca":
        pa = ga.select_atoms("name CA").center_of_geometry() if ga.select_atoms("name CA").n_atoms else ga.center_of_geometry()
        pb = gb.select_atoms("name CA").center_of_geometry() if gb.select_atoms("name CA").n_atoms else gb.center_of_geometry()
    elif mode == "com":
        pa, pb = ga.center_of_mass(), gb.center_of_mass()
    else:
        pa, pb = ga.center_of_geometry(), gb.center_of_geometry()

    return {
        "mode": mode,
        "distance": float(np.linalg.norm(np.asarray(pa) - np.asarray(pb))),
        "point_a": [float(x) for x in pa],
        "point_b": [float(x) for x in pb],
    }


def distance_matrix(store: StructureStore, sid: str, sel_a: str, sel_b: str,
                    mode: str = "ca", max_dim: int = 400) -> dict[str, Any]:
    """Per-residue inter-residue distance matrix (like the static analogue of
    your time-series inter-residue CSVs)."""
    if mode not in DISTANCE_MODES:
        raise ValueError(f"mode must be one of {sorted(DISTANCE_MODES)}")
    u = store.get(sid).universe()
    ca, la = _reference_points(u.select_atoms(sel_a), mode)
    cb, lb = _reference_points(u.select_atoms(sel_b), mode)
    if len(la) == 0 or len(lb) == 0:
        raise ValueError("A selection produced no residues with the chosen reference point.")
    if len(la) > max_dim or len(lb) > max_dim:
        raise ValueError(
            f"Matrix too large ({len(la)}x{len(lb)}); narrow the selection "
            f"(limit {max_dim} residues per axis)."
        )
    # Euclidean pairwise distances.
    diff = ca[:, None, :] - cb[None, :, :]
    mat = np.sqrt((diff ** 2).sum(axis=-1))
    return {
        "mode": mode,
        "rows": la,
        "cols": lb,
        "matrix": mat.round(3).tolist(),
        "min": float(mat.min()),
        "max": float(mat.max()),
    }


# --- helix geometry ---------------------------------------------------------
_AXES = {"x": [1.0, 0.0, 0.0], "y": [0.0, 1.0, 0.0], "z": [0.0, 0.0, 1.0]}


def helix_geometry(store: StructureStore, sid: str, selection: str = "protein",
                   ref_axis: str = "z") -> dict[str, Any]:
    """Helix geometry via HELANAL (Bansal local-axis method).

    Reports the per-residue helical twist (torsion), rise and residues-per-turn,
    the global helix axis, and the tilt of that axis relative to the viewport
    x/y/z axes — e.g. the tilt vs the membrane normal (z) for a TM helix.
    """
    try:
        from MDAnalysis.analysis import helix_analysis as hel
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("MDAnalysis (with helix_analysis) is required.") from exc

    if ref_axis not in _AXES:
        raise ValueError("ref_axis must be 'x', 'y' or 'z'")

    u = store.get(sid).universe()
    sel = f"({selection}) and name CA"
    ca = u.select_atoms(sel)
    if ca.n_atoms < 9:
        raise ValueError(
            f"Helix geometry needs at least 9 Cα atoms (HELANAL); the selection "
            f"resolved to {ca.n_atoms}. Pick a longer, continuous helix."
        )

    h = hel.HELANAL(u, select=sel, ref_axis=_AXES[ref_axis]).run()
    r = h.results

    axis = np.asarray(r.global_axis).reshape(-1)[:3]
    axis = axis / (np.linalg.norm(axis) or 1.0)

    def tilt(vec) -> float:
        # helix axis sign is arbitrary, so fold the angle into [0, 90] degrees
        cos = abs(float(np.dot(axis, vec)))
        return round(float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))), 2)

    twists = np.asarray(r.local_twists).reshape(-1)
    heights = np.asarray(r.local_heights).reshape(-1)
    nres = np.asarray(r.local_nres_per_turn).reshape(-1)
    bends = np.asarray(r.local_bends).reshape(-1)
    resids = [int(a.resid) for a in ca.atoms]

    # Each local twist sits between consecutive Cα windows; label by the residue.
    per_window = [
        {"resid": resids[min(i + 1, len(resids) - 1)], "twist": round(float(t), 2)}
        for i, t in enumerate(twists)
    ]

    return {
        "selection": selection,
        "n_ca": int(ca.n_atoms),
        "ref_axis": ref_axis,
        "global_axis": [round(float(x), 4) for x in axis],
        "tilt": {"x": tilt(_AXES["x"]), "y": tilt(_AXES["y"]), "z": tilt(_AXES["z"])},
        "tilt_vs_ref": tilt(_AXES[ref_axis]),
        "twist_mean": round(float(np.mean(twists)), 2),
        "twist_std": round(float(np.std(twists)), 2),
        "rise_mean": round(float(np.mean(heights)), 3),
        "residues_per_turn": round(float(np.mean(nres)), 3),
        "bend_mean": round(float(np.mean(bends)), 2) if bends.size else None,
        "per_window_twist": per_window,
    }


# --- RMSD / RMSF ------------------------------------------------------------


def rmsd_between(store: StructureStore, sid_ref: str, sid_mobile: str,
                 selection: str = "name CA") -> dict[str, Any]:
    """RMSD between two loaded structures after optimal superposition."""
    try:
        from MDAnalysis.analysis import align
        from MDAnalysis.analysis.rms import rmsd as _rmsd
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("MDAnalysis is required for RMSD.") from exc

    u_ref = store.get(sid_ref).universe()
    u_mob = store.get(sid_mobile).universe()
    a = u_ref.select_atoms(selection)
    b = u_mob.select_atoms(selection)
    if a.n_atoms == 0 or b.n_atoms == 0:
        raise ValueError("Selection matched no atoms in one of the structures.")
    if a.n_atoms != b.n_atoms:
        raise ValueError(
            f"Selections differ in size ({a.n_atoms} vs {b.n_atoms} atoms). "
            "Use a selection that resolves to the same atoms in both structures."
        )
    before = float(_rmsd(a.positions, b.positions, superposition=False))
    after = float(_rmsd(a.positions, b.positions, superposition=True))
    return {
        "selection": selection,
        "n_atoms": int(a.n_atoms),
        "rmsd_raw": round(before, 4),
        "rmsd_superposed": round(after, 4),
    }


def rmsf(store: StructureStore, sid: str, selection: str = "name CA") -> dict[str, Any]:
    """Per-residue RMSF across the models/frames in the structure.

    For a single-model crystal/AlphaFold structure there is only one frame, so
    RMSF is zero/undefined — this returns a clear note rather than misleading
    numbers. Multi-model files (e.g. NMR ensembles) and trajectories work.
    """
    try:
        from MDAnalysis.analysis.rms import RMSF as _RMSF
        from MDAnalysis.analysis import align
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("MDAnalysis is required for RMSF.") from exc

    u = store.get(sid).universe()
    n_frames = len(u.trajectory)
    sel = u.select_atoms(selection)
    if sel.n_atoms == 0:
        raise ValueError("Selection matched no atoms.")
    if n_frames < 2:
        return {
            "selection": selection,
            "n_frames": n_frames,
            "note": "Only one model/frame present — RMSF needs an ensemble "
                    "or trajectory. Load an NMR multi-model PDB or a trajectory.",
            "per_residue": [],
        }

    # Align all frames to the average before computing fluctuations.
    align.AlignTraj(u, u, select=selection, in_memory=True).run()
    calc = _RMSF(sel).run()
    per_residue = [
        {"resname": str(a.resname), "resid": int(a.resid),
         "segid": str(getattr(a, "segid", "")), "rmsf": float(v)}
        for a, v in zip(sel.atoms, calc.results.rmsf)
    ]
    return {"selection": selection, "n_frames": n_frames, "per_residue": per_residue}


# --- radius of gyration -----------------------------------------------------


def radius_of_gyration(store: StructureStore, sid: str,
                       selection: str = "protein") -> dict[str, Any]:
    """Overall and per-chain radius of gyration (compactness)."""
    u = store.get(sid).universe()
    g = u.select_atoms(selection)
    if g.n_atoms == 0:
        raise ValueError("Selection matched no atoms.")
    per_chain = []
    seg_attr = "segids" if hasattr(g, "segids") else None
    if seg_attr:
        for seg in sorted(set(g.segids)):
            sub = g.select_atoms(f"segid {seg}")
            if sub.n_atoms:
                per_chain.append({"chain": str(seg), "rg": round(float(sub.radius_of_gyration()), 3),
                                  "n_atoms": int(sub.n_atoms)})
    return {
        "selection": selection,
        "rg": round(float(g.radius_of_gyration()), 3),
        "n_atoms": int(g.n_atoms),
        "per_chain": per_chain,
    }


# --- secondary structure (DSSP) ---------------------------------------------

_SS_NAMES = {"H": "Helix", "E": "Strand", "-": "Loop/coil"}


def secondary_structure(store: StructureStore, sid: str,
                        selection: str = "protein") -> dict[str, Any]:
    """Per-residue secondary structure via the pure-Python DSSP (no external binary)."""
    try:
        from MDAnalysis.analysis.dssp import DSSP
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("MDAnalysis (with dssp) is required.") from exc

    u = store.get(sid).universe()
    sel = u.select_atoms(selection)
    if sel.select_atoms("protein").n_atoms == 0:
        raise ValueError("Secondary structure needs a protein selection.")
    try:
        res = DSSP(sel).run()
    except Exception as exc:
        raise ValueError(f"DSSP failed: {exc}") from exc

    codes = list(res.results.dssp[0])  # first frame, 3-state H / E / -
    cas = sel.select_atoms("protein and name CA")
    residues = list(cas.residues)
    per_residue = []
    for code, r in zip(codes, residues):
        per_residue.append(
            {"resid": int(r.resid), "resname": str(r.resname),
             "segid": str(getattr(r, "segid", "")), "ss": code, "ss_name": _SS_NAMES.get(code, code)}
        )
    n = len(per_residue) or 1
    summary = {
        "Helix": round(100 * sum(1 for p in per_residue if p["ss"] == "H") / n, 1),
        "Strand": round(100 * sum(1 for p in per_residue if p["ss"] == "E") / n, 1),
        "Loop/coil": round(100 * sum(1 for p in per_residue if p["ss"] == "-") / n, 1),
    }
    return {"selection": selection, "n_residues": len(per_residue),
            "summary_percent": summary, "per_residue": per_residue,
            "string": "".join(codes)}


# --- Ramachandran (phi/psi) -------------------------------------------------


def _rama_region(phi: float, psi: float) -> str:
    if -160 <= phi <= -40 and -70 <= psi <= -10:
        return "alpha-R"
    if -180 <= phi <= -40 and (90 <= psi <= 180 or -180 <= psi <= -160):
        return "beta"
    if 40 <= phi <= 80 and 10 <= psi <= 80:
        return "alpha-L"
    return "other"


def ramachandran(store: StructureStore, sid: str,
                 selection: str = "protein") -> dict[str, Any]:
    """Backbone phi/psi dihedrals per residue, with rough region assignment."""
    try:
        from MDAnalysis.analysis.dihedrals import Ramachandran
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("MDAnalysis (with dihedrals) is required.") from exc

    u = store.get(sid).universe()
    sel = u.select_atoms(selection)
    if sel.select_atoms("protein").n_atoms == 0:
        raise ValueError("Ramachandran needs a protein selection.")
    rama = Ramachandran(sel).run()
    angles = np.asarray(rama.results.angles[0])  # (n_res_with_phi_psi, 2)
    # residues that have both phi and psi (interior residues), in order
    residues = [r for r in sel.residues
                if r.phi_selection() is not None and r.psi_selection() is not None]
    per = []
    for (phi, psi), r in zip(angles, residues):
        per.append({"resid": int(r.resid), "resname": str(r.resname),
                    "phi": round(float(phi), 1), "psi": round(float(psi), 1),
                    "region": _rama_region(float(phi), float(psi))})
    return {"selection": selection, "n_residues": len(per), "per_residue": per}


# --- contacts & salt bridges ------------------------------------------------


def contacts(store: StructureStore, sid: str, selection: str = "protein",
             cutoff: float = 4.5, min_seq_sep: int = 2,
             max_pairs: int = 1000) -> dict[str, Any]:
    """Residue-residue heavy-atom contacts and salt bridges within a selection."""
    from MDAnalysis.lib.distances import capped_distance

    u = store.get(sid).universe()
    heavy = u.select_atoms(f"({selection}) and not name H*")
    if heavy.n_atoms == 0:
        raise ValueError("Selection matched no heavy atoms.")

    resindices = heavy.atoms.resindices
    pairs_idx, _ = capped_distance(heavy.positions, heavy.positions, max_cutoff=cutoff,
                                   box=u.dimensions, return_distances=True)
    # collapse atom pairs -> residue pairs, keeping the minimum distance
    best: dict[tuple[int, int], float] = {}
    from MDAnalysis.lib.distances import calc_bonds
    pos = heavy.positions
    for i, j in pairs_idx:
        ri, rj = int(resindices[i]), int(resindices[j])
        if ri >= rj:
            continue
        if abs(ri - rj) < min_seq_sep:
            continue
        d = float(np.linalg.norm(pos[i] - pos[j]))
        key = (ri, rj)
        if key not in best or d < best[key]:
            best[key] = d

    res_by_index = {int(r.resindex): r for r in heavy.residues}
    contact_list = []
    for (ri, rj), d in sorted(best.items(), key=lambda kv: kv[1])[:max_pairs]:
        a, b = res_by_index[ri], res_by_index[rj]
        contact_list.append({
            "a": f"{a.resname}{a.resid}", "b": f"{b.resname}{b.resid}",
            "min_dist": round(d, 2),
        })

    # salt bridges: cationic N vs anionic O sidechain atoms within 4.0 A
    cation = u.select_atoms(
        f"({selection}) and ((resname ARG and name NH1 NH2 NE) or "
        f"(resname LYS and name NZ) or (resname HIS HSP and name ND1 NE2))")
    anion = u.select_atoms(
        f"({selection}) and ((resname ASP and name OD1 OD2) or (resname GLU and name OE1 OE2))")
    salt = []
    if cation.n_atoms and anion.n_atoms:
        sb_idx, sb_d = capped_distance(cation.positions, anion.positions,
                                       max_cutoff=4.0, box=u.dimensions, return_distances=True)
        seen = set()
        for (ci, ai), d in sorted(zip(sb_idx, sb_d), key=lambda kv: kv[1]):
            c, an = cation.atoms[int(ci)], anion.atoms[int(ai)]
            key = (int(c.resid), int(an.resid))
            if key in seen:
                continue
            seen.add(key)
            salt.append({"cation": f"{c.resname}{c.resid}", "anion": f"{an.resname}{an.resid}",
                         "dist": round(float(d), 2)})

    return {
        "selection": selection,
        "cutoff": cutoff,
        "n_contacts": len(best),
        "contacts": contact_list,
        "salt_bridges": salt,
    }
