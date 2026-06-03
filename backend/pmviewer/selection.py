"""Human-readable selection tree.

Turns a structure into a drillable tree of molecule types — Protein, Nucleic
acids, Lipids, Waters, Ions, Other/ligands — so the UI can offer plain-language
selection ("Alanine 1") instead of raw selection syntax. Every node carries
ready-made selection strings for *both* targets:

    ngl  -> drives the NGL viewport (representations, camera focus)
    mda  -> drives MDAnalysis-based analysis on the backend

The two viewer/analysis dialects are nearly identical to VMD's, but differ in
small ways (NGL ``:A`` / ``water`` vs MDAnalysis ``segid A`` / ``resname HOH``),
so we generate both here and let each consumer use the right one.
"""

from __future__ import annotations

from typing import Any

# 3-letter (and common variant) residue codes -> full names.
AMINO_ACIDS = {
    "ALA": "Alanine", "ARG": "Arginine", "ASN": "Asparagine", "ASP": "Aspartate",
    "CYS": "Cysteine", "GLN": "Glutamine", "GLU": "Glutamate", "GLY": "Glycine",
    "HIS": "Histidine", "ILE": "Isoleucine", "LEU": "Leucine", "LYS": "Lysine",
    "MET": "Methionine", "PHE": "Phenylalanine", "PRO": "Proline", "SER": "Serine",
    "THR": "Threonine", "TRP": "Tryptophan", "TYR": "Tyrosine", "VAL": "Valine",
    "SEC": "Selenocysteine", "PYL": "Pyrrolysine",
    # protonation / force-field variants
    "HSD": "Histidine", "HSE": "Histidine", "HSP": "Histidine",
    "HID": "Histidine", "HIE": "Histidine", "HIP": "Histidine",
    "CYX": "Cysteine", "CYM": "Cysteine", "ASH": "Aspartate", "GLH": "Glutamate",
    "LYN": "Lysine", "ARN": "Arginine", "TYM": "Tyrosine",
}
NUCLEOTIDES = {
    "DA": "Deoxyadenosine", "DT": "Deoxythymidine", "DG": "Deoxyguanosine",
    "DC": "Deoxycytidine", "DU": "Deoxyuridine",
    "A": "Adenosine", "U": "Uridine", "G": "Guanosine", "C": "Cytidine", "T": "Thymidine",
    "RA": "Adenosine", "RU": "Uridine", "RG": "Guanosine", "RC": "Cytidine",
    "ADE": "Adenine", "THY": "Thymine", "GUA": "Guanine", "CYT": "Cytosine", "URA": "Uracil",
}
WATER_RESNAMES = {"HOH", "WAT", "TIP3", "TIP4", "TIP5", "SPC", "SOL", "H2O", "T3P", "T4P"}
WATER_NAMES = {r: "Water" for r in WATER_RESNAMES}
ION_RESNAMES = {
    "NA": "Sodium", "SOD": "Sodium", "CL": "Chloride", "CLA": "Chloride",
    "K": "Potassium", "POT": "Potassium", "MG": "Magnesium", "CAL": "Calcium",
    "CA": "Calcium", "ZN": "Zinc", "FE": "Iron", "MN": "Manganese", "CU": "Copper",
    "LI": "Lithium", "RB": "Rubidium", "CS": "Caesium", "BR": "Bromide", "IOD": "Iodide",
}
# Common membrane-lipid residue names across CHARMM / Amber-Lipid / Martini.
LIPID_RESNAMES = {
    "POPC": "POPC", "POPE": "POPE", "POPS": "POPS", "POPG": "POPG", "POPI": "POPI",
    "POPA": "POPA", "DOPC": "DOPC", "DOPE": "DOPE", "DOPS": "DOPS", "DOPG": "DOPG",
    "DPPC": "DPPC", "DPPE": "DPPE", "DPPG": "DPPG", "DMPC": "DMPC", "DMPE": "DMPE",
    "DLPC": "DLPC", "DSPC": "DSPC", "DSPE": "DSPE", "SOPC": "SOPC", "PSM": "Sphingomyelin",
    "SSM": "Sphingomyelin", "DPSM": "Sphingomyelin", "CHL1": "Cholesterol",
    "CHOL": "Cholesterol", "CLR": "Cholesterol", "ERG": "Ergosterol",
    # Amber Lipid split-residue naming
    "PC": "Phosphatidylcholine", "PE": "Phosphatidylethanolamine", "PA": "Phosphatidate",
    "PS": "Phosphatidylserine", "PGR": "Phosphatidylglycerol", "OL": "Oleoyl tail",
}


