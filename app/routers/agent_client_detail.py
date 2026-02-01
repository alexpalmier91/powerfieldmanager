# app/routers/agent_client_detail.py
from __future__ import annotations

from datetime import datetime, timedelta, date
from typing import List, Optional
from decimal import Decimal

import logging  # 👈 AJOUT


from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Response  # en haut du fichier, à côté de HTMLResponse
from fastapi.responses import HTMLResponse, StreamingResponse

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import sqlalchemy as sa
from pydantic import BaseModel, condecimal

from app.db.session import get_async_session
from app.db.models import (
    Agent,
    Client,
    LaboClient,
    Order,
    OrderItem,
    Product,
    Appointment,
    LaboDocument,
    Labo,
    LaboDocumentItem,
)

from app.routers.agent_clients import get_current_agent  # réutilisation




logger = logging.getLogger(__name__)


# =========================================================
#              Pydantic Schemas
# =========================================================

class ClientInfo(BaseModel):
    id: int
    name: str
    contact_name: Optional[str] = None
    address1: Optional[str] = None
    postcode: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    groupement: Optional[str] = None
    sage_code: Optional[str] = None  # code_client (LaboClient)

    # Infos bancaires
    iban: Optional[str] = None
    bic: Optional[str] = None
    payment_terms: Optional[str] = None
    credit_limit: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    sepa_mandate_ref: Optional[str] = None


class OrderSummary(BaseModel):
    id: int
    number: Optional[str] = None          # N° de commande
    order_date: Optional[date] = None     # Date de commande (renommée)
    created_at: datetime
    status: Optional[str] = None
    total_ht: Decimal
    labo_id: Optional[int] = None         # Labo d'origine de la commande


class PaginatedOrders(BaseModel):
    items: List[OrderSummary]
    total: int
    page: int
    page_size: int


class OrderItemDetail(BaseModel):
    product_id: int
    product_name: str
    sku: Optional[str] = None
    quantity: condecimal(max_digits=12, decimal_places=2)
    unit_price_ht: condecimal(max_digits=12, decimal_places=2)
    total_ht: condecimal(max_digits=12, decimal_places=2)


class OrderDetail(BaseModel):
    id: int
    number: str
    date: Optional[date]
    created_at: datetime
    status: str
    total_ht: condecimal(max_digits=12, decimal_places=2)
    total_ttc: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    items: List[OrderItemDetail]


class RevenuePoint(BaseModel):
    date: date
    total_ht: condecimal(max_digits=12, decimal_places=2)


class RevenueResponse(BaseModel):
    total_ht: condecimal(max_digits=12, decimal_places=2)
    start_date: date
    end_date: date
    points: List[RevenuePoint]


class BankInfoUpdate(BaseModel):
    iban: Optional[str] = None
    bic: Optional[str] = None
    payment_terms: Optional[str] = None
    credit_limit: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    sepa_mandate_ref: Optional[str] = None


class TopProduct(BaseModel):
    product_id: Optional[int] = None
    product_name: str
    sku: Optional[str] = None
    total_qty: condecimal(max_digits=12, decimal_places=2)
    total_ht: condecimal(max_digits=12, decimal_places=2)


class TopProductsResponse(BaseModel):
    items: List[TopProduct]


class AppointmentSummary(BaseModel):
    id: int
    start_at: datetime
    end_at: Optional[datetime]
    notes: Optional[str]
    status: Optional[str]
    agent_id: Optional[int]
    agent_name: Optional[str]


class PaginatedAppointments(BaseModel):
    items: List[AppointmentSummary]
    total: int
    page: int
    page_size: int


class LabOrderSummary(BaseModel):
    id: int
    doc_number: str
    doc_type: Optional[str] = None
    date: Optional[date] = None
    labo: Optional[str] = None
    total_ht: condecimal(max_digits=12, decimal_places=2)


