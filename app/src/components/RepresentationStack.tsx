import { RepSpec } from "../ngl-viewer";

const REP_TYPES = [
  "cartoon",
  "surface",
  "ball+stick",
  "licorice",
  "spacefill",
  "backbone",
  "ribbon",
  "rope",
  "line",
];
const COLOR_SCHEMES = ["chainid", "resname", "element", "sstruc", "bfactor", "uniform"];

let repCounter = 0;
export function newRep(partial: Partial<RepSpec> = {}): RepSpec {
  repCounter += 1;
  return {
    id: `rep-${Date.now()}-${repCounter}`,
    type: "cartoon",
    sele: "protein",
    colorScheme: "chainid",
    colorValue: "#4f9dff",
    opacity: 1,
    visible: true,
    ...partial,
  };
}

interface Props {
  reps: RepSpec[];
  disabled: boolean;
  onChange: (reps: RepSpec[]) => void;
  onFocus: (sele: string) => void;
}

export function RepresentationStack({ reps, disabled, onChange, onFocus }: Props) {
  const update = (id: string, patch: Partial<RepSpec>) =>
    onChange(reps.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(reps.filter((r) => r.id !== id));
  const add = () => onChange([...reps, newRep({ type: "licorice", sele: "hetero and not water", colorScheme: "element" })]);

  return (
    <div className="section">
      <h3>Representations</h3>
      <div className="section-body">
        {disabled && <div className="muted">Select a structure to edit its representations.</div>}
        {!disabled &&
          reps.map((r) => (
            <div className={`rep ${r.visible ? "" : "hidden"}`} key={r.id}>
              <div className="rep-head">
                <span
                  className="swatch"
                  style={{ background: r.colorScheme === "uniform" ? r.colorValue : "linear-gradient(135deg,#4f9dff,#46c08a)" }}
                />
                <span className="rep-type">{r.type}</span>
                <button className="icon-btn" title="Focus camera" onClick={() => onFocus(r.sele || "all")}>
                  ◎
                </button>
                <button className="icon-btn" title={r.visible ? "Hide" : "Show"} onClick={() => update(r.id, { visible: !r.visible })}>
                  {r.visible ? "◉" : "○"}
                </button>
                <button className="icon-btn" title="Delete" onClick={() => remove(r.id)}>
                  ✕
                </button>
              </div>
              <div className="rep-body">
                <div className="row">
                  <select value={r.type} onChange={(e) => update(r.id, { type: e.target.value })}>
                    {REP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select value={r.colorScheme} onChange={(e) => update(r.id, { colorScheme: e.target.value })}>
                    {COLOR_SCHEMES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={r.sele}
                  spellCheck={false}
                  placeholder="selection, e.g. protein and chain A"
                  onChange={(e) => update(r.id, { sele: e.target.value })}
                />
                <div className="row">
                  {r.colorScheme === "uniform" && (
                    <input
                      type="color"
                      value={r.colorValue}
                      style={{ padding: 2, height: 30 }}
                      onChange={(e) => update(r.id, { colorValue: e.target.value })}
                    />
                  )}
                  <label className="field" style={{ margin: 0, flex: 2 }}>
                    <span>opacity {r.opacity.toFixed(2)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={r.opacity}
                      onChange={(e) => update(r.id, { opacity: parseFloat(e.target.value) })}
                    />
                  </label>
                </div>
              </div>
            </div>
          ))}
        {!disabled && (
          <button className="ghost" style={{ width: "100%", marginTop: 6 }} onClick={add}>
            + Add representation
          </button>
        )}
      </div>
    </div>
  );
}
