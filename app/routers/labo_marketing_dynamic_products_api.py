# app/routers/labo_marketing_dynamic_products_api.py
from __future__ import annotations

from typing import Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.db.session import get_async_session
from app.db.models import Product, PriceTier
from app.core.security import require_role

router = APIRouter(
    prefix="/api-zenhub/marketing/products",
    tags=["labo-marketing-dynamic-products"],
)

# ---------------------------------------------------------
# Helpers auth/context (aligné avec labo_marketing_fonts_api.py)
# ---------------------------------------------------------
def _get_labo_id(user) -> int:
    labo_id = getattr(user, "labo_id", None)
    if labo_id is None and isinstance(user, dict):
        labo_id = user.get("labo_id")

    if not labo_id:
        raise HTTPException(status_code=403, detail="Compte labo inactif ou non rattaché")

    try:
        return int(labo_id)
    except Exception:
        raise HTTPException(status_code=403, detail="Contexte labo invalide")


# ---------------------------------------------------------
# Helpers output
# ---------------------------------------------------------
def _to_product_item(p: Product) -> Dict[str, Any]:
    ean13 = (p.ean13 or "").strip() if p.ean13 is not None else ""
    return {
        "id": p.id,
        "sku": p.sku,
        "name": p.name,
        "ean13": ean13,
        "ean": ean13,
        "price_ht": float(p.price_ht or 0),
        "stock": int(p.stock or 0),
        "is_active": bool(p.is_active),

        # ✅ images (les 3)
        "thumb_url": getattr(p, "thumb_url", None),
        "hd_jpg_url": getattr(p, "hd_jpg_url", None),
        "hd_webp_url": getattr(p, "hd_webp_url", None),

        # (legacy)
        "image_url": getattr(p, "image_url", None),
    }






def _to_tier_item(t: PriceTier) -> Dict[str, Any]:
    return {
        "id": t.id,
        "qty_min": int(getattr(t, "qty_min", 0) or 0),
        "price_ht": float(getattr(t, "price_ht", 0) or 0),
    }


# ---------------------------------------------------------
# 1) SEARCH products for autocomplete
# ---------------------------------------------------------
@router.get("/search")
async def search_products(
    q: str = Query("", max_length=80),
    limit: int = Query(12, ge=1, le=30),
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)
    query = (q or "").strip()

    stmt = select(Product).where(Product.labo_id == labo_id)

    if query:
        like = f"%{query}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(like),
                Product.sku.ilike(like),
                Product.ean13.ilike(like),
            )
        )

    stmt = stmt.order_by(Product.name.asc()).limit(limit)
    res = await session.execute(stmt)
    items = res.scalars().all()

    return {"items": [_to_product_item(p) for p in items]}


# ---------------------------------------------------------
# 2) TIERS (PriceTier table: qty_min + price_ht)
# ---------------------------------------------------------
@router.get("/{product_id}/tiers")
async def get_product_tiers(
    product_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    p = await session.get(Product, product_id)
    if not p or p.labo_id != labo_id:
        raise HTTPException(status_code=404, detail="Produit introuvable")

    stmt = (
        select(PriceTier)
        .where(PriceTier.product_id == product_id)
        .order_by(PriceTier.qty_min.asc())
    )
    res = await session.execute(stmt)
    tiers = res.scalars().all()

    return {"product_id": product_id, "tiers": [_to_tier_item(t) for t in tiers]}


# ---------------------------------------------------------
# 3) BULK-INFO (✅ utilisé par overlay_render.js)
# ---------------------------------------------------------
@router.post("/bulk-info")
async def bulk_info(
    payload: Dict[str, Any],
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    """
    Attendu côté front:
      POST /api-zenhub/marketing/products/bulk-info
      body: { product_ids: [..], role: "LABO"|"AGENT" }

    Réponse:
      {
        products: [ {id, sku, name, ean13, price_ht, stock, is_active, image_url}, ... ],
        tiers: { "<product_id>": [ {id, qty_min, price_ht}, ... ], ... }
      }
    """
    labo_id = _get_labo_id(user)

    raw_ids = payload.get("product_ids") or []
    if not isinstance(raw_ids, list):
        raise HTTPException(status_code=400, detail="product_ids doit être une liste")

    # sanitize
    ids: List[int] = []
    for x in raw_ids:
        try:
            xi = int(x)
        except Exception:
            continue
        if xi > 0:
            ids.append(xi)
    ids = list(dict.fromkeys(ids))  # unique preserving order

    if not ids:
        return {"products": [], "tiers": {}}

    # --- fetch products
    stmt = (
        select(Product)
        .where(Product.labo_id == labo_id)
        .where(Product.id.in_(ids))
    )
    res = await session.execute(stmt)
    products = res.scalars().all()

    # On ne renvoie que ce qui appartient au labo (sécurité)
    product_out = [_to_product_item(p) for p in products]

    # --- fetch tiers for those products
    found_ids = [p.id for p in products]
    tiers_map: Dict[str, Any] = {}

    if found_ids:
        tstmt = (
            select(PriceTier)
            .where(PriceTier.product_id.in_(found_ids))
            .order_by(PriceTier.product_id.asc(), PriceTier.qty_min.asc())
        )
        tres = await session.execute(tstmt)
        tiers = tres.scalars().all()

        for t in tiers:
            pid = int(t.product_id)
            k = str(pid)
            if k not in tiers_map:
                tiers_map[k] = []
            tiers_map[k].append(_to_tier_item(t))

        # ✅ important: si un produit n'a pas de tiers, on renvoie une liste vide
        for pid in found_ids:
            k = str(pid)
            if k not in tiers_map:
                tiers_map[k] = []

    return {"products": product_out, "tiers": tiers_map}
