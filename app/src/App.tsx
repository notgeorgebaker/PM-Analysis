import { useCallback, useEffect, useRef, useState } from "react";
import { api, StructureRef, Summary } from "./api";
import { RepSpec, Viewer, PickInfo } from "./ngl-viewer";
import { Viewport } from "./components/Viewport";
import { ImportPanel } from "./components/ImportPanel";
import { RepresentationStack, newRep } from "./components/RepresentationStack";
import { InspectorPanel } from "./components/InspectorPanel";
import { AnalysisPanel } from "./components/AnalysisPanel";

function defaultReps(): RepSpec[] {
  return [
    newRep({ type: "cartoon", sele: "protein or nucleic", colorScheme: "chainid" }),
    newRep({ type: "licorice", sele: "hetero and not water", colorScheme: "element" }),
  ];
}

export default function App() {
  const [structures, setStructures] = useState<StructureRef[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [repsById, setRepsById] = useState<Record<string, RepSpec[]>>({});
  const [pick, setPick] = useState<PickInfo | null>(null);
  const [focusSele, setFocusSele] = useState<string | null>(null);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const viewerRef = useRef<Viewer | null>(null);

  // Poll backend health for the status indicator.
  useEffect(() => {
    let live = true;
    const ping = () => api.health().then(() => live && setHealthy(true)).catch(() => live && setHealthy(false));
    ping();
    const t = setInterval(ping, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const active = structures.find((s) => s.id === activeId) || null;
  const reps = activeId ? repsById[activeId] || [] : [];

  const onLoaded = useCallback(async (s: StructureRef) => {
    setStructures((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
    setRepsById((prev) => (prev[s.id] ? prev : { ...prev, [s.id]: defaultReps() }));
    setActiveId(s.id);
    setPick(null);
    try {
      const sum = await api.summary(s.id);
      setSummaries((prev) => ({ ...prev, [s.id]: sum }));
    } catch {
      /* summary is best-effort */
    }
  }, []);

  const onRemove = useCallback((id: string) => {
    api.remove(id).catch(() => {});
    setStructures((prev) => prev.filter((s) => s.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const setReps = (next: RepSpec[]) =>
    activeId && setRepsById((prev) => ({ ...prev, [activeId]: next }));

  const addRepFromSelection = (sele: string) =>
    activeId &&
    setRepsById((prev) => ({
      ...prev,
      [activeId]: [...(prev[activeId] || []), newRep({ type: "licorice", sele, colorScheme: "element" })],
    }));

  const focus = (sele: string) => {
    setFocusSele(sele);
    // reset so the same selection can be re-focused later
    setTimeout(() => setFocusSele(null), 50);
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">PM<span>·</span>Analysis</div>
        <div className="tag">a Lightroom take on VMD</div>
        <div className="spacer" />
        <div className="status">
          <span className={`dot ${healthy === null ? "" : healthy ? "ok" : "bad"}`} />
          {healthy === null ? "connecting…" : healthy ? "engine ready" : "engine offline"}
        </div>
      </div>

      <div className="sidebar left">
        <ImportPanel
          structures={structures}
          activeId={activeId}
          onLoaded={onLoaded}
          onSelect={setActiveId}
          onRemove={onRemove}
        />
      </div>

      <Viewport
        structure={active}
        reps={reps}
        focusSele={focusSele}
        onPick={setPick}
        onReady={(v) => (viewerRef.current = v)}
      />

      <div className="sidebar right">
        <RepresentationStack reps={reps} disabled={!active} onChange={setReps} onFocus={focus} />
        <InspectorPanel
          structure={active}
          summary={activeId ? summaries[activeId] || null : null}
          pick={pick}
          onFocus={focus}
          onAddRep={addRepFromSelection}
        />
        <AnalysisPanel structure={active} structures={structures} />
      </div>
    </div>
  );
}
