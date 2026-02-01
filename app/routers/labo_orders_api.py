# app/routers/labo_orders_api.py
from __future__ import annotations

import csv
from io import StringIO, BytesIO
from collections import defaultdict
from typing import List, Optional
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_, literal, update

from pydantic import BaseModel

from app.db.session import get_async_session
from app.db.models import (
    Order,
    OrderItem,
    Client,
    LaboClient,
    Agent,
    Labo,
    User,
    UserRole,
    OrderStatus,  # enum du statut
    labo_agent,
    LaboDocument,
    LaboDocumentItem,
    Product,
    DeliveryAddress,
)
from app.core.security import get_current_subject
from app.services.labo_documents_export_csv import (
    fetch_labo_documents_with_items,
    build_easy_vrp_csv,
)

router = APIRouter(
    prefix="/api-zenhub/labo",
    tags=["labo-orders"],
)

# ==========================================================
#   Contexte courant (user + labo)
# ==========================================================


class CurrentContext(BaseModel):
    user_id: int
    role: UserRole
    labo_id: Optional[int] = None


async def get_current_context(
    subject: str = Depends(get_current_subject),
    session: AsyncSession = Depends(get_async_session),
) -> CurrentContext:
    """
    subject peut être un email OU un user_id (string convertible en int).
    """

    # Essayer de l'interpréter comme un id numérique
    try:
        user_id = int(subject)
        stmt = select(User).where(User.id == user_id)
    except (TypeError, ValueError):
        # Sinon, on suppose que c'est un email
        stmt = select(User).where(User.email == subject)

    res = await session.execute(stmt)
    user = res.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur inconnu")

    if user.role not in (UserRole.LABO, UserRole.SUPERUSER):
        raise HTTPException(status_code=403, detail="Accès réservé aux labos / superuser")

    labo_id: Optional[int] = None
    if user.role == UserRole.LABO:
        if not user.labo_id:
            raise HTTPException(status_code=403, detail="Aucun labo associé")
        labo_id = user.labo_id

    return CurrentContext(
        user_id=user.id,
        role=user.role,
        labo_id=labo_id,
    )


# ==========================================================
#   Schémas Pydantic
# ==========================================================


class OrderListItem(BaseModel):
    id: int
    order_number: str
    date: Optional[str] = None  # date de commande
    delivery_date: Optional[str] = None  # date de livraison
    client_id: Optional[int] = None
    client_name: str
    client_code: Optional[str] = None
    total_ht: float
    status: str
    items_count: int
    agent_name: Optional[str] = None


class OrderListResponse(BaseModel):
    items: List[OrderListItem]
    page: int
    page_size: int
    total: int


class ClientInfo(BaseModel):
    id: Optional[int] = None
    code: Optional[str] = None
    name: str


