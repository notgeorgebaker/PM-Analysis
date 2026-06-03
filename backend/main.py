"""PM-Analysis backend API.

A local FastAPI service that the Electron/React front-end talks to. It handles
structure import/fetching, selections, residue inspection, and the analysis
suite (SASA, inter-residue distances, RMSD, RMSF, HOLE2).

Run standalone:
    uvicorn main:app --port 8765 --reload
The Electron main process spawns this automatically in production.
"""

from __future__ import annotations

import os
import tempfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from pmviewer import analysis, fetch, hole
from pmviewer.structure import StructureStore

WORKDIR = os.environ.get("PMA_WORKDIR", os.path.join(tempfile.gettempdir(), "pm-analysis"))
SAMPLES = os.path.join(os.path.dirname(__file__), "samples")

app = FastAPI(title="PM-Analysis", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local desktop app; tighten if ever served remotely
    allow_methods=["*"],
    allow_headers=["*"],
)
store = StructureStore(WORKDIR)


# --- request models ---------------------------------------------------------


class SelectBody(BaseModel):
    selection: str


class DistanceBody(BaseModel):
    sel_a: str
    sel_b: str
    mode: str = "ca"  # ca | com | cog
    matrix: bool = False


class RMSDBody(BaseModel):
    ref_id: str
    mobile_id: str
    selection: str = "name CA"


class AnalysisSelBody(BaseModel):
    selection: str | None = None


class HoleBody(BaseModel):
    selection: str = "protein"
    cpoint: list[float] | None = None
    cvect: list[float] | None = None


# --- error helper -----------------------------------------------------------


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc))


# --- health & library -------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok", "version": app.version}


@app.get("/structures")
def list_structures():
    return store.list()


# --- import / fetch ---------------------------------------------------------


@app.post("/structures/import")
async def import_structure(file: UploadFile = File(...)):
    name = file.filename or "structure.pdb"
    fmt = name.rsplit(".", 1)[-1].lower() if "." in name else "pdb"
    if fmt not in ("pdb", "cif", "mmcif", "ent"):
        raise HTTPException(status_code=400, detail=f"Unsupported format '.{fmt}'")
    if fmt in ("mmcif",):
        fmt = "cif"
    if fmt == "ent":
        fmt = "pdb"
    data = await file.read()
    s = store.add_bytes(name, data, fmt, source="local")
    return {"id": s.id, "name": s.name, "format": s.fmt, "source": s.source}


@app.post("/structures/fetch/rcsb/{pdb_id}")
def fetch_rcsb(pdb_id: str, fmt: str = "pdb"):
    data, fmt = _guard(fetch.fetch_rcsb, pdb_id, fmt)
    s = store.add_bytes(f"{pdb_id.upper()}.{fmt}", data, fmt, source="rcsb")
    return {"id": s.id, "name": s.name, "format": s.fmt, "source": s.source}


@app.post("/structures/fetch/alphafold/{uniprot}")
def fetch_alphafold(uniprot: str, fmt: str = "pdb"):
    data, fmt = _guard(fetch.fetch_alphafold, uniprot, fmt)
    s = store.add_bytes(f"AF-{uniprot.upper()}.{fmt}", data, fmt, source="alphafold")
    return {"id": s.id, "name": s.name, "format": s.fmt, "source": s.source}


@app.post("/structures/sample/{name}")
def load_sample(name: str):
    """Load a bundled offline sample (used for first-run demo & tests)."""
    safe = os.path.basename(name)
    path = os.path.join(SAMPLES, safe)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"No sample '{safe}'")
    with open(path, "rb") as fh:
        data = fh.read()
    fmt = safe.rsplit(".", 1)[-1].lower()
    s = store.add_bytes(safe, data, fmt, source="sample")
    return {"id": s.id, "name": s.name, "format": s.fmt, "source": s.source}


# --- raw file (for the Mol* viewer) & introspection -------------------------


@app.get("/structures/{sid}/file")
def structure_file(sid: str):
    s = _guard(store.get, sid)
    media = "chemical/x-pdb" if s.fmt == "pdb" else "chemical/x-cif"
    return FileResponse(s.path, media_type=media, filename=f"{s.id}.{s.fmt}")


@app.get("/structures/{sid}/summary")
def structure_summary(sid: str):
    return _guard(store.summary, sid)


@app.post("/structures/{sid}/select")
def structure_select(sid: str, body: SelectBody):
    return _guard(store.select, sid, body.selection)


@app.get("/structures/{sid}/residue/{resid}")
def residue_detail(sid: str, resid: int, segid: str | None = None):
    return _guard(store.residue_detail, sid, resid, segid)


@app.delete("/structures/{sid}")
def delete_structure(sid: str):
    store.remove(sid)
    return JSONResponse({"deleted": sid})


# --- analysis ---------------------------------------------------------------


@app.post("/structures/{sid}/analysis/sasa")
def analysis_sasa(sid: str, body: AnalysisSelBody):
    return _guard(analysis.sasa, store, sid, body.selection)


@app.post("/structures/{sid}/analysis/distance")
def analysis_distance(sid: str, body: DistanceBody):
    if body.matrix:
        return _guard(analysis.distance_matrix, store, sid, body.sel_a, body.sel_b, body.mode)
    return _guard(analysis.distance, store, sid, body.sel_a, body.sel_b, body.mode)


@app.post("/analysis/rmsd")
def analysis_rmsd(body: RMSDBody):
    return _guard(analysis.rmsd_between, store, body.ref_id, body.mobile_id, body.selection)


@app.post("/structures/{sid}/analysis/rmsf")
def analysis_rmsf(sid: str, body: AnalysisSelBody):
    return _guard(analysis.rmsf, store, sid, body.selection or "name CA")


@app.post("/structures/{sid}/analysis/hole")
def analysis_hole(sid: str, body: HoleBody):
    return _guard(hole.hole_profile, store, sid, body.selection, body.cpoint, body.cvect)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PMA_PORT", 8765)))
