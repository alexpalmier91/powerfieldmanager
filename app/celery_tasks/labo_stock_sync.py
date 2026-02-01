# app/celery_tasks/labo_stock_sync.py
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

import logging
import requests
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models import LaboStockSyncConfig

# Adapte ces imports selon ton projet
from app.db.models import Product
from app.core.celery_app import celery_app  # <-- adapte : ton objet Celery

logger = logging.getLogger(__name__)


def _extract_sku_and_qty(
    row: Dict[str, Any],
    sku_field: str,
    qty_field: str,
) -> Optional[Dict[str, Any]]:
    """
    Essaie de récupérer sku et qty sur une ligne de la réponse.
    Tolère quelques variations de nom de champ.
    """
    sku_candidates = [sku_field, "sku", "code", "reference", "ref", "article"]
    qty_candidates = [qty_field, "qty", "quantity", "stock", "qte", "qte_stock"]

    sku: Optional[str] = None
    qty_val: Optional[Any] = None

    for k in sku_candidates:
        if k in row and row[k] is not None:
            sku = str(row[k]).strip()
            break

    for k in qty_candidates:
        if k in row and row[k] is not None:
            qty_val = row[k]
            break

    if sku is None or qty_val is None:
        return None

    try:
        qty = int(qty_val)
    except (ValueError, TypeError):
        try:
            qty = int(float(qty_val))
        except Exception:
            return None

    return {"sku": sku, "qty": qty}


def _call_labo_api_raw(url: str, api_token: Optional[str], timeout: int = 20) -> List[Dict[str, Any]]:
    headers: Dict[str, str] = {"Accept": "application/json"}
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError("La réponse API labo doit être une liste d'objets")
    return data


@celery_app.task(name="labo_stock_sync.sync_all")
def sync_all_labos_stock() -> None:
    """
    Tâche planifiée (via beat) qui parcourt tous les labos
    ayant la synchro stock activée et met à jour les stocks.
    """
    db: Session = SessionLocal()
    try:
        configs: List[LaboStockSyncConfig] = (
            db.query(LaboStockSyncConfig)
            .filter(LaboStockSyncConfig.enabled.is_(True))
            .all()
        )
        logger.info("Sync stock : %d labos éligibles", len(configs))

        for config in configs:
            _sync_single_labo(db, config)

        db.commit()
    except Exception:
        logger.exception("Erreur globale sync_all_labos_stock")
        db.rollback()
    finally:
        db.close()


def _sync_single_labo(db: Session, config: LaboStockSyncConfig) -> None:
    labo_id = config.labo_id
    now = datetime.utcnow()
    logger.info("Sync stock labo_id=%s", labo_id)

    if not config.api_url:
        logger.warning("Labo %s : api_url non configurée, on saute", labo_id)
        config.last_run_at = now
        config.last_status = "missing_api_url"
        config.last_error = "api_url non configurée"
        db.add(config)
        db.flush()
        return

    try:
        rows = _call_labo_api_raw(config.api_url, config.api_token)
    except Exception as exc:
        logger.exception("Labo %s : erreur API", labo_id)
        config.last_run_at = now
        config.last_status = "error"
        config.last_error = f"Erreur API : {exc}"
        db.add(config)
        db.flush()
        return

    parsed: List[Dict[str, Any]] = []
    skipped = 0

    for r in rows:
        if not isinstance(r, dict):
            skipped += 1
            continue
        parsed_row = _extract_sku_and_qty(r, config.sku_field, config.qty_field)
        if parsed_row is None:
            skipped += 1
            continue
        parsed.append(parsed_row)

    logger.info(
        "Labo %s : %d lignes reçues, %d interprétées, %d ignorées",
        labo_id,
        len(rows),
        len(parsed),
        skipped,
    )

    if not parsed:
        config.last_run_at = now
        config.last_status = "empty"
        config.last_error = "Aucune ligne exploitable dans la réponse API"
        db.add(config)
        db.flush()
        return

    sku_list = [p["sku"] for p in parsed]

    # IMPORTANT : adapte les noms des colonnes sur ton modèle Product :
    # - labo_id
    # - sku (ou reference, code_article...)
    # - stock_quantity (ou quantity, stock...)
    products: List[Product] = (
        db.query(Product)
        .filter(
            Product.labo_id == labo_id,  # adapte si le lien labo est différent
            Product.sku.in_(sku_list),   # adapte nom de colonne (sku / reference)
        )
        .all()
    )

    products_by_sku = {p.sku: p for p in products}
    updated = 0
    not_found = 0

    for item in parsed:
        sku = item["sku"]
        qty = item["qty"]

        product = products_by_sku.get(sku)
        if not product:
            not_found += 1
            continue

        # adapte le nom du champ stock :
        product.stock_quantity = qty  # ex: product.stock_quantity / product.stock
        updated += 1

    config.last_run_at = now
    config.last_status = "ok"
    config.last_error = None

    db.add(config)
    logger.info(
        "Labo %s : %d produits mis à jour, %d codes inconnus",
        labo_id,
        updated,
        not_found,
    )
