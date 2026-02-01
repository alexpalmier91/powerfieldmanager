# app/routers/agent_dashboard.py
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
from datetime import date as _date

from fastapi import APIRouter, Depends, Query, HTTPException, Body, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_

from app.db.session import get_async_session
from app.db.models import (
    Agent, Labo, Product, Client, Customer,
    Order, OrderItem, OrderStatus
)
from app.core.security import require_role, get_current_user


router = APIRouter(
    prefix="/api-zenhub/agent",
    tags=["agent"],
    # En prod, tu peux réduire à ["AGENT"] uniquement.
    dependencies=[Depends(require_role(["AGENT", "R", "SUPERADMIN", "SUPERUSER"]))],
)

# ------------------ Helpers ------------------
async def _get_me(session: AsyncSession, payload: dict) -> Agent:
    """Retrouve l'Agent via l'email (sub) contenu dans le JWT."""
    email = payload.get("sub") or payload.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token (no sub/email)")
    q = await session.execute(select(Agent).where(Agent.email == email))
    me = q.scalar_one_or_none()
    if not me:
        raise HTTPException(status_code=403, detail="Agent introuvable")
    return me


def _product_out(p: Product) -> Dict[str, Any]:
    return {
        "id": p.id,
        "labo_id": p.labo_id,
        "sku": p.sku,
        "name": p.name,
        "price_ht": float(p.price_ht or 0),
        "stock": int(p.stock or 0) if getattr(p, "stock", None) is not None else None,
        "ean13": p.ean13 or "",
        "image_url": p.image_url or "",
    }


def _norm_status(code: Optional[str]) -> str:
    # Conserve ce mapping si ton front attend pending/completed/canceled
    if isinstance(code, OrderStatus):
        return code.value
    c = (code or "").upper()
    if c == "FA":
        return "completed"
    if c in {"AV", "AW"}:
        return "canceled"
    return "pending"  # CO et défaut


def _status_enum_from_query(status: Optional[str]) -> Optional[OrderStatus]:
    if not status:
        return None
    s = status.lower()
    if s == "pending":
        return OrderStatus.pending
    if s == "completed":
        return OrderStatus.completed
    if s == "canceled":
        return OrderStatus.canceled
    return None


def _page_payload(total: int, page: int, page_size: int, items: List[dict]) -> Dict[str, Any]:
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _coalesce_pagination(
    page: Optional[int], page_size: Optional[int], limit: Optional[int], offset: Optional[int]
) -> Tuple[int, int]:
    """
    Compat : accepte page/page_size (spec) et limit/offset (legacy).
    Priorité à page/page_size si fournis.
    """
    if page or page_size:
        p = max(1, page or 1)
        ps = min(500, max(1, page_size or 50))
        return p, ps
    # fallback legacy
    lim = min(500, max(1, (limit or 50)))
    off = max(0, offset or 0)
    p = (off // lim) + 1
    return p, lim


def _parse_iso_date(val: Optional[str], name: str) -> Optional[_date]:
    if not val:
        return None
    try:
        return _date.fromisoformat(val)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Paramètre {name} invalide (attendu YYYY-MM-DD)")


async def _ensure_customer_from_client(session: AsyncSession, client_id: int) -> int:
    """
    Pont référentiel : garantit l'existence d'un Customer miroir du Client donné.
    Retourne customer_id.
    """
    q = await session.execute(select(Client).where(Client.id == client_id))
    c = q.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=400, detail=f"Client {client_id} introuvable")

    # 1) si on a un email, essayer de retrouver un Customer existant par email
    if c.email:
        q2 = await session.execute(select(Customer).where(Customer.email == c.email))
        cust = q2.scalar_one_or_none()
        if cust:
            # MàJ légère côté Customer (idempotent)
            changed = False
            if c.company_name and cust.company != c.company_name:
                cust.company = c.company_name; changed = True
            if c.phone and cust.phone != c.phone:
                cust.phone = c.phone; changed = True
            if c.address1 and cust.address1 != c.address1:
                cust.address1 = c.address1; changed = True
            if c.postcode and cust.postcode != c.postcode:
                cust.postcode = c.postcode; changed = True
            if c.city and cust.city != c.city:
                cust.city = c.city; changed = True
            if c.country and cust.country != c.country:
                cust.country = c.country; changed = True
            if changed:
                await session.flush()
            return cust.id

    # 2) sinon créer un nouveau Customer à partir du Client
    new_cust = Customer(
        email=c.email,
        company=c.company_name,
        vat=None,
        phone=c.phone,
        address1=c.address1,
        address2=None,
        postcode=c.postcode,
        city=c.city,
        country=c.country,
    )
    session.add(new_cust)
    await session.flush()
    return new_cust.id


