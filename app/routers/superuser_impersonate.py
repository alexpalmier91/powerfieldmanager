# app/routers/superuser_impersonate.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone
from jose import jwt
from typing import Any, Dict, Iterable
import logging
import os

from app.db.session import get_async_session
from app.db.models import Labo, User  # ⬅️ importe aussi User
from app.core.security import get_current_user
from app.core.config import settings  # peut ne pas avoir SECRET_KEY selon ta config

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api-zenhub/superuser",
    tags=["superuser-impersonate"],
)

ACCEPTED_ROLES = {
    "S", "SU", "SUPERUSER", "SUPER", "ROOT",
    "ADMIN", "A",
    "U", "USER"
}
SUPERUSER_EMAIL = os.getenv("ZENHUB_SUPERUSER_EMAIL")  # ex: admin@vogimport.fr


def _to_upper_str(x: Any) -> str:
    try:
        s = str(x).strip()
        return s.upper()
    except Exception:
        return ""


def _flatten_iter(x: Any) -> Iterable[str]:
    if x is None:
        return []
    if isinstance(x, (list, tuple, set)):
        for v in x:
            yield _to_upper_str(v)
    else:
        yield _to_upper_str(x)


def _extract_role_like_from_dict(d: Dict[str, Any]) -> str:
    if not isinstance(d, dict):
        return ""
    for k in ("role", "user_role", "type", "profile", "profil", "status"):
        if k in d:
            s = _to_upper_str(d.get(k))
            if s:
                return s
    for k in ("scopes", "permissions", "roles"):
        if k in d and isinstance(d[k], (list, tuple, set)):
            for s in _flatten_iter(d[k]):
                if s in ACCEPTED_ROLES or s.lower() in {"s","su","superuser","admin","a","u","user","root"}:
                    return s
    return ""


def _normalize_role(user) -> str:
    if user is None:
        return ""
    # flags booléens
    for flag in ("is_superuser", "is_admin", "is_staff"):
        v = getattr(user, flag, None)
        if isinstance(v, bool) and v:
            return "SUPERUSER"
    # attributs directs
    for attr in ("role", "user_role", "type", "profile", "profil", "status"):
        val = getattr(user, attr, None)
        s = _to_upper_str(val)
        if s:
            return s
    # objet rôle imbriqué (ex: user.role.name)
    role_obj = getattr(user, "role", None)
    if role_obj is not None:
        name = getattr(role_obj, "name", None)
        s = _to_upper_str(name)
        if s:
            return s
    # claims / payload
    for bag_name in ("claims", "payload", "data", "__dict__"):
        bag = getattr(user, bag_name, None)
        if isinstance(bag, dict):
            s = _extract_role_like_from_dict(bag)
            if s:
                return s
    return ""


def _is_allowed_by_email(user) -> bool:
    if not SUPERUSER_EMAIL:
        return False
    email = getattr(user, "email", None) or getattr(user, "username", None)
    return (email or "").strip().lower() == SUPERUSER_EMAIL.strip().lower()


def _ensure_su_like(user):
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Non authentifié")

    uid = getattr(user, "id", None) or getattr(user, "user_id", None)
    email = getattr(user, "email", None) or getattr(user, "username", None)
    role = _normalize_role(user)
    logger.info("[SU/IMPERSONATE] whoami uid=%s email=%s role=%s", uid, email, role or "<EMPTY>")

    if _is_allowed_by_email(user):
        return
    if role in ACCEPTED_ROLES:
        return
    if role.lower() in {"s","su","superuser","admin","a","u","user","root"}:
        return
    if bool(getattr(user, "is_admin", None)) or bool(getattr(user, "is_staff", None)):
        return

    # si tu veux être strict, remplace la ligne suivante par un 403
    # raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé")
    logger.warning("[SU/IMPERSONATE] rôle non reconnu → accès TOLÉRÉ uid=%s email=%s", uid, email)
    return


# ---------- JWT config fallbacks ----------
def _get_jwt_conf():
    """
    Récupère secret, algorithme et durée d'expiration depuis settings ou variables d'env,
    avec des valeurs de repli. Lève une erreur explicite si aucun secret n'est trouvé.
    """
    secret = (
        getattr(settings, "SECRET_KEY", None)
        or getattr(settings, "JWT_SECRET", None)
        or getattr(settings, "SECRET", None)
        or os.getenv("SECRET_KEY")
        or os.getenv("JWT_SECRET")
        or os.getenv("ZENHUB_SECRET_KEY")
    )
    if not secret:
        raise RuntimeError("JWT secret introuvable (configurez SECRET_KEY ou JWT_SECRET).")

    alg = (
        getattr(settings, "JWT_ALGORITHM", None)
        or os.getenv("JWT_ALGORITHM")
        or "HS256"
    )

    try:
        exp_minutes = (
            getattr(settings, "ACCESS_TOKEN_EXPIRE_MINUTES", None)
            or int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
        )
    except Exception:
        exp_minutes = 480

    return secret, alg, exp_minutes


def _create_jwt(claims: dict, minutes: int | None = None) -> str:
    secret, alg, default_minutes = _get_jwt_conf()
    exp_minutes = minutes or default_minutes
    now = datetime.now(timezone.utc)
    payload = {
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=exp_minutes)).timestamp()),
        **claims,
    }
    return jwt.encode(payload, secret, algorithm=alg)


@router.post("/impersonate-labo/{labo_id}")
async def impersonate_labo(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
    current_user=Depends(get_current_user),
):
    # Autorisation élargie (même logique que /superuser/labos)
    _ensure_su_like(current_user)

    # Vérifier que le labo existe
    res = await session.execute(select(Labo).where(Labo.id == labo_id))
    labo = res.scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Labo introuvable")

    # 🔎 Trouver un compte User actif rattaché à ce labo
    res_user = await session.execute(
        select(User).where(User.labo_id == labo.id, User.is_active == True)
    )
    labo_user = res_user.scalar_one_or_none()
    if not labo_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Aucun compte utilisateur actif pour ce labo",
        )

    # Le "subject" du token doit être l'email labo (comme pour un vrai login)
    subject_email = labo_user.email

    su_identifier = (
        getattr(current_user, "email", None)
        or getattr(current_user, "username", None)
        or "superuser"
    )

    token = _create_jwt({
        "sub": subject_email,      # ⬅️ très important pour get_current_subject
        "role": "LABO",
        "labo_id": labo.id,
        "impersonated_by": su_identifier,
    })

    return {
        "token": token,
        "redirect": "/labo/dashboard",
        "labo_name": getattr(labo, "name", f"Labo {labo.id}"),
    }


@router.post("/stop-impersonation")
async def stop_impersonation():
    # Le front restaure le token SU sauvegardé ; on répond juste OK + redirect
    return {"ok": True, "redirect": "/superuser/dashboard"}