class AgentInfo(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None


class AgentOption(BaseModel):
    id: int
    name: str


class OrderItemDetail(BaseModel):
    # ⚠️ product_id peut être null si la commande vient d’un import agent
    product_id: Optional[int] = None
    sku: Optional[str] = None
    name: Optional[str] = None
    qty: int
    price_ht: float
    line_total_ht: float
    vat_rate: Optional[float] = None  # nouveau


class OrderDetailResponse(BaseModel):
    id: int
    order_number: str
    date: Optional[str] = None
    delivery_date: Optional[str] = None
    client: ClientInfo
    status: str
    total_ht: float
    items: List[OrderItemDetail]
    agent: AgentInfo


class ClientCodeIn(BaseModel):
    client_id: int
    labo_id: Optional[int] = None  # utile pour SUPERUSER, ignoré pour LABO
    code_client: str


class ClientCodeOut(BaseModel):
    client_id: int
    labo_id: int
    code_client: str


class BulkValidateIn(BaseModel):
    order_ids: List[int]


class BulkValidateOut(BaseModel):
    updated: int
    new_status: str


class OrdersExportCsvIn(BaseModel):
    order_ids: List[int]


class LaboDocumentsExportIn(BaseModel):
    document_ids: List[int]


# ==========================================================
#   GET /api-zenhub/labo/orders  (liste paginée)
# ==========================================================


@router.get("/orders", response_model=OrderListResponse)
async def list_labo_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
):
    filters = []

    # Jointure LaboClient : lien client + labo
    lc_join = and_(
        LaboClient.client_id == Order.client_id,
        LaboClient.labo_id == Order.labo_id,
    )

    # Nom agent = firstname + " " + lastname
    if hasattr(Agent, "firstname") and hasattr(Agent, "lastname"):
        agent_name_col = func.concat(
            Agent.firstname,
            literal(" "),
            Agent.lastname,
        )
    else:
        agent_name_col = literal("")

    # Filtre labo
    if ctx.role == UserRole.LABO:
        filters.append(Order.labo_id == ctx.labo_id)

    # Filtres simples
    if status:
        try:
            status_enum = OrderStatus(status)
        except ValueError:
            status_enum = status
        filters.append(Order.status == status_enum)

    if date_from:
        filters.append(Order.order_date >= date_from)
    if date_to:
        filters.append(Order.order_date <= date_to)

    if agent_id:
        filters.append(Order.agent_id == agent_id)

    # Recherche
    if search:
        pattern = f"%{search}%"
        filters.append(
            or_(
                Order.order_number.ilike(pattern),
                Client.company_name.ilike(pattern),
                LaboClient.code_client.ilike(pattern),
                agent_name_col.ilike(pattern),
            )
        )

    # SELECT principal
    base_stmt = (
        select(
            Order.id,
            Order.order_number,
            Order.order_date.label("date"),
            Order.delivery_date.label("delivery_date"),
            Order.client_id.label("client_id"),
            Client.company_name.label("client_name"),
            LaboClient.code_client.label("client_code"),
            Order.total_ht,
            Order.status,
            func.count(OrderItem.id).label("items_count"),
            agent_name_col.label("agent_name"),
        )
        .select_from(Order)
        .join(Client, Client.id == Order.client_id, isouter=True)
        .join(LaboClient, lc_join, isouter=True)
        .join(Agent, Agent.id == Order.agent_id, isouter=True)
        .join(OrderItem, OrderItem.order_id == Order.id, isouter=True)
        .where(and_(*filters) if filters else True)
        .group_by(
            Order.id,
            Order.order_number,
            Order.order_date,
            Order.delivery_date,
            Order.client_id,
            Client.company_name,
            LaboClient.code_client,
            Order.total_ht,
            Order.status,
            agent_name_col,
        )
        .order_by(Order.order_date.desc(), Order.id.desc())
    )

    # Total
    count_stmt = (
        select(func.count())
        .select_from(Order)
        .join(Client, Client.id == Order.client_id, isouter=True)
        .join(LaboClient, lc_join, isouter=True)
        .where(and_(*filters) if filters else True)
    )

    total_res = await session.execute(count_stmt)
    total = total_res.scalar_one()

    # Pagination
    offset = (page - 1) * page_size
    rows_res = await session.execute(base_stmt.offset(offset).limit(page_size))
    rows = rows_res.all()

    items: List[OrderListItem] = []
    for r in rows:
        items.append(
            OrderListItem(
                id=r.id,
                order_number=(r.order_number or "").strip(),
                date=r.date.isoformat() if r.date else None,
                delivery_date=r.delivery_date.isoformat() if r.delivery_date else None,
                client_id=r.client_id,
                client_name=(r.client_name or "").strip(),
                client_code=r.client_code,
                total_ht=float(r.total_ht or 0),
                status=r.status.value if hasattr(r.status, "value") else str(r.status),
                items_count=r.items_count or 0,
                agent_name=r.agent_name,
            )
        )

    return OrderListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/agents", response_model=List[AgentOption])
