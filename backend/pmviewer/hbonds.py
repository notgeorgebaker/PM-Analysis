"""Hydrogen-bond analysis, including survival times.

A single static structure gives the H-bond *inventory* (which donor–acceptor
pairs exist). Survival times are an inherently time-dependent quantity — the
autocorrelation of an H-bond persisting across frames — so they are computed
only when the structure has >= 2 frames (a trajectory or multi-model ensemble),
and otherwise reported as unavailable with a clear note.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .structure import StructureStore


def _ensure_bonds(universe) -> None:
    """HBA pairs each hydrogen with its donor via bonds; guess them if absent."""
    try:
        if hasattr(universe.atoms, "bonds") and len(universe.atoms.bonds) > 0:
            return
    except Exception:
        pass
    try:
        universe.atoms.guess_bonds(vdwradii={"H": 1.1})
    except Exception as exc:
        raise RuntimeError(
            "Could not infer connectivity needed to pair donors with their "
            f"hydrogens ({exc}). A topology with bonds (e.g. PSF) would help."
        ) from exc


def hbond_analysis(
    store: StructureStore,
    sid: str,
    selection: str = "protein",
    d_a_cutoff: float = 3.5,
    angle_cutoff: float = 120.0,
    tau_max: int = 20,
    max_pairs: int = 400,
) -> dict[str, Any]:
    try:
        from MDAnalysis.analysis.hydrogenbonds import HydrogenBondAnalysis as HBA
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("MDAnalysis (with hydrogenbonds) is required.") from exc

    u = store.get(sid).universe()
    _ensure_bonds(u)

    # Default to backbone amide donors/acceptors within the chosen scope. Users can
    # widen the scope via `selection`; sidechain H-bonds are a later refinement.
    scope = selection.strip() or "protein"
    hba = HBA(
        u,
        donors_sel=f"({scope}) and name N",
        hydrogens_sel=f"({scope}) and name H HN H1",
        acceptors_sel=f"({scope}) and name O OC1 OC2",
        d_a_cutoff=d_a_cutoff,
        d_h_a_angle_cutoff=angle_cutoff,
    )
    try:
        hba.run()
    except Exception as exc:
        raise ValueError(f"Hydrogen-bond analysis failed for '{scope}': {exc}") from exc

    n_frames = len(u.trajectory)
    counts = np.asarray(hba.count_by_time())
    table = np.asarray(hba.count_by_ids())  # rows: [donor_ix, hydrogen_ix, acceptor_ix, count]

    pairs = []
    for row in table[:max_pairs]:
        d, _h, a, cnt = int(row[0]), int(row[1]), int(row[2]), int(row[3])
        da, aa = u.atoms[d], u.atoms[a]
        pairs.append(
            {
                "donor": f"{da.resname}{da.resid}:{da.name}",
                "acceptor": f"{aa.resname}{aa.resid}:{aa.name}",
                "count": cnt,
                "occupancy": round(cnt / n_frames, 3),
            }
        )

    result: dict[str, Any] = {
        "selection": scope,
        "d_a_cutoff": d_a_cutoff,
        "angle_cutoff": angle_cutoff,
        "n_frames": n_frames,
        "mean_count": round(float(counts.mean()), 2) if counts.size else 0.0,
        "n_unique": int(table.shape[0]) if table.size else 0,
        "pairs": pairs,
    }

    if n_frames >= 2:
        tmax = int(min(tau_max, n_frames - 1))
        tau, ac = hba.lifetime(tau_max=tmax)
        tau = np.asarray(tau, dtype=float)
        ac = np.asarray(ac, dtype=float)
        # Characteristic survival time = area under the survival autocorrelation.
        # (numpy 2 renamed trapz -> trapezoid; support both.)
        _trapz = getattr(np, "trapezoid", None) or np.trapz
        survival_time = float(_trapz(ac, tau))
        result["survival"] = {
            "available": True,
            "tau": [round(float(t), 3) for t in tau],
            "autocorrelation": [round(float(c), 4) for c in ac],
            "survival_time": round(survival_time, 3),
            "count_by_frame": [int(c) for c in counts],
            "note": "Survival time and tau are in frame units; absolute time "
                    "follows once a trajectory carries its timestep.",
        }
    else:
        result["survival"] = {
            "available": False,
            "note": "Survival times need a trajectory or multi-model ensemble "
                    "(>= 2 frames). Load the bundled demo_ensemble.pdb to see it.",
        }
    return result