# ------------------ Endpoints ------------------
@router.get("/me")
async def agent_me(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
):
    me = await _get_me(session, payload)
    # labos liés (id + name + count produits) pour alimenter un quick-select éventuel
    res = await session.execute(
        select(Labo.id, Labo.name, func.count(Product.id))
        .join(Labo.agents)
        .join(Product, Product.labo_id == Labo.id, isouter=True)
        .where(Agent.id == me.id)
        .group_by(Labo.id, Labo.name)
        .order_by(Labo.name.asc())
    )
    labos = [{"id": i, "name": n, "products_count": int(c)} for i, n, c in res.all()]
    return {
        "id": me.id,
        "email": me.email,
        "firstname": me.firstname,
        "lastname": me.lastname,
        "phone": me.phone,
        "role": "AGENT",
        "labos": labos,
    }


@router.get("/labos")
async def list_labos(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
):
    me = await _get_me(session, payload)
    q = await session.execute(
        select(Labo).join(Labo.agents).where(Agent.id == me.id).order_by(Labo.name.asc())
    )
    labos = q.scalars().all()
    return [{"id": l.id, "name": l.name} for l in labos]


@router.get("/clients")
async def list_clients(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
    search: Optional[str] = Query(None),
    # Spec: page/page_size, compat: limit/offset
    page: Optional[int] = Query(None, ge=1),
    page_size: Optional[int] = Query(None, ge=1, le=500),
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: Optional[int] = Query(None, ge=0),
):
    me = await _get_me(session, payload)
    page, page_size = _coalesce_pagination(page, page_size, limit, offset)

    base = select(Client).where(
        Client.agent_id == me.id  # ⬅️ adapte si tu utilises une table d'association agent_client
    )

    if search:
        like = f"%{search.lower()}%"
        base = base.where(
            or_(
                func.lower(Client.company_name).like(like),
                func.lower(Client.email).like(like),
                func.lower(Client.city).like(like),
                func.lower(Client.postcode).like(like),
            )
        )

    total = int((await session.execute(select(func.count()).select_from(base.subquery()))).scalar_one())
    q = await session.execute(
        base.order_by(Client.company_name.asc())
            .limit(page_size)
            .offset((page - 1) * page_size)
    )
    rows = q.scalars().all()
    items = [{
        "id": c.id,
        "company": c.company_name,
        "email": c.email,
        "city": c.city,
        "phone": c.phone,
        "zipcode": c.postcode,
        "address": c.address1,
        "country": c.country,
        "groupement": c.groupement,
    } for c in rows]
    return _page_payload(total, page, page_size, items)


