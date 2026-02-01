# app/celery_tasks/agent_orders_auto_import.py
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from typing import Optional

from sqlalchemy import select

from app.tasks.celery_app import celery
from app.db.session import async_session_maker
from app.models.labo_agent_orders_auto_import_config import (
    LaboAgentOrdersAutoImportConfig,
)
from app.services.agent_orders_auto_import_service import run_auto_import_for_labo

logger = logging.getLogger(__name__)


async def _run_for_all_enabled_labos(target_date: date) -> None:
    """
    Parcourt tous les labos ayant l'import auto des commandes agents activé
    et lance l'import pour chacun.

    ⚠️ Très important : aucune purge globale n'est effectuée ici.
        - Pas de TRUNCATE sur la table des commandes agents
        - Pas de DELETE global
        - Uniquement des INSERT / UPDATE par commande, pilotés par
          run_auto_import_for_labo(...).
    """
    logger.info(
        "[agent_orders_auto_import] Démarrage de l'import auto pour tous les labos activés (date=%s)",
        target_date.isoformat(),
    )

    async with async_session_maker() as session:
        stmt = select(LaboAgentOrdersAutoImportConfig).where(
            LaboAgentOrdersAutoImportConfig.enabled.is_(True)
        )
        res = await session.execute(stmt)
        configs = res.scalars().all()

        logger.info(
            "[agent_orders_auto_import] %d labo(s) avec import automatique activé",
            len(configs),
        )

        for config in configs:
            labo_id = config.labo_id
            logger.info(
                "[agent_orders_auto_import] Labo %s → début import auto commandes agents",
                labo_id,
            )
            try:
                await run_auto_import_for_labo(
                    session=session,
                    config=config,
                    target_date=target_date,
                )
                logger.info(
                    "[agent_orders_auto_import] Labo %s → import terminé avec succès",
                    labo_id,
                )
            except Exception as exc:
                logger.exception(
                    "[agent_orders_auto_import] Erreur pendant l'import auto pour labo_id=%s: %s",
                    labo_id,
                    exc,
                )


@celery.task(name="agent_orders_auto_import.sync_all")
def agent_orders_auto_import_sync_all(target_date_str: Optional[str] = None):
    """
    Tâche Celery à exécuter (manuellement ou plus tard via cron).

    :param target_date_str: optionnel, chaîne 'YYYY-MM-DD'.
                            Si None, on utilise la date du jour.
    """
    if target_date_str:
        try:
            target = datetime.strptime(target_date_str, "%Y-%m-%d").date()
        except ValueError:
            # En cas de format invalide, on retombe sur aujourd'hui
            logger.warning(
                "[agent_orders_auto_import] target_date_str invalide '%s', utilisation de la date du jour",
                target_date_str,
            )
            target = date.today()
    else:
        target = date.today()

    logger.info(
        "[agent_orders_auto_import] Task Celery sync_all lancé pour la date %s",
        target.isoformat(),
    )
    asyncio.run(_run_for_all_enabled_labos(target_date=target))
