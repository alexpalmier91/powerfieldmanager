# app/routers/superuser_import_agent_client.py
from __future__ import annotations

from typing import Dict, List, Optional
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import sqlalchemy as sa
import pandas as pd
import io
import math

from app.db.session import get_async_session
from app.db.models import Agent, Client, agent_client
from app.core.security import require_role  # exige ["S","U"]

router = APIRouter(
    prefix="/api-zenhub/superuser",
    tags=["Superuser - Matching agents/clients"],
    dependencies=[Depends(require_role(["S", "U"]))],
)

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
def _normalize_header(h: str) -> str:
    return str(h or "").strip().lower().replace("-", " ").replace("_", " ")


def _detect_format(filename: str) -> str:
    n = (filename or "").lower()
    if n.endswith(".xlsx") or n.endswith(".xls"):
        return "excel"
    if n.endswith(".csv"):
        return "csv"
    return "unknown"


def _clean(val: Optional[str]) -> Optional[str]:
    try:
        if val is None:
            return None
        if isinstance(val, float) and math.isnan(val):
            return None
        if pd.isna(val):
            return None
    except Exception:
        pass
    s = str(val).strip()
    if not s:
        return None
    return s


# Colonnes attendues dans le fichier
HEADER_MAP = {
    "representant": "representant",
    "représentant": "representant",
    "representant nom": "representant",
    "agent": "representant",
    "commercial": "representant",

    "email": "email",
    "e-mail": "email",

    "cp": "cp",
    "code postal": "cp",
    "zipcode": "cp",
    "postcode": "cp",
}

# Regroupement des noms d’agents (alias -> nom canonique)
SIMILAR_AGENTS: Dict[str, List[str]] = {
    "PASCALE BERNARD": ["PASCALE BERNARD", "PASCALE BERNARD 2"],
    "CHARLOTTE PERES": ["PERES", "PERES 2"],
    "DAVID ATTIAS": ["DAVID", "DAVID2"],
    "CHRISTELLE VIAUD": ["CHRISTELLE VIAUD", "CHRISTELLE VIAUD 2"],
    "CHARLOTTE LECUYER": ["CHARLOTTE LECUYER", "CHARLOTTE LECUYER 2"],
    "VERONIQUE CHUPIN": ["CHUPIN", "CHUPIN VERONIQUE", "CHUPIN PAUL LOUP"],
    "CHRISTINE JAHN": ["CHRISTINE JAHN", "CHRISTINE JAHN 2"],
    "ISABELLE BIRE": ["ISABELLE BIRE", "ISABELLE BIRE 2"],
}


def _build_agent_alias_index() -> Dict[str, str]:
    """
    Construit un dict {alias_normalisé -> nom_canonique}
    pour faire le mapping des représentants.
    """
    idx: Dict[str, str] = {}
    for canonical, aliases in SIMILAR_AGENTS.items():
        for a in aliases:
            idx[a.strip().upper()] = canonical
    # on ajoute la forme canonique elle-même
    for canonical in SIMILAR_AGENTS.keys():
        idx[canonical.strip().upper()] = canonical
    return idx


AGENT_ALIAS_INDEX = _build_agent_alias_index()


def _normalize_agent_name(raw: Optional[str]) -> Optional[str]:
    """
    - nettoie la chaîne
    - applique le mapping SIMILAR_AGENTS si l’alias est connu
    """
    s = _clean(raw)
    if not s:
        return None
    key = s.upper()
    if key in AGENT_ALIAS_INDEX:
        return AGENT_ALIAS_INDEX[key]
    return s


async def _find_agent_by_representation(
    session: AsyncSession,
    rep_raw: Optional[str],
) -> Optional[Agent]:
    """
    Essaie de retrouver l'Agent à partir de la valeur "representant"
    venant du fichier Excel.

    Cas gérés :
      - "Prénom Nom"
      - "Nom Prénom"
      - "Nom" seul
    + passage par le mapping SIMILAR_AGENTS.
    """
    rep_norm = _normalize_agent_name(rep_raw)
    if not rep_norm:
        return None

    rep_upper = rep_norm.upper()
    tokens = [tok for tok in rep_upper.split() if tok]

    upper_first = sa.func.upper(sa.func.coalesce(Agent.firstname, ""))
    upper_last = sa.func.upper(sa.func.coalesce(Agent.lastname, ""))

    # Cas 1 : on a au moins 2 mots -> on essaye (prenom, nom) et (nom, prenom)
    if len(tokens) >= 2:
        first_candidate = tokens[0]
        last_candidate = tokens[-1]

        stmt = select(Agent).where(
            sa.or_(
                sa.and_(upper_first == first_candidate, upper_last == last_candidate),
                sa.and_(upper_first == last_candidate, upper_last == first_candidate),
            )
        )
        res = (await session.execute(stmt)).scalars().all()
        if len(res) == 1:
            return res[0]
        # s'il y a plusieurs résultats ou aucun, on ne s'avance pas plus

    # Cas 2 : un seul mot -> on matche sur firstname OU lastname
    if len(tokens) == 1:
        token = tokens[0]
        stmt = select(Agent).where(
            sa.or_(
                upper_first == token,
                upper_last == token,
            )
        )
        res = (await session.execute(stmt)).scalars().all()
        if len(res) == 1:
            return res[0]

    # Si tout échoue : pas d'agent trouvé
    return None


