from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_session
from app.db.models import User, Product, Labo
from app.core.security import get_current_subject
from app.schemas import ProductOut, VariantOut

router = APIRouter(prefix="/labo", tags=["labo"])

async def _current_labo_id(db: AsyncSession, email: str) -> int:
    res = await db.execute(select(User).where(User.email==email, User.is_active==True))
    u = res.scalar_one_or_none()
    if not u or not u.labo_id:
        raise HTTPException(403, "Compte labo inactif")
    return u.labo_id

@router.get("/dashboard")
async def dashboard(db: AsyncSession = Depends(get_session), subject: str = Depends(get_current_subject)):
    labo_id = await _current_labo_id(db, subject)
    nb_products = (await db.execute(select(Product).where(Product.labo_id==labo_id))).scalars().unique().all()
    return {"labo_id": labo_id, "stats": {"products": len(nb_products)}}


