import { useState } from "react";
import { api, StructureRef } from "../api";
import { PickedSelection } from "./SelectionTree";
import { LinePlot } from "./LinePlot";
import { saveTextFile } from "../exporter";

type Tab =
  | "timeseries" | "dssp" | "gyration" | "rama" | "hbonds" | "contacts"
  | "sasa" | "distance" | "helix" | "rmsd" | "rmsf" | "hole";

const ANALYSES: { id: Tab; label: string }[] = [
  { id: "timeseries", label: "Time series & plots (trajectory)" },
  { id: "dssp", label: "Secondary structure (DSSP)" },
  { id: "gyration", label: "Radius of gyration" },
  { id: "rama", label: "Ramachandran (φ/ψ)" },
  { id: "hbonds", label: "Hydrogen bonds & survival" },
  { id: "contacts", label: "Contacts & salt bridges" },
  { id: "sasa", label: "SASA" },
  { id: "distance", label: "Inter-residue distance" },
  { id: "helix", label: "Helix geometry" },
  { id: "rmsd", label: "RMSD (vs structure)" },
  { id: "rmsf", label: "RMSF" },
  { id: "hole", label: "HOLE2 pore profile" },
];

interface Props {
  structure: StructureRef | null;
  structures: StructureRef[];
  picked: PickedSelection | null;
  frame: number | null; // current trajectory frame (null = single structure)
  nFrames: number;
}

