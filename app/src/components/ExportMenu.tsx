import { useState } from "react";
import { Viewer } from "../ngl-viewer";
import { exportView, ExportFormat } from "../exporter";

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "png", label: "PNG (lossless)" },
  { id: "jpeg", label: "JPEG" },
  { id: "tiff", label: "TIFF" },
  { id: "svg", label: "SVG (scalable, embeds raster)" },
];

interface Props {
  getViewer: () => Viewer | null;
  disabled: boolean;
}

export function ExportMenu({ getViewer, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function doExport() {
    const viewer = getViewer();
    if (!viewer) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await exportView(viewer, format, scale);
      setStatus(res.saved ? (res.path ? `Saved: ${res.path}` : "Saved.") : "Cancelled.");
    } catch (e: any) {
      setStatus(`Failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-menu">
      <button className="ghost" disabled={disabled} onClick={() => setOpen((o) => !o)} title="Export the current view as an image">
        ⤓ Export
      </button>
      {open && !disabled && (
        <div className="export-popover">
          <label className="field" style={{ marginTop: 0 }}>
            <span>Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Resolution: {scale}× viewport</span>
            <input type="range" min={1} max={4} step={1} value={scale} onChange={(e) => setScale(parseInt(e.target.value))} />
          </label>
          <button className="primary" style={{ width: "100%" }} disabled={busy} onClick={doExport}>
            {busy ? "Rendering…" : "Save image…"}
          </button>
          {status && <div className="muted" style={{ marginTop: 6, wordBreak: "break-all" }}>{status}</div>}
        </div>
      )}
    </div>
  );
}
