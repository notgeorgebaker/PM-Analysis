"""Remote structure fetching: RCSB PDB and AlphaFold DB.

These hit external hosts, so they fail gracefully with a clear message when the
machine is offline or the id doesn't exist.
"""

from __future__ import annotations

import httpx

RCSB_PDB = "https://files.rcsb.org/download/{pdb_id}.pdb"
RCSB_CIF = "https://files.rcsb.org/download/{pdb_id}.cif"
# AlphaFold DB stores predicted models keyed by UniProt accession.
ALPHAFOLD_PDB = "https://alphafold.ebi.ac.uk/files/AF-{uniprot}-F1-model_v4.pdb"
ALPHAFOLD_CIF = "https://alphafold.ebi.ac.uk/files/AF-{uniprot}-F1-model_v4.cif"

_TIMEOUT = httpx.Timeout(30.0)


def _get(url: str) -> bytes:
    try:
        resp = httpx.get(url, timeout=_TIMEOUT, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Network error fetching {url}: {exc}") from exc
    if resp.status_code == 404:
        raise FileNotFoundError(f"Not found: {url}")
    resp.raise_for_status()
    return resp.content


def fetch_rcsb(pdb_id: str, fmt: str = "pdb") -> tuple[bytes, str]:
    pdb_id = pdb_id.strip().lower()
    if not pdb_id.isalnum() or len(pdb_id) != 4:
        raise ValueError(f"'{pdb_id}' is not a valid 4-character PDB id")
    url = (RCSB_CIF if fmt == "cif" else RCSB_PDB).format(pdb_id=pdb_id)
    return _get(url), fmt


def fetch_alphafold(uniprot: str, fmt: str = "pdb") -> tuple[bytes, str]:
    uniprot = uniprot.strip().upper()
    if not uniprot.isalnum():
        raise ValueError(f"'{uniprot}' is not a valid UniProt accession")
    url = (ALPHAFOLD_CIF if fmt == "cif" else ALPHAFOLD_PDB).format(uniprot=uniprot)
    return _get(url), fmt
