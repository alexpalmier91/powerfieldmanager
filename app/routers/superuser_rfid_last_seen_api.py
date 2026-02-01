from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import RfidTag, PresentoirEvent
from app.core.security import require_role

router = APIRouter(prefix="/api-zenhub/superuser/rfid", tags=["superuser-rfid"])


@router.get("/last-seen-epc")
async def get_last_seen_epc(
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
    presentoir_id: Optional[int] = Query(None),
):
    """
    Retourne le dernier EPC vu.
    - Si presentoir_id est fourni : basé sur presentoir_events (source “scan présentoir”).
    - Sinon : basé sur rfid_tag.last_seen_at (source globale).
    """
    if presentoir_id is not None:
        stmt = (
            select(PresentoirEvent.epc, PresentoirEvent.ts_received)
            .where(PresentoirEvent.presentoir_id == presentoir_id)
            .order_by(PresentoirEvent.ts_received.desc())
            .limit(1)
        )
        res = await session.execute(stmt)
        row = res.first()
        if not row:
            return {"epc": None, "ts": None, "source": "presentoir_events"}
        return {"epc": row.epc, "ts": row.ts_received, "source": "presentoir_events"}

    stmt = (
        select(RfidTag.epc, RfidTag.last_seen_at)
        .order_by(RfidTag.last_seen_at.desc().nullslast())
        .limit(1)
    )
    res = await session.execute(stmt)
    row = res.first()
    if not row:
        return {"epc": None, "ts": None, "source": "rfid_tag"}
    return {"epc": row.epc, "ts": row.last_seen_at, "source": "rfid_tag"}
