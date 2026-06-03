import { useEffect, useState } from "react";
import { api, StructureRef, Summary, SelectResult } from "../api";
import { PickInfo } from "../ngl-viewer";

interface Props {
  structure: StructureRef | null;
  summary: Summary | null;
  pick: PickInfo | null;
  onFocus: (sele: string) => void;
}

export function InspectorPanel({ structure, summary, pick, onFocus }: Props) {
  const [detail, setDetail] = useState<any>(null);
  const [sele, setSele] = useState("resid 1 to 10");
  const [selResult, setSelResult] = useState<SelectResult | null>(null);
  const [selError, setSelError] = useState<string | null>(null);

  // Fetch residue attributes whenever a residue is clicked in the viewport.
  useEffect(() => {
    if (!structure || !pick) {
      setDetail(null);
      return;
    }
    api
      .residue(structure.id, pick.resno, pick.chain || undefined)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [structure, pick]);

  async function testSelection() {
    if (!structure) return;
    setSelError(null);
    try {
      setSelResult(await api.select(structure.id, sele));
    } catch (e: any) {
      setSelResult(null);
      setSelError(e.message);
    }
  }

  return (
    <>
      <div className="section">
        <h3>Structure</h3>
        <div className="section-body">
          {!summary && <div className="muted">No structure selected.</div>}
          {summary && (
            <>
              <div className="kv"><span className="k">Atoms</span><span className="v">{summary.n_atoms.toLocaleString()}</span></div>
              <div className="kv"><span className="k">Residues</span><span className="v">{summary.n_residues.toLocaleString()}</span></div>
              <div className="kv"><span className="k">Protein</span><span className="v">{summary.components.protein_residues}</span></div>
              <div className="kv"><span className="k">Nucleic</span><span className="v">{summary.components.nucleic_residues}</span></div>
              <div className="kv"><span className="k">Water</span><span className="v">{summary.components.water_residues}</span></div>
              <div className="kv"><span className="k">Other / ligand</span><span className="v">{summary.components.other_residues}</span></div>
              <div style={{ marginTop: 8 }}>
                {summary.chains.map((c) => (
                  <span key={c.id} className="pill" style={{ marginRight: 5 }} title={`${c.n_residues} residues`}>
                    {c.id} · {c.kind}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="section">
        <h3>Residue inspector</h3>
        <div className="section-body">
          {!detail && <div className="muted">Click an atom in the viewport to inspect its residue.</div>}
          {detail && (
            <>
              <div className="kv"><span className="k">Residue</span><span className="v">{detail.resname} {detail.resid}</span></div>
              <div className="kv"><span className="k">Chain / segid</span><span className="v">{detail.segid || "—"}</span></div>
              <div className="kv"><span className="k">Atoms</span><span className="v">{detail.n_atoms}</span></div>
              <div className="kv"><span className="k">Centre (Å)</span><span className="v">{detail.center_of_geometry.map((x: number) => x.toFixed(1)).join(", ")}</span></div>
              <button
                className="ghost"
                style={{ width: "100%", marginTop: 8 }}
                onClick={() => onFocus(`${detail.resid} and :${detail.segid}`.trim())}
              >
                Focus on this residue
              </button>
            </>
          )}
        </div>
      </div>

      <div className="section">
        <h3>Advanced selection</h3>
        <div className="section-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Most selecting is done in the Selection tree above. This box is for power
            users: write an MDAnalysis / VMD expression and check what it matches.
          </p>
          <textarea
            value={sele}
            spellCheck={false}
            placeholder="e.g. segid A and resid 11:41 and name CA"
            onChange={(e) => setSele(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button disabled={!structure} onClick={testSelection}>Count matches</button>
          </div>
          {selError && <div className="error">{selError}</div>}
          {selResult && (
            <div style={{ marginTop: 8 }}>
              <div className="kv"><span className="k">Matched atoms</span><span className="v">{selResult.n_atoms}</span></div>
              <div className="kv"><span className="k">Matched residues</span><span className="v">{selResult.n_residues}</span></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
