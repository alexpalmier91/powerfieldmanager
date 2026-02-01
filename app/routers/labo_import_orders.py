# app/routers/labo_import_orders.py
from __future__ import annotations

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
import sqlalchemy as sa  
from pydantic import BaseModel

from app.db.session import get_async_session
from app.db.models import User, UserRole, Labo
from app.core.security import get_current_subject

from app.services.import_labo_documents import run_labo_import


router = APIRouter(
    prefix="/api-zenhub/labo",
    tags=["labo-import"],
)


# ==========================================================
#   Contexte courant (copie du modèle de labo_orders_api.py)
# ==========================================================

class CurrentContext(BaseModel):
    user_id: int
    role: UserRole
    labo_id: int


async def get_current_context(
    subject: str = Depends(get_current_subject),
    session: AsyncSession = Depends(get_async_session),
) -> CurrentContext:
    """Détermine le labo courant depuis le JWT."""

    # Interpréter subject comme user_id OU email
    try:
        user_id = int(subject)
        stmt = (
            await session.execute(
                sa.select(User).where(User.id == user_id)
            )
        )
    except Exception:
        stmt = (
            await session.execute(
                sa.select(User).where(User.email == subject)
            )
        )

    user = stmt.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur inconnu")

    if user.role not in (UserRole.LABO, UserRole.SUPERUSER):
        raise HTTPException(status_code=403, detail="Accès réservé aux Labos / Superuser")

    # Récupérer le labo_id
    labo_id = None
    if user.role == UserRole.LABO:
        if not user.labo_id:
            raise HTTPException(status_code=403, detail="Aucun labo associé à cet utilisateur")
        labo_id = user.labo_id

    # SUPERUSER → accès à tous les labos, labo_id devra être spécifié dans la requête
    if user.role == UserRole.SUPERUSER and not user.labo_id:
        # on ne bloque pas, le endpoint accepte labo_id dans le body si besoin
        labo_id = None

    return CurrentContext(
        user_id=user.id,
        role=user.role,
        labo_id=labo_id,
    )


# ==========================================================
#   POST /api-zenhub/labo/import/sales
# ==========================================================

@router.post("/import/sales")
async def import_labo_sales(
    file: UploadFile = File(...),
    ctx: CurrentContext = Depends(get_current_context),
    session: AsyncSession = Depends(get_async_session),
    labo_id: int = None,
):
    """
    Import des ventes labo :
    - Factures (FA…)
    - Commandes (CO…)
    - Avoirs (AV… / AW…)

    Le labo connecté n’a pas besoin de passer labo_id.
    Le superuser PEUT passer labo_id dans l’URL ou body.
    """

    # Si LABO → labo_id issu du token
    if ctx.role == UserRole.LABO:
        labo_id = ctx.labo_id

    # Si superuser → labo_id doit être fourni
    if ctx.role == UserRole.SUPERUSER:
        if not labo_id:
            raise HTTPException(
                status_code=400,
                detail="Pour le superuser, labo_id doit être indiqué (ex: ?labo_id=3)"
            )

    # Lecture du fichier
    try:
        raw = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Impossible de lire le fichier fourni")

    # Import principal
    result = await run_labo_import(
        file_bytes=raw,
        filename=file.filename or "",
        labo_id=labo_id,
        session=session,
    )

    return {
        "labo_id": labo_id,
        **result
    }
