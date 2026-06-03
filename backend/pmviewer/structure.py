"""Structure store: load, summarize, select, and inspect molecular structures.

A loaded structure keeps the raw file on disk (so the Mol* viewer can fetch it
verbatim) plus a lazily-constructed MDAnalysis ``Universe`` used for selections
and analysis. Heavy science deps are imported lazily so the API boots even if
they aren't installed yet — endpoints then return a clear, actionable error.
"""

from __future__ import annotations

import os
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any

# --- lazy heavy imports -----------------------------------------------------


def _require_mda():
    try:
        import MDAnalysis as mda  # noqa: F401
    except Exception as exc:  # pragma: no cover - exercised only without dep
        raise RuntimeError(
            "MDAnalysis is not installed in the backend environment. "
            "Run: pip install -r backend/requirements.txt"
        ) from exc
    return mda


# Coarse classification of components, mirroring how a chemist thinks about a
# structure in VMD ("protein", "nucleic", "water", "ligand", "ion").
WATER_RESNAMES = {"HOH", "WAT", "TIP3", "TIP4", "SOL", "H2O"}
ION_RESNAMES = {"NA", "CL", "K", "MG", "CA", "ZN", "FE", "MN", "SOD", "CLA", "POT"}


@dataclass
class Structure:
    id: str
    name: str
    path: str
    fmt: str  # "pdb" or "cif"
    source: str = "local"  # local | rcsb | alphafold
    traj_path: str | None = None  # optional trajectory coordinate file (DCD/XTC/…)
    meta: dict[str, Any] = field(default_factory=dict)
    _universe: Any = None  # cached MDAnalysis Universe

    def universe(self):
        if self._universe is None:
            mda = _require_mda()
            if self.traj_path:
                self._universe = mda.Universe(self.path, self.traj_path)
            else:
                self._universe = mda.Universe(self.path)
        return self._universe