async def list_labo_agents(
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Renvoie la liste des agents rattachés au labo courant.
    - Labo : agents liés via la table labo_agent
    - Superuser : tous les agents
    """
    if hasattr(Agent, "firstname") and hasattr(Agent, "lastname"):
        full_name_col = func.concat(
            Agent.firstname,
            literal(" "),
            Agent.lastname,
        )
    else:
        full_name_col = literal("")

    if ctx.role == UserRole.LABO:
        stmt = (
            select(
                Agent.id,
                full_name_col.label("name"),
            )
            .select_from(Agent)
            .join(labo_agent, labo_agent.c.agent_id == Agent.id)
            .where(labo_agent.c.labo_id == ctx.labo_id)
            .order_by(full_name_col)
        )
    else:
        stmt = (
            select(
                Agent.id,
                full_name_col.label("name"),
            )
            .select_from(Agent)
            .order_by(full_name_col)
        )

    res = await session.execute(stmt)
    rows = res.all()

    return [
        AgentOption(id=r.id, name=(r.name or "").strip())
        for r in rows
    ]


# ==========================================================
#   GET /api-zenhub/labo/orders/{order_id}  (détail)
# ==========================================================


@router.get("/orders/{order_id}", response_model=OrderDetailResponse)
async def get_labo_order_detail(
    order_id: int,
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
):
    lc_join = and_(
        LaboClient.client_id == Order.client_id,
        LaboClient.labo_id == Order.labo_id,
    )

    stmt = (
        select(Order, Client, LaboClient, Agent)
        .join(Client, Client.id == Order.client_id, isouter=True)
        .join(LaboClient, lc_join, isouter=True)
        .join(Agent, Agent.id == Order.agent_id, isouter=True)
        .where(Order.id == order_id)
    )

    res = await session.execute(stmt)
    row = res.one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Commande introuvable")

    order, client, laboclient, agent = row

    if ctx.role == UserRole.LABO and order.labo_id != ctx.labo_id:
        raise HTTPException(status_code=403, detail="Commande non autorisée pour ce labo")

    # Lignes de commande + TVA produit
    # ⚠️ jointure maintenant sur product_id, pas sur sku
    items_stmt = (
        select(
            OrderItem,
            Product.vat_rate,
        )
        .join(Product, Product.id == OrderItem.product_id, isouter=True)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id.asc())
    )
    items_res = await session.execute(items_stmt)
    items_rows = items_res.all()

    items: List[OrderItemDetail] = []
    for it, prod_vat_rate in items_rows:
        name_val = (
            getattr(it, "name", None)
            or getattr(it, "product_name", None)
            or getattr(it, "label", None)
            or getattr(it, "sku", None)
            or ""
        )

        sku_val = (
            getattr(it, "sku", None)
            or getattr(it, "product_sku", None)
            or getattr(it, "reference", None)
        )

        vat_rate = float(prod_vat_rate or 0)

        items.append(
            OrderItemDetail(
                product_id=getattr(it, "product_id", None),
                sku=sku_val,
                name=name_val or None,
                qty=it.qty,
                price_ht=float(getattr(it, "unit_ht", 0) or 0),
                line_total_ht=float(getattr(it, "line_ht", 0) or 0),
                vat_rate=vat_rate,
            )
        )

    # Nom client
    raw_client_name = None
    if client and hasattr(client, "company_name"):
        raw_client_name = client.company_name
    if not raw_client_name:
        raw_client_name = order.client_name
    client_name = (raw_client_name or "").strip()

    client_info = ClientInfo(
        id=client.id if client else None,
        code=laboclient.code_client if laboclient else None,
        name=client_name,
    )

    # Nom complet agent
    if agent:
        fn = getattr(agent, "firstname", "") or ""
        ln = getattr(agent, "lastname", "") or ""
        agent_name = (fn + " " + ln).strip() or None
    else:
        agent_name = None

    agent_info = AgentInfo(
        id=agent.id if agent else None,
        name=agent_name,
    )

    return OrderDetailResponse(
        id=order.id,
        order_number=(order.order_number or "").strip(),
        date=order.order_date.isoformat() if order.order_date else None,
        delivery_date=order.delivery_date.isoformat() if order.delivery_date else None,
        client=client_info,
        status=order.status.value if hasattr(order.status, "value") else str(order.status),
        total_ht=float(order.total_ht or 0),
        items=items,
        agent=agent_info,
    )


# ==========================================================
#   POST /api-zenhub/labo/client-code
# ==========================================================


@router.post("/client-code", response_model=ClientCodeOut)
async def upsert_client_code(
    payload: ClientCodeIn,
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
):
    if ctx.role == UserRole.LABO:
        labo_id = ctx.labo_id
        if labo_id is None:
            raise HTTPException(status_code=403, detail="Aucun labo associé")
    else:
        labo_id = payload.labo_id
        if not labo_id:
            raise HTTPException(status_code=400, detail="labo_id requis pour SUPERUSER")

    client_id = payload.client_id
    code = (payload.code_client or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code_client requis")

    res_client = await session.execute(select(Client).where(Client.id == client_id))
    client = res_client.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client introuvable")

    res_labo = await session.execute(select(Labo).where(Labo.id == labo_id))
    labo = res_labo.scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    stmt = select(LaboClient).where(
        LaboClient.client_id == client_id,
        LaboClient.labo_id == labo_id,
    )
    res_lc = await session.execute(stmt)
    lc = res_lc.scalar_one_or_none()

    if lc is None:
        lc = LaboClient(
            labo_id=labo_id,
            client_id=client_id,
            code_client=code,
        )
        session.add(lc)
    else:
        lc.code_client = code

    await session.commit()

    return ClientCodeOut(
        client_id=client_id,
        labo_id=labo_id,
        code_client=code,
    )


# ==========================================================
#   POST /api-zenhub/labo/orders/export-csv
# ==========================================================


@router.post("/orders/export-csv")
async def export_labo_orders_csv(
    payload: OrdersExportCsvIn,
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
):
    order_ids = payload.order_ids or []
    if not order_ids:
        raise HTTPException(status_code=400, detail="order_ids obligatoire")

    lc_join = and_(
        LaboClient.client_id == Order.client_id,
        LaboClient.labo_id == Order.labo_id,
    )

    stmt = (
        select(Order, Client, LaboClient, Agent)
        .join(Client, Client.id == Order.client_id, isouter=True)
        .join(LaboClient, lc_join, isouter=True)
        .join(Agent, Agent.id == Order.agent_id, isouter=True)
        .where(Order.id.in_(order_ids))
    )
    if ctx.role == UserRole.LABO:
        stmt = stmt.where(Order.labo_id == ctx.labo_id)

    res = await session.execute(stmt)
    rows = res.all()

    if not rows:
        raise HTTPException(status_code=404, detail="Aucune commande trouvée pour ces IDs")

    orders_data = []
    db_order_ids: list[int] = []
    client_ids: set[int] = set()

    for order, client, laboclient, agent in rows:
        orders_data.append((order, client, laboclient, agent))
        db_order_ids.append(order.id)
        if client and client.id is not None:
            client_ids.add(client.id)

    # 3) Lignes d’articles + TVA produit (jointure sur product_id)
    items_stmt = (
        select(
            OrderItem,
            Product.vat_rate,
        )
        .join(Product, Product.id == OrderItem.product_id, isouter=True)
        .where(OrderItem.order_id.in_(db_order_ids))
        .order_by(OrderItem.order_id.asc(), OrderItem.id.asc())
    )
    items_res = await session.execute(items_stmt)
    items_all = items_res.all()

    items_by_order: dict[int, list[tuple[OrderItem, Optional[float]]]] = defaultdict(list)
    for it, prod_vat_rate in items_all:
        items_by_order[it.order_id].append((it, prod_vat_rate))

    # 4) Adresses de livraison
    shipping_by_client: dict[int, DeliveryAddress] = {}
    if client_ids:
        addr_stmt = select(DeliveryAddress).where(
            DeliveryAddress.client_id.in_(client_ids)
        )
        addr_res = await session.execute(addr_stmt)
        for da in addr_res.scalars().all():
            cid = da.client_id
            if cid not in shipping_by_client:
                shipping_by_client[cid] = da
            else:
                current = shipping_by_client[cid]
                if getattr(da, "is_default", False) and not getattr(
                    current, "is_default", False
                ):
                    shipping_by_client[cid] = da

    sio = StringIO()
    writer = csv.writer(sio, delimiter=";", quoting=csv.QUOTE_MINIMAL)

    for order, client, laboclient, agent in orders_data:
        company_name = ""
        if client and getattr(client, "company_name", None):
            company_name = (client.company_name or "").strip()
        else:
            company_name = (order.client_name or "").strip()

        fact_addr = ""
        fact_cp = ""
        fact_city = ""

        if client:
            fact_addr = (getattr(client, "address1", "") or "").strip()
            fact_cp = (getattr(client, "postcode", "") or "").strip()
            fact_city = (getattr(client, "city", "") or "").strip()

        ship_addr = fact_addr
        ship_cp = fact_cp
        ship_city = fact_city

        if client and client.id in shipping_by_client:
            da = shipping_by_client[client.id]
            ship_addr = (getattr(da, "address1", "") or "").strip() or ship_addr
            ship_cp = (getattr(da, "postcode", "") or "").strip() or ship_cp
            ship_city = (getattr(da, "city", "") or "").strip() or ship_city

        date_cmd = order.order_date.isoformat() if order.order_date else ""
        date_liv = order.delivery_date.isoformat() if order.delivery_date else ""

        if agent:
            fn = (getattr(agent, "firstname", "") or "").strip()
            ln = (getattr(agent, "lastname", "") or "").strip()
            rep_name = (fn + " " + ln).strip()
        else:
            rep_name = ""

        code_client = laboclient.code_client if laboclient else ""

        comment = (
            getattr(order, "comment", None)
            or getattr(order, "internal_comment", None)
            or ""
        )

        lines = items_by_order.get(order.id, []) or [None]

        for row in lines:
            if row is None:
                sku = ""
                prod_name = ""
                qty = 0
                unit_ht = 0.0
                discount_pct = 0.0
                vat_rate = 0.0
            else:
                it, prod_vat_rate = row

                sku = (
                    getattr(it, "sku", None)
                    or getattr(it, "product_sku", None)
                    or getattr(it, "reference", None)
                    or ""
                )
                prod_name = (
                    getattr(it, "name", None)
                    or getattr(it, "product_name", None)
                    or getattr(it, "label", None)
                    or sku
                    or ""
                )
                qty = getattr(it, "qty", 0) or 0
                unit_ht = float(getattr(it, "unit_ht", 0) or 0)

                discount_pct = float(
                    getattr(it, "discount_percent", None)
                    or getattr(it, "discount_rate", None)
                    or 0
                )
                vat_rate = float(prod_vat_rate or 0)

            writer.writerow(
                [
                    (order.order_number or "").strip(),
                    (code_client or "").strip(),
                    company_name,
                    fact_addr,
                    fact_cp,
                    fact_city,
                    ship_addr,
                    ship_cp,
                    ship_city,
                    date_cmd,
                    date_liv,
                    rep_name,
                    sku,
                    prod_name,
                    qty,
                    f"{unit_ht:.4f}".replace(".", ","),
                    f"{discount_pct:.2f}".replace(".", ","),
                    f"{vat_rate:.2f}".replace(".", ","),
                    comment,
                ]
            )

    csv_bytes = sio.getvalue().encode("utf-8")
    bio = BytesIO(csv_bytes)

    return StreamingResponse(
        bio,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="commandes_selection.csv"'
        },
    )


# ==========================================================
#   POST /api-zenhub/labo/orders/bulk-status
# ==========================================================

@router.post("/orders/bulk-status", response_model=BulkValidateOut)
async def bulk_validate_orders(
    payload: BulkValidateIn,
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
):
    if not payload.order_ids:
        raise HTTPException(status_code=400, detail="order_ids obligatoire")

    # ✅ On force "validated" (puisque ton bouton = "Valider")
    wanted_status = "validated"

    # ✅ Convertit en Enum si possible (sinon fallback string)
    try:
        new_status_enum = OrderStatus(wanted_status)
    except ValueError:
        new_status_enum = wanted_status

    stmt = (
        update(Order)
        .where(Order.id.in_(payload.order_ids))
        .values(status=new_status_enum, updated_at=func.now())
    )

    if ctx.role == UserRole.LABO:
        stmt = stmt.where(Order.labo_id == ctx.labo_id)

    res = await session.execute(stmt)
    await session.commit()

    updated = res.rowcount or 0

    new_status_value = (
        new_status_enum.value if hasattr(new_status_enum, "value") else str(new_status_enum)
    )

    return BulkValidateOut(
        updated=updated,
        new_status=new_status_value,
    )



# ==========================================================
#   POST /api-zenhub/labo/documents/export-csv
# ==========================================================

@router.post("/documents/export-csv")
async def export_labo_documents_csv(
    payload: LaboDocumentsExportIn,
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
):
    if not payload.document_ids:
        raise HTTPException(status_code=400, detail="Aucun document sélectionné")

    labo_id = ctx.labo_id if ctx.role == UserRole.LABO else None

    rows = await fetch_labo_documents_with_items(
        session=session,
        document_ids=payload.document_ids,
        labo_id=labo_id,
    )

    if not rows:
        raise HTTPException(status_code=404, detail="Aucune ligne trouvée pour les documents sélectionnés")

    csv_str = build_easy_vrp_csv(rows)
    csv_bytes = csv_str.encode("utf-8")

    suffix = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"export_documents_labo_{suffix}.csv"

    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
