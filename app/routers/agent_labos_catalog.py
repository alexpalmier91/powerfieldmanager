# app/routers/agent_labos_catalog.py
from __future__ import annotations
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, literal

import csv
import io

from app.db.session import get_async_session
from app.db.models import Product, PriceTier, labo_agent
from app.core.security import get_current_user, require_role


print(">>> [AGENT_CATALOG_V2] Router loaded with commission + tiers")

router = APIRouter(
    prefix="/api-zenhub/agent",
    tags=["agent"],
    dependencies=[Depends(require_role(["AGENT", "SUPERUSER"]))],
)

# ------------------------------------------------------------
# Utils
# ------------------------------------------------------------

STOCK_COL = Product.__table__.c.stock

ALLOWED_SORT = {
    "name": Product.name,
    "sku": Product.sku,
    "price_ht": Product.price_ht,
    "stock_qty": STOCK_COL,
}


def _get_user_role(user: Any) -> Optional[str]:
    if user is None:
        return None
    if isinstance(user, dict):
        return user.get("role")
    return getattr(user, "role", None)


def _get_user_agent_id(user: Any) -> Optional[int]:
    if user is None:
        return None
    if isinstance(user, dict):
        return user.get("agent_id")
    return getattr(user, "agent_id", None)


async def get_agent_labo_ids(session: AsyncSession, agent_id: int) -> List[int]:
    res = await session.execute(
        select(labo_agent.c.labo_id).where(labo_agent.c.agent_id == agent_id)
    )
    return [r[0] for r in res.all()]


async def ensure_labo_access(session: AsyncSession, user: Any, labo_id: int):
    """
    Vérifie qu’un agent a bien accès à un labo donné.
    Supporte user sous forme d'objet OU de dict.
    """
    role = _get_user_role(user)
    agent_id = _get_user_agent_id(user)

    print(
        f">>> [AGENT_CATALOG_V2] ensure_labo_access role={role}, "
        f"agent_id={agent_id}, labo_id={labo_id}"
    )

    if role == "SUPERUSER":
        return

    if role == "AGENT":
        if agent_id is None:
            raise HTTPException(status_code=403, detail="Agent non identifié.")
        ids = await get_agent_labo_ids(session, agent_id)
        if labo_id not in ids:
            raise HTTPException(status_code=403, detail="Labo non autorisé.")
        return

    raise HTTPException(status_code=403, detail="Forbidden")


# ------------------------------------------------------------
# Debug
# ------------------------------------------------------------
@router.get("/__debug_commission")
def debug():
    return {"ok": True, "file": "commission+tiers version"}


# ------------------------------------------------------------
#  Catalogue d’un labo (commission + tiers)
# ------------------------------------------------------------
@router.get("/labos/{labo_id}/products")
async def list_labo_products(
    labo_id: int,
    search: Optional[str] = Query(None),
    sku: Optional[str] = Query(None),
    ean: Optional[str] = Query(None),
    in_stock: Optional[bool] = Query(None),
    min_price: Optional[float] = Query(None),
    max_price: Optional[float] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    sort: str = Query("name"),
    dir: str = Query("asc", regex="^(asc|desc)$"),
    export: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    user: Any = Depends(get_current_user),
):
    print(
        f">>> [AGENT_CATALOG_V2] list_labo_products called – "
        f"labo_id={labo_id}, page={page}, search={search}"
    )

    await ensure_labo_access(session, user, labo_id)

    filters = [Product.labo_id == labo_id]

    if search:
        like = f"%{search}%"
        filters.append(
            or_(
                Product.name.ilike(like),
                Product.description.ilike(like),
                Product.sku.ilike(like),
                Product.ean13.ilike(like),
            )
        )
    if sku:
        filters.append(Product.sku.ilike(f"%{sku}%"))
    if ean:
        filters.append(Product.ean13.ilike(f"%{ean}%"))
    if in_stock:
        filters.append(STOCK_COL > 0)
    if min_price is not None:
        filters.append(Product.price_ht >= min_price)
    if max_price is not None:
        filters.append(Product.price_ht <= max_price)

    sort_col = ALLOWED_SORT.get(sort, Product.name)
    order = sort_col.asc() if dir == "asc" else sort_col.desc()

    # ---- colonne "active" robuste + filtre "actif uniquement" ----
    active_col = getattr(Product, "is_active", None)
    if active_col is None:
        active_col = getattr(Product, "active", None)

    if active_col is not None:
        # ✅ Ne pas afficher les produits désactivés
        filters.append(active_col.is_(True))
    else:
        # Si aucune colonne, on considère tout actif
        active_col = literal(True)

    base_q = (
        select(
            Product.id,
            Product.sku,
            Product.ean13,
            Product.name,
            Product.price_ht,
            STOCK_COL.label("stock_qty"),
            Product.labo_id,
            Product.image_url,
            # On peut garder ce champ pour debug/compat, mais l'UI ne l'affiche plus
            active_col.label("active"),
            Product.commission,
        )
        .where(and_(*filters))
    )

    # --- Total pour pagination ---
    total = (
        await session.execute(
            select(func.count()).select_from(Product).where(and_(*filters))
        )
    ).scalar_one()

    # --- Page courante ---
    offset = (page - 1) * page_size
    rows = (
        await session.execute(
            base_q.order_by(order).offset(offset).limit(page_size)
        )
    ).all()

    # --- Tiers price pour tous les produits de la page ---
    product_ids = [r.id for r in rows]
    tiers_by_product: dict[int, list[dict]] = {}

    if product_ids:
        tiers_q = (
            select(
                PriceTier.product_id,
                PriceTier.qty_min,
                PriceTier.price_ht,
            )
            .where(PriceTier.product_id.in_(product_ids))
            .order_by(PriceTier.product_id, PriceTier.qty_min)
        )
        tiers_res = await session.execute(tiers_q)
        for t in tiers_res.all():
            tiers_by_product.setdefault(t.product_id, []).append(
                {
                    "min_qty": t.qty_min,
                    "price_ht": float(t.price_ht or 0),
                }
            )

    # --- Construction JSON ---
    items = []
    for r in rows:
        commission_val = float(r.commission or 0.0)
        img_url = r.image_url or f"/media/labo_products/{r.labo_id}/{r.sku}.jpg"

        items.append(
            {
                "id": r.id,
                "sku": r.sku,
                "ean13": r.ean13,
                "name": r.name,
                "price_ht": float(r.price_ht or 0.0),
                "stock": int(r.stock_qty or 0),
                "stock_qty": int(r.stock_qty or 0),
                "labo_id": r.labo_id,
                # Toujours True ici car on filtre déjà sur actif
                "active": True,
                "image_url": img_url,
                "commission": commission_val,
                "tiers": tiers_by_product.get(r.id, []),
            }
        )

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }
