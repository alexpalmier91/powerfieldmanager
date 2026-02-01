# app/routers/superuser_labo_sales_import_sync.py
from __future__ import annotations

from datetime import datetime, time
from typing import Any, Dict, Optional
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
import re

import requests
import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, HttpUrl, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Labo
from app.models.labo_sales_import_config import LaboSalesImportConfig
from app.services.import_labo_documents import run_labo_import

router = APIRouter(
    prefix="/api-zenhub/superuser/labos",
    tags=["superuser-labo-sales-import"],
)

# ---------- Schémas Pydantic ----------


class LaboSalesImportConfigOut(BaseModel):
    labo_id: int
    enabled: bool
    file_url: Optional[HttpUrl] = None
    run_at: Optional[str] = None  # "HH:MM"

    last_run_at: Optional[datetime] = None
    last_status: Optional[str] = None
    last_error: Optional[str] = None

    class Config:
        from_attributes = True


class LaboSalesImportConfigUpdate(BaseModel):
    enabled: bool
    file_url: Optional[HttpUrl] = None
    run_at: Optional[str] = None  # "HH:MM" ou None

    @field_validator("run_at")
    @classmethod
    def validate_run_at(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        try:
            time.fromisoformat(v)
        except ValueError:
            raise ValueError("run_at doit être au format HH:MM (ex: 05:00)")
        return v


class LaboSalesImportRunResult(BaseModel):
    labo_id: int
    labo_name: str | None = None
    ok: bool
    summary: Dict[str, Any] = {}
    error: Optional[str] = None


# ---------- Helpers ----------


async def _get_or_create_config(
    session: AsyncSession,
    labo_id: int,
) -> LaboSalesImportConfig:
    res = await session.execute(
        sa.select(LaboSalesImportConfig).where(
            LaboSalesImportConfig.labo_id == labo_id
        )
    )
    config = res.scalar_one_or_none()

    if config is None:
        res_lab = await session.execute(
            sa.select(Labo).where(Labo.id == labo_id)
        )
        labo = res_lab.scalar_one_or_none()
        if labo is None:
            raise HTTPException(status_code=404, detail="Labo introuvable")

        config = LaboSalesImportConfig(
            labo_id=labo_id,
            enabled=False,
            file_url=None,
            run_at=None,
            last_run_at=None,
            last_status=None,
            last_error=None,
        )
        session.add(config)
        await session.flush()

    return config


def _normalize_google_sheets_url(url: str) -> str:
    """
    Transforme UNIQUEMENT les URLs Google Sheets de type "view/edit" en lien d'export XLSX.

    - Si l'URL pointe déjà vers /export, on NE TOUCHE À RIEN.
    - Sinon, on construit : .../spreadsheets/d/FILE_ID/export?format=xlsx&gid=...
    """
    parsed = urlparse(url)

    if "docs.google.com" not in parsed.netloc:
        return url  # pas un Google Sheets

    if "/spreadsheets/d/" not in parsed.path:
        return url  # autre type de doc

    # Cas important : si on a déjà /export dans le path, on ne modifie pas l'URL
    if "/export" in parsed.path:
        return url

    # À partir d'ici, on est sur une URL /edit, /view, etc. → on fabrique un /export
    parts = parsed.path.split("/")
    file_id = None
    for i, part in enumerate(parts):
        if part == "d" and i + 1 < len(parts):
            file_id = parts[i + 1]
            break

    if not file_id:
        return url

    qs = parse_qs(parsed.query)
    gid = qs.get("gid", ["0"])[0]

    new_path = f"/spreadsheets/d/{file_id}/export"
    new_qs = urlencode({"format": "xlsx", "gid": gid})
    new_url = urlunparse(
        (parsed.scheme, parsed.netloc, new_path, "", new_qs, "")
    )
    return new_url


def _download_file(url: str, timeout: int = 30) -> bytes:
    """
    Télécharge le fichier Excel depuis l'URL (Google Drive / Sheets ou autre).

    - Si l'URL est un lien Google Sheets "view/edit", on la convertit en export XLSX.
    - Si c'est déjà un lien /export (comme tu les saisis aujourd'hui), on le laisse tel quel.
    - AUCUNE variante 'exportFormat=' n'est ajoutée.
    """
    # Normalisation douce des URLs Google Sheets
    final_url = _normalize_google_sheets_url(url)

    try:
        # requests suit les redirections (307) par défaut
        resp = requests.get(final_url, timeout=timeout)
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erreur de connexion à l'URL du fichier : {exc}",
        )

    if resp.status_code >= 400:
        snippet = resp.text[:400].replace("\n", " ")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Fichier inaccessible (HTTP {resp.status_code}) pour l'URL: {resp.url} "
                f"(extrait de la réponse: {snippet})"
            ),
        )

    return resp.content


