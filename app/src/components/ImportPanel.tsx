import { useRef, useState } from "react";
import { api, StructureRef } from "../api";

interface Props {
  structures: StructureRef[];
  activeId: string | null;
  onLoaded: (s: StructureRef) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onTrajectoryAttached: (id: string, info: { n_frames: number; dt_ps: number }) => void;
}

export function ImportPanel({ structures, activeId, onLoaded, onSelect, onRemove, onTrajectoryAttached }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const trajRef = useRef<HTMLInputElement>(null);
  const [pdbId, setPdbId] = useState("");
  const [uniprot, setUniprot] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attachTraj(file: File) {
    if (!activeId) return;
    setBusy("trajectory");
    setError(null);
    try {
      const info = await api.attachTrajectory(activeId, file);
      onTrajectoryAttached(activeId, info);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  async function run(label: string, fn: () => Promise<StructureRef>) {
    setBusy(label);
    setError(null);
    try {
      onLoaded(await fn());
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="section">
        <h3>Import</h3>
        <div className="section-body">
          <input
            ref={fileRef}
            type="file"
            accept=".pdb,.cif,.ent,.mmcif"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run("file", () => api.importFile(f));
              e.target.value = "";
            }}
          />
          <button className="primary" style={{ width: "100%" }} onClick={() => fileRef.current?.click()}>
            Open PDB / mmCIF file…
          </button>

          <label className="field" style={{ marginTop: 12 }}>
            <span>RCSB PDB ID</span>
            <div className="row tight">
              <input
                placeholder="e.g. 1CRN"
                value={pdbId}
                onChange={(e) => setPdbId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && pdbId && run("rcsb", () => api.fetchRcsb(pdbId))}
              />
              <button disabled={!pdbId} onClick={() => run("rcsb", () => api.fetchRcsb(pdbId))}>
                Fetch
              </button>
            </div>
          </label>

          <label className="field">
            <span>AlphaFold (UniProt accession)</span>
            <div className="row tight">
              <input
                placeholder="e.g. P69905"
                value={uniprot}
                onChange={(e) => setUniprot(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && uniprot && run("af", () => api.fetchAlphafold(uniprot))
                }
              />
              <button disabled={!uniprot} onClick={() => run("af", () => api.fetchAlphafold(uniprot))}>
                Fetch
              </button>
            </div>
          </label>

          <div className="row tight" style={{ marginTop: 0 }}>
            <button className="ghost" onClick={() => run("sample", () => api.loadSample("demo_helix.pdb"))}>
              Demo structure
            </button>
            <button className="ghost" onClick={() => run("sample", () => api.loadSample("demo_ensemble.pdb"))}>
              Demo trajectory
            </button>
          </div>

          <input
            ref={trajRef}
            type="file"
            accept=".dcd,.xtc,.trr,.nc,.netcdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attachTraj(f);
              e.target.value = "";
            }}
          />
          <button
            className="ghost"
            style={{ width: "100%", marginTop: 6 }}
            disabled={!activeId}
            title={activeId ? "Attach a DCD/XTC trajectory to the active structure" : "Select a structure first"}
            onClick={() => trajRef.current?.click()}
          >
            Attach trajectory (DCD/XTC)…
          </button>

          {busy && <div className="busy">Loading ({busy})…</div>}
          {error && <div className="error">{error}</div>}
        </div>
      </div>

      <div className="section">
        <h3>Library</h3>
        <div className="section-body">
          {structures.length === 0 && <div className="muted">No structures loaded yet.</div>}
          {structures.map((s) => (
            <div
              key={s.id}
              className={`lib-item ${s.id === activeId ? "active" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              <span className="name" title={s.name}>
                {s.name}
              </span>
              <span className="src">{s.source}</span>
              <button
                className="icon-btn ghost"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(s.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
