import { useCallback, useEffect, useRef, useState } from "react";
import { api, StructureRef, Summary } from "./api";
import { RepSpec, Viewer, PickInfo } from "./ngl-viewer";
import { Viewport } from "./components/Viewport";
import { ImportPanel } from "./components/ImportPanel";
import { RepresentationStack, newRep } from "./components/RepresentationStack";
import { SelectionTree, PickedSelection } from "./components/SelectionTree";
import { InspectorPanel } from "./components/InspectorPanel";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { ExportMenu } from "./components/ExportMenu";

interface TrajInfo {
  nFrames: number;
  dtPs: number;
}

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
  const [picked, setPicked] = useState<PickedSelection | null>(null);
  const [focusSele, setFocusSele] = useState<string | null>(null);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  // trajectory state
  const [trajById, setTrajById] = useState<Record<string, TrajInfo>>({});
  const [trajUrlById, setTrajUrlById] = useState<Record<string, string>>({});
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
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
  const traj = activeId ? trajById[activeId] : undefined;
  const nFrames = traj?.nFrames ?? 1;
  const dtPs = traj?.dtPs ?? 1;
  const trajUrl = activeId ? trajUrlById[activeId] ?? null : null;

  const refreshTrajectory = useCallback(async (id: string) => {
    try {
      const info = await api.trajectoryInfo(id);
      setTrajById((prev) => ({ ...prev, [id]: { nFrames: info.n_frames, dtPs: info.dt_ps } }));
    } catch {
      /* a structure with no trajectory is just one frame */
    }
  }, []);

  const onLoaded = useCallback(
    async (s: StructureRef) => {
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
      refreshTrajectory(s.id);
    },
    [refreshTrajectory]
  );

  const onTrajectoryAttached = useCallback((id: string, info: { n_frames: number; dt_ps: number }) => {
    setTrajById((prev) => ({ ...prev, [id]: { nFrames: info.n_frames, dtPs: info.dt_ps } }));
    setTrajUrlById((prev) => ({ ...prev, [id]: api.trajUrl(id) + `?t=${Date.now()}` }));
    if (id === activeId) {
      setFrame(0);
      setPlaying(false);
    }
  }, [activeId]);

  const onRemove = useCallback((id: string) => {
    api.remove(id).catch(() => {});
    setStructures((prev) => prev.filter((s) => s.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  // Reset the timeline when switching structures.
  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [activeId]);

  // Playback loop: advance frames while playing.
  useEffect(() => {
    if (!playing || nFrames <= 1) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % nFrames), 150);
    return () => clearInterval(t);
  }, [playing, nFrames]);

  const setReps = (next: RepSpec[]) =>
    activeId && setRepsById((prev) => ({ ...prev, [activeId]: next }));

  const addRepFromSelection = (sele: string, repType = "licorice") =>
    activeId &&
    setRepsById((prev) => ({
      ...prev,
      [activeId]: [
        ...(prev[activeId] || []),
        // Cartoon/ribbon read best coloured by chain; everything else by element.
        newRep({ type: repType, sele, colorScheme: /cartoon|ribbon|rope|tube/.test(repType) ? "chainid" : "element" }),
      ],
    }));

  const focus = (sele: string) => {
    setFocusSele(sele);
    setTimeout(() => setFocusSele(null), 50);
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">Meon<span> </span>Spring</div>
        <div className="tag">a Lightroom take on VMD</div>
        <div className="spacer" />
        <ExportMenu getViewer={() => viewerRef.current} disabled={!active} />
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
          onTrajectoryAttached={onTrajectoryAttached}
        />
      </div>

      <Viewport
        structure={active}
        reps={reps}
        focusSele={focusSele}
        onPick={setPick}
        onReady={(v) => (viewerRef.current = v)}
        trajUrl={trajUrl}
        frame={frame}
        nFrames={nFrames}
        dtPs={dtPs}
        playing={playing}
        onFrame={(i) => {
          setPlaying(false);
          setFrame(i);
        }}
        onTogglePlay={() => setPlaying((p) => !p)}
      />

      <div className="sidebar right">
        <SelectionTree structure={active} onFocus={focus} onAddRep={addRepFromSelection} onPick={setPicked} />
        <RepresentationStack reps={reps} disabled={!active} onChange={setReps} onFocus={focus} />
        <InspectorPanel
          structure={active}
          summary={activeId ? summaries[activeId] || null : null}
          pick={pick}
          onFocus={focus}
        />
        <AnalysisPanel
          structure={active}
          structures={structures}
          picked={picked}
          frame={nFrames > 1 ? frame : null}
          nFrames={nFrames}
        />
      </div>
    </div>
  );
}
