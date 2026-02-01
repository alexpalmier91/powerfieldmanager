# app/core/security.py
import time, hmac, hashlib, base64, json
from typing import Optional, Dict, Any, Iterable
from fastapi import HTTPException, Header, status, Depends
from app.core.config import settings

from datetime import datetime, timedelta, timezone

# (optionnel) pour d'autres usages, mais non requis ici
# from jose import jwt


# =========================
# Helpers internes JWT
# =========================
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64pad(s: str) -> str:
    return s + "=" * (-len(s) % 4)

def _sign(header: dict, payload: dict, secret: str) -> str:
    header_b64  = _b64url(json.dumps(header, separators=(",", ":"), default=str).encode())
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":"), default=str).encode())
    token = f"{header_b64}.{payload_b64}"
    sig = hmac.new(secret.encode(), token.encode(), hashlib.sha256).digest()
    return token + "." + _b64url(sig)

# =========================
# Création & vérification JWT
# =========================
def create_jwt(sub: str, exp_sec: int = 3600, extra_claims: Optional[Dict[str, Any]] = None) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": sub, "exp": int(time.time()) + exp_sec}
    if extra_claims:
        for k, v in extra_claims.items():
            if k in ("sub", "exp"):
                continue
            payload[k] = v
    return _sign(header, payload, settings.JWT_SECRET)

def verify_jwt(token: str) -> dict:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        token_unsigned = f"{header_b64}.{payload_b64}"

        expected_sig = _b64url(hmac.new(
            settings.JWT_SECRET.encode(),
            token_unsigned.encode(),
            hashlib.sha256
        ).digest())

        if not hmac.compare_digest(expected_sig, sig_b64):
            raise ValueError("bad signature")

        payload = json.loads(base64.urlsafe_b64decode(_b64pad(payload_b64)).decode())
        if payload.get("exp", 0) < int(time.time()):
            raise ValueError("expired")

        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# =========================
# Création d’un access token (helper public)
# =========================
# Durée par défaut (ex. 14 jours) si non précisée dans settings
DEFAULT_ACCESS_TOKEN_MIN = getattr(settings, "ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24 * 14)

def create_access_token(
    data: Dict[str, Any],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Helper générique pour créer un JWT compatible avec verify_jwt().
    - 'data' peut contenir 'sub' ou à défaut 'email' (utilisé comme sub).
    - On ajoute automatiquement 'exp'.
    - Les autres claims de 'data' sont conservés (sauf sub/exp).
    """
    # Récupérer le sujet
    sub = data.get("sub") or data.get("email")
    if not sub:
        raise ValueError("create_access_token: 'sub' ou 'email' est requis dans data")

    # Durée d'expiration
    if expires_delta is not None:
        exp_sec = int(expires_delta.total_seconds())
    else:
        exp_sec = int(DEFAULT_ACCESS_TOKEN_MIN) * 60

    # Claims additionnels (sans sub/exp)
    extra = data.copy()
    extra.pop("sub", None)
    extra.pop("exp", None)

    return create_jwt(sub=sub, exp_sec=exp_sec, extra_claims=extra)


# =========================
# Dépendances FastAPI (auth)
# =========================
def get_current_payload(authorization: str = Header(default="")) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:]
    return verify_jwt(token)

def get_current_subject(payload: dict = Depends(get_current_payload)) -> str:
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token payload (no sub)")
    return sub

# Alias pratique : “get_current_user” = payload JWT (dict)
get_current_user = get_current_payload


# =========================
# Vérification des rôles
# =========================
def _extract_role_from_payload(payload: Dict[str, Any]) -> str:
    if not payload:
        return ""
    role = payload.get("role") or payload.get("Role") or payload.get("roles")
    if isinstance(role, (list, tuple)) and role:
        role = role[0]
    return str(role).upper().strip() if role else ""

ROLE_ALIASES = {
    "SUPERADMIN": "U",
    "SUPERUSER":  "S",
    "ADMIN":      "U",
    "LABO":       "L",
    "AGENT":      "R",
    "CLIENT":     "P",
}

def _map_role(r: str) -> str:
    return ROLE_ALIASES.get(str(r).upper(), str(r).upper())

def require_role(roles):
    """Vérifie que l'utilisateur courant possède un rôle parmi ceux listés (codes ou alias)."""
    needed = set(roles if isinstance(roles, (list, tuple, set)) else [roles])
    needed = {_map_role(x) for x in needed}

    def dep(payload: dict = Depends(get_current_user)):  # payload dict
        user_role_raw = _extract_role_from_payload(payload)
        user_role = _map_role(user_role_raw)
        if user_role not in needed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient role. Required one of: {', '.join(sorted(needed))}",
            )
        return payload  # on retourne le payload si besoin
    return dep

# Alias éventuel
require_roles = require_role
