import { useEffect, useRef } from "react";
import { Viewer, RepSpec, PickInfo } from "../ngl-viewer";
import { api, StructureRef } from "../api";

interface Props {
  structure: StructureRef | null;
  reps: RepSpec[];
  focusSele: string | null;
  onPick: (info: PickInfo | null) => void;
  onReady: (v: Viewer) => void;
  // trajectory
  trajUrl: string | null;
  frame: number;
  nFrames: number;
  dtPs: number;
  playing: boolean;
  onFrame: (i: number) => void;
  onTogglePlay: () => void;
}

export function Viewport(props: Props) {
  const { structure, reps, focusSele, onPick, onReady, trajUrl, frame, nFrames, dtPs, playing, onFrame, onTogglePlay } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const loadedKey = useRef<string | null>(null);

  // Create the NGL stage once.
  useEffect(() => {
    if (!hostRef.current) return;
    const v = new Viewer(hostRef.current);
    v.onPick = onPick;
    viewerRef.current = v;
    onReady(v);
    return () => v.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load structure (and any attached trajectory) when the active one changes.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!structure) {
      v.clear();
      loadedKey.current = null;
      return;
    }
    const key = `${structure.id}|${trajUrl ?? ""}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    v.load(api.fileUrl(structure.id), structure.format, trajUrl).then(() => {
      v.sync(reps);
      v.setFrame(frame);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, trajUrl]);

  // Re-sync representations whenever they change.
  useEffect(() => {
    viewerRef.current?.sync(reps);
  }, [reps]);

  // Drive the viewer to the current frame.
  useEffect(() => {
    viewerRef.current?.setFrame(frame);
  }, [frame]);

  // Focus camera on request.
  useEffect(() => {
    if (focusSele && viewerRef.current) viewerRef.current.focus(focusSele);
  }, [focusSele]);

  const isTraj = nFrames > 1;
  const timeNs = (frame * dtPs) / 1000;

  return (
    <div className="viewport">
      <div className="ngl-host" ref={hostRef} />
      {!structure && (
        <div className="hint">
          Import a PDB, or fetch from RCSB / AlphaFold to begin.
          <br />
          Then sculpt representations on the right — non-destructively.
        </div>
      )}

      {structure && isTraj && (
        <>
          {/* bottom-left transport: play/pause + frame selector */}
          <div className="transport">
            <button className="play-btn" onClick={onTogglePlay} title={playing ? "Pause" : "Play"}>
              {playing ? "❚❚" : "▶"}
            </button>
            <select
              className="frame-select"
              value={frame}
              onChange={(e) => onFrame(parseInt(e.target.value))}
              title="Jump to frame"
            >
              {Array.from({ length: nFrames }, (_, i) => (
                <option key={i} value={i}>Frame {i + 1}</option>
              ))}
            </select>
            <input
              className="frame-scrub"
              type="range"
              min={0}
              max={nFrames - 1}
              value={frame}
              onChange={(e) => onFrame(parseInt(e.target.value))}
            />
          </div>

          {/* bottom-right frame + time readout */}
          <div className="frame-readout">
            <span className="fr-frame">Frame {frame + 1} / {nFrames}</span>
            <span className="fr-time">t = {timeNs.toFixed(timeNs < 1 ? 4 : 2)} ns</span>
          </div>
        </>
      )}
    </div>
  );
}
