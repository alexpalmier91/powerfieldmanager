# app/routers/iot_presentoirs.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, Literal

import hashlib

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Presentoir, PresentoirEvent

router = APIRouter(prefix="/api/iot/presentoirs", tags=["iot-presentoirs"])


# ====================== Schemas Pydantic ======================

class HeartbeatPayload(BaseModel):
    num_products: Optional[int] = None
    last_scan: Optional[datetime] = None
    firmware_version: Optional[str] = None
    tunnel_url: Optional[str] = None
    local_ip: Optional[str] = None


class PresentoirEventIn(BaseModel):
    epc: str
    sku: Optional[str] = None
    event_type: Literal["POSE", "RETIRE"]
    timestamp: datetime  # horodatage côté Pi


class EventsPayload(BaseModel):
    events: List[PresentoirEventIn]


# ====================== Helpers auth ======================

async def _authenticate_presentoir(
    code: str,
    authorization: str | None,
    session: AsyncSession,
) -> Presentoir:
    """
    Vérifie le header Authorization: Bearer <TOKEN_DU_PRESENTOIR>
    + retourne l'objet Presentoir correspondant au code.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
        )

    token = authorization.removeprefix("Bearer").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
        )

    result = await session.execute(
        select(Presentoir).where(Presentoir.code == code)
    )
    presentoir: Optional[Presentoir] = result.scalar_one_or_none()

    if not presentoir:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Presentoir not found",
        )

    if not presentoir.api_token_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Presentoir token not configured",
        )

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if token_hash != presentoir.api_token_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    if not presentoir.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Presentoir inactive",
        )

    return presentoir


# ====================== ENDPOINT HEARTBEAT ======================

@router.post("/{code}/heartbeat")
async def presentoir_heartbeat(
    code: str,
    payload: HeartbeatPayload,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Appelé périodiquement par le Pi pour signaler qu'il est vivant.
    Met à jour : last_seen_at, last_status, firmware_version, tunnel_url, last_ip, current_num_products.
    """
    presentoir = await _authenticate_presentoir(code, authorization, session)

    now = datetime.now(timezone.utc)

    presentoir.last_seen_at = now
    presentoir.last_status = "ONLINE"

    if payload.firmware_version:
        presentoir.firmware_version = payload.firmware_version
    if payload.tunnel_url:
        presentoir.tunnel_url = payload.tunnel_url
    if payload.local_ip:
        presentoir.last_ip = payload.local_ip
    if payload.num_products is not None:
        presentoir.current_num_products = payload.num_products

    # last_scan est pour l'instant juste ignoré / réservé pour plus tard

    await session.commit()

    return {"status": "ok"}


# ====================== ENDPOINT EVENTS ======================

@router.post("/{code}/events")
async def presentoir_events(
    code: str,
    payload: EventsPayload,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Réception des événements POSÉ / RETIRÉ en bulk.
    """
    presentoir = await _authenticate_presentoir(code, authorization, session)

    now = datetime.now(timezone.utc)

    for ev in payload.events:
        evt = PresentoirEvent(
            presentoir_id=presentoir.id,
            epc=ev.epc,
            sku=ev.sku,
            event_type=ev.event_type,
            ts_device=ev.timestamp,
            ts_received=now,
        )
        session.add(evt)

    # On considère que le présentoir est online dès qu'il nous parle
    presentoir.last_seen_at = now
    presentoir.last_status = "ONLINE"

    await session.commit()

    return {"status": "ok", "received": len(payload.events)}
