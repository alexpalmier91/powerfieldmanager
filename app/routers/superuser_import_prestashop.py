# app/routers/superuser_import_prestashop.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.core.security import require_role
from app.services.prestashop_product_import import import_prestashop_products

router = APIRouter(
    prefix="/api-zenhub/superuser/imports",
    tags=["superuser-imports"],
)

@router.post("/prestashop/labo/{labo_id}")
async def import_products_from_prestashop(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
    _=Depends(require_role("SUPERUSER")),
):
    try:
        return await import_prestashop_products(
            session=session,
            labo_id=labo_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
