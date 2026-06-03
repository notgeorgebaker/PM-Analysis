import { useEffect, useMemo, useState } from "react";
import { api, StructureRef, SelectionTree as Tree, TreeCategory, TreeResidue } from "../api";

// A colour accent per molecule type, echoing the Meon palette.
const CAT_COLOR: Record<string, string> = {
  protein: "#4f9dff",
  nucleic: "#7c8cff",
  lipids: "#46c08a",
  water: "#38b6c4",
  ions: "#e0a64b",
  other: "#b07cff",
};

interface Props {
  structure: StructureRef | null;
  onFocus: (nglSele: string) => void;
  onAddRep: (nglSele: string, repType: string) => void;
}

export function SelectionTree({ structure, onFocus, onAddRep }: Props) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!structure) {
      setTree(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .selectionTree(structure.id)
      .then((t) => setTree(t))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [structure]);

  const q = filter.trim().toLowerCase();
  const matches = (r: TreeResidue) =>
    !q || `${r.label} ${r.resid} ${r.resname} ${r.chain}`.toLowerCase().includes(q);

  return (
    <div className="section">
      <h3>Selection</h3>
      <div className="section-body">
        {!structure && <div className="muted">Select a structure to browse its molecules.</div>}
        {structure && (
          <>
            <input
              placeholder="Filter residues… (e.g. alanine, 41, HIS)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {loading && <div className="busy">Reading structure…</div>}
            {error && <div className="error">{error}</div>}
            {tree?.categories.map((cat) => (
              <CategoryRow
                key={cat.key}
                cat={cat}
                color={CAT_COLOR[cat.key] || "#9aa1ad"}
                expanded={!!expanded[cat.key] || (!!q && cat.residues.some(matches))}
                onToggle={() => setExpanded((e) => ({ ...e, [cat.key]: !e[cat.key] }))}
                onFocus={onFocus}
                onAddRep={onAddRep}
                matches={matches}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  cat: TreeCategory;
  color: string;
  expanded: boolean;
  onToggle: () => void;
  onFocus: (sele: string) => void;
  onAddRep: (sele: string, repType: string) => void;
  matches: (r: TreeResidue) => boolean;
}

function CategoryRow({ cat, color, expanded, onToggle, onFocus, onAddRep, matches }: RowProps) {
  const shown = useMemo(() => cat.residues.filter(matches), [cat.residues, matches]);
  const canExpand = cat.present && cat.residues.length > 0;

  return (
    <div className="tree-cat">
      <div className={`tree-cat-head ${cat.present ? "" : "absent"}`}>
        <button
          className="caret"
          disabled={!canExpand}
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {canExpand ? (expanded ? "▾" : "▸") : "·"}
        </button>
        <span className="cat-dot" style={{ background: cat.present ? color : "#3a4049" }} />
        <span className="cat-label">{cat.label}</span>
        {cat.present ? (
          <span className="pill">{cat.count}</span>
        ) : (
          <span className="muted" style={{ fontStyle: "italic" }}>
            No {cat.label.toLowerCase()} found
          </span>
        )}
        {cat.present && (
          <span className="cat-actions">
            <button className="icon-btn" title="Focus camera" onClick={() => onFocus(cat.selectors.ngl)}>
              ◎
            </button>
            <button className="icon-btn" title="Add as representation layer" onClick={() => onAddRep(cat.selectors.ngl, cat.rep)}>
              +
            </button>
          </span>
        )}
      </div>

      {expanded && canExpand && (
        <div className="tree-residues">
          {shown.length === 0 && <div className="muted" style={{ padding: "2px 0 4px 26px" }}>no matches</div>}
          {shown.map((r, i) => (
            <div className="tree-res" key={`${r.segid}-${r.resid}-${i}`} onClick={() => onFocus(r.selectors.ngl)}>
              <span className="res-label">
                {r.label} <span className="res-num">{r.resid}</span>
                {r.chain && <span className="res-chain">· {r.chain}</span>}
              </span>
              <button
                className="icon-btn"
                title="Add this residue as a layer"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddRep(r.selectors.ngl, "licorice");
                }}
              >
                +
              </button>
            </div>
          ))}
          {cat.truncated && (
            <div className="muted" style={{ padding: "4px 0 2px 26px" }}>
              showing first {cat.residues.length.toLocaleString()} — use the filter to narrow
            </div>
          )}
        </div>
      )}
    </div>
  );
}
