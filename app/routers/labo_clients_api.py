# app/routers/labo_clients_api.py
from __future__ import annotations

from decimal import Decimal
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Path
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import (
    Client,
    LaboClient,
    Labo,
    Order,
    OrderItem,
    LaboDocument,
    LaboDocumentItem,
    Product,
    Agent,
    UserRole,
)
from app.routers.labo_orders_api import get_current_context  # déjà existant

router = APIRouter(
    prefix="/api-zenhub/labo",
    tags=["labo-clients"],
)


# ============================
#   Pydantic Schemas
# ============================

class ClientBase(BaseModel):
    id: int
    code_client: Optional[str] = None
    company_name: str
    address: Optional[str] = None
    zip_code: Optional[str] = None
    city: Optional[str] = None

    class Config:
        orm_mode = True


class ClientListResponse(BaseModel):
    items: List[ClientBase]
    page: int
    page_size: int
    total: int


class ClientDetail(BaseModel):
    id: int
    code_client: Optional[str] = None
    company_name: str
    address: Optional[str] = None
    zip_code: Optional[str] = None
    city: Optional[str] = None

    class Config:
        orm_mode = True


class ClientOrder(BaseModel):
    id: int
    order_number: str
    order_date: Optional[str] = None
    delivery_date: Optional[str] = None
    agent_name: Optional[str] = None
    status: Optional[str] = None
    total_ht: float

    class Config:
        orm_mode = True


class ClientOrderList(BaseModel):
    items: List[ClientOrder]
    page: int
    page_size: int
    total: int


class ClientDocument(BaseModel):
    id: int
    order_number: str
    type: str
    order_date: Optional[str] = None
    delivery_date: Optional[str] = None
    total_ht: float

    class Config:
        orm_mode = True


class ClientDocumentList(BaseModel):
    items: List[ClientDocument]
    page: int
    page_size: int
    total: int


# ----- Détail lignes commandes / docs -----

class OrderItemLite(BaseModel):
    id: int
    sku: str
    product_name: Optional[str]
    qty: int
    unit_ht: Decimal
    total_ht: Decimal


class OrderItemsResponse(BaseModel):
    items: List[OrderItemLite]


class DocumentItemLite(BaseModel):
    id: int
    sku: str
    product_name: Optional[str]
    qty: int
    unit_ht: Decimal
    total_ht: Decimal


class DocumentItemsResponse(BaseModel):
    items: List[DocumentItemLite]


# ============================
#   Helpers
# ============================

def parse_pagination(page: int, page_size: int) -> tuple[int, int]:
    page = max(1, page)
    # on garde les mêmes tailles que le reste du projet
    if page_size <= 0 or page_size > 200:
        page_size = 50
    return page, page_size


async def get_current_labo(
    ctx: Any = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
) -> Labo:
    """
    ctx vient de get_current_context dans labo_orders_api.py.
    C'est un objet Pydantic (ex: CurrentContext) avec les attributs :
      - role   : UserRole
      - labo_id: int | None
    """
    # Récupère les infos depuis l'objet (ou dict, par sécurité)
    role = getattr(ctx, "role", None)
    labo_id = getattr(ctx, "labo_id", None)

    # Si jamais ctx était un dict par la suite, on gère aussi
    if role is None and isinstance(ctx, dict):
        role = ctx.get("role")
        labo_id = ctx.get("labo_id")

    if role not in (UserRole.LABO, UserRole.SUPERUSER):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not labo_id:
        raise HTTPException(status_code=403, detail="No labo_id in context")

    res = await session.execute(
        select(Labo).where(Labo.id == labo_id)
    )
    labo = res.scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=403, detail="Labo not found")

    return labo


async def ensure_client_for_labo(
    client_id: int,
    labo: Labo,
    session: AsyncSession,
) -> ClientDetail:
    """
    Vérifie que le client appartient bien au labo via LaboClient
    et renvoie les infos de base pour l'entête de la fiche.
    """
    q = (
        select(
            Client.id,
            Client.company_name,
            Client.address1.label("address"),
            Client.postcode.label("zip_code"),
            Client.city,
            LaboClient.code_client,
        )
        .join(LaboClient, LaboClient.client_id == Client.id)
        .where(
            LaboClient.labo_id == labo.id,
            Client.id == client_id,
        )
    )

    res = await session.execute(q)
    row = res.first()
    if not row:
        # le client n'est pas rattaché à ce labo → 403
        raise HTTPException(status_code=403, detail="Client not linked to this labo")

    return ClientDetail(
        id=row.id,
        company_name=row.company_name,
        address=row.address,
        zip_code=row.zip_code,
        city=row.city,
        code_client=row.code_client,
    )


