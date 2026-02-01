# app/routers/labo_agents.py
from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_async_session
from app.db.models import Agent, labo_agent
from app.core.security import get_current_subject
from app.routers.labo_products_api import get_current_labo

from pydantic import BaseModel

router = APIRouter(
    prefix="/api-zenhub/labo",
    tags=["labo-agents"],
)

# -----------------------------
# Pydantic response schema
# -----------------------------
class AgentItem(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    code: Optional[str] = None
    is_active: bool


class AgentListResponse(BaseModel):
    items: List[AgentItem]
    total: int
    page: int
    page_size: int


# -----------------------------
# API : liste des agents du labo
# -----------------------------
@router.get("/agents", response_model=AgentListResponse)
async def list_labo_agents(
    session: AsyncSession = Depends(get_async_session),
    labo = Depends(get_current_labo),  # récupère automatiquement le labo du token
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort: str = Query("name"),
    dir: str = Query("asc"),
):
    """
    Liste les agents rattachés au laboratoire connecté.
    """

    # Colonnes de tri autorisées
    sort_map = {
        "name": Agent.name,
        "city": Agent.city,
        "postal_code": Agent.postal_code,
    }

    order_col = sort_map.get(sort, Agent.name)  # défaut : tri par nom
    order_col = order_col.desc() if dir == "desc" else order_col.asc()

    # Base query : jointure sur labo_agent
    stmt = (
        select(Agent)
        .join(labo_agent, labo_agent.c.agent_id == Agent.id)
        .where(labo_agent.c.labo_id == labo.id)
        .where(Agent.is_active == True)
    )

    # Search
    if search:
        s = f"%{search.lower()}%"
        stmt = stmt.where(
            func.lower(Agent.name).like(s)
            | func.lower(Agent.email).like(s)
            | func.lower(Agent.city).like(s)
            | func.lower(Agent.code).like(s)
        )

    # Total
    total_stmt = stmt.with_only_columns(func.count()).order_by(None)
    total = (await session.execute(total_stmt)).scalar_one()

    # Pagination
    offset = (page - 1) * page_size
    stmt = stmt.order_by(order_col).offset(offset).limit(page_size)

    res = await session.execute(stmt)
    agents = res.scalars().all()

    items = [
        AgentItem(
            id=a.id,
            name=a.name,
            email=a.email,
            phone=a.phone,
            city=a.city,
            postal_code=a.postal_code,
            code=a.code,
            is_active=a.is_active,
        )
        for a in agents
    ]

    return AgentListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )
