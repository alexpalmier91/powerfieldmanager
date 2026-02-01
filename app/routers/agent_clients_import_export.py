# app/routers/agent_clients_import_export.py
from __future__ import annotations

from typing import List, Dict, Any, Optional
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import sqlalchemy as sa

from app.db.session import get_async_session
from app.db.models import (
    Agent,
    Client,
    agent_client,
)
from app.core.security import require_role
from app.routers.agent_clients import get_current_agent

from app.services.agent_clients_excel import (
    build_clients_excel,
    parse_clients_excel,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api-zenhub/agent/clients",
    tags=["agent-clients-import-export"],
)


def _norm(s: str | None) -> str:
    if not s:
        return ""
    s = s.strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def _phone_norm(p: str | None) -> str:
    if not p:
        return ""
    digits = re.sub(r"\D+", "", p)
    if digits.startswith("33") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


# =========================================================
# EXPORT XLSX (agent-level)
# GET /api-zenhub/agent/clients/export.xlsx
# =========================================================
@router.get("/export.xlsx")
async def export_clients_excel(
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
    _role=Depends(require_role("AGENT")),
):
    """
    Export des clients accessibles à l'agent (agent_client).
    Pas de notion code_client (labo) ici.
    """
    print("[AGENT_CLIENTS_IMPORT] GET export.xlsx")

    stmt = (
        select(
            Client.company_name.label("nom_societe"),
            sa.func.trim(
                sa.func.concat(
                    sa.func.coalesce(Client.first_name, ""),
                    sa.literal(" "),
                    sa.func.coalesce(Client.last_name, ""),
                )
            ).label("contact_nom"),
            Client.email.label("email"),
            Client.phone.label("telephone"),
            Client.address1.label("adresse"),
            Client.postcode.label("code_postal"),
            Client.city.label("ville"),
            Client.country.label("pays"),
            Client.siret.label("siret"),
            sa.literal(None).label("tva_intracom"),  # pas dans ton modèle Client
            sa.literal(True).label("actif"),         # pas de champ is_active => TRUE
            Client.created_at.label("created_at"),
        )
        .select_from(Client)
        .join(agent_client, agent_client.c.client_id == Client.id)
        .where(agent_client.c.agent_id == agent.id)
        .order_by(Client.company_name.asc())
    )

    result = await session.execute(stmt)
    rows = [dict(r._mapping) for r in result.all()]

    buffer = build_clients_excel(rows)

    filename = f"clients_agent_{agent.id}_.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# =========================================================
# IMPORT XLSX (agent-level upsert)
# POST /api-zenhub/agent/clients/import.xlsx
# =========================================================
@router.post("/import.xlsx")
async def import_clients_excel(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
    _role=Depends(require_role("AGENT")),
):
    """
    Import depuis le XLSX exporté (mêmes colonnes).
    Pas de code_client, pas de LaboClient.

    Upsert "smart" (ordre):
      1) email (si présent)
      2) téléphone (si présent)
      3) empreinte société+cp+ville+adresse
      4) sinon create
    """
    print("[AGENT_CLIENTS_IMPORT] POST import.xlsx")

    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Format invalide. Fichier .xlsx requis.")

    content = await file.read()
    parsed_rows, parse_errors = parse_clients_excel(content)

    created = 0
    updated = 0
    skipped = 0
    errors: List[Dict[str, Any]] = []

    for pe in parse_errors:
        errors.append({"row_index": 1, "code_client": None, "message": pe})

    for row in parsed_rows:
        row_index = row.get("_row_index", 0)

        # Validation minimale
        nom_societe = (row.get("nom_societe") or "").strip()
        if not nom_societe:
            skipped += 1
            errors.append({
                "row_index": row_index,
                "code_client": None,
                "message": "nom_societe manquant",
            })
            continue

        if row.get("_invalid_email"):
            skipped += 1
            errors.append({
                "row_index": row_index,
                "code_client": None,
                "message": "Email invalide",
            })
            continue

        # Payload Client (mapping)
        client_payload: Dict[str, Any] = {
            "company_name": nom_societe,
            "email": (row.get("email") or None),
            "phone": (row.get("telephone") or None),
            "address1": (row.get("adresse") or None),
            "postcode": (row.get("code_postal") or None),
            "city": (row.get("ville") or None),
            "country": (row.get("pays") or None),
            "siret": (row.get("siret") or None),
        }

        # contact_nom -> first_name / last_name (split simple)
        contact = (row.get("contact_nom") or "").strip()
        if contact:
            parts = [p for p in contact.split(" ") if p]
            if len(parts) == 1:
                client_payload["first_name"] = parts[0]
                client_payload["last_name"] = None
            else:
                client_payload["first_name"] = parts[0]
                client_payload["last_name"] = " ".join(parts[1:])

        # --- Recherche candidat existant
        client: Optional[Client] = None

        email_norm = _norm(client_payload.get("email"))
        phone_norm = _phone_norm(client_payload.get("phone"))
        company_norm = _norm(client_payload.get("company_name"))
        postcode_norm = _norm(client_payload.get("postcode"))
        city_norm = _norm(client_payload.get("city"))
        addr_norm = _norm(client_payload.get("address1"))

        # 1) email
        if email_norm:
            stmt = select(Client).where(
                sa.func.lower(sa.func.coalesce(Client.email, "")) == email_norm
            ).limit(1)
            client = (await session.scalars(stmt)).first()

        # 2) phone
        if client is None and phone_norm:
            stmt = select(Client).where(
                sa.func.regexp_replace(sa.func.coalesce(Client.phone, ""), r"\D+", "", "g") == phone_norm
            ).limit(1)
            client = (await session.scalars(stmt)).first()

        # 3) empreinte
        if client is None and company_norm:
            conds = [sa.func.lower(sa.func.coalesce(Client.company_name, "")) == company_norm]
            if postcode_norm:
                conds.append(sa.func.lower(sa.func.coalesce(Client.postcode, "")) == postcode_norm)
            if city_norm:
                conds.append(sa.func.lower(sa.func.coalesce(Client.city, "")) == city_norm)
            if addr_norm:
                conds.append(sa.func.lower(sa.func.coalesce(Client.address1, "")) == addr_norm)

            stmt = select(Client).where(sa.and_(*conds)).limit(1)
            client = (await session.scalars(stmt)).first()

        try:
            if client:
                # UPDATE (sans toucher created_at)
                for k, v in client_payload.items():
                    if hasattr(client, k):
                        setattr(client, k, v)

                # Lien agent_client si manquant
                stmt_link = select(sa.literal(True)).select_from(agent_client).where(
                    agent_client.c.agent_id == agent.id,
                    agent_client.c.client_id == client.id,
                )
                linked = (await session.scalar(stmt_link)) or False
                if not linked:
                    await session.execute(
                        agent_client.insert().values(agent_id=agent.id, client_id=client.id)
                    )

                updated += 1

            else:
                # CREATE + lien agent_client
                client = Client(**{k: v for k, v in client_payload.items() if hasattr(Client, k)})
                session.add(client)
                await session.flush()

                await session.execute(
                    agent_client.insert().values(agent_id=agent.id, client_id=client.id)
                )

                created += 1

        except Exception as exc:
            logger.exception("[AGENT_CLIENTS_IMPORT] Import row failed row=%s", row_index)
            skipped += 1
            errors.append({
                "row_index": row_index,
                "code_client": None,
                "message": f"Erreur import: {exc}",
            })

    await session.commit()

    return {
        "total_rows": len(parsed_rows),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors[:10],
    }
