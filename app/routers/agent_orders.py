# app/routers/agent_orders.py
from __future__ import annotations

import re
import sqlalchemy as sa
from sqlalchemy.orm import selectinload
from decimal import Decimal
from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.session import get_session
from app.db import models
from app.core.security import get_current_payload

router = APIRouter(prefix="/api-zenhub/agent", tags=["agent"])


# =========================
# Helpers sécurité / user
# =========================
async def get_current_user(
    payload: dict = Depends(get_current_payload),
    db: AsyncSession = Depends(get_session),
) -> models.User:
    """
    Récupère l'utilisateur courant à partir du JWT.
    Crée un user minimal si absent (utile en dev).
    """
    email = payload.get("email") or payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = (
        await db.execute(sa.select(models.User).where(models.User.email == email))
    ).scalar_one_or_none()

    if user is None:
        user = models.User(email=email, is_active=True, role=models.UserRole.AGENT)
        db.add(user)
        await db.flush()

    return user


def _role_name(role_val) -> str:
    if role_val is None:
        return ""
    if hasattr(role_val, "value"):
        return role_val.value
    return str(role_val)


def ensure_agent(user: models.User):
    name = _role_name(getattr(user, "role", None)).upper()
    if name not in {"AGENT", "SUPERUSER"}:
        raise HTTPException(status_code=403, detail="Forbidden")


# =========================
# Pydantic Schemas
# =========================
class OrderItemIn(BaseModel):
    product_id: int
    qty: int = Field(ge=1)
    price_ht: Decimal = Field(ge=0)
    discount_percent: Optional[Decimal] = Field(default=0, ge=0, le=100)


class OrderIn(BaseModel):
    client_id: int
    labo_id: int
    items: List[OrderItemIn]

    delivery_date: Optional[date] = Field(default=None)
    payment_method: Optional[str] = Field(default=None)
    comment: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("delivery_date")
    @classmethod
    def validate_delivery_date(cls, v: Optional[date]) -> Optional[date]:
        today = date.today()
        if v is None:
            return today
        if v < today:
            raise ValueError("La date de livraison ne peut pas être dans le passé.")
        return v

    @field_validator("comment")
    @classmethod
    def strip_comment(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("items")
    @classmethod
    def ensure_items_not_empty(cls, v: List[OrderItemIn]) -> List[OrderItemIn]:
        if not v:
            raise ValueError("Aucun article")
        return v


class ClientOut(BaseModel):
    id: int
    company_name: Optional[str] = None
    postcode: Optional[str] = None
    city: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

    class Config:
        from_attributes = True


class PriceTierOut(BaseModel):
    qty_min: int
    price_ht: Decimal

    class Config:
        from_attributes = True


class ProductOut(BaseModel):
    id: int
    sku: str
    name: str
    ean13: Optional[str] = None
    image_url: Optional[str] = None
    price_ht: Decimal
    stock: int
    commission: Optional[Decimal] = None

    tiers: list[PriceTierOut] = Field(default_factory=list, alias="price_tiers")

    class Config:
        from_attributes = True
        allow_population_by_field_name = True


# =========================
# Helpers métier
# =========================
async def get_or_create_agent_minimal(db: AsyncSession, user: models.User) -> models.Agent:
    agent = (
        await db.execute(sa.select(models.Agent).where(models.Agent.email == user.email))
    ).scalar_one_or_none()

    if agent is None:
        agent = models.Agent(email=user.email, firstname=None, lastname=None, phone=None)
        db.add(agent)
        await db.flush()

    return agent


async def ensure_agent_labo_scope(db: AsyncSession, agent_id: int, labo_id: int, user: models.User) -> None:
    if _role_name(user.role).upper() == "SUPERUSER":
        return
    cnt = (
        await db.execute(
            sa.select(sa.func.count())
            .select_from(models.labo_agent)
            .where(
                models.labo_agent.c.agent_id == agent_id,
                models.labo_agent.c.labo_id == labo_id,
            )
        )
    ).scalar_one()
    if cnt == 0:
        raise HTTPException(status_code=403, detail="Labo non autorisé pour cet agent")


async def ensure_agent_client_link(db: AsyncSession, agent_id: int, client_id: int) -> None:
    if not agent_id or not client_id:
        return
    stmt = pg_insert(models.agent_client).values(agent_id=agent_id, client_id=client_id)
    try:
        stmt = stmt.on_conflict_do_nothing(index_elements=["agent_id", "client_id"])
    except Exception:
        pass
    await db.execute(stmt)


async def generate_next_order_number(db: AsyncSession, agent_id: int) -> str:
    prefix = f"AG-{agent_id}-"
    last_number: Optional[str] = (
        await db.execute(
            sa.select(models.Order.order_number)
            .where(
                models.Order.agent_id == agent_id,
                models.Order.order_number.isnot(None),
            )
            .order_by(models.Order.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if not last_number or not last_number.startswith(prefix):
        next_seq = 1
    else:
        m = re.match(rf"^AG-{agent_id}-(\d+)$", last_number)
        next_seq = int(m.group(1)) + 1 if m else 1

    return f"{prefix}{next_seq:06d}"


# =========================
# Endpoints auxiliaires
# =========================
@router.get("/labos")
async def list_labos_for_agent(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ensure_agent(user)

    if _role_name(user.role).upper() == "SUPERUSER":
        rows = (await db.execute(sa.select(models.Labo.id, models.Labo.name))).all()
        return [{"id": i, "name": n} for (i, n) in rows]

    agent = (
        await db.execute(sa.select(models.Agent).where(models.Agent.email == user.email))
    ).scalar_one_or_none()
    if agent is None:
        return []

    rows = (
        await db.execute(
            sa.select(models.Labo.id, models.Labo.name)
            .select_from(models.Labo)
            .join(models.labo_agent, models.labo_agent.c.labo_id == models.Labo.id)
            .where(models.labo_agent.c.agent_id == agent.id)
            .order_by(models.Labo.name.asc())
        )
    ).all()
    return [{"id": i, "name": n} for (i, n) in rows]


@router.get("/clients")
async def search_clients(
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ensure_agent(user)

    agent = (
        await db.execute(sa.select(models.Agent).where(models.Agent.email == user.email))
    ).scalar_one_or_none()
    if agent is None:
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "source": "agent"}

    base = (
        sa.select(models.Client)
        .join(models.agent_client, models.agent_client.c.client_id == models.Client.id)
        .where(models.agent_client.c.agent_id == agent.id)
    )

    if search:
        s = f"%{search.strip()}%"
        base = base.where(
            sa.or_(
                models.Client.company_name.ilike(s),
                models.Client.postcode.ilike(s),
                models.Client.city.ilike(s),
                models.Client.email.ilike(s),
                models.Client.phone.ilike(s),
            )
        )

    total = (await db.execute(sa.select(sa.func.count()).select_from(base.subquery()))).scalar_one()

    page = max(1, page)
    page_size = page_size if page_size in (50, 100) else 50
    q = (
        base.order_by(models.Client.company_name.asc(), models.Client.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = (await db.execute(q)).scalars().all()
    items = [
        {
            "id": r.id,
            "company": r.company_name,
            "zipcode": r.postcode,
            "city": r.city,
            "email": r.email,
            "phone": r.phone,
            "groupement": r.groupement,
        }
        for r in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size, "source": "agent"}


# =========================
# ✅ Catalogue produits (FIX infinite scroll)
# - support page/page_size (ton api.js)
# - garde offset/limit (compat)
# - filtre produits non actifs
# - order_by stable + log intelligent
# =========================
@router.get("/products")
async def list_products(
    labo_id: int = Query(..., ge=1),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(default=None),

    # 🔥 NOUVEAU
    sort: str = Query(default="name"),   # name | sku
    dir: str = Query(default="asc"),     # asc | desc

    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ensure_agent(user)

    agent = (
        await db.execute(sa.select(models.Agent).where(models.Agent.email == user.email))
    ).scalar_one_or_none()

    if not agent:
        return {"total": 0, "items": [], "offset": offset, "limit": limit, "has_more": False}

    await ensure_agent_labo_scope(db, agent_id=agent.id, labo_id=labo_id, user=user)

    active_col = getattr(models.Product, "is_active", None) or getattr(models.Product, "active", None)

    base = (
        sa.select(models.Product)
        .where(models.Product.labo_id == labo_id)
        .options(selectinload(models.Product.price_tiers))
    )

    if active_col is not None:
        base = base.where(active_col.is_(True))

    if search:
        s = f"%{search.strip()}%"
        base = base.where(
            sa.or_(
                models.Product.sku.ilike(s),
                models.Product.name.ilike(s),
                models.Product.ean13.ilike(s),
            )
        )

    # 🔒 Whitelist TRI
    sort_map = {
        "name": models.Product.name,
        "sku": models.Product.sku,
    }
    sort_col = sort_map.get(sort, models.Product.name)
    order_dir = sort_col.asc() if dir.lower() == "asc" else sort_col.desc()

    # ✅ total AVANT pagination
    total = (
        await db.execute(
            sa.select(sa.func.count()).select_from(base.subquery())
        )
    ).scalar_one()

    # ✅ ORDER BY STABLE
    q = (
        base
        .order_by(order_dir, models.Product.id.asc())
        .offset(offset)
        .limit(limit)
    )

    rows = (await db.execute(q)).scalars().all()

    items = []
    for p in rows:
        items.append({
            "id": p.id,
            "sku": p.sku,
            "name": p.name,
            "ean13": p.ean13,
            "image_url": p.image_url or f"/media/labo_products/{p.labo_id}/{p.sku}.jpg",
            "price_ht": float(p.price_ht or 0),
            "stock": int(p.stock or 0),
            "commission": float(p.commission or 0),
            "tiers": [
                {"min_qty": t.qty_min, "price_ht": float(t.price_ht or 0)}
                for t in p.price_tiers
            ],
        })

    next_offset = offset + len(items)

    return {
        "total": int(total),
        "items": items,
        "offset": offset,
        "limit": limit,
        "next_offset": next_offset,
        "has_more": next_offset < total,
    }




# =========================
# Listing des commandes (GET /agent/orders)
# =========================
@router.get("/orders")
async def list_orders(
    labo_id: Optional[int] = Query(default=None),
    status: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    search: Optional[str] = Query(default=None),
    sort: str = Query(default="date"),
    dir: str = Query(default="desc"),
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ensure_agent(user)

    agent = (
        await db.execute(sa.select(models.Agent).where(models.Agent.email == user.email))
    ).scalar_one_or_none()
    if agent is None:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    date_col = sa.func.coalesce(
        models.Order.order_date,
        sa.func.date(models.Order.created_at),
    )

    base = (
        sa.select(models.Order, models.Client, models.Labo, models.Agent)
        .join(models.Labo, models.Labo.id == models.Order.labo_id)
        .outerjoin(models.Client, models.Client.id == models.Order.client_id)
        .join(models.Agent, models.Agent.id == models.Order.agent_id)
        .where(models.Order.agent_id == agent.id)
    )

    if labo_id:
        base = base.where(models.Order.labo_id == labo_id)

    if status:
        try:
            status_enum = models.OrderStatus(status)
            base = base.where(models.Order.status == status_enum)
        except ValueError:
            pass

    if date_from:
        base = base.where(date_col >= date_from)
    if date_to:
        base = base.where(date_col <= date_to)

    if search:
        s = f"%{search.strip()}%"
        base = base.where(
            sa.or_(
                models.Order.order_number.ilike(s),
                models.Client.company_name.ilike(s),
                models.Client.city.ilike(s),
                models.Client.postcode.ilike(s),
            )
        )

    total = (await db.execute(sa.select(sa.func.count()).select_from(base.subquery()))).scalar_one()

    page = max(1, page)
    page_size = page_size if page_size in (50, 100) else 50

    sort_map = {
        "date": date_col,
        "total_ht": models.Order.total_ht,
        "labo_name": models.Labo.name,
        "client_name": models.Client.company_name,
    }
    sort_col = sort_map.get(sort, date_col)
    order_dir = sort_col.asc() if dir.lower() == "asc" else sort_col.desc()

    q = (
        base.order_by(order_dir, models.Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = (await db.execute(q)).all()

    items = []
    for order, client, labo, ag in rows:
        d = order.order_date
        if not d and order.created_at is not None:
            d = order.created_at.date()
        date_iso = d.isoformat() if d else None

        client_name = client.company_name if client else getattr(order, "client_name", None)

        fn = (getattr(ag, "firstname", None) or "").strip()
        ln = (getattr(ag, "lastname", None) or "").strip()
        agent_name = (f"{fn} {ln}".strip()) or (getattr(ag, "email", None) or "")

        items.append(
            {
                "id": order.id,
                "doc_no": order.order_number,
                "date": date_iso,
                "client_name": client_name,
                "labo_name": labo.name,
                "status": getattr(order.status, "value", str(order.status)),
                "total_ht": float(order.total_ht or 0),
                "agent_name": agent_name,
            }
        )

    return {"items": items, "total": total, "page": page, "page_size": page_size}


# =========================
# Création de commande (POST /agent/orders)
# =========================
@router.post("/orders")
async def create_order(
    payload: OrderIn,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ensure_agent(user)

    if not payload.items:
        raise HTTPException(status_code=400, detail="Aucun article")

    agent = await get_or_create_agent_minimal(db, user)

    await ensure_agent_labo_scope(db, agent_id=agent.id, labo_id=payload.labo_id, user=user)

    client: models.Client | None = (
        await db.execute(sa.select(models.Client).where(models.Client.id == payload.client_id))
    ).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=400, detail="Client introuvable")

    order_number = await generate_next_order_number(db, agent_id=agent.id)

    order = models.Order(
        labo_id=payload.labo_id,
        agent_id=agent.id,
        client_id=payload.client_id,
        order_number=order_number,
        order_date=date.today(),
        delivery_date=payload.delivery_date or date.today(),
        payment_method=payload.payment_method,
        comment=payload.comment,
        client_name=client.company_name,
        currency="EUR",
        status=models.OrderStatus.draft,
        total_ht=Decimal("0.00"),
        total_ttc=Decimal("0.00"),
    )
    db.add(order)
    await db.flush()

    total_ht = Decimal("0.00")
    total_tva = Decimal("0.00")

    for it in payload.items:
        product: models.Product | None = (
            await db.execute(
                sa.select(models.Product).where(
                    models.Product.id == it.product_id,
                    models.Product.labo_id == payload.labo_id,
                )
            )
        ).scalar_one_or_none()

        if not product:
            raise HTTPException(status_code=400, detail=f"Produit {it.product_id} introuvable pour ce labo")

        unit_ht = Decimal(it.price_ht)
        qty_dec = Decimal(it.qty)
        discount = Decimal(it.discount_percent or 0)

        if discount < 0 or discount > 100:
            raise HTTPException(status_code=400, detail=f"Remise invalide sur le produit {product.sku}")

        factor = (Decimal("100") - discount) / Decimal("100")
        line_ht = (unit_ht * qty_dec * factor).quantize(Decimal("0.01"))

        tva_rate = Decimal(getattr(product, "vat_rate", 0) or 0)
        line_tva = (line_ht * tva_rate / Decimal("100")).quantize(Decimal("0.01"))

        db.add(
            models.OrderItem(
                order_id=order.id,
                product_id=product.id,
                sku=product.sku,
                ean13=product.ean13,
                qty=it.qty,
                unit_ht=unit_ht,
                line_ht=line_ht,
                price_ht=unit_ht,
                total_ht=line_ht,
                discount_percent=discount,
            )
        )

        total_ht += line_ht
        total_tva += line_tva

    order.total_ht = total_ht.quantize(Decimal("0.01"))
    order.total_ttc = (total_ht + total_tva).quantize(Decimal("0.01"))

    await ensure_agent_client_link(db, agent_id=agent.id, client_id=payload.client_id)

    await db.commit()
    await db.refresh(order)

    return {
        "id": order.id,
        "doc_no": order.order_number,
        "total_ht": str(order.total_ht),
        "total_ttc": str(order.total_ttc),
        "status": getattr(order.status, "value", str(order.status)),
        "labo_id": order.labo_id,
        "client_id": order.client_id,
        "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
        "payment_method": order.payment_method,
        "comment": order.comment,
    }


# --- Ancien endpoint my-orders (gardé pour compat) ---
@router.get("/my-orders")
async def list_my_orders(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ensure_agent(user)

    agent = (
        await db.execute(sa.select(models.Agent).where(models.Agent.email == user.email))
    ).scalar_one_or_none()
    if agent is None:
        return {"total": 0, "items": [], "offset": offset, "limit": limit, "source": "agent"}

    base = (
        sa.select(models.Order, models.Customer)
        .join(models.Customer, models.Customer.id == models.Order.customer_id)
        .where(models.Order.agent_id == agent.id)
    )

    total = (await db.execute(sa.select(sa.func.count()).select_from(base.subquery()))).scalar_one()

    rows = (
        await db.execute(
            base.order_by(models.Order.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()

    items = []
    for order, cust in rows:
        items.append(
            {
                "id": order.id,
                "created_at": str(order.created_at),
                "status": getattr(order.status, "value", str(order.status)),
                "total_ht": str(order.total_ht),
                "labo_id": order.labo_id,
                "customer": {
                    "company": cust.company,
                    "city": cust.city,
                    "postcode": cust.postcode,
                    "email": cust.email,
                },
            }
        )

    return {"total": total, "items": items, "offset": offset, "limit": limit, "source": "agent"}


@router.get("/orders/{order_id}")
async def get_order_detail(
    order_id: int,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    ensure_agent(user)

    agent = (
        await db.execute(sa.select(models.Agent).where(models.Agent.email == user.email))
    ).scalar_one_or_none()

    if agent is None and _role_name(user.role).upper() != "SUPERUSER":
        raise HTTPException(status_code=403, detail="Agent introuvable")

    row = (
        await db.execute(
            sa.select(models.Order, models.Client, models.Labo)
            .join(models.Client, models.Client.id == models.Order.client_id)
            .join(models.Labo, models.Labo.id == models.Order.labo_id)
            .where(models.Order.id == order_id)
        )
    ).one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Commande introuvable")

    order: models.Order = row[0]
    client: models.Client = row[1]
    labo: models.Labo = row[2]

    if _role_name(user.role).upper() != "SUPERUSER":
        if order.agent_id != agent.id:
            raise HTTPException(status_code=403, detail="Commande non autorisée")

    line_rows = (
        await db.execute(
            sa.select(
                models.OrderItem.sku,
                models.OrderItem.qty,
                models.OrderItem.unit_ht,
                models.OrderItem.discount_percent,
                models.OrderItem.total_ht,
                models.Product.name.label("product_name"),
            )
            .join(models.Product, models.Product.id == models.OrderItem.product_id)
            .where(models.OrderItem.order_id == order.id)
            .order_by(models.OrderItem.id.asc())
        )
    ).all()

    items = []
    for sku, qty, unit_ht, discount_percent, total_ht, product_name in line_rows:
        dp = float(discount_percent or 0)
        items.append(
            {
                "sku": sku,
                "name": product_name or "",
                "qty": qty,
                "unit_ht": str(unit_ht or 0),
                "discount_percent": dp,
                "total_line": str(total_ht or 0),
            }
        )

    return {
        "id": order.id,
        "doc_no": order.order_number or str(order.id),
        "date": (order.order_date or order.created_at).isoformat(),
        "client_name": client.company_name or "",
        "labo_name": labo.name or "",
        "status": getattr(order.status, "value", str(order.status)),
        "total_ht": str(order.total_ht or 0),
        "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
        "payment_method": order.payment_method,
        "comment": order.comment,
        "items": items,
    }