# ============================
#   Endpoints principaux
# ============================

@router.get("/clients", response_model=ClientListResponse)
async def api_labo_clients(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort: str = Query("name"),
    direction: str = Query("asc"),
    labo: Labo = Depends(get_current_labo),
    session: AsyncSession = Depends(get_async_session),
):
    page, page_size = parse_pagination(page, page_size)

    base = (
        select(
            Client.id,
            Client.company_name,
            Client.address1.label("address"),
            Client.postcode.label("zip_code"),
            Client.city,
            LaboClient.code_client,
        )
        .join(LaboClient, LaboClient.client_id == Client.id)
        .where(LaboClient.labo_id == labo.id)
    )

    if search:
        pattern = f"%{search}%"
        base = base.where(
            LaboClient.code_client.ilike(pattern)
            | Client.company_name.ilike(pattern)
        )

    # Tri
    sort = (sort or "name").lower()
    direction = (direction or "asc").lower()
    if sort == "code":
        col = LaboClient.code_client
    elif sort == "postcode":
        col = Client.postcode
    elif sort == "city":
        col = Client.city
    else:
        col = Client.company_name

    if direction == "desc":
        base = base.order_by(col.desc())
    else:
        base = base.order_by(col.asc())

    # Total
    count_q = select(func.count()).select_from(base.subquery())
    res_total = await session.execute(count_q)
    total = res_total.scalar_one() or 0

    offset = (page - 1) * page_size
    q = base.offset(offset).limit(page_size)
    res = await session.execute(q)
    rows = res.all()

    items = [
        ClientBase(
            id=r.id,
            company_name=r.company_name,
            address=r.address,
            zip_code=r.zip_code,
            city=r.city,
            code_client=r.code_client,
        )
        for r in rows
    ]

    return ClientListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/clients/{client_id}", response_model=ClientDetail)