export function AnalysisPanel({ structure, structures, picked, frame, nFrames }: Props) {
  const [tab, setTab] = useState<Tab>("dssp");
  return (
    <div className="section">
      <h3>Analysis</h3>
      <div className="section-body">
        <label className="field" style={{ marginTop: 0 }}>
          <span>Analysis type</span>
          <select value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
            {ANALYSES.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </label>
        {nFrames > 1 && (
          <div className="frame-tag">Analysing frame {(frame ?? 0) + 1} / {nFrames}</div>
        )}
        {!structure && <div className="muted">Select a structure to analyse.</div>}
        {structure && tab === "timeseries" && <TimeSeries structure={structure} picked={picked} nFrames={nFrames} />}
        {structure && tab === "dssp" && <Dssp structure={structure} picked={picked} frame={frame} />}
        {structure && tab === "gyration" && <Gyration structure={structure} picked={picked} frame={frame} />}
        {structure && tab === "rama" && <Rama structure={structure} picked={picked} frame={frame} />}
        {structure && tab === "hbonds" && <HBonds structure={structure} picked={picked} />}
        {structure && tab === "contacts" && <Contacts structure={structure} picked={picked} frame={frame} />}
        {structure && tab === "sasa" && <Sasa structure={structure} picked={picked} frame={frame} />}
        {structure && tab === "distance" && <Distance structure={structure} picked={picked} frame={frame} />}
        {structure && tab === "helix" && <Helix structure={structure} picked={picked} frame={frame} />}
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

// Shared prop shape for the simple, selection-only analyses.
type SP = { structure: StructureRef; picked: PickedSelection | null };
type FP = SP & { frame: number | null }; // frame-aware variant
const useSel = (picked: PickedSelection | null, set: (s: string) => void) =>
  [{ label: "Use as selection", onClick: () => set(picked!.mda) }];

const SS_COLOR: Record<string, string> = { H: "#4f9dff", E: "#e0a64b", "-": "#6b7280" };

const TS_METRICS = [
  { id: "rg", label: "Radius of gyration" },
  { id: "rmsd", label: "RMSD (vs frame 1)" },
  { id: "distance", label: "Inter-residue distance" },
  { id: "n_hbonds", label: "Hydrogen-bond count" },
  { id: "helix_tilt", label: "Helix tilt" },
  { id: "helix_twist", label: "Helix twist" },
  { id: "sasa_total", label: "Total SASA" },
];

function TimeSeries({ structure, picked, nFrames }: SP & { nFrames: number }) {
  const [metric, setMetric] = useState("rg");
  const [sele, setSele] = useState("protein");
  const [selB, setSelB] = useState("resid 15");
  const [mode, setMode] = useState("ca");
  const [axis, setAxis] = useState("z");
  const [res, setRes] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [xlabel, setXLabel] = useState("Time (ns)");
  const [ylabel, setYLabel] = useState("");
  const [useNs, setUseNs] = useState(true);
  const { busy, error, run } = useRunner();

  if (nFrames <= 1) {
    return <div className="note">Time-series plots need a trajectory or multi-model ensemble. Load one (e.g. “Demo trajectory”) or attach a DCD.</div>;
  }

  const compute = () =>
    run(async () => {
      const r = await api.timeseries(structure.id, {
        metric, selection: sele, sel_b: metric === "distance" ? selB : null, mode, ref_axis: axis,
      });
      setRes(r);
      setTitle(`${TS_METRICS.find((m) => m.id === metric)?.label} vs time`);
      setYLabel(r.ylabel);
      setXLabel(useNs ? "Time (ns)" : "Frame");
    });

  const xdata = res ? (useNs ? res.times_ns : res.frames) : [];

  function exportCsv() {
    if (!res) return;
    const rows = [`# ${title}`, `${xlabel},${ylabel}`];
    for (let i = 0; i < res.values.length; i++) rows.push(`${xdata[i]},${res.values[i]}`);
    saveTextFile(`${(title || "timeseries").replace(/\s+/g, "_")}.csv`, rows.join("\n"));
  }

  return (
    <>
      <FromSelection picked={picked} actions={[
        { label: metric === "distance" ? "Set A" : "Use as selection", onClick: () => setSele(picked!.mda) },
        ...(metric === "distance" ? [{ label: "Set B", onClick: () => setSelB(picked!.mda) }] : []),
      ]} />
      <label className="field"><span>Metric</span>
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {TS_METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className="field"><span>{metric === "distance" ? "Selection A" : "Selection"}</span>
        <input value={sele} onChange={(e) => setSele(e.target.value)} />
      </label>
      {metric === "distance" && (
        <>
          <label className="field"><span>Selection B</span><input value={selB} onChange={(e) => setSelB(e.target.value)} /></label>
          <label className="field"><span>Reference point</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ca">Cα</option><option value="com">Centre of mass</option><option value="cog">Centre of geometry</option>
            </select>
          </label>
        </>
      )}
      {(metric === "helix_tilt" || metric === "helix_twist") && (
        <label className="field"><span>Reference axis</span>
          <select value={axis} onChange={(e) => setAxis(e.target.value)}>
            <option value="z">Z</option><option value="x">X</option><option value="y">Y</option>
          </select>
        </label>
      )}
      <label className="field" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={useNs} onChange={(e) => setUseNs(e.target.checked)} />
        <span style={{ margin: 0 }}>x-axis in nanoseconds (else frame index)</span>
      </label>
      <button className="primary" disabled={busy} onClick={compute}>
        {busy ? "Computing…" : "Compute & plot"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <LinePlot
            x={xdata}
            y={res.values}
            title={title}
            xlabel={xlabel}
            ylabel={ylabel}
            onTitle={setTitle}
            onXLabel={setXLabel}
            onYLabel={setYLabel}
          />
          <p className="muted" style={{ marginTop: 4 }}>Double-click the title or an axis label to rename it.</p>
          <button className="ghost" style={{ width: "100%", marginTop: 4 }} onClick={exportCsv}>Export plot data (CSV)</button>
        </>
      )}
    </>
  );
}

function Dssp({ structure, picked, frame }: FP) {
  const [sele, setSele] = useState("protein");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={useSel(picked, setSele)} />
      <label className="field"><span>Selection</span><input value={sele} onChange={(e) => setSele(e.target.value)} /></label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.dssp(structure.id, sele, frame)))}>
        {busy ? "Assigning…" : "Assign secondary structure"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="row" style={{ gap: 4, marginTop: 8 }}>
            {Object.entries(res.summary_percent).map(([k, v]) => (
              <span key={k} className="pill" style={{ flex: 1, textAlign: "center" }}>{k}: {v as number}%</span>
            ))}
          </div>
          {/* Compact SS ribbon: one coloured cell per residue */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2, margin: "8px 0" }}>
            {res.per_residue.map((p: any, i: number) => (
              <span key={i} title={`${p.resname} ${p.resid}: ${p.ss_name}`}
                style={{ width: 10, height: 14, borderRadius: 2, background: SS_COLOR[p.ss] || "#6b7280" }} />
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Residue</th><th>SS</th></tr></thead>
              <tbody>
                {res.per_residue.map((p: any, i: number) => (
                  <tr key={i}><td>{p.resname} {p.resid}</td><td>{p.ss_name}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Gyration({ structure, picked, frame }: FP) {
  const [sele, setSele] = useState("protein");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={useSel(picked, setSele)} />
      <label className="field"><span>Selection</span><input value={sele} onChange={(e) => setSele(e.target.value)} /></label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.gyration(structure.id, sele, frame)))}>
        {busy ? "Computing…" : "Compute Rg"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="kv" style={{ marginTop: 8 }}><span className="k">Radius of gyration</span><span className="v" style={{ color: "var(--accent)" }}>{res.rg} Å</span></div>
          <div className="kv"><span className="k">Atoms</span><span className="v">{res.n_atoms}</span></div>
          {res.per_chain.length > 1 && res.per_chain.map((c: any) => (
            <div className="kv" key={c.chain}><span className="k">Chain {c.chain}</span><span className="v">{c.rg} Å</span></div>
          ))}
        </>
      )}
    </>
  );
}

const REGION_COLOR: Record<string, string> = { "alpha-R": "#4f9dff", beta: "#e0a64b", "alpha-L": "#46c08a", other: "#6b7280" };

function Rama({ structure, picked, frame }: FP) {
  const [sele, setSele] = useState("protein");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  // simple inline phi/psi scatter (-180..180 on both axes)
  const S = 150, map = (v: number) => ((v + 180) / 360) * S;
  return (
    <>
      <FromSelection picked={picked} actions={useSel(picked, setSele)} />
      <label className="field"><span>Selection</span><input value={sele} onChange={(e) => setSele(e.target.value)} /></label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.ramachandran(structure.id, sele, frame)))}>
        {busy ? "Computing…" : "Compute φ/ψ"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <svg width={S} height={S} style={{ marginTop: 8, background: "var(--panel-2)", borderRadius: 5, display: "block" }}>
            <line x1={S / 2} y1={0} x2={S / 2} y2={S} stroke="#33384280" />
            <line x1={0} y1={S / 2} x2={S} y2={S / 2} stroke="#33384280" />
            {res.per_residue.map((p: any, i: number) => (
              <circle key={i} cx={map(p.phi)} cy={S - map(p.psi)} r={2.6}
                fill={REGION_COLOR[p.region]} opacity={0.85}>
                <title>{p.resname} {p.resid}: φ={p.phi}, ψ={p.psi} ({p.region})</title>
              </circle>
            ))}
          </svg>
          <p className="muted" style={{ marginTop: 4 }}>φ (x) vs ψ (y), −180…180°. {res.n_residues} residues.</p>
        </>
      )}
    </>
  );
}

