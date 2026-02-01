# app/core/roles.py
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.security import get_current_subject
from app.db.session import get_session
from app.db.models import User, UserRole


async def get_current_user(
    sub: str = Depends(get_current_subject),
    db: AsyncSession = Depends(get_session),
) -> User:
    """
    Récupère l'utilisateur courant à partir du JWT.
    Lève 401 si non trouvé.
    """
    result = await db.execute(select(User).where(User.email == sub))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur non trouvé")
    return user


async def require_superadmin(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Vérifie que l'utilisateur est SUPERADMIN.
    """
    if current_user.role != UserRole.SUPERADMIN or not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès SuperAdmin requis")
    return current_user


async def require_labo(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Vérifie que l'utilisateur est un labo actif.
    """
    if current_user.role != UserRole.LABO or not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès Laboratoire requis")
    return current_user