class PaginatedLabOrders(BaseModel):
    items: List[LabOrderSummary]
    total: int
    page: int
    page_size: int


class ClientOverviewResponse(BaseModel):
    client: ClientInfo
    revenue_12m_ht: condecimal(max_digits=12, decimal_places=2)
    last_order_date: Optional[date] = None
    total_orders: int


class LaboDocumentItemDetail(BaseModel):
    product_id: int
    product_name: str
    sku: Optional[str] = None
    quantity: condecimal(max_digits=12, decimal_places=2)
    unit_price_ht: condecimal(max_digits=12, decimal_places=2)
    total_ht: condecimal(max_digits=12, decimal_places=2)


class LaboDocumentDetail(BaseModel):
    id: int
    number: str
    date: Optional[date]
    type: str
    total_ht: condecimal(max_digits=12, decimal_places=2)
    items: List[LaboDocumentItemDetail]


# =========================================================
#              Helpers internes
# =========================================================

async def _get_client_for_agent(
    session: AsyncSession,
    agent: Agent,
    client_id: int,
) -> Client:
    """
    Récupère un client rattaché à l'agent via agent_client.
    """
    stmt = (
        select(Client)
        .join_from(Client, Client.agents)
        .where(
            Client.id == client_id,
            Agent.id == agent.id,
        )
    )
    client = (await session.scalars(stmt)).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client introuvable pour cet agent.")
    return client


def _compute_period(
    mode: str,
    start: Optional[date],
    end: Optional[date],
) -> tuple[date, date]:
    today = date.today()
    if mode == "30d":
        start_date = today - timedelta(days=30)
        end_date = today
    elif mode == "90d":
        start_date = today - timedelta(days=90)
        end_date = today
    elif mode == "12m":
        start_date = today - timedelta(days=365)
        end_date = today
    elif mode == "custom" and start and end:
        start_date = start
        end_date = end
    else:
        start_date = today - timedelta(days=365)
        end_date = today
    return start_date, end_date


async def _get_any_sage_code_for_client_and_agent(
    session: AsyncSession,
    agent: Agent,  # gardé pour compat
    client_id: int,
) -> Optional[str]:
    """
    Cherche un code_client (Sage) pour ce client.
    (Version safe async : ne touche pas à agent.labos pour éviter MissingGreenlet)
    """
    stmt = (
        select(LaboClient.code_client)
        .where(
            LaboClient.client_id == client_id,
            LaboClient.code_client.isnot(None),
        )
        .order_by(LaboClient.created_at.desc())
    )
    return (await session.scalars(stmt)).first()


def _is_facture_doc(doc: LaboDocument) -> bool:
    """
    Détermine si un LaboDocument est une facture.
    On se base sur son type ('FA') ou sur le numéro commençant par 'FA'.
    """
    raw_type = getattr(doc, "type", None)
    if hasattr(raw_type, "value"):
        raw_type = raw_type.value
    type_str = (raw_type or "").upper()

    number = getattr(doc, "order_number", None) or ""
    num_str = number.upper()

    if type_str == "FA":
        return True
    if num_str.startswith("FA"):
        return True
    return False


# =========================================================
#              Router HTML (Dashboard Agent)
# =========================================================

page_router = APIRouter(
    prefix="/agent",
    tags=["agent-client-page"],
)


@page_router.get(
    "/client/{client_id}",
    response_class=HTMLResponse,
    include_in_schema=False,
)
async def agent_client_detail_page(
    request: Request,
    client_id: int,
):
    """
    Page détail client Agent.
    URL : /agent/client/{client_id}

    ⚠️ Pas de Depends(get_current_agent) ici :
    l'auth est gérée côté API via le token JS.
    """
    from app.main import templates  # import local

    lang = getattr(request.state, "lang", "fr")

    context = {
        "request": request,
        "lang": lang,
        "client_id": client_id,
        "api_prefix": f"/api-zenhub/agent/clients/{client_id}",
    }

    return templates.TemplateResponse(
        "agent/client_detail.html",
        context,
    )