function HBonds({ structure, picked }: SP) {
  const [sele, setSele] = useState("protein");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={useSel(picked, setSele)} />
      <label className="field"><span>Selection (backbone donors/acceptors within)</span>
        <input value={sele} onChange={(e) => setSele(e.target.value)} />
      </label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.hbonds(structure.id, sele)))}>
        {busy ? "Finding H-bonds…" : "Analyse hydrogen bonds"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="kv" style={{ marginTop: 8 }}><span className="k">Unique H-bonds</span><span className="v">{res.n_unique}</span></div>
          <div className="kv"><span className="k">Mean per frame</span><span className="v">{res.mean_count}</span></div>
          <div className="kv"><span className="k">Frames</span><span className="v">{res.n_frames}</span></div>
          {res.survival.available ? (
            <>
              <div className="kv"><span className="k">Survival time</span><span className="v" style={{ color: "var(--accent)" }}>{res.survival.survival_time} frames</span></div>
              <p className="muted" style={{ marginTop: 6, marginBottom: 2 }}>Survival autocorrelation C(τ):</p>
              <Sparkline values={res.survival.autocorrelation} />
              <p className="muted" style={{ marginTop: 4 }}>{res.survival.note}</p>
            </>
          ) : (
            <div className="note">{res.survival.note}</div>
          )}
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Donor</th><th>Acceptor</th><th className="num">Occ.</th></tr></thead>
              <tbody>
                {res.pairs.map((p: any, i: number) => (
                  <tr key={i}><td>{p.donor}</td><td>{p.acceptor}</td><td className="num">{(p.occupancy * 100).toFixed(0)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 150, H = 40, n = values.length;
  if (n < 2) return null;
  const pts = values.map((v, i) => `${(i / (n - 1)) * W},${H - v * H}`).join(" ");
  return (
    <svg width={W} height={H} style={{ background: "var(--panel-2)", borderRadius: 5, display: "block" }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
    </svg>
  );
}

function Contacts({ structure, picked, frame }: FP) {
  const [sele, setSele] = useState("protein");
  const [cutoff, setCutoff] = useState(4.5);
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={useSel(picked, setSele)} />
      <label className="field"><span>Selection</span><input value={sele} onChange={(e) => setSele(e.target.value)} /></label>
      <label className="field"><span>Contact cutoff: {cutoff.toFixed(1)} Å</span>
        <input type="range" min={3} max={8} step={0.5} value={cutoff} onChange={(e) => setCutoff(parseFloat(e.target.value))} />
      </label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.contacts(structure.id, sele, cutoff, frame)))}>
        {busy ? "Computing…" : "Find contacts & salt bridges"}
      </button>
      {error && <div className="error">{error}</div>}
      {res && (
        <>
          <div className="kv" style={{ marginTop: 8 }}><span className="k">Residue contacts</span><span className="v">{res.n_contacts}</span></div>
          <div className="kv"><span className="k">Salt bridges</span><span className="v">{res.salt_bridges.length}</span></div>
          {res.salt_bridges.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Cation</th><th>Anion</th><th className="num">Å</th></tr></thead>
                <tbody>
                  {res.salt_bridges.map((s: any, i: number) => (
                    <tr key={i}><td>{s.cation}</td><td>{s.anion}</td><td className="num">{s.dist}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Residue A</th><th>Residue B</th><th className="num">Min Å</th></tr></thead>
              <tbody>
                {res.contacts.slice(0, 300).map((cpair: any, i: number) => (
                  <tr key={i}><td>{cpair.a}</td><td>{cpair.b}</td><td className="num">{cpair.min_dist}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Sasa({ structure, picked, frame }: FP) {
  const [sele, setSele] = useState("");
  const [res, setRes] = useState<any>(null);
  const { busy, error, run } = useRunner();
  return (
    <>
      <FromSelection picked={picked} actions={[{ label: "Use as selection", onClick: () => setSele(picked!.mda) }]} />
      <label className="field"><span>Selection (blank = whole structure)</span>
        <input value={sele} placeholder="protein" onChange={(e) => setSele(e.target.value)} />
      </label>
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.sasa(structure.id, sele || undefined, frame)))}>
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

function Distance({ structure, picked, frame }: FP) {
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
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.distance(structure.id, a, b, mode, false, frame)))}>
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

function Helix({ structure, picked, frame }: FP) {
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
      <button className="primary" disabled={busy} onClick={() => run(async () => setRes(await api.helix(structure.id, sele, axis, frame)))}>
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
