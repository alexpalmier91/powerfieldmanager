# app/routers/superuser_labo_stock_sync.py
from __future__ import annotations

from datetime import datetime, time
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, HttpUrl, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.session import get_db
from app.db.models import LaboStockSyncConfig
from app.db.models import Labo, Product  # 👈 on importe aussi Product pour la mise à jour de stock

router = APIRouter(
    prefix="/api-zenhub/superuser/labos",
    tags=["superuser-labo-stock-sync"],
)

# ---------- Schémas Pydantic ----------


class LaboStockSyncConfigOut(BaseModel):
    labo_id: int
    enabled: bool
    api_url: Optional[HttpUrl] = None
    api_token: Optional[str] = None
    sku_field: str
    qty_field: str
    run_at: Optional[str] = None  # "HH:MM"
    last_run_at: Optional[datetime] = None
    last_status: Optional[str] = None
    last_error: Optional[str] = None

    class Config:
        from_attributes = True


class LaboStockSyncConfigUpdate(BaseModel):
    enabled: bool
    api_url: Optional[HttpUrl] = None
    api_token: Optional[str] = None
    sku_field: str = "sku"
    qty_field: str = "qty"
    run_at: Optional[str] = None  # "HH:MM" ou None

    @field_validator("run_at")
    @classmethod
    def validate_run_at(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        try:
            time.fromisoformat(v)
        except ValueError:
            raise ValueError("run_at doit être au format HH:MM (ex: 05:00)")
        return v


class StockSyncTestResult(BaseModel):
    ok: bool
    total_items: int
    sample_items: List[Dict[str, Any]]
    detected_sku_field: Optional[str] = None
    detected_qty_field: Optional[str] = None
    error: Optional[str] = None


class StockSyncRunNowResult(BaseModel):
    ok: bool
    labo_id: int
    labo_name: str
    summary: Dict[str, Any]


# ---------- Helpers ----------


def _get_or_create_config(db: Session, labo_id: int) -> LaboStockSyncConfig:
    config = (
        db.query(LaboStockSyncConfig)
        .filter(LaboStockSyncConfig.labo_id == labo_id)
        .one_or_none()
    )
    if config is None:
        labo = db.query(Labo).filter(Labo.id == labo_id).one_or_none()
        if labo is None:
            raise HTTPException(status_code=404, detail="Labo introuvable")

        config = LaboStockSyncConfig(
            labo_id=labo_id,
            enabled=False,
            sku_field="sku",
            qty_field="qty",
        )
        db.add(config)
        db.flush()
    return config


def _call_labo_api(
    url: str,
    api_token: Optional[str],
    timeout: int = 15,
) -> List[Dict[str, Any]]:
    headers: Dict[str, str] = {
        "Accept": "application/json",
    }
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"

    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erreur de connexion à l'API labo : {exc}",
        )

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"API labo a répondu {resp.status_code} : {resp.text[:300]}",
        )

    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Réponse API labo non JSON",
        )

    if not isinstance(data, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="La réponse API labo doit être une liste JSON de lignes {sku, qty}",
        )

    return data


def _apply_stock_updates_for_labo(
    db: Session,
    labo_id: int,
    rows: List[Dict[str, Any]],
    sku_field: str,
    qty_field: str,
) -> Dict[str, Any]:
    """
    Met à jour le stock des produits pour un labo donné à partir des lignes renvoyées par l'API.

    rows : liste de dicts venant de l'API labo (brute).
    sku_field / qty_field : noms des champs à utiliser pour récupérer la ref et la quantité.
    """
    # 1) On extrait toutes les SKUs présentes
    skus: List[str] = []
    for r in rows:
        raw = r.get(sku_field)
        if raw is None:
            continue
        sku = str(raw).strip()
        if sku:
            skus.append(sku)

    # On supprime les doublons tout en conservant l'ordre
    skus = list(dict.fromkeys(skus))

    if not skus:
        return {
            "total_rows": len(rows),
            "matched": 0,
            "updated": 0,
            "unknown_count": 0,
            "unknown_preview": [],
        }

    # 2) On charge les produits de ce labo correspondant aux SKUs
    products: List[Product] = (
        db.query(Product)
        .filter(Product.labo_id == labo_id)
        .filter(Product.sku.in_(skus))
        .all()
    )

    by_sku: Dict[str, Product] = {p.sku: p for p in products}

    updated = 0
    matched = 0
    unknown: List[str] = []

    # 3) On applique les quantités
    for r in rows:
        raw_sku = r.get(sku_field)
        if raw_sku is None:
            continue
        sku = str(raw_sku).strip()
        if not sku:
            continue

        raw_qty = r.get(qty_field, 0)
        try:
            qty = int(raw_qty)
        except (TypeError, ValueError):
            # on ignore la ligne si la quantité est invalide
            continue

        prod = by_sku.get(sku)
        if prod is None:
            unknown.append(sku)
            continue

        matched += 1
        if prod.stock != qty:
            prod.stock = qty
            updated += 1

    db.commit()

    # On limite la liste des inconnus pour ne pas surcharger la réponse
    if len(unknown) > 50:
        unknown_preview = unknown[:50]
    else:
        unknown_preview = unknown

    return {
        "total_rows": len(rows),
        "matched": matched,
        "updated": updated,
        "unknown_count": len(unknown),
        "unknown_preview": unknown_preview,
    }


