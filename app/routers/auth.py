# app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert
from datetime import datetime, timezone
import logging
import os
from pydantic import BaseModel

from app.db.session import get_session
from app.db.models import LaboApplication, User, AuthCode, Agent
from app.schemas import LaboSignupIn, EmailIn, CodeLoginIn, MsgOut, TokenOut
from app.core.security import create_jwt, get_current_payload, create_access_token
from app.tasks.celery_app import celery
from app.tasks.jobs import send_login_code  # <<< import direct de la task


router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("auth")

# ✅ Liste des superusers (emails séparés par virgules dans .env ou docker-compose)
_SUPERUSERS = {e.strip().lower() for e in os.getenv("SUPERUSERS", "").split(",") if e.strip()}


# ===============================
# 🔐 Modèle utilisateur courant
# ===============================
class CurrentUser(BaseModel):
    id: int | None = None
    email: str | None = None
    role: str | None = None
    labo_id: int | None = None


# ===============================
# 🔐 Récupération utilisateur depuis JWT
# ===============================
async def get_current_user(
    payload: dict = Depends(get_current_payload),
    db: AsyncSession = Depends(get_session),
) -> CurrentUser:
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token manquant")

    email = (payload.get("email") or payload.get("sub") or "").strip().lower()
    role = payload.get("role")
    labo_id = payload.get("labo_id")

    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Payload invalide")

    db_user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not db_user:
        return CurrentUser(id=None, email=email, role=role, labo_id=labo_id)

    db_role = getattr(db_user, "role", None)
    if email in _SUPERUSERS:
        db_role = "superuser"
    final_role = role or (db_role.value if hasattr(db_role, "value") else db_role)
    final_labo_id = labo_id if labo_id is not None else getattr(db_user, "labo_id", None)

    return CurrentUser(
        id=getattr(db_user, "id", None),
        email=email,
        role=final_role,
        labo_id=final_labo_id,
    )


# ===============================
# 🔒 Helpers d’autorisation
# ===============================
def _norm_role(x: str | None) -> str | None:
    if x is None:
        return None
    return x.lower().strip()