# -------------------------------------------------------------------
# Endpoint d’import : matching agent / client
# -------------------------------------------------------------------
@router.post("/import-agent-client")
async def import_agent_client_matching(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Import d’un fichier Excel/CSV avec 3 colonnes :
      - representant  (nom seul, ou 'prenom nom', ou 'nom prenom')
      - email         (client)
      - cp            (client)

    Process :
      1) lecture du fichier
      2) mapping des colonnes
      3) DELETE FROM agent_client
      4) pour chaque ligne :
         - trouver l’agent (logique robuste sur firstname/lastname)
         - trouver le client via (email + CP)
         - INSERT agent_client (agent_id, client_id)
           avec ON CONFLICT DO NOTHING
    """
    # 1) lecture brute
    try:
        raw = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de lire le fichier uploadé.")

    # 2) parse DataFrame
    fmt = _detect_format(file.filename or "")
    try:
        if fmt == "excel":
            df = pd.read_excel(io.BytesIO(raw), dtype=object)
        else:
            df = pd.read_csv(io.BytesIO(raw), dtype=object, sep=None, engine="python")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Fichier non lisible : {e}")

    if df is None or df.empty:
        raise HTTPException(status_code=400, detail="Fichier vide.")

    # 3) mapping d’en-têtes
    renamer: Dict[str, str] = {}
    for col in df.columns:
        target = HEADER_MAP.get(_normalize_header(col))
        if target:
            renamer[col] = target
    df = df.rename(columns=renamer)

    required = {"representant", "email", "cp"}
    if not required.issubset(df.columns):
        missing = sorted(list(required - set(df.columns)))
        raise HTTPException(
            status_code=400,
            detail=f"Colonnes manquantes : {', '.join(missing)} (attendu : representant, email, cp)",
        )

    # Nettoyage de base
    df["representant"] = df["representant"].map(_clean)
    df["email"] = df["email"].map(_clean)
    df["cp"] = df["cp"].map(_clean)

    total_rows = len(df)

    # 4) On vide la table agent_client avant de recréer tous les liens
    await session.execute(sa.text("DELETE FROM agent_client"))

    created_links = 0
    skipped_missing_data: List[int] = []
    skipped_no_agent: List[int] = []
    skipped_no_client: List[int] = []

    seen_pairs = set()

    for idx, r in df.iterrows():
        excel_line = idx + 2  # ligne Excel pour les logs

        rep = r.get("representant")
        email = r.get("email")
        cp = r.get("cp")

        if not rep or not email or not cp:
            skipped_missing_data.append(excel_line)
            continue

        # ---------- Agent ----------
        agent = await _find_agent_by_representation(session, rep)
        if not agent:
            skipped_no_agent.append(excel_line)
            continue

        # ---------- Client ----------
        client_q = await session.execute(
            select(Client).where(
                Client.email == email,
                Client.postcode == cp,
            )
        )
        client = client_q.scalars().first()
        if not client:
            skipped_no_client.append(excel_line)
            continue

        pair = (agent.id, client.id)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        # 5) insertion sécurisée : ON CONFLICT DO NOTHING
        await session.execute(
            sa.text(
                """
                INSERT INTO agent_client (agent_id, client_id)
                VALUES (:agent_id, :client_id)
                ON CONFLICT (agent_id, client_id) DO NOTHING
                """
            ),
            {"agent_id": agent.id, "client_id": client.id},
        )
        created_links += 1

    await session.commit()

    return {
        "rows_read": total_rows,
        "links_created": created_links,
        "rows_missing_data": len(skipped_missing_data),
        "rows_agent_not_found": len(skipped_no_agent),
        "rows_client_not_found": len(skipped_no_client),
        "warnings": {
            "missing_data_example_lines": skipped_missing_data[:20],
            "agent_not_found_example_lines": skipped_no_agent[:20],
            "client_not_found_example_lines": skipped_no_client[:20],
        },
    }
