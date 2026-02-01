# app/routers/labo_dashboard_stats.py
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, List

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import (
    Labo,
    LaboDocument,
    Product,
    Agent,
)
from app.core.security import get_current_user

router = APIRouter(
    prefix="/api-zenhub/labo",
    tags=["labo"],
)

# =========================================================
#  Helper : récupérer le labo courant
# =========================================================


async def get_current_labo(
    current_user=Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> Labo:
    """
    Récupère le labo courant à partir de l'utilisateur authentifié.
    On exige un labo_id.
    """
    if isinstance(current_user, dict):
        role = current_user.get("role")
        labo_id = current_user.get("labo_id")
        email = current_user.get("email")
    else:
        role = getattr(current_user, "role", None)
        labo_id = getattr(current_user, "labo_id", None)
        email = getattr(current_user, "email", None)

    print(
        f"[get_current_labo.dashboard] role={role!r} "
        f"labo_id={labo_id!r} email={email!r}"
    )

    if not labo_id:
        raise HTTPException(
            status_code=403,
            detail="Aucun labo rattaché à cet utilisateur",
        )

    labo = await session.get(Labo, labo_id)
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    return labo


# =========================================================
#  Schémas de réponse
# =========================================================


class LaboDashboardSummary(BaseModel):
    ca_month_ht: float
    ca_year_ht: float
    orders_today: int
    active_clients_12m: int
    active_agents_12m: int
    out_of_stock_products: int


class DailySalesPoint(BaseModel):
    date: str  # "YYYY-MM-DD"
    ca_ht: float


class MonthlySalesPoint(BaseModel):
    month: str  # "YYYY-MM-01"
    ca_ht: float


# =========================================================
#  Helpers dates
# =========================================================


def _month_bounds(d: date) -> tuple[date, date]:
    """Retourne (1er jour du mois, 1er jour du mois suivant)."""
    start = date(d.year, d.month, 1)
    if d.month == 12:
        end = date(d.year + 1, 1, 1)
    else:
        end = date(d.year, d.month + 1, 1)
    return start, end


def _year_bounds(d: date) -> tuple[date, date]:
    """Retourne (1er jour de l'année, 1er jour de l'année suivante)."""
    start = date(d.year, 1, 1)
    end = date(d.year + 1, 1, 1)
    return start, end


def _twelve_months_bounds(d: date) -> tuple[date, date]:
    """
    12 derniers mois glissants :
    Du même mois l'année précédente inclus,
    jusqu'au 1er jour du mois suivant exclus.
    """
    month_start, month_next = _month_bounds(d)
    start = date(d.year - 1, month_start.month, 1)
    end = month_next
    return start, end


# =========================================================
#  GET /api-zenhub/labo/dashboard/summary
# =========================================================


@router.get("/dashboard/summary", response_model=LaboDashboardSummary)
async def labo_dashboard_summary(
    session: AsyncSession = Depends(get_async_session),
    labo: Labo = Depends(get_current_labo),
) -> Any:
    """
    Indicateurs globaux pour le labo connecté :
      - CA HT mois en cours (factures FA)
      - CA HT année en cours (factures FA)
      - Commandes agents du jour (FA/BL/BC)
      - Clients actifs sur 12 mois (au moins un doc FA/BL/BC)
      - Agents actifs sur 12 mois
      - Produits en rupture (stock <= 0)
    """
    today = date.today()
    start_of_month, end_of_month = _month_bounds(today)
    start_of_year, end_of_year = _year_bounds(today)
    last12_start, last12_end = _twelve_months_bounds(today)

    # ---------- CA MOIS EN COURS (FA) ----------
    ca_month_stmt = select(func.coalesce(func.sum(LaboDocument.total_ht), 0)).where(
        LaboDocument.labo_id == labo.id,
        LaboDocument.type == "FA",
        LaboDocument.order_date >= start_of_month,
        LaboDocument.order_date < end_of_month,
    )
    ca_month = (await session.execute(ca_month_stmt)).scalar_one() or 0
    ca_month = float(ca_month)

    # ---------- CA ANNÉE EN COURS (FA) ----------
    ca_year_stmt = select(func.coalesce(func.sum(LaboDocument.total_ht), 0)).where(
        LaboDocument.labo_id == labo.id,
        LaboDocument.type == "FA",
        LaboDocument.order_date >= start_of_year,
        LaboDocument.order_date < end_of_year,
    )
    ca_year = (await session.execute(ca_year_stmt)).scalar_one() or 0
    ca_year = float(ca_year)

    # ---------- COMMANDES AGENTS DU JOUR ----------
    # Tous les documents de vente : FA + BL + BC
    orders_today_stmt = select(func.count(LaboDocument.id)).where(
        LaboDocument.labo_id == labo.id,
        LaboDocument.order_date == today,
        LaboDocument.type.in_(["FA", "BL", "BC"]),
    )
    orders_today = (await session.execute(orders_today_stmt)).scalar_one() or 0
    orders_today = int(orders_today)

    # ---------- CLIENTS ACTIFS (12 DERNIERS MOIS) ----------
    active_clients_stmt = select(
        func.count(sa.distinct(LaboDocument.client_id))
    ).where(
        LaboDocument.labo_id == labo.id,
        LaboDocument.order_date >= last12_start,
        LaboDocument.order_date < last12_end,
        LaboDocument.type.in_(["FA", "BL", "BC"]),
        LaboDocument.client_id.is_not(None),
    )
    active_clients_12m = (
        (await session.execute(active_clients_stmt)).scalar_one() or 0
    )
    active_clients_12m = int(active_clients_12m)

    # ---------- AGENTS ACTIFS (12 DERNIERS MOIS) ----------
    active_agents_stmt = select(
        func.count(sa.distinct(LaboDocument.agent_id))
    ).where(
        LaboDocument.labo_id == labo.id,
        LaboDocument.order_date >= last12_start,
        LaboDocument.order_date < last12_end,
        LaboDocument.type.in_(["FA", "BL", "BC"]),
        LaboDocument.agent_id.is_not(None),
    )
    active_agents_12m = (
        (await session.execute(active_agents_stmt)).scalar_one() or 0
    )
    active_agents_12m = int(active_agents_12m)

    # ---------- PRODUITS EN RUPTURE (stock <= 0) ----------
    out_of_stock_stmt = select(func.count(Product.id)).where(
        Product.labo_id == labo.id,
        Product.stock <= 0,
    )
    out_of_stock_products = (
        (await session.execute(out_of_stock_stmt)).scalar_one() or 0
    )
    out_of_stock_products = int(out_of_stock_products)

    print(
        f"[LABO_DASHBOARD] labo_id={labo.id} "
        f"ca_month={ca_month} ca_year={ca_year} "
        f"orders_today={orders_today} "
        f"active_clients_12m={active_clients_12m} "
        f"active_agents_12m={active_agents_12m} "
        f"out_of_stock={out_of_stock_products}"
    )

    return LaboDashboardSummary(
        ca_month_ht=ca_month,
        ca_year_ht=ca_year,
        orders_today=orders_today,
        active_clients_12m=active_clients_12m,
        active_agents_12m=active_agents_12m,
        out_of_stock_products=out_of_stock_products,
    )


# =========================================================
#  GET /api-zenhub/labo/dashboard/daily-sales
# =========================================================


@router.get("/dashboard/daily-sales", response_model=List[DailySalesPoint])
async def labo_daily_sales(
    session: AsyncSession = Depends(get_async_session),
    labo: Labo = Depends(get_current_labo),
) -> Any:
    """
    CA HT par jour (factures FA) pour le mois en cours.
    """
    today = date.today()
    start_of_month, end_of_month = _month_bounds(today)

    day_expr = func.date_trunc("day", LaboDocument.order_date).label("day")
    total_expr = func.coalesce(func.sum(LaboDocument.total_ht), 0).label("total_ht")

    daily_stmt = (
        select(day_expr, total_expr)
        .where(
            LaboDocument.labo_id == labo.id,
            LaboDocument.type == "FA",
            LaboDocument.order_date >= start_of_month,
            LaboDocument.order_date < end_of_month,
        )
        .group_by(day_expr)
        .order_by(day_expr)
    )

    rows = (await session.execute(daily_stmt)).all()

    points: list[DailySalesPoint] = []
    for row in rows:
        d = row.day
        if isinstance(d, datetime):
            d = d.date()
        points.append(
            DailySalesPoint(
                date=d.isoformat(),
                ca_ht=float(row.total_ht or 0),
            )
        )

    return points


# =========================================================
#  GET /api-zenhub/labo/dashboard/monthly-sales
# =========================================================


@router.get("/dashboard/monthly-sales", response_model=List[MonthlySalesPoint])
async def labo_monthly_sales(
    session: AsyncSession = Depends(get_async_session),
    labo: Labo = Depends(get_current_labo),
) -> Any:
    """
    CA HT mensuel (factures FA) sur les 12 derniers mois glissants.
    """
    today = date.today()
    last12_start, last12_end = _twelve_months_bounds(today)

    month_expr = func.date_trunc("month", LaboDocument.order_date).label("month")
    total_expr = func.coalesce(func.sum(LaboDocument.total_ht), 0).label("total_ht")

    monthly_stmt = (
        select(month_expr, total_expr)
        .where(
            LaboDocument.labo_id == labo.id,
            LaboDocument.type == "FA",
            LaboDocument.order_date >= last12_start,
            LaboDocument.order_date < last12_end,
        )
        .group_by(month_expr)
        .order_by(month_expr)
    )

    rows = (await session.execute(monthly_stmt)).all()

    points: list[MonthlySalesPoint] = []
    for row in rows:
        m = row.month
        if isinstance(m, datetime):
            m = m.date()
        # on renvoie le 1er du mois en ISO : "YYYY-MM-01"
        points.append(
            MonthlySalesPoint(
                month=m.isoformat(),
                ca_ht=float(row.total_ht or 0),
            )
        )

    return points