async def require_role(required: str, user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    role = _norm_role(user.role)
    if role == _norm_role(required):
        return user
    if role == "superuser":
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Rôle {required} requis")


async def require_superuser(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    role = _norm_role(user.role)
    # ✅ accepte superuser ET superadmin
    if role in {"superuser", "superadmin"}:
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superuser requis")


# ===============================
# 🧩 Routes AUTH principales
# ===============================
@router.post("/signup-labo", response_model=MsgOut)
async def signup_labo(body: LaboSignupIn, db: AsyncSession = Depends(get_session)):
    await db.execute(insert(LaboApplication).values(
        email=body.email.strip().lower(),
        firstname=body.firstname,
        lastname=body.lastname,
        labo_name=body.labo_name,
        address=body.address,
        phone=body.phone
    ))
    await db.commit()
    return MsgOut(message="Demande enregistrée. En attente de validation admin.")


@router.post("/request-code", response_model=MsgOut)
async def request_code(body: EmailIn, db: AsyncSession = Depends(get_session)):
    """
    Envoie un code de connexion par email si :
    - le compte utilisateur est actif, ou
    - une demande de labo approuvée existe.
    Toujours renvoie 200 pour éviter l’énumération d’adresses.
    """
    email = body.email.strip().lower()
    try:
        user = (await db.execute(
            select(User).where(User.email == email, User.is_active == True)  # noqa: E712
        )).scalar_one_or_none()
        allowed = bool(user)

        if not allowed:
            app_row = (await db.execute(
                select(LaboApplication).where(LaboApplication.email == email)
            )).scalar_one_or_none()
            if app_row and getattr(app_row, "approved", False):
                allowed = True

        if allowed:
            try:
                # ✅ appel fiable : import direct + .delay()
                send_login_code.delay(email)
                logger.info(f"[request-code] Tâche send_login_code enqueued pour {email}")
            except Exception:
                logger.exception("[request-code] Échec enqueue send_login_code pour %s", email)

        return MsgOut(message="Si le compte est autorisé, un code a été envoyé (valable 10 minutes).")

    except Exception:
        logger.exception("Erreur interne dans /auth/request-code pour %s", email)
        return MsgOut(message="Si le compte est autorisé, un code a été envoyé (valable 10 minutes).")


@router.post("/verify-code", response_model=TokenOut)
async def verify_code(payload: CodeLoginIn, db: AsyncSession = Depends(get_session)):
    email = payload.email.strip().lower()
    code = payload.code.strip()

    ac = (await db.execute(
        select(AuthCode)
        .where(AuthCode.email == email, AuthCode.code == code, AuthCode.used == False)
        .order_by(AuthCode.id.desc())
        .limit(1)
    )).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if not ac or not ac.expires_at or ac.expires_at < now:
        raise HTTPException(status_code=400, detail="Code invalide ou expiré")

    ac.used = True
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    app_row = None

    if user is None:
        app_row = (await db.execute(
            select(LaboApplication).where(LaboApplication.email == email)
        )).scalar_one_or_none()
        if not app_row or not getattr(app_row, "approved", False):
            await db.commit()
            raise HTTPException(status_code=403, detail="Compte non autorisé")

        user = User(email=email, is_active=True, labo_id=None)
        user.role = "superuser" if email in _SUPERUSERS else "labo"
        db.add(user)

    else:
        if not user.is_active:
            app_row = (await db.execute(
                select(LaboApplication).where(LaboApplication.email == email)
            )).scalar_one_or_none()
            if not app_row or not getattr(app_row, "approved", False):
                await db.commit()
                raise HTTPException(status_code=403, detail="Compte inactif")
            user.is_active = True

        if not getattr(user, "role", None):
            if email in _SUPERUSERS:
                user.role = "superuser"
            else:
                app_row = app_row or (await db.execute(
                    select(LaboApplication).where(LaboApplication.email == email)
                )).scalar_one_or_none()
                user.role = "labo" if (app_row and getattr(app_row, "approved", False)) else "agent"

        if email in _SUPERUSERS and user.role != "superuser":
            user.role = "superuser"

    await db.commit()

    role_value = getattr(user, "role", None)
    if hasattr(role_value, "value"):
        role_value = role_value.value

    claims = {
        "role": role_value,
        "email": user.email,
        "labo_id": getattr(user, "labo_id", None),
    }

    token = create_jwt(user.email, exp_sec=12 * 3600, extra_claims=claims)
    logger.info(f"Connexion réussie pour {email} ({user.role})")

    return TokenOut(access_token=token, token_type="bearer")


# ===============================
# 🔍 Diagnostic /whoami
# ===============================
@router.get("/whoami")
async def whoami(payload: dict = Depends(get_current_payload)):
    return {
        "sub": payload.get("sub"),
        "role": payload.get("role"),
        "email": payload.get("email"),
        "labo_id": payload.get("labo_id"),
    }


__all__ = [
    "router",
    "get_current_user",
    "require_role",
    "require_superuser",
    "CurrentUser",
]


# ===============================
# 🕵️ Impersonation (SUPERUSER → AGENT)
# ===============================
@router.post("/impersonate")
async def auth_impersonate(
    agent_id: int = Query(..., ge=1),
    session: AsyncSession = Depends(get_session),
    caller: CurrentUser = Depends(require_superuser),   # vérifie SUPERUSER/SUPERADMIN
):
    # 1) charger l’agent cible
    q = await session.execute(select(Agent).where(Agent.id == agent_id))
    agent = q.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent introuvable")

    # 2) fabriquer un JWT d’agent, en conservant l'info du superuser d’origine
    orig_email = caller.email
    token = create_access_token({
        "sub": agent.email,
        "email": agent.email,
        "role": "AGENT",
        "agent_id": agent.id,
        "labo_id": None,           # si tu scope l’agent à 1 labo, remplis-le ici
        "impersonated": True,
        "orig_sub": orig_email,
        "orig_role": (caller.role or "").upper() if caller.role else None,
    })

    return {"access_token": token, "token_type": "bearer"}


@router.post("/stop-impersonation")
async def auth_stop_impersonation(
    _caller: CurrentUser = Depends(get_current_user),
):
    """
    Côté serveur on n’a pas besoin d’état.
    Le front restaure simplement prev_token. On renvoie juste ok.
    (Si tu veux réémettre un token superuser ici, on peut : lis orig_sub et signe un JWT.)
    """
    return {"ok": True}
