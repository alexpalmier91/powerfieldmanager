# app/celery_tasks/labo_sales_import_sync.py
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List

import requests
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.celery_app import celery_app
from app.core.config import settings
from app.db.models import Labo
from app.models.labo_sales_import_config import LaboSalesImportConfig
from app.services.import_labo_documents import run_labo_import

logger = logging.getLogger(__name__)


async def _download_file_async(url: str, timeout: int = 30) -> bytes:
    """
    Téléchargement HTTP "pseudo-async" : on offload requests dans un executor.
    """
    def _do():
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        return resp.content

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def _run_single_labo_import(
    session: AsyncSession,
    config: LaboSalesImportConfig,
) -> Dict[str, Any]:
    """
    Lance l'import des ventes pour un labo donné (config fournie).
    Met à jour config.last_run_at / last_status / last_error, mais
    ne commit pas la transaction (laisse ça à l'appelant).
    """
    now = datetime.utcnow()

    # Récup du labo pour les logs
    res_lab = await session.execute(sa.select(Labo).where(Labo.id == config.labo_id))
    labo = res_lab.scalar_one_or_none()
    labo_name = labo.name if labo else f"labo_id={config.labo_id}"

    if not config.file_url:
        msg = "file_url non configurée"
        logger.warning("Labo %s : %s, on saute", labo_name, msg)
        config.last_run_at = now
        config.last_status = "missing_file_url"
        config.last_error = msg
        return {"ok": False, "error": msg}

    try:
        logger.info(
            "Téléchargement fichier ventes depuis : %s",
            config.file_url,
        )
        content = await _download_file_async(config.file_url)
    except Exception as exc:
        err = f"Erreur téléchargement : {exc}"
        logger.exception("Labo %s : %s", labo_name, err)
        config.last_run_at = now
        config.last_status = "error"
        config.last_error = err
        return {"ok": False, "error": err}

    filename = "labo_sales.xlsx"

    try:
        # run_labo_import est async et utilise déjà AsyncSession
        result = await run_labo_import(
            file_bytes=content,
            filename=filename,
            labo_id=config.labo_id,
            session=session,
        )

        # Résumé détaillé pour les logs
        docs_inserted = result.get("documents_inserted", 0)
        docs_updated = result.get("documents_updated", 0)
        items_inserted = result.get("items_inserted", 0)
        warnings = result.get("warnings", [])
        warnings_count = len(warnings) if isinstance(warnings, list) else 0

        logger.info(
            "Labo %s : import ventes OK (docs_inserted=%s, docs_updated=%s, "
            "items_inserted=%s, warnings=%s)",
            labo_name,
            docs_inserted,
            docs_updated,
            items_inserted,
            warnings_count,
        )

        config.last_run_at = now
        config.last_status = "success"
        config.last_error = None

        # On stocke un résumé éventuel dans la config si tu as une colonne JSON
        if hasattr(config, "last_summary"):
            config.last_summary = result  # type: ignore[attr-defined]

        return {"ok": True, "summary": result}

    except HTTPException as exc:
        # Erreur "fonctionnelle" de ton import (format fichier, etc.)
        msg = f"Erreur import : {exc.detail}"
        logger.exception("Labo %s : %s", labo_name, msg)
        config.last_run_at = now
        config.last_status = "error"
        config.last_error = msg
        return {"ok": False, "error": msg}

    except Exception as exc:
        msg = f"Erreur import : {exc}"
        logger.exception("Labo %s : %s", labo_name, msg)
        config.last_run_at = now
        config.last_status = "error"
        config.last_error = msg
        return {"ok": False, "error": msg}


async def _async_sync_all_labos_sales_import() -> None:
    """
    Version purement async :
    - crée son propre engine async + sessionmaker,
    - s'assure que tout tourne dans la même boucle event,
    - et ferme le pool en fin de tâche.

    ⚠️ On n'utilise volontairement PAS AsyncSessionLocal global pour
    éviter les histoires de "Future attached to a different loop".
    """
    # 1) Engine async dédié à CETTE exécution
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        future=True,
    )
    async_session_factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )

    try:
        async with async_session_factory() as session:
            # Récupère les configs actives
            res = await session.execute(
                sa.select(LaboSalesImportConfig).where(
                    LaboSalesImportConfig.enabled.is_(True),
                    LaboSalesImportConfig.file_url.isnot(None),
                )
            )
            configs: List[LaboSalesImportConfig] = res.scalars().all()

            logger.info("Import ventes auto : %d labos éligibles", len(configs))

            for config in configs:
                # On exécute labo par labo
                result = await _run_single_labo_import(session, config)
                # On attache la config modifiée à la session
                session.add(config)

            # Commit global après tous les labos
            await session.commit()

    finally:
        # On ferme proprement le pool asyncpg pour cette tâche
        await engine.dispose()


@celery_app.task(name="labo_sales_import_sync.sync_all")
def labo_sales_import_sync_all() -> None:
    """
    Tâche appelée par Celery (et par cron via `celery call`).

    Elle se contente de démarrer une boucle event locale et
    d'exécuter la coroutine principale.
    """
    try:
        asyncio.run(_async_sync_all_labos_sales_import())
    except Exception:
        logger.exception("Erreur globale labo_sales_import_sync_all")
