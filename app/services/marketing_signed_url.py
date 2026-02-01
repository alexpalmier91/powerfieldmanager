# app/services/marketing_signed_url.py
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict


from app.core.config import settings


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    # rajoute le padding manquant
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("utf-8"))


def _get_secret() -> bytes:
    """
    Fallback robuste : on cherche une clé existante dans ton Settings.
    """
    for attr in ("SECRET_KEY", "JWT_SECRET", "JWT_SECRET_KEY", "APP_SECRET", "SECRET", "SIGNING_SECRET"):
        val = getattr(settings, attr, None)
        if val:
            return str(val).encode("utf-8")

    # dernier recours (dev)
    return b"dev-secret"


def _sign_payload(payload: Dict[str, Any]) -> str:
    secret = _get_secret()
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    sig = hmac.new(secret, raw, hashlib.sha256).digest()
    return _b64url_encode(sig)


def make_marketing_token(doc_id: int, kind: str, exp_ts: int) -> str:
    """
    Génère un token "payload.signature"
    payload = {"doc_id":..., "kind":"pdf|thumb", "exp":...}
    """
    payload = {"doc_id": int(doc_id), "kind": str(kind), "exp": int(exp_ts)}
    sig = _sign_payload(payload)
    blob = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{blob}.{sig}"


def parse_and_verify_marketing_token(token: str) -> Dict[str, Any]:
    """
    Parse + vérifie la signature + vérifie l'expiration.
    Retourne le payload dict si OK.
    Lève ValueError si invalide / expiré.
    """
    if not token or "." not in token:
        raise ValueError("invalid_token")

    blob, sig = token.split(".", 1)
    try:
        payload_raw = _b64url_decode(blob)
        payload = json.loads(payload_raw.decode("utf-8"))
    except Exception:
        raise ValueError("invalid_payload")

    if not isinstance(payload, dict):
        raise ValueError("invalid_payload")

    # Vérif signature (constant-time)
    expected = _sign_payload(payload)
    if not hmac.compare_digest(expected, sig):
        raise ValueError("invalid_signature")

    # Vérif exp
    exp = payload.get("exp")
    if not isinstance(exp, int):
        raise ValueError("invalid_exp")

    now = int(time.time())
    if exp < now:
        raise ValueError("expired")

    # champs attendus
    if "doc_id" not in payload or "kind" not in payload:
        raise ValueError("invalid_payload")

    return payload


def build_public_url(token: str) -> str:
    """
    URL publique consommée par l'iframe ou l'image <img>.
    Tu dois avoir un router qui expose /public/marketing/{token}
    """
    return f"/public/marketing/{token}"
