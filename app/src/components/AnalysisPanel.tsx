import { useState } from "react";
import { api, StructureRef } from "../api";

type Tab = "sasa" | "distance" | "rmsd" | "rmsf" | "hole";
const TABS: { id: Tab; label: string }[] = [
  { id: "sasa", label: "SASA" },
  { id: "distance", label: "Dist" },
  { id: "rmsd", label: "RMSD" },
  { id: "rmsf", label: "RMSF" },
  { id: "hole", label: "HOLE2" },
];

interface Props {
  structure: StructureRef | null;
  structures: StructureRef[];
}

export function AnalysisPanel({ structure, structures }: Props) {
  const [tab, setTab] = useState<Tab>("sasa");
  return (
    <div className="section">
      <h3>Analysis</h3>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="section-body">
        {!structure && <div className="muted">Select a structure to analyse.</div>}
        {structure && tab === "sasa" && <Sasa structure={structure} />}
        {structure && tab === "distance" && <Distance structure={structure} />}
        {structure && tab === "rmsd" && <Rmsd structure={structure} structures={structures} />}
        {structure && tab === "rmsf" && <Rmsf structure={structure} />}
        {structure && tab === "hole" && <Hole structure={structure} />}
        <p className="muted" style={{ marginTop: 10 }}>
          Analysis selections use MDAnalysis / VMD syntax (e.g. <code>segid A and resid 11:41</code>).
        </p>
      </div>
    </div>
  );
}

function useRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Sasa({ structure }: { structure: StructureRef }) {
  const [sele, setSele] = useState("");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <label className="field"><span>Selection (blank = whole structure)</span>
        <input value={sele} placeholder="protein" onChange={(e) => setSele(e.target.value)} />
      </label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.sasa(structure.id, sele || undefined)))}>
        {busy ? "Computing…" : "Compute SASA"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="kv" style={{ marginTop: 8 }}><span className="k">Total SASA</span><span className="v">{res.total_sasa.toFixed(1)} Å²</span></div>
          {sele && <div className="kv"><span className="k">Selected SASA</span><span className="v">{res.selected_sasa.toFixed(1)} Å²</span></div>}
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Res</th><th>Chain</th><th className="num">Total</th><th className="num">Rel %</th></tr></thead>
              <tbody>
                {res.per_residue.slice(0, 500).map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.resname} {r.resid}</td><td>{r.chain}</td>
                    <td className="num">{r.total.toFixed(1)}</td>
                    <td className="num">{r.relative_total != null ? (r.relative_total * 100).toFixed(0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Distance({ structure }: { structure: StructureRef }) {
  const [a, setA] = useState("segid A and resid 1");
  const [b, setB] = useState("segid A and resid 10");
  const [mode, setMode] = useState("ca");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <label className="field"><span>Selection A</span><input value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label className="field"><span>Selection B</span><input value={b} onChange={(e) => setB(e.target.value)} /></label>
      <label className="field"><span>Reference point</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="ca">Alpha-carbon (Cα)</option>
          <option value="com">Centre of mass</option>
          <option value="cog">Centre of geometry</option>
        </select>
      </label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.distance(structure.id, a, b, mode)))}>
        {busy ? "Measuring…" : "Measure distance"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <div className="kv" style={{ marginTop: 8 }}>
          <span className="k">Distance ({res.mode})</span>
          <span className="v">{res.distance.toFixed(3)} Å</span>
        </div>
      )}
    </>
  );
}

function Rmsd({ structure, structures }: { structure: StructureRef; structures: StructureRef[] }) {
  const others = structures;
  const [mobile, setMobile] = useState(structure.id);
  const [sele, setSele] = useState("name CA");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <label className="field"><span>Reference</span><input value={structure.name} disabled /></label>
      <label className="field"><span>Mobile structure</span>
        <select value={mobile} onChange={(e) => setMobile(e.target.value)}>
          {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="field"><span>Selection (must match atom count)</span>
        <input value={sele} onChange={(e) => setSele(e.target.value)} />
      </label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.rmsd(structure.id, mobile, sele)))}>
        {busy ? "Aligning…" : "Compute RMSD"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="kv" style={{ marginTop: 8 }}><span className="k">RMSD (superposed)</span><span className="v">{res.rmsd_superposed} Å</span></div>
          <div className="kv"><span className="k">RMSD (raw)</span><span className="v">{res.rmsd_raw} Å</span></div>
          <div className="kv"><span className="k">Atoms</span><span className="v">{res.n_atoms}</span></div>
        </>
      )}
    </>
  );
}

function Rmsf({ structure }: { structure: StructureRef }) {
  const [sele, setSele] = useState("name CA");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <label className="field"><span>Selection</span><input value={sele} onChange={(e) => setSele(e.target.value)} /></label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.rmsf(structure.id, sele)))}>
        {busy ? "Computing…" : "Compute RMSF"}
      </button>
      {error && <div className="error">{error}</div>}
      {res?.note && <div className="note">{res.note}</div>}
      {res?.per_residue?.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Residue</th><th className="num">RMSF (Å)</th></tr></thead>
            <tbody>
              {res.per_residue.map((r: any, i: number) => (
                <tr key={i}><td>{r.resname} {r.resid}</td><td className="num">{r.rmsf.toFixed(3)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Hole({ structure }: { structure: StructureRef }) {
  const [sele, setSele] = useState("protein");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <label className="field"><span>Channel selection</span><input value={sele} onChange={(e) => setSele(e.target.value)} /></label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.hole(structure.id, sele)))}>
        {busy ? "Profiling pore…" : "Run HOLE2"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="kv" style={{ marginTop: 8 }}><span className="k">Min radius</span><span className="v">{res.min_radius?.toFixed(2)} Å</span></div>
          <div className="kv"><span className="k">Profile points</span><span className="v">{res.n_points}</span></div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th className="num">Axis (Å)</th><th className="num">Radius (Å)</th></tr></thead>
              <tbody>
                {res.profile.map((p: any, i: number) => (
                  <tr key={i}><td className="num">{p.coord.toFixed(1)}</td><td className="num">{p.radius.toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