@router.get("/catalogue")
async def agent_catalogue(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
    labo_id: int = Query(..., ge=1),
    search: Optional[str] = Query(None),
    # compat legacy
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """
    Legacy: conserve /catalogue (limit/offset) — préférer /labos/{labo_id}/products (page/page_size).
    """
    me = await _get_me(session, payload)

    # Vérifier accès labo
    q = await session.execute(
        select(Labo).join(Labo.agents).where(Labo.id == labo_id, Agent.id == me.id)
    )
    if not q.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Accès refusé à ce laboratoire")

    base = select(Product).where(Product.labo_id == labo_id)
    if search:
        like = f"%{search.lower()}%"
        base = base.where(or_(func.lower(Product.name).like(like), func.lower(Product.sku).like(like)))

    total = int((await session.execute(select(func.count()).select_from(base.subquery()))).scalar_one())
    q2 = await session.execute(
        base.order_by(Product.name.asc())
            .limit(limit)
            .offset(offset)
    )
    items = [_product_out(p) for p in q2.scalars().all()]
    # on renvoie en legacy (limit/offset) pour ne pas casser le front historique
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get(
    "/labos/{labo_id}/products-legacy",
    include_in_schema=False,
)
async def labo_products(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    """Route canonique pour le catalogue par labo (spec MVP)."""
    me = await _get_me(session, payload)

    # sécurité : l’agent doit être lié au labo
    ok = await session.execute(
        select(func.count())
        .select_from(Labo)
        .join(Labo.agents)
        .where(Labo.id == labo_id, Agent.id == me.id)
    )
    if ok.scalar_one() == 0:
        raise HTTPException(status_code=403, detail="Accès refusé à ce laboratoire")

    base = select(Product).where(Product.labo_id == labo_id)
    if search:
        like = f"%{search.lower()}%"
        base = base.where(or_(func.lower(Product.sku).like(like), func.lower(Product.name).like(like)))

    total = int((await session.execute(select(func.count()).select_from(base.subquery()))).scalar_one())
    rows = (await session.execute(
        base.order_by(Product.name.asc())
            .limit(page_size)
            .offset((page - 1) * page_size)
    )).scalars().all()
    items = [_product_out(p) for p in rows]
    return _page_payload(total, page, page_size, items)


@router.get("/orders")
async def list_orders(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
    labo_id: Optional[int] = Query(None, ge=1),
    status: Optional[str] = Query(None, regex="^(pending|completed|canceled)$"),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD (exclu)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    """
    Liste paginée des commandes de l'agent connecté, avec filtres.
    """
    me = await _get_me(session, payload)

    q = (
        select(Order, Client, Labo)
        .join(Client, Client.id == Order.client_id, isouter=True)
        .join(Labo, Labo.id == Order.labo_id, isouter=True)
        .where(Order.agent_id == me.id)
    )

    if labo_id:
        q = q.where(Order.labo_id == labo_id)

    # ---- Dates : parse en objets date -> binding SQL correct (DATE)
    df = _parse_iso_date(date_from, "date_from")
    dt = _parse_iso_date(date_to, "date_to")

    # fallback date: COALESCE(order_date, date(created_at))
    odate = func.coalesce(Order.order_date, func.date(Order.created_at))
    if df is not None:
        q = q.where(odate >= df)
    if dt is not None:
        q = q.where(odate < dt)

    # ---- Statut: filtrer via Enum
    wanted = _status_enum_from_query(status)
    if wanted is not None:
        q = q.where(Order.status == wanted)

    total = int((await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one())
    rows = (await session.execute(
        q.order_by(odate.desc(), Order.id.desc())
         .limit(page_size)
         .offset((page - 1) * page_size)
    )).all()

    items = []
    for o, c, l in rows:
        od = o.order_date or (o.created_at.date() if o.created_at else None)
        items.append({
            "id": o.id,
            "doc_number": getattr(o, "order_number", None) or getattr(o, "doc_number", str(o.id)),
            "date": od.isoformat() if od else None,
            "client_name": getattr(c, "company_name", None) or getattr(c, "societe", None) or "",
            "labo_name": getattr(l, "name", "") if l else "",
            "status": _norm_status(getattr(o, "status", None)),
            "total_ht": float(getattr(o, "total_ht", 0) or 0),
        })
    return _page_payload(total, page, page_size, items)


@router.get("/orders/{order_id}")
async def get_order_detail(
    order_id: int,
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
):
    """
    Détail d'une commande (contrôle d'accès par agent_id) + lignes.
    """
    me = await _get_me(session, payload)

    row = (await session.execute(
        select(Order, Client, Labo)
        .join(Client, Client.id == Order.client_id, isouter=True)
        .join(Labo, Labo.id == Order.labo_id, isouter=True)
        .where(and_(Order.id == order_id, Order.agent_id == me.id))
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Commande introuvable")

    o, c, l = row
    lines = (await session.execute(
        select(OrderItem, Product)
        .join(Product, Product.id == OrderItem.product_id, isouter=True)
        .where(OrderItem.order_id == o.id)
        .order_by(OrderItem.id.asc())
    )).all()

    line_items = [{
        "sku": getattr(p, "sku", "") if p else "",
        "product_name": getattr(p, "name", "") if p else "",
        "qty": float(getattr(oi, "qty", 0) or 0),
        "line_total_ht": float(getattr(oi, "line_ht", 0) or 0),
    } for oi, p in lines]

    od = o.order_date or (o.created_at.date() if o.created_at else None)
    order_out = {
        "id": o.id,
        "doc_number": getattr(o, "order_number", None) or getattr(o, "doc_number", str(o.id)),
        "date": od.isoformat() if od else None,
        "client_name": getattr(c, "company_name", None) or getattr(c, "societe", None) or "",
        "labo_name": getattr(l, "name", "") if l else "",
        "status": _norm_status(getattr(o, "status", None)),
        "total_ht": float(getattr(o, "total_ht", 0) or 0),
    }
    return {"order": order_out, "lines": line_items}


@router.post("/orders", status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
    labo_id: int = Body(..., embed=True),
    client_id: int = Body(..., embed=True),
    items: List[Dict[str, Any]] = Body(..., embed=True),  # [{product_id, qty}]
):
    me = await _get_me(session, payload)

    # Vérifier accès labo
    q = await session.execute(
        select(Labo).join(Labo.agents).where(Labo.id == labo_id, Agent.id == me.id)
    )
    labo = q.scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=403, detail="Accès refusé à ce laboratoire")

    if not items:
        raise HTTPException(status_code=400, detail="Aucun article")

    # Charger produits et valider leur appartenance au labo
    prod_ids = [int(it["product_id"]) for it in items]
    q = await session.execute(select(Product).where(Product.id.in_(prod_ids)))
    prods = {p.id: p for p in q.scalars().all()}
    if len(prods) != len(set(prod_ids)):
        raise HTTPException(status_code=400, detail="Produit introuvable")
    for p in prods.values():
        if p.labo_id != labo_id:
            raise HTTPException(status_code=400, detail=f"Produit {p.id} non lié au labo")

    # Garantir un Customer pour ce client référentiel
    customer_id = await _ensure_customer_from_client(session, client_id)

    # Construire la commande
    from decimal import Decimal
    total_ht = Decimal("0.00")
    order = Order(
        labo_id=labo_id,
        agent_id=me.id,
        customer_id=customer_id,
        status=OrderStatus.pending,
        currency="EUR",
        total_ht=Decimal("0.00"),
        total_ttc=Decimal("0.00"),
    )
    session.add(order)
    await session.flush()  # order.id

    for it in items:
        p = prods[int(it["product_id"])]
        qty = max(1, int(it.get("qty") or 0))
        unit = Decimal(p.price_ht or 0)
        line = unit * qty
        total_ht += line

        session.add(OrderItem(
            order_id=order.id,
            product_id=p.id,
            sku=p.sku,
            ean13=p.ean13,
            qty=qty,
            unit_ht=unit,
            line_ht=line,
        ))

    order.total_ht = total_ht
    order.total_ttc = total_ht  # TVA calculée ailleurs si besoin

    await session.commit()
    return {"order_id": order.id, "total_ht": float(order.total_ht)}
