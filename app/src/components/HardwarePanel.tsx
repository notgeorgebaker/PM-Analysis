import { useEffect, useState } from "react";
import { api, HardwareReport } from "../api";

// Probe which GPU the browser/Electron is using to render the WebGL viewport.
function webglRenderer(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const v = dbg ? gl.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function HardwarePanel() {
  const [open, setOpen] = useState(false);
  const [hw, setHw] = useState<HardwareReport | null>(null);
  const [cpu, setCpu] = useState(1);
  const [gpuSel, setGpuSel] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderer] = useState(webglRenderer);

  useEffect(() => {
    if (!open || hw) return;
    api
      .hardware()
      .then((h) => {
        setHw(h);
        setCpu(h.config.cpu_workers || h.detected.recommended.cpu_workers);
        setGpuSel(new Set(h.config.gpu_indices));
      })
      .catch((e) => setError(e.message));
  }, [open, hw]);

  async function apply() {
    if (!hw) return;
    setStatus(null);
    setError(null);
    try {
      const cfg = await api.setHardware({
        cpu_workers: cpu,
        gpu_indices: [...gpuSel],
        use_gpu: gpuSel.size > 0,
      });
      setStatus(
        `Applied: ${cfg.cpu_workers} CPU core${cfg.cpu_workers > 1 ? "s" : ""}` +
          (cfg.use_gpu ? `, ${cfg.gpu_indices.length} GPU${cfg.gpu_indices.length > 1 ? "s" : ""}` : ", GPU off")
      );
    } catch (e: any) {
      setError(e.message);
    }
  }

  const d = hw?.detected;
  const logical = d?.cpu.logical_cores ?? 1;
  const toggleGpu = (i: number) =>
    setGpuSel((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <div className="export-menu">
      <button className="ghost" onClick={() => setOpen((o) => !o)} title="Map Meon Spring to the host CPU and GPUs">
        ⚙ Hardware
      </button>
      {open && (
        <div className="export-popover hardware-popover">
          {!hw && !error && <div className="busy">Scanning host…</div>}
          {error && <div className="error">{error}</div>}
          {d && (
            <>
              <div className="hw-head">Host</div>
              <div className="kv"><span className="k">CPU</span><span className="v" title={d.cpu.model}>{shorten(d.cpu.model)}</span></div>
              <div className="kv"><span className="k">Cores</span><span className="v">{d.cpu.logical_cores} logical{d.cpu.physical_cores ? ` · ${d.cpu.physical_cores} physical` : ""}</span></div>
              {d.memory_gb && <div className="kv"><span className="k">Memory</span><span className="v">{d.memory_gb} GB</span></div>}
              {renderer && <div className="kv"><span className="k">Viewport GPU</span><span className="v" title={renderer}>{shorten(renderer)}</span></div>}

              <div className="hw-head" style={{ marginTop: 12 }}>
                {logical} CPU cores detected — how many should Meon Spring use?
              </div>
              <div className="row" style={{ alignItems: "center" }}>
                <input type="range" min={1} max={logical} value={cpu} onChange={(e) => setCpu(parseInt(e.target.value))} />
                <span className="pill" style={{ flex: "0 0 auto" }}>{cpu} / {logical}</span>
              </div>

              <div className="hw-head" style={{ marginTop: 12 }}>
                {d.gpus.length} GPU accelerator{d.gpus.length === 1 ? "" : "s"} detected
                {d.gpus.length > 0 ? " — how many to allocate?" : ""}
              </div>
              {d.gpus.length === 0 && (
                <div className="muted">No CUDA GPUs found — running in CPU mode.</div>
              )}
              {d.gpus.map((g) => (
                <label key={g.index} className="gpu-row">
                  <input type="checkbox" checked={gpuSel.has(g.index)} onChange={() => toggleGpu(g.index)} />
                  <span className="gpu-name">GPU {g.index}: {g.name}</span>
                  <span className="muted">{Math.round(g.memory_mb / 1024)} GB</span>
                </label>
              ))}
              {d.gpus.length > 0 && d.cuda.available && !d.cuda.cupy && (
                <div className="note">GPUs detected, but install <code>cupy-cuda12x</code> to enable GPU array maths (CPU is used until then).</div>
              )}

              <button className="primary" style={{ width: "100%", marginTop: 10 }} onClick={apply}>
                Apply allocation
              </button>
              {status && <div className="muted" style={{ marginTop: 6 }}>{status}</div>}
              <p className="muted" style={{ marginTop: 8 }}>
                CPU cap controls numpy/BLAS parallelism for the analyses; allocated
                GPUs accelerate large distance/contact kernels.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function shorten(s: string, n = 34): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
