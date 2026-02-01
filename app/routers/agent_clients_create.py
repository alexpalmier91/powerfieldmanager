# app/routers/agent_clients_create.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Client, Agent, agent_client
from app.core.security import get_current_user

router = APIRouter(
    prefix="/api-zenhub/agent",
    tags=["agent-clients-create"],
)


# ------- récup agent courant --------------------------------------
async def get_current_agent(
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> Agent:
    if isinstance(current_user, dict):
        agent_id = current_user.get("agent_id")
    else:
        agent_id = getattr(current_user, "agent_id", None)

    if not agent_id:
        raise HTTPException(
            status_code=403,
            detail="Aucun agent rattaché à cet utilisateur",
        )

    agent = await session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")
    return agent


# ------- schéma de création client --------------------------------
class AgentClientCreate(BaseModel):
    company_name: str
    contact: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    email: EmailStr
    groupement: Optional[str] = None
    phone: Optional[str] = None
    iban: Optional[str] = None
    bic: Optional[str] = None
    payment_terms: Optional[str] = None
    credit_limit: Optional[float] = None


# ------- POST /api-zenhub/agent/clients/new -----------------------
@router.post("/clients/new", status_code=201)
async def create_agent_client(
    payload: AgentClientCreate,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    # Vérif email unique
    existing = await session.execute(
        select(Client).where(Client.email == payload.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="CLIENT_EMAIL_ALREADY_EXISTS",
        )

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
        credit_limit=payload.credit_limit,
        created_at=datetime.utcnow(),
    )

    session.add(client)
    await session.flush()  # id disponible

    await session.execute(
        sa.insert(agent_client).values(
            agent_id=agent.id,
            client_id=client.id,
        )
    )

    await session.commit()

    return {
        "id": client.id,
        "company": client.company_name,
        "zipcode": client.postcode,
        "city": client.city,
        "email": client.email,
        "phone": client.phone,
        "groupement": client.groupement,
    }
