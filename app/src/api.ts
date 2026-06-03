// Typed client for the PM-Analysis backend.

declare global {
  interface Window {
    PMA?: { apiBase: string };
  }
}

// In Electron the preload injects window.PMA.apiBase; in a plain browser dev
// session fall back to the default local port.
export const API_BASE =
  (typeof window !== "undefined" && window.PMA?.apiBase) || "http://127.0.0.1:8765";

export interface StructureRef {
  id: string;
  name: string;
  format: string;
  source: string;
}

export interface ChainInfo {
  id: string;
  n_atoms: number;
  n_residues: number;
  kind: string;
}

export interface Summary {
  id: string;
  n_atoms: number;
  n_residues: number;
  components: Record<string, number>;
  chains: ChainInfo[];
}

export interface ResidueRow {
  resname: string;
  resid: number;
  segid: string;
  n_atoms: number;
}

export interface SelectResult {
  selection: string;
  n_atoms: number;
  n_residues: number;
  residues: ResidueRow[];
  truncated: boolean;
}

export interface Selectors {
  ngl: string;
  mda: string;
}

export interface TreeResidue {
  label: string; // full residue name, e.g. "Alanine"
  resname: string;
  resid: number;
  segid: string;
  chain: string;
  selectors: Selectors;
}

export interface TreeCategory {
  key: string;
  label: string; // "Protein", "Lipids", ...
  rep: string; // suggested representation type
  present: boolean;
  count: number;
  selectors: Selectors;
  residues: TreeResidue[];
  truncated: boolean;
}

export interface SystemNode {
  key: string;
  label: string;
  rep: string;
  present: boolean;
  count: number; // residues
  n_atoms: number;
  selectors: Selectors;
}

export interface SelectionTree {
  system: SystemNode;
  categories: TreeCategory[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  fileUrl: (id: string) => `${API_BASE}/structures/${id}/file`,

  health: () => req<{ status: string }>("/health"),
  list: () => req<StructureRef[]>("/structures"),

  importFile: async (file: File): Promise<StructureRef> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/structures/import`, { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "import failed");
    return body;
  },
  fetchRcsb: (pdbId: string) =>
    req<StructureRef>(`/structures/fetch/rcsb/${encodeURIComponent(pdbId)}`, { method: "POST" }),
  fetchAlphafold: (uniprot: string) =>
    req<StructureRef>(`/structures/fetch/alphafold/${encodeURIComponent(uniprot)}`, { method: "POST" }),
  loadSample: (name: string) =>
    req<StructureRef>(`/structures/sample/${encodeURIComponent(name)}`, { method: "POST" }),

  remove: (id: string) => req<{ deleted: string }>(`/structures/${id}`, { method: "DELETE" }),

  summary: (id: string) => req<Summary>(`/structures/${id}/summary`),
  selectionTree: (id: string) => req<SelectionTree>(`/structures/${id}/selection-tree`),
  select: (id: string, selection: string) =>
    req<SelectResult>(`/structures/${id}/select`, {
      method: "POST",
      body: JSON.stringify({ selection }),
    }),
  residue: (id: string, resid: number, segid?: string) =>
    req<any>(`/structures/${id}/residue/${resid}${segid ? `?segid=${segid}` : ""}`),

  sasa: (id: string, selection?: string) =>
    req<any>(`/structures/${id}/analysis/sasa`, {
      method: "POST",
      body: JSON.stringify({ selection: selection || null }),
    }),
  distance: (id: string, sel_a: string, sel_b: string, mode: string, matrix = false) =>
    req<any>(`/structures/${id}/analysis/distance`, {
      method: "POST",
      body: JSON.stringify({ sel_a, sel_b, mode, matrix }),
    }),
  rmsf: (id: string, selection: string) =>
    req<any>(`/structures/${id}/analysis/rmsf`, {
      method: "POST",
      body: JSON.stringify({ selection }),
    }),
  rmsd: (ref_id: string, mobile_id: string, selection: string) =>
    req<any>(`/analysis/rmsd`, {
      method: "POST",
      body: JSON.stringify({ ref_id, mobile_id, selection }),
    }),
  hole: (id: string, selection: string) =>
    req<any>(`/structures/${id}/analysis/hole`, {
      method: "POST",
      body: JSON.stringify({ selection }),
    }),
  helix: (id: string, selection: string, ref_axis: string) =>
    req<any>(`/structures/${id}/analysis/helix`, {
      method: "POST",
      body: JSON.stringify({ selection, ref_axis }),
    }),
};
