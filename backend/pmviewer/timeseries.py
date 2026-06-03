"""Trajectory-wide time series: compute a scalar metric per frame.

This is the time-series counterpart to the per-frame analyses — e.g. Rg(t),
inter-residue distance(t), RMSD(t), H-bond count(t), helix tilt(t) — feeding the
plotting panel (and matching the inter-residue-distance CSV workflow).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .structure import StructureStore

METRICS = {
    "rg": "Radius of gyration (Å)",
    "distance": "Distance (Å)",
    "rmsd": "RMSD (Å)",
    "n_hbonds": "Hydrogen bonds",
    "helix_tilt": "Helix tilt (°)",
    "helix_twist": "Helix twist (°/res)",
    "sasa_total": "Total SASA (Å²)",
}
_AXES = {"x": [1.0, 0.0, 0.0], "y": [0.0, 1.0, 0.0], "z": [0.0, 0.0, 1.0]}


def _ref_point(ag, mode: str):
    if mode == "ca":
        ca = ag.select_atoms("name CA")
        return (ca if ca.n_atoms else ag).center_of_geometry()
    if mode == "com":
        return ag.center_of_mass()
    return ag.center_of_geometry()


def timeseries(store: StructureStore, sid: str, metric: str, selection: str = "protein",
               sel_b: str | None = None, mode: str = "ca", ref_axis: str = "z") -> dict[str, Any]:
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {sorted(METRICS)}")
    struct = store.get(sid)
    u = struct.universe()
    n = len(u.trajectory)
    if n < 2:
        raise ValueError("Time series needs a trajectory or multi-model ensemble (>= 2 frames).")
    try:
        dt = float(u.trajectory.dt) or 1.0
    except Exception:
        dt = 1.0

    frames = list(range(n))
    values: list[float] = []
    ylabel = METRICS[metric]

    if metric == "rg":
        ag = u.select_atoms(selection)
        if ag.n_atoms == 0:
            raise ValueError("Selection matched no atoms.")
        for _ in u.trajectory:
            values.append(float(ag.radius_of_gyration()))

    elif metric == "distance":
        if not sel_b:
            raise ValueError("Distance time series needs both selections (sel_a, sel_b).")
        ga, gb = u.select_atoms(selection), u.select_atoms(sel_b)
        if ga.n_atoms == 0 or gb.n_atoms == 0:
            raise ValueError("One of the selections matched no atoms.")
        for _ in u.trajectory:
            pa, pb = _ref_point(ga, mode), _ref_point(gb, mode)
            values.append(float(np.linalg.norm(np.asarray(pa) - np.asarray(pb))))
        ylabel = f"Distance {mode} (Å)"

    elif metric == "rmsd":
        from MDAnalysis.analysis.rms import RMSD
        r = RMSD(u, u, select=selection, ref_frame=0).run()
        return _pack(metric, ylabel, [int(x) for x in r.results.rmsd[:, 0]],
                     [float(x) for x in r.results.rmsd[:, 2]], dt)

    elif metric == "n_hbonds":
        from MDAnalysis.analysis.hydrogenbonds import HydrogenBondAnalysis as HBA
        from .hbonds import _ensure_bonds
        _ensure_bonds(u)
        scope = selection or "protein"
        hba = HBA(u, donors_sel=f"({scope}) and name N",
                  hydrogens_sel=f"({scope}) and name H HN H1",
                  acceptors_sel=f"({scope}) and name O OC1 OC2",
                  d_a_cutoff=3.5, d_h_a_angle_cutoff=120)
        hba.run()
        values = [float(c) for c in hba.count_by_time()]
        ylabel = "Hydrogen bonds"

    elif metric in ("helix_tilt", "helix_twist"):
        from MDAnalysis.analysis import helix_analysis as hel
        if ref_axis not in _AXES:
            raise ValueError("ref_axis must be 'x', 'y' or 'z'")
        sel = f"({selection}) and name CA"
        if u.select_atoms(sel).n_atoms < 9:
            raise ValueError("Helix metrics need at least 9 Cα atoms.")
        res = hel.HELANAL(u, select=sel, ref_axis=_AXES[ref_axis]).run().results
        if metric == "helix_twist":
            values = [float(np.mean(t)) for t in res.local_twists]
            ylabel = "Helix twist (°/res)"
        else:
            ref = np.asarray(_AXES[ref_axis])
            for ax in res.global_axis:
                ax = np.asarray(ax).reshape(-1)[:3]
                ax = ax / (np.linalg.norm(ax) or 1.0)
                cos = abs(float(np.dot(ax, ref)))
                values.append(round(float(np.degrees(np.arccos(np.clip(cos, -1, 1)))), 3))
            ylabel = f"Helix tilt vs {ref_axis.upper()} (°)"

    elif metric == "sasa_total":
        import os
        import tempfile
        import freesasa
        if n > 250:
            raise ValueError("Per-frame SASA is limited to 250 frames; narrow the trajectory.")
        freesasa.setVerbosity(freesasa.silent)
        for _ in u.trajectory:
            tmp = tempfile.NamedTemporaryFile(suffix=".pdb", delete=False)
            tmp.close()
            try:
                u.atoms.write(tmp.name)
                values.append(float(freesasa.calc(freesasa.Structure(tmp.name)).totalArea()))
            finally:
                os.remove(tmp.name)

    return _pack(metric, ylabel, frames, values, dt)


def _pack(metric: str, ylabel: str, frames: list[int], values: list[float], dt: float) -> dict[str, Any]:
    return {
        "metric": metric,
        "ylabel": ylabel,
        "xlabel": "Time (ns)",
        "frames": frames,
        "values": [round(float(v), 4) for v in values],
        "times_ns": [round(f * dt / 1000.0, 5) for f in frames],
        "dt_ps": dt,
        "n_frames": len(frames),
    }