class StructureStore:
    """Thread-safe in-memory registry of loaded structures."""

    def __init__(self, workdir: str):
        self.workdir = workdir
        os.makedirs(workdir, exist_ok=True)
        self._items: dict[str, Structure] = {}
        self._lock = threading.Lock()

    # -- registration --------------------------------------------------------

    def add_bytes(self, name: str, data: bytes, fmt: str, source: str = "local") -> Structure:
        sid = uuid.uuid4().hex[:12]
        fmt = fmt.lower().lstrip(".")
        path = os.path.join(self.workdir, f"{sid}.{fmt}")
        with open(path, "wb") as fh:
            fh.write(data)
        struct = Structure(id=sid, name=name, path=path, fmt=fmt, source=source)
        with self._lock:
            self._items[sid] = struct
        return struct

    def get(self, sid: str) -> Structure:
        with self._lock:
            if sid not in self._items:
                raise KeyError(f"No structure with id '{sid}'")
            return self._items[sid]

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {"id": s.id, "name": s.name, "format": s.fmt, "source": s.source}
                for s in self._items.values()
            ]

    def remove(self, sid: str) -> None:
        with self._lock:
            s = self._items.pop(sid, None)
        if s and os.path.exists(s.path):
            try:
                os.remove(s.path)
            except OSError:
                pass

    # -- trajectories --------------------------------------------------------

    def attach_trajectory(self, sid: str, data: bytes, fmt: str) -> dict[str, Any]:
        """Attach a trajectory (DCD/XTC/TRR/…) to a structure used as topology."""
        s = self.get(sid)
        fmt = fmt.lower().lstrip(".")
        path = os.path.join(self.workdir, f"{sid}_traj.{fmt}")
        with open(path, "wb") as fh:
            fh.write(data)
        s.traj_path = path
        s._universe = None  # force rebuild with the trajectory
        return self.trajectory_info(sid)

    def trajectory_info(self, sid: str) -> dict[str, Any]:
        u = self.get(sid).universe()
        n = int(len(u.trajectory))
        try:
            dt = float(u.trajectory.dt)
        except Exception:
            dt = 1.0
        if not dt or dt != dt:  # 0 or NaN
            dt = 1.0
        return {
            "n_frames": n,
            "dt_ps": dt,
            "total_ns": round(n * dt / 1000.0, 5),
            "has_trajectory": n > 1,
        }

    @staticmethod
    def set_frame(universe, frame: int | None) -> None:
        """Move a Universe to a given frame (no-op if frame is None/out of range)."""
        if frame is None:
            return
        n = len(universe.trajectory)
        if 0 <= frame < n:
            universe.trajectory[frame]

    # -- introspection -------------------------------------------------------

    def summary(self, sid: str) -> dict[str, Any]:
        """Chain/component breakdown for the Library + Inspector panels."""
        u = self.get(sid).universe()
        protein = u.select_atoms("protein")
        nucleic = u.select_atoms("nucleic")
        water = u.select_atoms("resname " + " ".join(WATER_RESNAMES))

        chains: list[dict[str, Any]] = []
        seg_attr = "segids" if hasattr(u.atoms, "segids") else "chainIDs"
        for seg in sorted(set(getattr(u.atoms, seg_attr, []))):
            sel = u.select_atoms(f"segid {seg}") if seg_attr == "segids" else u.select_atoms(f"chainid {seg}")
            if sel.n_atoms == 0:
                continue
            chains.append(
                {
                    "id": str(seg) or "?",
                    "n_atoms": int(sel.n_atoms),
                    "n_residues": int(sel.residues.n_residues),
                    "kind": _classify(sel),
                }
            )

        return {
            "id": sid,
            "n_atoms": int(u.atoms.n_atoms),
            "n_residues": int(u.residues.n_residues),
            "components": {
                "protein_residues": int(protein.residues.n_residues),
                "nucleic_residues": int(nucleic.residues.n_residues),
                "water_residues": int(water.residues.n_residues),
                "other_residues": int(
                    u.residues.n_residues
                    - protein.residues.n_residues
                    - nucleic.residues.n_residues
                    - water.residues.n_residues
                ),
            },
            "chains": chains,
        }

    def select(self, sid: str, selection: str, max_residues: int = 5000) -> dict[str, Any]:
        """Resolve an MDAnalysis/VMD-style selection to atoms + residue table."""
        u = self.get(sid).universe()
        try:
            atoms = u.select_atoms(selection)
        except Exception as exc:
            raise ValueError(f"Invalid selection '{selection}': {exc}") from exc

        residues = []
        for res in atoms.residues[:max_residues]:
            residues.append(
                {
                    "resname": str(res.resname),
                    "resid": int(res.resid),
                    "segid": str(getattr(res, "segid", "")),
                    "n_atoms": int(res.atoms.n_atoms),
                }
            )
        return {
            "selection": selection,
            "n_atoms": int(atoms.n_atoms),
            "n_residues": int(atoms.residues.n_residues),
            "residues": residues,
            "truncated": atoms.residues.n_residues > max_residues,
        }

    def residue_detail(self, sid: str, resid: int, segid: str | None = None) -> dict[str, Any]:
        """Per-residue attributes for the Inspector panel."""
        u = self.get(sid).universe()
        sel = f"resid {resid}"
        if segid:
            sel += f" and segid {segid}"
        res_atoms = u.select_atoms(sel)
        if res_atoms.n_atoms == 0:
            raise ValueError(f"No residue matched '{sel}'")
        res = res_atoms.residues[0]
        center = res.atoms.center_of_geometry()
        atoms = [
            {
                "name": str(a.name),
                "element": str(getattr(a, "element", "") or ""),
                "x": float(a.position[0]),
                "y": float(a.position[1]),
                "z": float(a.position[2]),
            }
            for a in res.atoms
        ]
        return {
            "resname": str(res.resname),
            "resid": int(res.resid),
            "segid": str(getattr(res, "segid", "")),
            "n_atoms": int(res.atoms.n_atoms),
            "center_of_geometry": [float(c) for c in center],
            "atoms": atoms,
        }


def _classify(atomgroup) -> str:
    """Best-effort single-label classification of a chain/segment."""
    resnames = set(str(r) for r in getattr(atomgroup.residues, "resnames", []))
    if atomgroup.select_atoms("protein").n_atoms > 0:
        return "protein"
    if atomgroup.select_atoms("nucleic").n_atoms > 0:
        return "nucleic"
    if resnames & WATER_RESNAMES:
        return "water"
    if resnames & ION_RESNAMES:
        return "ion"
    return "ligand"
