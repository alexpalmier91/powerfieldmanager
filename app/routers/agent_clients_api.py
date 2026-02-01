# app/routers/agent_clients_api.py
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Client, agent_client
from app.core.security import get_current_user  # user.id, user.role, user.agent_id

router = APIRouter(
    prefix="/api-zenhub/agent/clients",
    tags=["Agent - Clients"],
)

# ------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------

class ClientCreateIn(BaseModel):
    company_name: str
    contact: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    email: EmailStr
    groupement: Optional[str] = None
    phone: Optional[str] = None

    # infos bancaires
    iban: Optional[str] = None
    bic: Optional[str] = None
    payment_terms: Optional[str] = None


class ClientOut(BaseModel):
    id: int
    company_name: str
    email: str
    phone: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None

    class Config:
        from_attributes = True


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def role_guard(user: Any, roles: list[str]):
    if user is None or getattr(user, "role", None) not in roles:
        raise HTTPException(status_code=403, detail="Forbidden")


# ------------------------------------------------------------------
# POST /api-zenhub/agent/clients
# ------------------------------------------------------------------

@router.post("", response_model=ClientOut, status_code=201)
async def create_client_for_agent(
    payload: ClientCreateIn,
    session: AsyncSession = Depends(get_async_session),
    user: Any = Depends(get_current_user),
):
    """
    L’agent crée un nouveau client :
    - vérifie que l'email n'existe pas déjà (unicité)
    - crée le client dans la table client
    - crée la liaison dans agent_client avec l'agent courant
    """
    role_guard(user, ["AGENT", "SUPERUSER"])

    # 1) Email unique
    existing = await session.execute(
        select(Client).where(Client.email == payload.email)
    )
    existing_client = existing.scalar_one_or_none()
    if existing_client:
        raise HTTPException(
            status_code=400,
            detail="CLIENT_EMAIL_ALREADY_EXISTS",
        )

    # 2) Création du client
    # contact -> on le met dans first_name pour le moment (simple)
    client = Client(
        company_name=payload.company_name.strip(),
        first_name=(payload.contact or "").strip() or None,
        last_name=None,
        address1=(payload.address or "").strip() or None,
        postcode=(payload.postcode or "").strip() or None,
        city=(payload.city or "").strip() or None,
        country=(payload.country or "").strip() or None,
        email=payload.email,
        phone=(payload.phone or "").strip() or None,
        groupement=(payload.groupement or "").strip() or None,
        iban=(payload.iban or "").strip() or None,
        bic=(payload.bic or "").strip() or None,
        payment_terms=(payload.payment_terms or "").strip() or None,
    )

    if hasattr(Client, "created_at"):
        client.created_at = datetime.utcnow()

    session.add(client)
    await session.flush()  # => client.id

    # 3) Liaison agent_client
    agent_id: Optional[int] = getattr(user, "agent_id", None)
    if agent_id is None:
        raise HTTPException(
            status_code=400,
            detail="AGENT_ID_MISSING_FOR_USER",
        )

    await session.execute(
        sa.insert(agent_client).values(
            agent_id=agent_id,
            client_id=client.id,
        )
    )

    await session.commit()
    await session.refresh(client)

    return client