async def _run_import_for_labo(
    session: AsyncSession,
    labo_id: int,
    file_bytes: bytes,
    filename: str,
) -> Dict[str, Any]:
    """
    Appelle le service existant run_labo_import.
    """
    result = await run_labo_import(
        file_bytes=file_bytes,
        filename=filename,
        labo_id=labo_id,
        session=session,
    )
    # run_labo_import gère les insert/updates.
    # On commit ici pour être sûr.
    await session.commit()
    return result


# ---------- Endpoints ----------


@router.get(
    "/{labo_id}/sales-import-sync",
    response_model=LaboSalesImportConfigOut,
)
async def get_labo_sales_import_config(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
):
    config = await _get_or_create_config(session, labo_id)
    run_at_str = config.run_at.strftime("%H:%M") if config.run_at else None

    return LaboSalesImportConfigOut(
        labo_id=config.labo_id,
        enabled=config.enabled,
        file_url=config.file_url,
        run_at=run_at_str,
        last_run_at=config.last_run_at,
        last_status=config.last_status,
        last_error=config.last_error,
    )


@router.put(
    "/{labo_id}/sales-import-sync",
    response_model=LaboSalesImportConfigOut,
)
async def update_labo_sales_import_config(
    labo_id: int,
    payload: LaboSalesImportConfigUpdate,
    session: AsyncSession = Depends(get_async_session),
):
    config = await _get_or_create_config(session, labo_id)

    config.enabled = payload.enabled
    config.file_url = str(payload.file_url) if payload.file_url else None
    config.run_at = time.fromisoformat(payload.run_at) if payload.run_at else None

    session.add(config)
    await session.commit()
    await session.refresh(config)

    run_at_str = config.run_at.strftime("%H:%M") if config.run_at else None

    return LaboSalesImportConfigOut(
        labo_id=config.labo_id,
        enabled=config.enabled,
        file_url=config.file_url,
        run_at=run_at_str,
        last_run_at=config.last_run_at,
        last_status=config.last_status,
        last_error=config.last_error,
    )


@router.post(
    "/{labo_id}/sales-import-sync/run-now",
    response_model=LaboSalesImportRunResult,
)
async def run_labo_sales_import_now(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Déclenche un import immédiat des ventes pour le labo.
    Utilise le fichier Excel pointé par file_url.
    """
    # Récup config + labo
    config = await _get_or_create_config(session, labo_id)

    res_lab = await session.execute(sa.select(Labo).where(Labo.id == labo_id))
    labo = res_lab.scalar_one_or_none()
    if labo is None:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    if not config.file_url:
        raise HTTPException(
            status_code=400,
            detail="file_url non configurée pour ce labo",
        )

    now = datetime.utcnow()

    try:
        content = _download_file(config.file_url)
    except HTTPException as exc:
        # on loggue l'échec dans la config
        config.last_run_at = now
        config.last_status = "error"
        config.last_error = str(exc.detail)
        session.add(config)
        await session.commit()
        raise

    # On essaie d'inférer un nom de fichier "virtuel"
    filename = "labo_sales.xlsx"

    try:
        result = await _run_import_for_labo(
            session=session,
            labo_id=labo_id,
            file_bytes=content,
            filename=filename,
        )

        # Résumé détaillé pour la réponse (pas dans last_status)
        docs_inserted = result.get("documents_inserted", 0)
        docs_updated = result.get("documents_updated", 0)
        items_inserted = result.get("items_inserted", 0)
        warnings = result.get("warnings", [])
        warnings_count = len(warnings) if isinstance(warnings, list) else 0

        # En DB on ne met qu'un statut COURT
        config.last_run_at = now
        config.last_status = "success"
        config.last_error = None
        session.add(config)
        await session.commit()

        summary: Dict[str, Any] = dict(result)
        summary.setdefault("documents_inserted", docs_inserted)
        summary.setdefault("documents_updated", docs_updated)
        summary.setdefault("items_inserted", items_inserted)
        summary.setdefault("warnings_count", warnings_count)

        return LaboSalesImportRunResult(
            labo_id=labo_id,
            labo_name=labo.name,
            ok=True,
            summary=summary,
            error=None,
        )

    except Exception as exc:
        config.last_run_at = now
        config.last_status = "error"
        config.last_error = str(exc)
        session.add(config)
        await session.commit()

        raise HTTPException(
            status_code=500,
            detail=f"Erreur pendant l'import : {exc}",
        )
