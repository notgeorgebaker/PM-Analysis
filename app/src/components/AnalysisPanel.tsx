import { useState } from "react";
import { api, StructureRef } from "../api";
import { PickedSelection } from "./SelectionTree";

type Tab = "sasa" | "distance" | "helix" | "rmsd" | "rmsf" | "hole";
const TABS: { id: Tab; label: string }[] = [
  { id: "sasa", label: "SASA" },
  { id: "distance", label: "Dist" },
  { id: "helix", label: "Helix" },
  { id: "rmsd", label: "RMSD" },
  { id: "rmsf", label: "RMSF" },
  { id: "hole", label: "HOLE2" },
];

interface Props {
  structure: StructureRef | null;
  structures: StructureRef[];
  picked: PickedSelection | null;
}

export function AnalysisPanel({ structure, structures, picked }: Props) {
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
        {structure && tab === "sasa" && <Sasa structure={structure} picked={picked} />}
        {structure && tab === "distance" && <Distance structure={structure} picked={picked} />}
        {structure && tab === "helix" && <Helix structure={structure} picked={picked} />}
        {structure && tab === "rmsd" && <Rmsd structure={structure} structures={structures} picked={picked} />}
        {structure && tab === "rmsf" && <Rmsf structure={structure} picked={picked} />}
        {structure && tab === "hole" && <Hole structure={structure} picked={picked} />}
        <p className="muted" style={{ marginTop: 10 }}>
          Tip: hit <strong>⤓</strong> on anything in the Selection tree to send it here. Fields
          accept MDAnalysis / VMD syntax (e.g. <code>segid A and resid 11:41</code>).
        </p>
      </div>
    </div>
  );
}

/** Small control row: "From selection: <label>" + button(s) to fill a field. */
function FromSelection({ picked, actions }: { picked: PickedSelection | null; actions: { label: string; onClick: () => void }[] }) {
  if (!picked) return null;
  return (
    <div className="from-sel">
      <span className="from-sel-label" title={picked.mda}>
        ⤓ {picked.label}
      </span>
      {actions.map((a) => (
        <button key={a.label} className="ghost" onClick={a.onClick}>
          {a.label}
        </button>
      ))}
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

function Sasa({ structure, picked }: { structure: StructureRef; picked: PickedSelection | null }) {
  const [sele, setSele] = useState("");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={[{ label: "Use as selection", onClick: () => setSele(picked!.mda) }]} />
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

function Distance({ structure, picked }: { structure: StructureRef; picked: PickedSelection | null }) {
  const [a, setA] = useState("segid A and resid 1");
  const [b, setB] = useState("segid A and resid 10");
  const [mode, setMode] = useState("ca");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection
        picked={picked}
        actions={[
          { label: "Set A", onClick: () => setA(picked!.mda) },
          { label: "Set B", onClick: () => setB(picked!.mda) },
        ]}
      />
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

function Helix({ structure, picked }: { structure: StructureRef; picked: PickedSelection | null }) {
  const [sele, setSele] = useState("protein");
  const [axis, setAxis] = useState("z");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={[{ label: "Use as selection", onClick: () => setSele(picked!.mda) }]} />
      <label className="field"><span>Helix selection (≥ 9 Cα)</span>
        <input value={sele} onChange={(e) => setSele(e.target.value)} />
      </label>
      <label className="field"><span>Tilt reference axis (the “= 0” viewpoint axis)</span>
        <select value={axis} onChange={(e) => setAxis(e.target.value)}>
          <option value="z">Z axis (e.g. membrane normal)</option>
          <option value="x">X axis</option>
          <option value="y">Y axis</option>
        </select>
      </label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.helix(structure.id, sele, axis)))}>
        {busy ? "Fitting helix…" : "Analyse helix geometry"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="kv" style={{ marginTop: 8 }}>
            <span className="k">Tilt vs {res.ref_axis.toUpperCase()} axis</span>
            <span className="v" style={{ color: "var(--accent)" }}>{res.tilt_vs_ref}°</span>
          </div>
          <div className="kv"><span className="k">Twist (torsion)</span><span className="v">{res.twist_mean} ± {res.twist_std}°/res</span></div>
          <div className="kv"><span className="k">Rise per residue</span><span className="v">{res.rise_mean} Å</span></div>
          <div className="kv"><span className="k">Residues per turn</span><span className="v">{res.residues_per_turn}</span></div>
          {res.bend_mean != null && <div className="kv"><span className="k">Mean bend</span><span className="v">{res.bend_mean}°</span></div>}
          <div className="kv"><span className="k">Global axis</span><span className="v">[{res.global_axis.map((x: number) => x.toFixed(2)).join(", ")}]</span></div>
          <div className="kv"><span className="k">Cα atoms</span><span className="v">{res.n_ca}</span></div>
          <p className="muted" style={{ marginTop: 6, marginBottom: 2 }}>Tilt against each axis:</p>
          <div className="row" style={{ gap: 4 }}>
            {(["x", "y", "z"] as const).map((a) => (
              <span key={a} className="pill" style={{ flex: 1, textAlign: "center", borderColor: a === res.ref_axis ? "var(--accent-dim)" : undefined, color: a === res.ref_axis ? "var(--accent)" : undefined }}>
                {a.toUpperCase()}: {res.tilt[a]}°
              </span>
            ))}
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Residue</th><th className="num">Local twist (°)</th></tr></thead>
              <tbody>
                {res.per_window_twist.map((w: any, i: number) => (
                  <tr key={i}><td>{w.resid}</td><td className="num">{w.twist.toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Rmsd({ structure, structures, picked }: { structure: StructureRef; structures: StructureRef[]; picked: PickedSelection | null }) {
  const others = structures;
  const [mobile, setMobile] = useState(structure.id);
  const [sele, setSele] = useState("name CA");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={[{ label: "Use as selection", onClick: () => setSele(picked!.mda) }]} />
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

function Rmsf({ structure, picked }: { structure: StructureRef; picked: PickedSelection | null }) {
  const [sele, setSele] = useState("name CA");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={[{ label: "Use as selection", onClick: () => setSele(picked!.mda) }]} />
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

function Hole({ structure, picked }: { structure: StructureRef; picked: PickedSelection | null }) {
  const [sele, setSele] = useState("protein");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={[{ label: "Use as selection", onClick: () => setSele(picked!.mda) }]} />
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