# ---------- Endpoints ----------


@router.get(
    "/{labo_id}/stock-sync",
    response_model=LaboStockSyncConfigOut,
)
def get_labo_stock_sync_config(
    labo_id: int,
    db: Session = Depends(get_db),
):
    config = _get_or_create_config(db, labo_id)
    run_at_str = config.run_at.strftime("%H:%M") if config.run_at else None
    out = LaboStockSyncConfigOut(
        labo_id=config.labo_id,
        enabled=config.enabled,
        api_url=config.api_url,
        api_token=config.api_token,
        sku_field=config.sku_field,
        qty_field=config.qty_field,
        run_at=run_at_str,
        last_run_at=config.last_run_at,
        last_status=config.last_status,
        last_error=config.last_error,
    )
    return out


@router.put(
    "/{labo_id}/stock-sync",
    response_model=LaboStockSyncConfigOut,
)
def update_labo_stock_sync_config(
    labo_id: int,
    payload: LaboStockSyncConfigUpdate,
    db: Session = Depends(get_db),
):
    config = _get_or_create_config(db, labo_id)

    config.enabled = payload.enabled
    config.api_url = str(payload.api_url) if payload.api_url else None
    config.api_token = payload.api_token
    config.sku_field = payload.sku_field or "sku"
    config.qty_field = payload.qty_field or "qty"
    config.run_at = time.fromisoformat(payload.run_at) if payload.run_at else None

    db.add(config)
    db.commit()
    db.refresh(config)

    run_at_str = config.run_at.strftime("%H:%M") if config.run_at else None

    return LaboStockSyncConfigOut(
        labo_id=config.labo_id,
        enabled=config.enabled,
        api_url=config.api_url,
        api_token=config.api_token,
        sku_field=config.sku_field,
        qty_field=config.qty_field,
        run_at=run_at_str,
        last_run_at=config.last_run_at,
        last_status=config.last_status,
        last_error=config.last_error,
    )


@router.post(
    "/{labo_id}/stock-sync/test",
    response_model=StockSyncTestResult,
)
def test_labo_stock_sync(
    labo_id: int,
    db: Session = Depends(get_db),
):
    config = _get_or_create_config(db, labo_id)

    if not config.api_url:
        raise HTTPException(status_code=400, detail="api_url non configurée")

    data = _call_labo_api(config.api_url, config.api_token)

    total_items = len(data)
    sample_items = data[:5] if total_items else []

    detected_sku_field = config.sku_field
    detected_qty_field = config.qty_field

    return StockSyncTestResult(
        ok=True,
        total_items=total_items,
        sample_items=sample_items,
        detected_sku_field=detected_sku_field,
        detected_qty_field=detected_qty_field,
        error=None,
    )


@router.post(
    "/{labo_id}/stock-sync/run-now",
    response_model=StockSyncRunNowResult,
)
def run_labo_stock_sync_now(
    labo_id: int,
    db: Session = Depends(get_db),
):
    """
    Lance une mise à jour de stock *immédiate* pour un labo donné.
    Utilisé par le bouton "Mettre à jour le stock maintenant" dans le dashboard SUPERUSER.
    """
    # Vérifier que le labo existe
    labo = db.query(Labo).filter(Labo.id == labo_id).one_or_none()
    if labo is None:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    # Charger la configuration
    config = _get_or_create_config(db, labo_id)
    if not config.api_url:
        raise HTTPException(
            status_code=400,
            detail="Configuration de synchro stock incomplète (api_url manquante)",
        )

    sku_field = config.sku_field or "sku"
    qty_field = config.qty_field or "qty"

    try:
        # 1) Appel API labo
        rows = _call_labo_api(config.api_url, config.api_token)

        # 2) Application des mises à jour de stock
        summary = _apply_stock_updates_for_labo(
            db=db,
            labo_id=labo_id,
            rows=rows,
            sku_field=sku_field,
            qty_field=qty_field,
        )

        # 3) Mise à jour des métadonnées de config
        config.last_run_at = datetime.utcnow()
        config.last_status = "success"
        config.last_error = None
        db.add(config)
        db.commit()

        return StockSyncRunNowResult(
            ok=True,
            labo_id=labo_id,
            labo_name=labo.name,
            summary=summary,
        )

    except HTTPException:
        # on laisse remonter les HTTPException telles quelles
        raise
    except Exception as e:
        # Erreur inattendue → on logue dans la config
        config.last_run_at = datetime.utcnow()
        config.last_status = "error"
        config.last_error = str(e)
        db.add(config)
        db.commit()

        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors de la mise à jour du stock : {e}",
        )
