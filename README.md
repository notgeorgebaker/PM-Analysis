# Meon Spring — a Lightroom take on VMD

> **Meon Spring** is the data-analysis & model-viewing app in the **Meon
> Scientific Services** suite (alongside *Meon River* — system generation — and
> *Meon Lake* — the ML/AI-accelerated MD engine). This repository is Meon Spring.

A modern, clean desktop app for protein visualisation and analysis. It borrows
Adobe Lightroom's interaction model — a bright 3D viewport in the centre, a
**non-destructive stack of representation "layers"** on one side, and a focused
**selection + inspector + analysis** panel on the other — and applies it to the
kind of work you'd otherwise do in VMD.

> **Status: first draft / v0.1.** The skeleton is end-to-end functional. Lots of
> tweaking expected along the way — this is the foundation to iterate on.

## What it does today

- **Import structures** — open a local `.pdb`/`.mmCIF`, fetch from the **RCSB
  PDB** by 4-character ID, or pull a predicted model from **AlphaFold DB** by
  UniProt accession. A bundled demo structure — an idealised poly-Ala α-helix
  (real φ/ψ geometry, backbone + amide H) plus TIP3 waters and
  POPE/POPG/cardiolipin lipids — works fully offline and exercises every
  molecule-type category and analysis. A companion `demo_ensemble.pdb`
  (8 perturbed models) demonstrates H-bond survival times and RMSF.
- **Clean representations** — cartoon, surface, ball-and-stick, licorice,
  spacefill, ribbon, rope and more, each its own non-destructive layer with its
  own selection, colour scheme and opacity. Stack and tweak them live.
- **Selection tree (no syntax required)** — a master **System** node sits atop
  the structure, which is auto-classified into plain-language molecule types:
  **Protein, Nucleic acids, Lipids, Waters, Ions, Other/ligands**. Absent types
  say so ("No lipids found") instead of failing. Drill into a type to see
  individual residues by full name ("Alanine 41"), then click to focus the
  camera, **+** to promote it to its own representation layer, or **⤓** to send
  it straight into the Analysis panel. A filter box narrows large proteins
  instantly. Power users still get a raw MDAnalysis/VMD box in the inspector.
- **Selection ↔ analysis linking** — every node in the tree (System, a molecule
  type, or a single residue) can be pushed into the analysis tools with one
  click: "Set A"/"Set B" for distances, "Use as selection" elsewhere.
- **Residue inspector** — click an atom to see its residue's name, chain,
  atom count and centre of geometry.
- **Analysis suite**
  - **Secondary structure (DSSP)** — per-residue helix/strand/coil with a colour
    ribbon and %-composition, via MDAnalysis's pure-Python DSSP (no binary).
  - **Radius of gyration** — overall and per-chain compactness.
  - **Ramachandran (φ/ψ)** — backbone dihedrals with an inline scatter plot and
    α/β region assignment.
  - **Hydrogen bonds & survival times** — donor–acceptor inventory with
    occupancy, and (for trajectories / multi-model ensembles) the **survival
    autocorrelation C(τ)** and a characteristic survival time.
  - **Contacts & salt bridges** — residue–residue heavy-atom contact list and
    cation–anion salt-bridge detection.
  - **SASA** (solvent-accessible surface area), total and per-residue, via `freesasa`.
  - **Inter-residue distances** between two selections, using **Cα**, **centre
    of mass**, or **centre of geometry** reference points — plus a per-residue
    distance **matrix** (the static analogue of your time-series distance CSVs).
  - **Helix geometry** (HELANAL / Bansal local-axis): per-residue helical twist
    (torsion), rise, residues-per-turn and bend, the global helix axis, and the
    **tilt of that axis relative to the viewport x/y/z axes** — e.g. tilt vs the
    membrane normal (z) for a transmembrane helix.
  - **RMSD** between two loaded structures, with optimal superposition.
  - **RMSF** per residue across models/frames (NMR ensembles & trajectories).
  - **HOLE2** pore-radius profile (wraps the external `hole` program).

