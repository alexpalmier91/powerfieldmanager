# app/routers/agent_stats.py
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional, Dict

import sqlalchemy as sa
from sqlalchemy import func, case
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, Query, HTTPException

from app.db.session import get_session
from app.db import models
from app.routers.agent_orders import get_current_user, ensure_agent

router = APIRouter(
    prefix="/api-zenhub/agent/stats",
    tags=["agent-stats"],
)


# -------------------------
# Helpers de période
# -------------------------
def compute_period_from_code(period: str) -> tuple[date, date, str]:
    """Calcule la période [start, end] en fonction du code 'period'."""
    today = date.today()

    if period == "current_year":
        start = date(today.year, 1, 1)
        end = date(today.year, 12, 31)
        label = f"Janvier {today.year} – Décembre {today.year}"

    elif period == "last_12_months":
        # 12 mois glissants à partir d'aujourd'hui
        start = (today.replace(day=1) - timedelta(days=365))
        end = today
        label = "12 derniers mois"

    else:
        raise HTTPException(status_code=400, detail="Période invalide")

    return start, end, label


def override_period_with_dates(
    period: str,
    date_from: Optional[date],
    date_to: Optional[date],
) -> tuple[date, date, str]:
    """
    Si date_from et date_to sont fournis, ils priment sur 'period'.
    Sinon, on revient au comportement basé sur 'period'.
    """
    if date_from and date_to:
        if date_from > date_to:
            raise HTTPException(status_code=400, detail="date_from > date_to")
        label = f"{date_from.strftime('%d/%m/%Y')} – {date_to.strftime('%d/%m/%Y')}"
        return date_from, date_to, label

    # fallback: on utilise le code period
    return compute_period_from_code(period)


def month_range(start: date, end: date):
    """Génère la liste des premiers jours de mois entre start et end inclus."""
    if start > end:
        return []

    # normaliser sur le 1er du mois pour start
    cur = start.replace(day=1)
    months = []
    while cur <= end:
        months.append(cur)
        # avancer d'un mois
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
    return months


# -------------------------
# Endpoint stats mensuelles
# -------------------------
@router.get("/sales-monthly")
async def sales_monthly(
    period: str = Query("last_12_months"),
    labo_id: Optional[int] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    db: AsyncSession = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """
    Statistiques mensuelles pour l'agent connecté :

    - CA facturé (FA) : basé sur labo_document (type = FA)
    - CA potentiel (BC) : basé sur les bons de commande agents (table "order")

    Dates utilisées :
      - FA : COALESCE(delivery_date, order_date, created_at::date)
      - BC : COALESCE(delivery_date, order_date, created_at::date)

    La période peut être :
      - period = "current_year" / "last_12_months"
      - ou bien date_from + date_to (qui priment sur period).
    """

    ensure_agent(user)

    # Récupérer l'agent réel via son email
    agent = (
        await db.execute(
            sa.select(models.Agent).where(models.Agent.email == user.email)
        )
    ).scalar_one_or_none()

    if agent is None:
        # pas d'agent => pas de stats
        return {
            "labels": [],
            "ca_facture": [],
            "ca_potentiel": [],
            "period_label": "",
        }

    start, end, label = override_period_with_dates(period, date_from, date_to)

    # -------------------------
    # 1) CA FACTURÉ (FA) — LaboDocument
    # -------------------------
    doc_date_expr = func.coalesce(
        models.LaboDocument.delivery_date,
        models.LaboDocument.order_date,
        func.date(models.LaboDocument.created_at),
    )

    docs_query = (
        sa.select(
            func.date_trunc("month", doc_date_expr).label("month"),
            func.sum(
                case(
                    (models.LaboDocument.type == models.LaboDocumentType.FA,
                     models.LaboDocument.total_ht),
                    else_=0,
                )
            ).label("ca_facture"),
        )
        .where(models.LaboDocument.agent_id == agent.id)
        .where(doc_date_expr.between(start, end))
        .group_by("month")
        .order_by("month")
    )

    if labo_id:
        docs_query = docs_query.where(models.LaboDocument.labo_id == labo_id)

    docs_rows = (await db.execute(docs_query)).all()

    # Dict: month_date -> ca_facture
    ca_facture_by_month: Dict[date, float] = {}
    for (month_dt, ca_val) in docs_rows:
        if month_dt is None:
            continue
        month_date = month_dt.date()  # date_trunc renvoie un datetime
        ca_facture_by_month[month_date] = float(ca_val or 0)

    # -------------------------
    # 2) CA POTENTIEL (BC) — Commandes agent ("order")
    # -------------------------
    order_date_expr = func.coalesce(
        models.Order.delivery_date,
        models.Order.order_date,
        func.date(models.Order.created_at),
    )

    orders_query = (
        sa.select(
            func.date_trunc("month", order_date_expr).label("month"),
            func.sum(models.Order.total_ht).label("ca_potentiel"),
        )
        .where(models.Order.agent_id == agent.id)
        .where(order_date_expr.between(start, end))
        # on exclut les commandes annulées
        .where(
            sa.or_(
                models.Order.status.is_(None),
                models.Order.status != models.OrderStatus.canceled,
            )
        )
        .group_by("month")
        .order_by("month")
    )

    if labo_id:
        orders_query = orders_query.where(models.Order.labo_id == labo_id)

    orders_rows = (await db.execute(orders_query)).all()

    # Dict: month_date -> ca_potentiel
    ca_potentiel_by_month: Dict[date, float] = {}
    for (month_dt, ca_val) in orders_rows:
        if month_dt is None:
            continue
        month_date = month_dt.date()
        ca_potentiel_by_month[month_date] = float(ca_val or 0)

    # -------------------------
    # 3) Fusion : timeline mois + valeurs
    # -------------------------
    months = month_range(start, end)

    labels: list[str] = []
    ca_facture: list[float] = []
    ca_potentiel: list[float] = []

    for m in months:
        # libellé du mois : "YYYY-MM"
        labels.append(f"{m.year:04d}-{m.month:02d}")

        # on doit retrouver la clé exacte utilisée dans les dicts
        m_key = m  # m est déjà le 1er du mois

        ca_fa_val = ca_facture_by_month.get(m_key, 0.0)
        ca_bc_val = ca_potentiel_by_month.get(m_key, 0.0)

        ca_facture.append(round(ca_fa_val, 2))
        ca_potentiel.append(round(ca_bc_val, 2))

    return {
        "labels": labels,
        "ca_facture": ca_facture,
        "ca_potentiel": ca_potentiel,
        "period_label": label,
    }