# =========================================================
#              Router API JSON
# =========================================================

api_router = APIRouter(
    prefix="/api-zenhub/agent/clients",
    tags=["agent-client-detail"],
)


@api_router.get(
    "/{client_id}/info",
    response_model=ClientOverviewResponse,
)
async def get_client_overview(
    client_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    client = await _get_client_for_agent(session, agent, client_id)

    twelve_months_ago = date.today() - timedelta(days=365)

    base_orders = select(Order).where(
        Order.client_id == client_id,
        Order.agent_id == agent.id,
        Order.order_date.isnot(None),
    )

    count_q = select(func.count()).select_from(base_orders.subquery())
    total_orders = (await session.scalar(count_q)) or 0

    revenue_q = select(func.coalesce(func.sum(Order.total_ht), 0)).where(
        Order.client_id == client_id,
        Order.agent_id == agent.id,
        Order.order_date >= twelve_months_ago,
    )
    revenue_12m = (await session.scalar(revenue_q)) or 0

    last_order_q = (
        select(Order.order_date)
        .where(
            Order.client_id == client_id,
            Order.agent_id == agent.id,
            Order.order_date.isnot(None),
        )
        .order_by(Order.order_date.desc())
    )
    last_order_date = (await session.scalars(last_order_q)).first()

    sage_code = await _get_any_sage_code_for_client_and_agent(session, agent, client_id)

    contact_parts = []
    if getattr(client, "first_name", None):
        contact_parts.append(client.first_name)
    if getattr(client, "last_name", None):
        contact_parts.append(client.last_name)

    client_info = ClientInfo(
        id=client.id,
        name=client.company_name,
        contact_name=" ".join(contact_parts) or None,
        address1=client.address1,
        postcode=client.postcode,
        city=client.city,
        country=client.country,
        email=client.email,
        phone=client.phone,
        groupement=client.groupement,
        sage_code=sage_code,
        iban=client.iban,
        bic=client.bic,
        payment_terms=client.payment_terms,
        credit_limit=client.credit_limit,
        sepa_mandate_ref=client.sepa_mandate_ref,
    )

    return ClientOverviewResponse(
        client=client_info,
        revenue_12m_ht=revenue_12m,
        last_order_date=last_order_date,
        total_orders=total_orders,
    )


@api_router.get(
    "/{client_id}/orders",
    response_model=PaginatedOrders,
)
async def get_client_orders(
    client_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    await _get_client_for_agent(session, agent, client_id)

    offset = (page - 1) * page_size

    base_q = select(Order).where(
        Order.client_id == client_id,
        Order.agent_id == agent.id,
    )

    total = (await session.scalar(
        select(func.count()).select_from(base_q.subquery())
    )) or 0

    stmt = (
        base_q
        .order_by(
            Order.order_date.desc().nullslast(),
            Order.created_at.desc(),
        )
        .offset(offset)
        .limit(page_size)
    )
    orders = (await session.scalars(stmt)).all()

    items = [
        OrderSummary(
            id=o.id,
            number=o.order_number,
            order_date=o.order_date,
            created_at=o.created_at,
            total_ht=o.total_ht or 0,
            status=o.status.value if hasattr(o.status, "value") else str(o.status),
            labo_id=o.labo_id,
        )
        for o in orders
    ]

    return PaginatedOrders(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@api_router.get(
    "/{client_id}/orders/{order_id}",
    response_model=OrderDetail,
)
async def get_client_order_detail(
    client_id: int,
    order_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    await _get_client_for_agent(session, agent, client_id)

    order_stmt = select(Order).where(
        Order.id == order_id,
        Order.client_id == client_id,
        Order.agent_id == agent.id,
    )
    order = (await session.scalars(order_stmt)).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    items_stmt = (
        select(OrderItem, Product)
        .select_from(OrderItem)
        .outerjoin(
            Product,
            sa.or_(
                Product.id == OrderItem.product_id,
                sa.and_(
                    Product.sku.isnot(None),
                    OrderItem.sku.isnot(None),
                    Product.sku == OrderItem.sku,
                ),
            ),
        )
        .where(OrderItem.order_id == order.id)
    )

    rows = (await session.execute(items_stmt)).all()

    items: List[OrderItemDetail] = []
    for oi, p in rows:
        product_id = (p.id if p and p.id is not None else (oi.product_id or 0))
        product_name = (
            p.name
            if p and p.name
            else (oi.sku or "Produit")
        )

        items.append(
            OrderItemDetail(
                product_id=product_id,
                product_name=product_name,
                sku=oi.sku,
                quantity=oi.qty,
                unit_price_ht=oi.unit_ht,
                total_ht=oi.total_ht,
            )
        )

    return OrderDetail(
        id=order.id,
        number=order.order_number,
        date=order.order_date,
        created_at=order.created_at,
        status=order.status.value if hasattr(order.status, "value") else str(order.status),
        total_ht=order.total_ht or 0,
        total_ttc=order.total_ttc,
        items=items,
    )


@api_router.put(
    "/{client_id}/bank-info",
    response_model=ClientInfo,
)
async def update_client_bank_info(
    client_id: int,
    payload: BankInfoUpdate,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    client = await _get_client_for_agent(session, agent, client_id)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(client, field, value)

    await session.commit()
    await session.refresh(client)

    sage_code = await _get_any_sage_code_for_client_and_agent(session, agent, client_id)

    contact_parts = []
    if client.first_name:
        contact_parts.append(client.first_name)
    if client.last_name:
        contact_parts.append(client.last_name)

    return ClientInfo(
        id=client.id,
        name=client.company_name,
        contact_name=" ".join(contact_parts) or None,
        address1=client.address1,
        postcode=client.postcode,
        city=client.city,
        country=client.country,
        email=client.email,
        phone=client.phone,
        groupement=client.groupement,
        sage_code=sage_code,
        iban=client.iban,
        bic=client.bic,
        payment_terms=client.payment_terms,
        credit_limit=client.credit_limit,
        sepa_mandate_ref=client.sepa_mandate_ref,
    )


@api_router.get("/{client_id}/lab-orders")
async def get_client_lab_orders(
    client_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=200),
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    """
    Renvoie tous les documents Labo associés à un client :
    CO..., FA..., AV..., AW..., AVOIR…, etc.

    Ajoute :
    - doc_type_label : label humain (Facture / Avoir / Commande / Document)
    - has_pdf : booléen indiquant si un PDF est disponible (pour l’instant: seulement Factures = type FA)
    """

    # Sécurité : vérifier que le client appartient bien à l’agent
    await _get_client_for_agent(session, agent, client_id)

    offset = (page - 1) * page_size

    # Requête principale
    stmt = (
        select(
            LaboDocument.id,
            LaboDocument.order_number.label("order_number"),
            LaboDocument.type,            # Enum ou str
            LaboDocument.total_ht,
            LaboDocument.order_date.label("order_date"),
            Labo.name.label("labo_name"),
        )
        .join(Labo, Labo.id == LaboDocument.labo_id)
        .where(LaboDocument.client_id == client_id)
        .order_by(LaboDocument.order_date.desc().nullslast(), LaboDocument.id.desc())
        .offset(offset)
        .limit(page_size)
    )

    rows = (await session.execute(stmt)).all()

    # Total pour pagination
    total_stmt = select(sa.func.count()).select_from(
        select(LaboDocument.id)
        .where(LaboDocument.client_id == client_id)
        .subquery()
    )
    total = (await session.execute(total_stmt)).scalar_one()

    items = []
    for r in rows:
        number = getattr(r, "number", None) or getattr(r, "order_number", "") or ""
        date_val = getattr(r, "date", None) or getattr(r, "order_date", None)
        labo_name = getattr(r, "labo_name", None) or getattr(r, "name", "") or ""
        total_ht = getattr(r, "total_ht", 0) or 0

        # --- Normalisation du type (Enum -> str) ---
        raw_type_obj = getattr(r, "type", None)
        if hasattr(raw_type_obj, "value"):
            # Enum LaboDocumentType
            raw_type_str = raw_type_obj.value or ""
        elif raw_type_obj is None:
            raw_type_str = ""
        else:
            raw_type_str = str(raw_type_obj)

        num_upper = (number or "").upper()

        # Détection du label humain
        if num_upper.startswith("AVOIR") or num_upper.startswith("AW"):
            doc_type_label = "Avoir"
        else:
            doc_type_label = {
                "CO": "Commande",
                "BC": "Commande",
                "FA": "Facture",
                "AV": "Avoir",
                "AW": "Avoir",
            }.get(raw_type_str, "Document")

        # PDF disponible uniquement pour les factures (type FA)
        has_pdf = raw_type_str.upper() == "FA"

        items.append(
            {
                "id": r.id,
                "number": number,
                "doc_number": number,            # alias pratique côté JS
                "type": raw_type_str,
                "doc_type_label": doc_type_label,
                "date": date_val.isoformat() if date_val else None,
                "labo": labo_name,
                "labo_name": labo_name,          # alias
                "total_ht": float(total_ht),
                "has_pdf": has_pdf,
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@api_router.get(
    "/{client_id}/revenue",
    response_model=RevenueResponse,
)
async def get_client_revenue(
    client_id: int,
    mode: str = Query("12m", regex="^(30d|90d|12m|custom)$"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    """
    CA du client regroupé par MOIS.
    """

    await _get_client_for_agent(session, agent, client_id)

    start, end = _compute_period(mode, start_date, end_date)

    order_day_expr = func.coalesce(
        Order.order_date,
        func.date_trunc("day", Order.created_at),
    )

    month_expr = func.date_trunc("month", order_day_expr).label("m")

    stmt = (
        select(
            month_expr,
            func.coalesce(func.sum(Order.total_ht), 0).label("total_ht"),
        )
        .where(
            Order.client_id == client_id,
            Order.agent_id == agent.id,
            order_day_expr >= start,
            order_day_expr <= end,
        )
        .group_by(month_expr)
        .order_by(month_expr)
    )

    rows = (await session.execute(stmt)).all()

    points: list[RevenuePoint] = []
    for row in rows:
        d = row.m
        if isinstance(d, datetime):
            d = d.date().replace(day=1)
        else:
            d = d.replace(day=1)
        points.append(
            RevenuePoint(
                date=d,
                total_ht=row.total_ht,
            )
        )

    total_ht = sum((p.total_ht for p in points), Decimal("0"))

    return RevenueResponse(
        total_ht=total_ht,
        start_date=start,
        end_date=end,
        points=points,
    )


@api_router.get(
    "/{client_id}/top-products",
    response_model=TopProductsResponse,
)
async def get_client_top_products(
    client_id: int,
    mode: str = Query("12m", regex="^(30d|90d|12m|custom)$"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(10, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    await _get_client_for_agent(session, agent, client_id)
    start, end = _compute_period(mode, start_date, end_date)

    stmt = (
        select(
            sa.func.max(Product.id).label("product_id"),
            sa.func.coalesce(sa.func.max(Product.name), sa.literal("")).label("product_name"),
            sa.func.coalesce(OrderItem.sku, sa.literal("")).label("sku"),
            sa.func.coalesce(sa.func.sum(OrderItem.qty), 0).label("total_qty"),
            sa.func.coalesce(sa.func.sum(OrderItem.total_ht), 0).label("total_ht"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(Product, Product.id == OrderItem.product_id)
        .where(
            Order.client_id == client_id,
            Order.agent_id == agent.id,
            Order.order_date.isnot(None),
            sa.and_(Order.order_date >= start, Order.order_date <= end),
        )
        .group_by(OrderItem.sku)
        .order_by(sa.desc("total_ht"))
        .limit(limit)
    )

    rows = (await session.execute(stmt)).all()

    items: List[TopProduct] = []
    for row in rows:
        items.append(
            TopProduct(
                product_id=row.product_id,
                product_name=row.product_name or (row.sku or "Produit sans nom"),
                sku=row.sku,
                total_qty=row.total_qty,
                total_ht=row.total_ht,
            )
        )

    return TopProductsResponse(items=items)


@api_router.get(
    "/{client_id}/appointments",
    response_model=PaginatedAppointments,
)
async def get_client_appointments(
    client_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    await _get_client_for_agent(session, agent, client_id)
    offset = (page - 1) * page_size

    base_q = (
        select(Appointment)
        .where(
            Appointment.client_id == client_id,
            Appointment.agent_id == agent.id,
        )
    )

    total = (await session.scalar(
        select(func.count()).select_from(base_q.subquery())
    )) or 0

    stmt = (
        base_q
        .order_by(Appointment.start_datetime.desc())
        .offset(offset)
        .limit(page_size)
    )
    appts = (await session.scalars(stmt)).all()

    items: List[AppointmentSummary] = []
    for appt in appts:
        items.append(
            AppointmentSummary(
                id=appt.id,
                start_at=appt.start_datetime,
                end_at=appt.end_datetime,
                notes=appt.notes,
                status=appt.status.value if hasattr(appt.status, "value") else str(appt.status),
                agent_id=agent.id,
                agent_name=f"{agent.firstname or ''} {agent.lastname or ''}".strip() or agent.email,
            )
        )

    return PaginatedAppointments(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@api_router.get(
    "/{client_id}/lab-orders/{document_id}",
    response_model=LaboDocumentDetail,
)
async def get_client_lab_order_detail(
    client_id: int,
    document_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    """
    Détail d'un document labo (lignes produits) pour un client + agent donnés.
    """

    await _get_client_for_agent(session, agent, client_id)

    doc_stmt = (
        select(LaboDocument)
        .where(
            LaboDocument.id == document_id,
            LaboDocument.client_id == client_id,
        )
    )
    doc = (await session.scalars(doc_stmt)).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document labo introuvable.")

    items_stmt = (
        select(LaboDocumentItem, Product)
        .select_from(LaboDocumentItem)
        .outerjoin(
            Product,
            sa.or_(
                Product.id == LaboDocumentItem.product_id,
                sa.and_(
                    Product.sku.isnot(None),
                    LaboDocumentItem.sku.isnot(None),
                    Product.sku == LaboDocumentItem.sku,
                ),
            ),
        )
        .where(LaboDocumentItem.document_id == doc.id)
    )

    rows = (await session.execute(items_stmt)).all()

    items: List[LaboDocumentItemDetail] = []
    for li, p in rows:
        product_id = p.id if p and p.id is not None else (li.product_id or 0)
        product_name = (
            p.name
            if p and getattr(p, "name", None)
            else (li.sku or "Produit")
        )

        items.append(
            LaboDocumentItemDetail(
                product_id=product_id,
                product_name=product_name,
                sku=li.sku,
                quantity=li.qty,
                unit_price_ht=li.unit_ht,
                total_ht=li.total_ht,
            )
        )

    doc_type = doc.type.value if hasattr(doc.type, "value") else str(doc.type)

    return LaboDocumentDetail(
        id=doc.id,
        number=doc.order_number,
        date=doc.order_date,
        type=doc_type,
        total_ht=doc.total_ht or 0,
        items=items,
    )


@api_router.get(
    "/{client_id}/lab-orders/{document_id}/pdf",
    response_class=Response,
    include_in_schema=False,
)
async def get_client_lab_order_pdf(
    client_id: int,
    document_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    """
    Génère et renvoie le PDF d'un document labo (facture).

    Règles :
    - Le client doit appartenir à l'agent (agent_client).
    - Le document doit appartenir à ce client.
    - Seuls les documents de type FA (factures) sont autorisés.
    """

    # 1) Sécurité : vérifie que le client est bien rattaché à l'agent
    client = await _get_client_for_agent(session, agent, client_id)

    # 2) Récupère le document
    doc_stmt = (
        select(LaboDocument)
        .where(
            LaboDocument.id == document_id,
            LaboDocument.client_id == client_id,
        )
    )
    doc = (await session.scalars(doc_stmt)).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document labo introuvable.")

    # 3) Vérifie que c'est bien une facture (type FA)
    raw_type = doc.type.value if hasattr(doc.type, "value") else (doc.type or "")
    if (raw_type or "").upper() != "FA":
        # On masque l'existence des autres types, pour rester neutre
        raise HTTPException(
            status_code=404,
            detail="PDF disponible uniquement pour les factures.",
        )

    # 4) Récupère les lignes (jointure Product pour le nom si dispo)
    items_stmt = (
        select(LaboDocumentItem, Product)
        .select_from(LaboDocumentItem)
        .outerjoin(
            Product,
            sa.or_(
                Product.id == LaboDocumentItem.product_id,
                sa.and_(
                    Product.sku.isnot(None),
                    LaboDocumentItem.sku.isnot(None),
                    Product.sku == LaboDocumentItem.sku,
                ),
            ),
        )
        .where(LaboDocumentItem.document_id == doc.id)
    )
    rows = (await session.execute(items_stmt)).all()

    invoice_items: list[dict] = []
    for li, p in rows:
        # Nom du produit
        product_name = (
            p.name
            if p and getattr(p, "name", None)
            else (
                li.description
                if hasattr(li, "description") and getattr(li, "description", None)
                else (li.sku or "Produit")
            )
        )

        # --- Récupération du taux de TVA ---
        vat_rate = None

        # 1) Priorité : champ sur la ligne LaboDocumentItem (import Sage)
        for attr in ("vat_rate", "tva_rate", "tva", "tax_rate"):
            if hasattr(li, attr) and getattr(li, attr) is not None:
                vat_rate = getattr(li, attr)
                break

        # 2) Fallback : champ sur le Product
        if vat_rate is None and p is not None:
            for attr in ("vat_rate", "tva_rate", "tva", "tax_rate"):
                if hasattr(p, attr) and getattr(p, attr) is not None:
                    vat_rate = getattr(p, attr)
                    break

        # 3) Dernier fallback : 0 si rien trouvé
        if vat_rate is None:
            vat_rate = Decimal("0")

        invoice_items.append(
            {
                "sku": li.sku,
                "product_name": product_name,
                "qty": li.qty,
                "unit_ht": li.unit_ht,
                "total_ht": li.total_ht,
                "vat_rate": vat_rate,  # 👈 transmis au service PDF
            }
        )

    # 5) Labo associé
    labo = await session.get(Labo, doc.labo_id)
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable pour ce document.")

    # 6) Génération du PDF via le service dédié
    from app.services.labo_pdf import render_labo_invoice_pdf

    try:
        pdf_bytes = render_labo_invoice_pdf(
            doc=doc,
            items=invoice_items,
            client=client,
            labo=labo,
            delivery=client,  # 👈 on passe le même objet pour l’adresse de livraison
        )
    except Exception as exc:
        logger.exception(
            "Erreur lors de la génération du PDF Agent pour client_id=%s, document_id=%s",
            client_id,
            document_id,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors de la génération du PDF: {exc}",
        )


    # 7) Nom de fichier
    doc_number = doc.order_number or f"FA-{doc.id}"
    filename = f"Facture-{doc_number}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
