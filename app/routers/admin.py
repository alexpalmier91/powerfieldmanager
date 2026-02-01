from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, update
from app.db.session import get_session
from app.db.models import LaboApplication, Labo, User, UserRole
from app.core.security import get_current_subject
from app.core.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

def _assert_super(sub: str):
    if sub not in settings.SUPERADMINS:
        raise HTTPException(403, "Forbidden")

@router.get("/applications")
async def list_applications(db: AsyncSession = Depends(get_session), subject: str = Depends(get_current_subject)):
    _assert_super(subject)
    res = await db.execute(select(LaboApplication).order_by(LaboApplication.id.desc()))
    rows = res.scalars().all()
    return [
        {
            "id": a.id, "email": a.email, "firstname": a.firstname, "lastname": a.lastname,
            "labo_name": a.labo_name, "address": a.address, "phone": a.phone, "approved": a.approved
        }
        for a in rows
    ]

@router.post("/applications/{app_id}/approve")
async def approve_application(app_id: int, db: AsyncSession = Depends(get_session), subject: str = Depends(get_current_subject)):
    _assert_super(subject)
    a = await db.get(LaboApplication, app_id)
    if not a:
        raise HTTPException(404, "Not found")
    if a.approved:
        return {"detail": "Déjà approuvée"}

    # créer Labo
    labo_id = (await db.execute(insert(Labo).values(name=a.labo_name).returning(Labo.id))).scalar_one()

    # activer/ créer User
    res = await db.execute(select(User).where(User.email == a.email))
    u = res.scalar_one_or_none()
    if u:
        await db.execute(update(User).where(User.id==u.id).values(is_active=True, role=UserRole.LABO, labo_id=labo_id))
    else:
        await db.execute(insert(User).values(email=a.email, role=UserRole.LABO, is_active=True, labo_id=labo_id))

    # marquer application approuvée
    await db.execute(update(LaboApplication).where(LaboApplication.id==app_id).values(approved=True))
    await db.commit()
    return {"detail": "Labo et compte activés"}
