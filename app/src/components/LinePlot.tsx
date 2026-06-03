import { useEffect, useState } from "react";

// A text label you edit by double-clicking (commit on Enter/blur, cancel on Esc).
export function EditableText({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <input
        className={`editable-input ${className || ""}`}
        value={draft}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onChange(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            onChange(draft);
          } else if (e.key === "Escape") {
            setEditing(false);
            setDraft(value);
          }
        }}
      />
    );
  }
  return (
    <span className={`editable ${className || ""}`} title="Double-click to edit" onDoubleClick={() => setEditing(true)}>
      {value || <span className="muted">{placeholder}</span>}
    </span>
  );
}

interface Props {
  x: number[];
  y: number[];
  title: string;
  xlabel: string;
  ylabel: string;
  onTitle: (v: string) => void;
  onXLabel: (v: string) => void;
  onYLabel: (v: string) => void;
}

export function LinePlot({ x, y, title, xlabel, ylabel, onTitle, onXLabel, onYLabel }: Props) {
  const W = 288, H = 188, padL = 40, padR = 10, padT = 8, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;

  const xmin = Math.min(...x), xmax = Math.max(...x);
  const ymin = Math.min(...y), ymax = Math.max(...y);
  const xr = xmax - xmin || 1, yr = ymax - ymin || 1;
  // pad the y-range a touch so the line isn't glued to the edges
  const ylo = ymin - yr * 0.08, yhi = ymax + yr * 0.08, yrp = yhi - ylo || 1;

  const px = (v: number) => padL + ((v - xmin) / xr) * iw;
  const py = (v: number) => padT + ih - ((v - ylo) / yrp) * ih;
  const pts = x.map((xv, i) => `${px(xv).toFixed(1)},${py(y[i]).toFixed(1)}`).join(" ");

  const yticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ylo + f * yrp);
  const xticks = [0, 0.5, 1].map((f) => xmin + f * xr);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));

  return (
    <div className="plot">
      <EditableText value={title} onChange={onTitle} className="plot-title" placeholder="Untitled plot" />
      <div className="plot-body">
        <div className="plot-ylabel">
          <EditableText value={ylabel} onChange={onYLabel} placeholder="y-axis" />
        </div>
        <svg width={W} height={H} className="plot-svg">
          {/* axes */}
          <line x1={padL} y1={padT} x2={padL} y2={padT + ih} stroke="#3a4049" />
          <line x1={padL} y1={padT + ih} x2={padL + iw} y2={padT + ih} stroke="#3a4049" />
          {/* y gridlines + ticks */}
          {yticks.map((t, i) => (
            <g key={`y${i}`}>
              <line x1={padL} y1={py(t)} x2={padL + iw} y2={py(t)} stroke="#2a2f38" />
              <text x={padL - 4} y={py(t) + 3} textAnchor="end" className="plot-tick">{fmt(t)}</text>
            </g>
          ))}
          {/* x ticks */}
          {xticks.map((t, i) => (
            <text key={`x${i}`} x={px(t)} y={padT + ih + 14} textAnchor="middle" className="plot-tick">{fmt(t)}</text>
          ))}
          {/* the series */}
          <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
          {x.length <= 60 && x.map((xv, i) => (
            <circle key={i} cx={px(xv)} cy={py(y[i])} r={2} fill="var(--accent)" />
          ))}
        </svg>
      </div>
      <EditableText value={xlabel} onChange={onXLabel} className="plot-xlabel" placeholder="x-axis" />
    </div>
  );
}
