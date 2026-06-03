"""HOLE2 pore-profile wrapper.

HOLE2 analyses the dimensions of a pore/channel along an axis. MDAnalysis ships
a wrapper (``MDAnalysis.analysis.hole2``) that drives the external ``hole``
binary, which must be installed separately (academic licence, free):
    https://www.holeprogram.org/

This returns the pore radius profile (radius vs. position along the channel).
If the binary isn't found, it raises a clear error explaining how to install it.
"""

from __future__ import annotations

import shutil
import tempfile
from typing import Any

from .structure import StructureStore


def hole_profile(store: StructureStore, sid: str,
                 selection: str = "protein",
                 cpoint: list[float] | None = None,
                 cvect: list[float] | None = None) -> dict[str, Any]:
    if shutil.which("hole") is None:
        raise RuntimeError(
            "The 'hole' binary was not found on PATH. Install HOLE2 from "
            "https://www.holeprogram.org/ (free for academic use) and ensure "
            "the 'hole' executable is on your PATH."
        )
    try:
        from MDAnalysis.analysis import hole2
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("MDAnalysis (with hole2 support) is required.") from exc

    struct = store.get(sid)
    u = struct.universe()
    sel = u.select_atoms(selection)
    if sel.n_atoms == 0:
        raise ValueError("Selection matched no atoms for the pore calculation.")

    with tempfile.TemporaryDirectory() as tmp:
        kwargs: dict[str, Any] = {"select": selection, "tmpdir": tmp}
        if cpoint is not None:
            kwargs["cpoint"] = cpoint
        if cvect is not None:
            kwargs["cvect"] = cvect
        ha = hole2.HoleAnalysis(u, **kwargs)
        ha.run()
        # profiles keyed by frame; take the first frame for a static structure.
        frame0 = list(ha.results.profiles.values())[0]
        profile = [
            {"coord": float(p.rxn_coord), "radius": float(p.radius)}
            for p in frame0
        ]
        ha.delete()

    radii = [p["radius"] for p in profile]
    return {
        "selection": selection,
        "n_points": len(profile),
        "min_radius": min(radii) if radii else None,
        "profile": profile,
    }
