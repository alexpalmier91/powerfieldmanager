from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_session
from app.db.models import Product

router = APIRouter(prefix="/products", tags=["products"])

def _to_out(p: Product) -> dict:
    return {
        "id": p.id,
        "sku": p.sku,
        "name": p.name,
        "image_url": p.image_url,
        "ean13": p.ean13,
        "price_ht": float(p.price_ht) if p.price_ht is not None else None,
        "stock": p.stock,
    }

@router.get("/", response_model=list[dict])
async def list_products(
    q: str | None = Query(None, description="filtre SKU/nom"),
    labo_id: int | None = Query(None),
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_session),
):
    stmt = select(Product).order_by(Product.id.desc()).offset(offset).limit(limit)
    if labo_id:
        stmt = stmt.where(Product.labo_id == labo_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where((Product.sku.ilike(like)) | (Product.name.ilike(like)))
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(p) for p in rows]
