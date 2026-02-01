# app/routers/agent.py
from __future__ import annotations
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException, Body, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_async_session
from app.db.models import Agent, Labo, Product, Order, OrderItem, UserRole
from app.core.security import require_role, get_current_user

# =========================
# Router API (JSON)
# =========================
router = APIRouter(
    prefix="/api-zenhub/agent",
    tags=["agent"],
    dependencies=[Depends(require_role(["R"]))],  # R = AGENT
)

# ---- helpers
async def _get_me(session: AsyncSession, payload: dict) -> Agent:
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
        "sku": p.sku,
        "name": p.name,
        "price_ht": float(p.price_ht or 0),
        "stock": int(p.stock or 0),
        "ean13": p.ean13 or "",
        "image_url": p.image_url or "",
        "labo_id": p.labo_id,
    }

# ---- endpoints API

@router.get("/me")
async def agent_me(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
):
    me = await _get_me(session, payload)
    return {
        "id": me.id,
        "email": me.email,
        "firstname": me.firstname,
        "lastname": me.lastname,
        "phone": me.phone,
        "role": "AGENT",
    }

@router.get("/labos")
async def list_labos(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
):
    me = await _get_me(session, payload)
    # relation many-to-many via labo_agent (déclarée sur le modèle)
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
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    # on liste depuis la table référentiel "client"
    from app.db.models import Client
    base = select(Client).order_by(Client.id.desc())
    cnt = select(func.count(Client.id))
    if search:
        like = f"%{search.lower()}%"
        base = base.where(
            func.lower(Client.company_name).like(like) |
            func.lower(Client.email).like(like) |
            func.lower(Client.city).like(like)
        )
        cnt = cnt.where(
            func.lower(Client.company_name).like(like) |
            func.lower(Client.email).like(like) |
            func.lower(Client.city).like(like)
        )

    total = int((await session.execute(cnt)).scalar_one())
    q = await session.execute(base.limit(limit).offset(offset))
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
    return {"total": total, "limit": limit, "offset": offset, "items": items}

@router.get("/catalogue")
async def agent_catalogue(
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
    labo_id: int = Query(..., ge=1),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    me = await _get_me(session, payload)
    # contrôle que l'agent est bien rattaché au labo demandé
    q = await session.execute(
        select(Labo).join(Labo.agents).where(Labo.id == labo_id, Agent.id == me.id)
    )
    labo = q.scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=403, detail="Accès refusé à ce laboratoire")

    base = select(Product).where(Product.labo_id == labo_id).order_by(Product.id.desc())
    cnt = select(func.count(Product.id)).where(Product.labo_id == labo_id)
    if search:
        like = f"%{search.lower()}%"
        base = base.where(func.lower(Product.name).like(like) | func.lower(Product.sku).like(like))
        cnt = cnt.where(func.lower(Product.name).like(like) | func.lower(Product.sku).like(like))

    total = int((await session.execute(cnt)).scalar_one())
    q2 = await session.execute(base.limit(limit).offset(offset))
    items = [_product_out(p) for p in q2.scalars().all()]
    return {"total": total, "limit": limit, "offset": offset, "items": items}

# ---- création de commande (API)
class OrderItemIn(Any):
    ...

@router.post("/orders")
async def create_order(
    payload: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
    labo_id: int = Body(..., embed=True),
    client_id: int = Body(..., embed=True),
    items: List[Dict[str, Any]] = Body(..., embed=True),  # [{product_id, qty}]
):
    me = await _get_me(session, payload)

    # 1) vérifier que l'agent est rattaché au labo
    q = await session.execute(
        select(Labo).join(Labo.agents).where(Labo.id == labo_id, Agent.id == me.id)
    )
    labo = q.scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=403, detail="Accès refusé à ce laboratoire")

    if not items:
        raise HTTPException(status_code=400, detail="Aucun article")

    # 2) charger produits et valider appartenance au labo
    prod_ids = [int(it["product_id"]) for it in items]
    q = await session.execute(select(Product).where(Product.id.in_(prod_ids)))
    prods = {p.id: p for p in q.scalars().all()}
    if len(prods) != len(set(prod_ids)):
        raise HTTPException(status_code=400, detail="Produit introuvable")
    for p in prods.values():
        if p.labo_id != labo_id:
            raise HTTPException(status_code=400, detail=f"Produit {p.id} non lié au labo")

    # 3) construire la commande
    from decimal import Decimal
    total_ht = Decimal("0.00")
    order = Order(
        labo_id = labo_id,
        agent_id = me.id,
        customer_id = client_id,  # si chez toi c'est Client vs Customer, adapte
        status = "pending",
        currency = "EUR",
        total_ht = Decimal("0.00"),
        total_ttc = Decimal("0.00"),
    )
    session.add(order)
    await session.flush()  # obtenir order.id

    for it in items:
        p = prods[int(it["product_id"])]
        qty = int(it.get("qty") or 0)
        if qty <= 0:
            continue
        unit = Decimal(p.price_ht or 0)
        line = unit * qty
        total_ht += line
        session.add(OrderItem(
            order_id = order.id,
            product_id = p.id,
            sku = p.sku,
            ean13 = p.ean13,
            qty = qty,
            unit_ht = unit,
            line_ht = line,
        ))

    order.total_ht = total_ht
    order.total_ttc = total_ht  # si TVA gérée ailleurs; sinon applique un taux

    await session.commit()
    return {"order_id": order.id, "total_ht": float(order.total_ht)}


# =========================
# Router PAGES (HTML)
# =========================
templates = Jinja2Templates(directory="templates")

pages = APIRouter(
    prefix="/agent",
    tags=["agent-pages"],
    dependencies=[Depends(require_role(["R"]))],  # même contrôle que l'API
)

@pages.get("/orders/new", response_class=HTMLResponse)
async def page_new_order(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    payload: dict = Depends(get_current_user),
):
    """
    Page HTML "Créer une commande" -> templates/agent/orders_new.html
    Le JS front se charge via /static/agent/pages/orders/new/index.js
    """
    # Vérifie qu'on a bien un agent existant (évite 404 silencieux)
    _ = await _get_me(session, payload)
    return templates.TemplateResponse("agent/orders_new.html", {"request": request})