async def api_labo_client_detail(
    client_id: int = Path(..., ge=1),
    labo: Labo = Depends(get_current_labo),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Infos de base pour l'entête (raison sociale, code client, adresse…)
    + vérification d’appartenance au labo.
    """
    return await ensure_client_for_labo(client_id, labo, session)


@router.get("/clients/{client_id}/orders", response_model=ClientOrderList)
async def api_labo_client_orders(
    client_id: int = Path(..., ge=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    labo: Labo = Depends(get_current_labo),
    session: AsyncSession = Depends(get_async_session),
):
    page, page_size = parse_pagination(page, page_size)

    # vérifie que le client appartient bien au labo
    await ensure_client_for_labo(client_id, labo, session)

    base = (
        select(
            Order.id,
            Order.order_number,
            Order.order_date,
            Order.delivery_date,
            Order.status,
            Order.total_ht,
            Agent.firstname,
            Agent.lastname,
        )
        .select_from(Order)
        .join(Agent, Agent.id == Order.agent_id, isouter=True)
        .where(
            Order.labo_id == labo.id,
            Order.client_id == client_id,
        )
        .order_by(Order.order_date.desc(), Order.order_number.desc())
    )

    count_q = select(func.count()).select_from(base.subquery())
    res_total = await session.execute(count_q)
    total = res_total.scalar_one() or 0

    offset = (page - 1) * page_size
    q = base.offset(offset).limit(page_size)
    res = await session.execute(q)
    rows = res.all()

    items: List[ClientOrder] = []
    for r in rows:
        agent_name = None
        if r.firstname or r.lastname:
            agent_name = f"{r.firstname or ''} {r.lastname or ''}".strip() or None

        items.append(
            ClientOrder(
                id=r.id,
                order_number=r.order_number,
                order_date=r.order_date.isoformat() if r.order_date else None,
                delivery_date=r.delivery_date.isoformat() if r.delivery_date else None,
                agent_name=agent_name,
                status=r.status.value if r.status else None,
                total_ht=float(r.total_ht or 0),
            )
        )

    return ClientOrderList(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/clients/{client_id}/documents", response_model=ClientDocumentList)
async def api_labo_client_documents(
    client_id: int = Path(..., ge=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    labo: Labo = Depends(get_current_labo),
    session: AsyncSession = Depends(get_async_session),
):
    page, page_size = parse_pagination(page, page_size)

    # vérifie que le client appartient bien au labo
    await ensure_client_for_labo(client_id, labo, session)

    base = (
        select(
            LaboDocument.id,
            LaboDocument.order_number,
            LaboDocument.type,
            LaboDocument.order_date,
            LaboDocument.delivery_date,
            LaboDocument.total_ht,
        )
        .where(
            LaboDocument.labo_id == labo.id,
            LaboDocument.client_id == client_id,
        )
        .order_by(LaboDocument.order_date.desc(), LaboDocument.order_number.desc())
    )

    count_q = select(func.count()).select_from(base.subquery())
    res_total = await session.execute(count_q)
    total = res_total.scalar_one() or 0

    offset = (page - 1) * page_size
    q = base.offset(offset).limit(page_size)
    res = await session.execute(q)
    rows = res.all()

    items: List[ClientDocument] = [
        ClientDocument(
            id=r.id,
            order_number=r.order_number,
            type=r.type.value if hasattr(r.type, "value") else str(r.type),
            order_date=r.order_date.isoformat() if r.order_date else None,
            delivery_date=r.delivery_date.isoformat() if r.delivery_date else None,
            total_ht=float(r.total_ht or 0),
        )
        for r in rows
    ]

    return ClientDocumentList(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


# ============================
#   Endpoints de détail
# ============================

@router.get(
    "/clients/{client_id}/orders/{order_id}/items",
    response_model=OrderItemsResponse,
)
async def api_labo_client_order_items(
    client_id: int = Path(..., ge=1),
    order_id: int = Path(..., ge=1),
    labo: Labo = Depends(get_current_labo),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Détail des lignes d'une commande agent pour un client donné
    (sécurisé sur labo_id + client_id).
    """
    # Vérifier que la commande appartient bien au labo + client
    res_order = await session.execute(
        select(Order).where(
            Order.id == order_id,
            Order.labo_id == labo.id,
            Order.client_id == client_id,
        )
    )
    order = res_order.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for this client/labo")

    # Récupérer les lignes
    res_items = await session.execute(
        select(
            OrderItem.id,
            OrderItem.sku,
            Product.name.label("product_name"),
            OrderItem.qty,
            OrderItem.unit_ht,
            OrderItem.total_ht,
        )
        .select_from(OrderItem)
        .join(Product, Product.id == OrderItem.product_id, isouter=True)
        .where(OrderItem.order_id == order_id)
        .order_by(OrderItem.id)
    )

    rows = res_items.all()
    items = [
        OrderItemLite(
            id=row.id,
            sku=row.sku,
            product_name=row.product_name,
            qty=row.qty,
            unit_ht=row.unit_ht,
            total_ht=row.total_ht,
        )
        for row in rows
    ]
    return OrderItemsResponse(items=items)


@router.get(
    "/clients/{client_id}/documents/{document_id}/items",
    response_model=DocumentItemsResponse,
)
async def api_labo_client_document_items(
    client_id: int = Path(..., ge=1),
    document_id: int = Path(..., ge=1),
    labo: Labo = Depends(get_current_labo),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Détail des lignes d'un document labo (FA/BC/BL/AV) pour un client.
    """
    res_doc = await session.execute(
        select(LaboDocument).where(
            LaboDocument.id == document_id,
            LaboDocument.labo_id == labo.id,
            LaboDocument.client_id == client_id,
        )
    )
    doc = res_doc.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="LaboDocument not found for this client/labo")

    res_items = await session.execute(
        select(
            LaboDocumentItem.id,
            LaboDocumentItem.sku,
            Product.name.label("product_name"),
            LaboDocumentItem.qty,
            LaboDocumentItem.unit_ht,
            LaboDocumentItem.total_ht,
        )
        .select_from(LaboDocumentItem)
        .join(Product, Product.id == LaboDocumentItem.product_id, isouter=True)
        .where(LaboDocumentItem.document_id == document_id)
        .order_by(LaboDocumentItem.id)
    )

    rows = res_items.all()
    items = [
        DocumentItemLite(
            id=row.id,
            sku=row.sku,
            product_name=row.product_name,
            qty=row.qty,
            unit_ht=row.unit_ht,
            total_ht=row.total_ht,
        )
        for row in rows
    ]
    return DocumentItemsResponse(items=items)