## Architecture

```
┌─────────────────────────────┐        HTTP (localhost:8765)        ┌──────────────────────────┐
│  Electron + React/TS UI     │  ───────────────────────────────▶  │  Python FastAPI backend  │
│  • NGL WebGL viewport       │                                     │  • MDAnalysis (selections,│
│  • representation stack     │  ◀───────────────────────────────  │    distances, RMSD/RMSF)  │
│  • inspector + analysis     │         JSON / structure files      │  • freesasa (SASA)        │
└─────────────────────────────┘                                     │  • HOLE2 wrapper          │
                                                                     └──────────────────────────┘
```

The **viewport** uses [NGL](https://nglviewer.org/) — the same engine behind
`nglview`, which you already use in your notebooks. The **science** runs in a
local Python service so it reuses the MDAnalysis/mdtraj ecosystem you work in.
Electron spawns the backend automatically and tears it down on exit.

## Getting started

### 1. Backend (Python ≥ 3.10)

```bash
cd backend
pip install -r requirements.txt
# freesasa needs a small build workaround on some systems:
#   SETUPTOOLS_USE_DISTUTILS=stdlib pip install --no-build-isolation freesasa
python test_api.py        # 11/11 should pass
```

### 2. Frontend / desktop app

```bash
cd app
npm install
npm run dev               # launches Vite + Electron; Electron spawns the backend
```

`npm run dev` starts the renderer (Vite, port 5173), then opens the Electron
window which boots the Python backend (port 8765) and waits for it to be
healthy. Click **Load demo structure** to try it immediately, offline.

To build the renderer bundle for packaging:

```bash
npm run build             # tsc --noEmit + vite build -> app/dist
```

### Optional: HOLE2

Pore analysis drives the external `hole` binary. Install HOLE2 (free for
academic use) from <https://www.holeprogram.org/> and make sure `hole` is on
your `PATH`. Without it, the HOLE2 panel returns a clear "binary not found"
message rather than failing silently.

## A note on selection syntax

There are two underlying dialects — NGL (drives the viewport: `:A`, `1-41`,
`protein`) and MDAnalysis/VMD (drives analysis: `segid A`, `resid 11:41`,
`name CA`). **You normally never see either.** The selection tree generates
both for every node behind the scenes (see `backend/pmviewer/selection.py`),
so picking "Alanine 41" just works in both the viewport and the analysis tools.

The raw MDAnalysis/VMD box in the inspector remains for power users, and matches
your existing notebook selections almost verbatim.

## Roadmap (next passes)

- **Trajectories**: PSF+DCD/XTC loading and a timeline scrubber. The static
  analyses above are written to run per-frame, so they become time-series for
  free (matching `TM1_…_Inter_Residue_Distances.csv`); the trajectory pass is
  then mostly a frame slider + plotting.
- In-viewport **measurement tools** (click-to-measure distances/angles) and
  colour-by-analysis (paint SASA, RMSF or secondary structure onto the structure).
- Richer plots (currently inline SVG/tables) and CSV export.
- Packaged installers via `electron-builder` with a bundled Python runtime.

## Repository layout

```
backend/
  main.py              FastAPI app (routes + request models)
  pmviewer/
    structure.py       load / summarise / select / inspect
    selection.py       human-readable molecule-type selection tree
    analysis.py        SASA, distances, helix, RMSD/RMSF, Rg, DSSP, Ramachandran, contacts
    hbonds.py          hydrogen bonds + survival times
    fetch.py           RCSB + AlphaFold fetching
    hole.py            HOLE2 wrapper
  samples/             bundled offline demo structure + multi-model ensemble
  test_api.py          in-process endpoint tests
app/
  electron/            Electron main + preload
  src/                 React UI (viewport, representation stack, inspector, analysis)
```