def _full_name(resname: str) -> str:
    rn = resname.strip().upper()
    return (
        AMINO_ACIDS.get(rn)
        or NUCLEOTIDES.get(rn)
        or LIPID_RESNAMES.get(rn)
        or ION_RESNAMES.get(rn)
        or WATER_NAMES.get(rn)
        or rn  # unknown ligand: show the raw code
    )


def _resname_clause(resnames: set[str]) -> str:
    return "resname " + " ".join(sorted(resnames))


# Category definitions: (key, label, suggested NGL representation, ngl sel, mda sel).
# present/count/residues are filled in per-structure.
def _category_defs() -> list[dict[str, str]]:
    waters = " ".join(sorted(WATER_RESNAMES))
    ions = " ".join(sorted(ION_RESNAMES))
    lipids = " ".join(sorted(LIPID_RESNAMES))
    return [
        {"key": "protein", "label": "Protein", "rep": "cartoon",
         "ngl": "protein", "mda": "protein"},
        {"key": "nucleic", "label": "Nucleic acids", "rep": "cartoon",
         "ngl": "nucleic", "mda": "nucleic"},
        {"key": "lipids", "label": "Lipids", "rep": "licorice",
         "ngl": lipids, "mda": _resname_clause(set(LIPID_RESNAMES))},
        {"key": "water", "label": "Waters", "rep": "ball+stick",
         "ngl": "water", "mda": _resname_clause(WATER_RESNAMES)},
        {"key": "ions", "label": "Ions", "rep": "spacefill",
         "ngl": "ion", "mda": _resname_clause(set(ION_RESNAMES))},
    ]


def _residue_selectors(resid: int, segid: str, chain: str) -> dict[str, str]:
    ngl = f"{resid} and :{chain}" if chain.strip() else f"{resid}"
    mda = f"resid {resid} and segid {segid}" if segid.strip() else f"resid {resid}"
    return {"ngl": ngl, "mda": mda}


def selection_tree(universe, per_category_cap: int = 2000) -> dict[str, Any]:
    """Build the molecule-type selection tree for a structure."""
    claimed = universe.select_atoms("not all")  # empty AtomGroup to accumulate into
    categories: list[dict[str, Any]] = []

    for spec in _category_defs():
        try:
            atoms = universe.select_atoms(spec["mda"])
        except Exception:
            atoms = universe.select_atoms("not all")
        claimed = claimed.union(atoms)
        categories.append(_build_category(spec, atoms.residues, per_category_cap))

    # "Other / ligands" = whatever no known category claimed (set difference on atoms).
    other_atoms = universe.atoms.difference(claimed)
    categories.append(
        _build_category(
            {"key": "other", "label": "Other / ligands", "rep": "licorice",
             "ngl": "hetero and not (water or ion)", "mda": "not (protein or nucleic)"},
            other_atoms.residues, per_category_cap,
        )
    )

    return {"categories": categories}


def _build_category(spec: dict[str, str], residues, cap: int) -> dict[str, Any]:
    n = int(residues.n_residues) if hasattr(residues, "n_residues") else len(residues)
    out_residues = []
    truncated = False
    if n > 0:
        seq = list(residues)
        if len(seq) > cap:
            seq = seq[:cap]
            truncated = True
        for res in seq:
            segid = str(getattr(res, "segid", "") or "")
            try:
                chain = str(res.atoms.chainIDs[0]) if hasattr(res.atoms, "chainIDs") else ""
            except Exception:
                chain = ""
            resname = str(res.resname)
            out_residues.append(
                {
                    "label": _full_name(resname),
                    "resname": resname,
                    "resid": int(res.resid),
                    "segid": segid,
                    "chain": chain.strip(),
                    "selectors": _residue_selectors(int(res.resid), segid, chain),
                }
            )
    return {
        "key": spec["key"],
        "label": spec["label"],
        "rep": spec["rep"],
        "present": n > 0,
        "count": n,
        "selectors": {"ngl": spec["ngl"], "mda": spec["mda"]},
        "residues": out_residues,
        "truncated": truncated,
    }
