# app/routers/superuser_global_fonts.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import GlobalFont
from app.core.security import require_role
from app.db.models import UserRole  # adapte si besoin

from app.services.global_fonts_service import import_global_fonts

router = APIRouter(tags=["superuser-fonts"])


# =====================================================
# Schemas
# =====================================================

class ImportResult(BaseModel):
    created: int
    updated: int
    disabled_missing: int
    count_scanned: int


class GlobalFontPatch(BaseModel):
    display_name: Optional[str] = None
    enabled: Optional[bool] = None


# =====================================================
# Routes
# =====================================================

@router.post(
    "/superuser/fonts/global/import",
    response_model=ImportResult,
)
async def superuser_import_global_fonts(
    session: AsyncSession = Depends(get_async_session),
    _ctx=Depends(require_role(UserRole.SUPERUSER)),
):
    """
    Scan /app/app/assets/fonts_global/
    Upsert DB
    Disable missing fonts
    """
    return await import_global_fonts(session, dry_run=False)


@router.patch(
    "/superuser/fonts/global/{font_id}",
)
async def superuser_patch_global_font(
    font_id: int,
    payload: GlobalFontPatch,
    session: AsyncSession = Depends(get_async_session),
    _ctx=Depends(require_role(UserRole.SUPERUSER)),
):
    """
    Enable / disable / rename a global font
    """
    gf = (
        await session.execute(
            select(GlobalFont).where(GlobalFont.id == font_id)
        )
    ).scalar_one_or_none()

    if not gf:
        raise HTTPException(status_code=404, detail="Police globale introuvable")

    if payload.display_name is not None:
        gf.display_name = payload.display_name

    if payload.enabled is not None:
        gf.enabled = payload.enabled

    await session.commit()
    return {"ok": True}
