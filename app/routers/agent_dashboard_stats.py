# app/routers/agent_dashboard_stats.py
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import (
    Order,
    OrderItem,
    Product,
    Labo,
    Agent,
    labo_agent,  # table d'association agent <-> labo
)
from app.core.security import get_current_user

router = APIRouter(
    prefix="/api-zenhub/agent",
    tags=["agent"],
)

# =========================================================
#  Helper : récupérer l'agent courant
# =========================================================


async def get_current_agent(
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> Agent:
    """
    Récupère l'agent courant à partir du user authentifié.
    On exige un agent_id.
    """
    if isinstance(current_user, dict):
        role = current_user.get("role")
        agent_id = current_user.get("agent_id")
        email = current_user.get("email")
    else:
        role = getattr(current_user, "role", None)
        agent_id = getattr(current_user, "agent_id", None)
        email = getattr(current_user, "email", None)

    print(
        f"[get_current_agent.dashboard] role={role!r} "
        f"agent_id={agent_id!r} email={email!r}"
    )

    if not agent_id:
        raise HTTPException(
            status_code=403,
            detail="Aucun agent rattaché à cet utilisateur",
        )

    agent = await session.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")

    return agent


# =========================================================
#  Schémas de réponse
# =========================================================


class LaboCA(BaseModel):
    labo_id: int
    labo_name: str
    ca_total: float


class DailyCA(BaseModel):
    date: str  # "YYYY-MM-DD"
    total_ht: float


class AgentDashboardStats(BaseModel):
    ca_month: float
    ca_year: float
    commission_month: float
    commission_year: float
    active_clients_12m: int
    labo_count: int
    ca_by_labo: list[LaboCA]
    daily_ca: list[DailyCA]


# =========================================================
#  GET /api-zenhub/agent/dashboard/stats
# =========================================================


@router.get("/dashboard/stats", response_model=AgentDashboardStats)
async def agent_dashboard_stats(
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
) -> Any:
    """
    Statistiques globales pour l’agent connecté :
      - CA mois en cours
      - CA année en cours
      - Commission mois en cours
      - Commission année en cours
      - nb clients actifs sur 12 mois (au moins une commande)
      - nb de labos partenaires (labo_agent)
      - CA par labo (12 derniers mois)
      - CA par jour du mois en cours
    """

    today = date.today()
    start_of_month = date(today.year, today.month, 1)
    start_of_year = date(today.year, 1, 1)
    one_year_ago = today - timedelta(days=365)

    # ---------- CA TOTAL MOIS EN COURS ----------
    ca_month_stmt = select(func.coalesce(func.sum(Order.total_ht), 0)).where(
        Order.agent_id == agent.id,
        Order.order_date >= start_of_month,
    )
    ca_month = (await session.execute(ca_month_stmt)).scalar_one() or 0
    ca_month = float(ca_month)

    # ---------- CA TOTAL ANNÉE EN COURS ----------
    ca_year_stmt = select(func.coalesce(func.sum(Order.total_ht), 0)).where(
        Order.agent_id == agent.id,
        Order.order_date >= start_of_year,
    )
    ca_year = (await session.execute(ca_year_stmt)).scalar_one() or 0
    ca_year = float(ca_year)

    # ---------- COMMISSIONS (en €) ----------
    # Commission par ligne : line_ht * (commission% / 100)
    commission_line_expr = (
        OrderItem.line_ht * (func.coalesce(Product.commission, 0) / 100.0)
    )

    # Mois en cours
    commission_month_stmt = (
        select(func.coalesce(func.sum(commission_line_expr), 0))
        .select_from(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(Product, Product.id == OrderItem.product_id)
        .where(
            Order.agent_id == agent.id,
            Order.order_date >= start_of_month,
        )
    )
    commission_month = (
        (await session.execute(commission_month_stmt)).scalar_one() or 0
    )
    commission_month = float(commission_month)

    # Année en cours
    commission_year_stmt = (
        select(func.coalesce(func.sum(commission_line_expr), 0))
        .select_from(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(Product, Product.id == OrderItem.product_id)
        .where(
            Order.agent_id == agent.id,
            Order.order_date >= start_of_year,
        )
    )
    commission_year = (await session.execute(commission_year_stmt)).scalar_one() or 0
    commission_year = float(commission_year)

    # ---------- CLIENTS ACTIFS (12 DERNIERS MOIS) ----------
    active_clients_stmt = select(
        func.count(sa.distinct(Order.client_id))
    ).where(
        Order.agent_id == agent.id,
        Order.order_date >= one_year_ago,
    )
    active_clients_12m = (await session.execute(active_clients_stmt)).scalar_one() or 0
    active_clients_12m = int(active_clients_12m)

    # ---------- NOMBRE DE LABOS PARTENAIRES ----------
    labo_count_stmt = select(func.count(sa.distinct(labo_agent.c.labo_id))).where(
        labo_agent.c.agent_id == agent.id
    )
    labo_count = (await session.execute(labo_count_stmt)).scalar_one() or 0
    labo_count = int(labo_count)

    # ---------- CA PAR LABO (12 DERNIERS MOIS) ----------
    ca_total_expr = func.coalesce(func.sum(Order.total_ht), 0).label("ca_total")

    ca_by_labo_stmt = (
        select(
            Labo.id.label("labo_id"),
            Labo.name.label("labo_name"),
            ca_total_expr,
        )
        .join(Order, Order.labo_id == Labo.id)
        .where(
            Order.agent_id == agent.id,
            Order.order_date >= one_year_ago,
        )
        .group_by(Labo.id, Labo.name)
        .order_by(sa.desc(ca_total_expr))
    )

    ca_by_labo_rows = (await session.execute(ca_by_labo_stmt)).all()

    ca_by_labo: list[LaboCA] = [
        LaboCA(
            labo_id=row.labo_id,
            labo_name=row.labo_name,
            ca_total=float(row.ca_total or 0),
        )
        for row in ca_by_labo_rows
    ]

    # ---------- CA PAR JOUR (MOIS EN COURS) ----------
    day_expr = func.date_trunc("day", Order.order_date).label("day")
    total_ht_expr = func.coalesce(func.sum(Order.total_ht), 0).label("total_ht")

    daily_stmt = (
        select(day_expr, total_ht_expr)
        .where(
            Order.agent_id == agent.id,
            Order.order_date >= start_of_month,
        )
        .group_by(day_expr)
        .order_by(day_expr)
    )

    daily_rows = (await session.execute(daily_stmt)).all()

    daily_ca: list[DailyCA] = []
    for row in daily_rows:
        d = row.day
        if isinstance(d, datetime):
            d = d.date()
        daily_ca.append(
            DailyCA(
                date=d.isoformat(),
                total_ht=float(row.total_ht or 0),
            )
        )

    # Petit log pour vérifier facilement les valeurs
    print(
        f"[DASHBOARD] agent_id={agent.id} "
        f"ca_month={ca_month} ca_year={ca_year} "
        f"commission_month={commission_month} commission_year={commission_year}"
    )

    return AgentDashboardStats(
        ca_month=ca_month,
        ca_year=ca_year,
        commission_month=commission_month,
        commission_year=commission_year,
        active_clients_12m=active_clients_12m,
        labo_count=labo_count,
        ca_by_labo=ca_by_labo,
        daily_ca=daily_ca,
    )
