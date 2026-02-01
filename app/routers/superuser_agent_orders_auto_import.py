# app/routers/superuser_agent_orders_auto_import.py
from __future__ import annotations

from datetime import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_async_session
from app.db.models import Labo, UserRole
from app.models.labo_agent_orders_auto_import_config import (
    LaboAgentOrdersAutoImportConfig,
)
from app.services.agent_orders_auto_import_service import run_auto_import_for_labo

router = APIRouter(
    prefix="/api-zenhub/superuser",
    tags=["superuser-agent-orders-auto-import"],
)


def get_current_superuser(current_user: Any = Depends(get_current_user)) -> Any:
    role = getattr(current_user, "role", None)

    if role is None and isinstance(current_user, dict):
        role = current_user.get("role")

    if isinstance(role, str):
        try:
            role_enum = UserRole(role)
        except Exception:
            role_enum = None
    else:
        role_enum = role

    if role_enum not in (UserRole.SUPERUSER, UserRole.SUPERADMIN):
        raise HTTPException(status_code=403, detail="Forbidden")

    return current_user


class AutoImportConfigIn(BaseModel):
    labo_id: int
    enabled: bool = Field(default=False)
    drive_folder_id: str | None = None
    drive_folder_url: str | None = None
    run_at: str | None = Field(
        default=None,
        description="Heure d'exécution quotidienne au format HH:MM (optionnelle)",
    )


class AutoImportConfigOut(BaseModel):
    labo_id: int
    enabled: bool
    drive_folder_id: str | None
    drive_folder_url: str | None
    run_at: str | None
    last_run_at: str | None
    last_status: str | None
    last_error: str | None
    last_summary: dict | None


class RunNowResponse(BaseModel):
    ok: bool
    summary: dict | None = None
    error: str | None = None


async def _get_labo(session: AsyncSession, labo_id: int) -> Labo:
    res = await session.execute(select(Labo).where(Labo.id == labo_id))
    labo = res.scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=404, detail=f"Labo {labo_id} introuvable")
    return labo


@router.get(
    "/agent-orders-auto-import/config",
    response_model=AutoImportConfigOut,
)
async def get_auto_import_config(
    labo_id: int = Query(...),
    session: AsyncSession = Depends(get_async_session),
    current_user: Any = Depends(get_current_superuser),
):
    await _get_labo(session, labo_id)

    res = await session.execute(
        select(LaboAgentOrdersAutoImportConfig).where(
            LaboAgentOrdersAutoImportConfig.labo_id == labo_id
        )
    )
    config = res.scalar_one_or_none()

    if config is None:
        return AutoImportConfigOut(
            labo_id=labo_id,
            enabled=False,
            drive_folder_id=None,
            drive_folder_url=None,
            run_at=None,
            last_run_at=None,
            last_status=None,
            last_error=None,
            last_summary=None,
        )

    return AutoImportConfigOut(
        labo_id=config.labo_id,
        enabled=config.enabled,
        drive_folder_id=config.drive_folder_id,
        drive_folder_url=config.drive_folder_url,
        run_at=config.run_at.strftime("%H:%M") if config.run_at else None,
        last_run_at=config.last_run_at.isoformat() if config.last_run_at else None,
        last_status=config.last_status,
        last_error=config.last_error,
        last_summary=config.last_summary,
    )


@router.post(
    "/agent-orders-auto-import/config",
    response_model=AutoImportConfigOut,
)
async def save_auto_import_config(
    payload: AutoImportConfigIn,
    session: AsyncSession = Depends(get_async_session),
    current_user: Any = Depends(get_current_superuser),
):
    await _get_labo(session, payload.labo_id)

    res = await session.execute(
        select(LaboAgentOrdersAutoImportConfig).where(
            LaboAgentOrdersAutoImportConfig.labo_id == payload.labo_id
        )
    )
    config = res.scalar_one_or_none()

    parsed_run_at: time | None = None
    if payload.run_at:
        try:
            hour, minute = payload.run_at.split(":")
            parsed_run_at = time(hour=int(hour), minute=int(minute))
        except Exception:
            raise HTTPException(status_code=400, detail="Format de run_at invalide (attendu HH:MM)")

    if config is None:
        config = LaboAgentOrdersAutoImportConfig(labo_id=payload.labo_id)
        session.add(config)

    config.enabled = payload.enabled
    config.drive_folder_id = payload.drive_folder_id
    config.drive_folder_url = payload.drive_folder_url
    config.run_at = parsed_run_at

    await session.commit()
    await session.refresh(config)

    return AutoImportConfigOut(
        labo_id=config.labo_id,
        enabled=config.enabled,
        drive_folder_id=config.drive_folder_id,
        drive_folder_url=config.drive_folder_url,
        run_at=config.run_at.strftime("%H:%M") if config.run_at else None,
        last_run_at=config.last_run_at.isoformat() if config.last_run_at else None,
        last_status=config.last_status,
        last_error=config.last_error,
        last_summary=config.last_summary,
    )


@router.post(
    "/labos/{labo_id}/agent-orders-auto-import/run-now",
    response_model=RunNowResponse,
)
async def run_now_auto_import_for_labo(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
    current_user: Any = Depends(get_current_superuser),
):
    await _get_labo(session, labo_id)

    res = await session.execute(
        select(LaboAgentOrdersAutoImportConfig).where(
            LaboAgentOrdersAutoImportConfig.labo_id == labo_id
        )
    )
    config = res.scalar_one_or_none()

    if config is None or not config.enabled:
        raise HTTPException(status_code=400, detail="L'import auto n'est pas configuré ou pas activé pour ce labo")

    try:
        summary = await run_auto_import_for_labo(session, config)
        return RunNowResponse(ok=True, summary=summary, error=None)
    except Exception as exc:
        return RunNowResponse(ok=False, summary=None, error=str(exc))
