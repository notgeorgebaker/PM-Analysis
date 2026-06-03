// Thin controller around an NGL Stage. React components drive it imperatively:
// load a structure, then declaratively sync a list of representation "layers".

import { Stage } from "ngl";

export interface RepSpec {
  id: string;
  type: string; // cartoon | surface | ball+stick | licorice | spacefill | backbone | ...
  sele: string; // VMD/NGL-style selection
  colorScheme: string; // uniform | chainid | resname | element | sstruc | bfactor
  colorValue: string; // hex, used when colorScheme === "uniform"
  opacity: number; // 0..1
  visible: boolean;
}

export interface PickInfo {
  resno: number;
  resname: string;
  chain: string;
  atom: string;
}

export class Viewer {
  private stage: Stage;
  private component: any = null;
  private reps = new Map<string, any>();
  onPick: ((info: PickInfo | null) => void) | null = null;

  constructor(element: HTMLElement) {
    this.stage = new Stage(element, {
      backgroundColor: "#13161b",
      quality: "high",
      cameraType: "perspective",
    });
    window.addEventListener("resize", this.handleResize);
    this.stage.signals.clicked.add((pickingProxy: any) => {
      if (pickingProxy && (pickingProxy.atom || pickingProxy.closestBondAtom)) {
        const a = pickingProxy.atom || pickingProxy.closestBondAtom;
        this.onPick?.({
          resno: a.resno,
          resname: a.resname,
          chain: a.chainname || a.chainid || "",
          atom: a.atomname,
        });
      } else {
        this.onPick?.(null);
      }
    });
  }

  private handleResize = () => this.stage.handleResize();

  async load(url: string, ext: string): Promise<void> {
    this.clear();
    const fmt = ext === "cif" || ext === "mmcif" ? "cif" : "pdb";
    this.component = await this.stage.loadFile(url, { ext: fmt });
    this.component.autoView();
  }

  clear(): void {
    this.reps.clear();
    this.stage.removeAllComponents();
    this.component = null;
  }

  /** Reconcile the on-screen representations with the desired spec list. */
  sync(specs: RepSpec[]): void {
    if (!this.component) return;
    const wanted = new Set(specs.map((s) => s.id));
    for (const [id, rep] of this.reps) {
      if (!wanted.has(id)) {
        this.component.removeRepresentation(rep);
        this.reps.delete(id);
      }
    }
    for (const spec of specs) {
      this.applyOne(spec);
    }
    this.stage.viewer.requestRender();
  }

  private applyOne(spec: RepSpec): void {
    // Rebuild the representation each sync — robust and cheap for a first draft.
    const existing = this.reps.get(spec.id);
    if (existing) {
      this.component.removeRepresentation(existing);
      this.reps.delete(spec.id);
    }
    if (!spec.visible) return;
    const params: any = {
      sele: spec.sele && spec.sele.trim() ? spec.sele : "all",
      opacity: spec.opacity,
      colorScheme: spec.colorScheme,
    };
    if (spec.colorScheme === "uniform") {
      params.color = spec.colorValue;
    }
    const rep = this.component.addRepresentation(spec.type, params);
    this.reps.set(spec.id, rep);
  }

  /** Transiently focus the camera on a selection. */
  focus(sele: string): void {
    if (this.component) this.component.autoView(sele, 500);
  }

  resetView(): void {
    if (this.component) this.component.autoView(1000);
  }

  dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    this.stage.dispose();
  }
}
