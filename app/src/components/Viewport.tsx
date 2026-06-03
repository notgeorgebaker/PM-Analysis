import { useEffect, useRef } from "react";
import { Viewer, RepSpec, PickInfo } from "../ngl-viewer";
import { api, StructureRef } from "../api";

interface Props {
  structure: StructureRef | null;
  reps: RepSpec[];
  focusSele: string | null;
  onPick: (info: PickInfo | null) => void;
  onReady: (v: Viewer) => void;
}

export function Viewport({ structure, reps, focusSele, onPick, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const loadedId = useRef<string | null>(null);

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

  // Load structure when the active one changes.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!structure) {
      v.clear();
      loadedId.current = null;
      return;
    }
    if (loadedId.current === structure.id) return;
    loadedId.current = structure.id;
    v.load(api.fileUrl(structure.id), structure.format).then(() => v.sync(reps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure]);

  // Re-sync representations whenever they change.
  useEffect(() => {
    viewerRef.current?.sync(reps);
  }, [reps]);

  // Focus camera on request.
  useEffect(() => {
    if (focusSele && viewerRef.current) viewerRef.current.focus(focusSele);
  }, [focusSele]);

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
    </div>
  );
}
