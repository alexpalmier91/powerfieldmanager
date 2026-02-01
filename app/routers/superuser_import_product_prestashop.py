# app/routers/superuser_labo_product_prestashop_import.py
from __future__ import annotations

from datetime import datetime
from typing import Dict, Any, Optional, Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Labo
from app.services.import_product_prestashop import import_product_prestashop

router = APIRouter(
    prefix="/api-zenhub/superuser/labos",
    tags=["superuser-labo-product-prestashop-import"],
)


@router.post("/{labo_id}/product-prestashop-import/run-now")
async def run_labo_product_prestashop_import_now(
    labo_id: int,
    images_mode: Literal["main_only", "all_images"] = Query(
        default="main_only",
        description="main_only = 1 image, all_images = plusieurs images",
    ),
    images_limit: int = Query(
        default=6,
        ge=1,
        le=20,
        description="Nombre max d'images importées par produit (si all_images)",
    ),
    limit: int = Query(
        default=500,
        ge=1,
        le=500,
        description="Nombre max de produits récupérés côté Presta (max 500)",
    ),
    since: Optional[str] = Query(
        default=None,
        description="Filtre date (ISO ou Y-m-d H:i:s) sur date_upd Presta",
    ),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Déclenche un import manuel des produits PrestaShop pour un labo.
    """

    # 🔹 Vérifier que le labo existe
    res = await session.execute(sa.select(Labo).where(Labo.id == labo_id))
    labo = res.scalar_one_or_none()
    if labo is None:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    started_at = datetime.utcnow()

    try:
        result: Dict[str, Any] = await import_product_prestashop(
            session=session,
            labo_id=labo_id,
            images_mode=images_mode,
            images_limit=images_limit,
            limit=limit,
            since=since,
        )

        # ⚠️ pas de commit ici : le service commit déjà
        return {
            "labo_id": labo.id,
            "labo_name": labo.name,
            "ok": True,
            "started_at": started_at.isoformat(),
            "params": {
                "images_mode": images_mode,
                "images_limit": images_limit,
                "limit": limit,
                "since": since,
            },
            "summary": result,
        }

    except Exception as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur import PrestaShop : {exc}",
        )
