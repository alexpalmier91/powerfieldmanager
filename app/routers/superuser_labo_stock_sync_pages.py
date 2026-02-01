# app/routers/superuser_labo_stock_sync_pages.py
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Labo

router = APIRouter(tags=["superuser-pages"])


@router.get("/superuser/labos/stock-sync", include_in_schema=False)
async def superuser_labo_stock_sync_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Page HTML SuperUser → Configuration de l'automatisation stock labos.

    ⚠️ Comme pour les autres pages superuser, pas de vérification Bearer ici.
    La sécurité est gérée côté API (/api-zenhub/superuser/...)
    qui vérifie le rôle SUPERUSER / SUPERADMIN.
    """
    res = await session.execute(select(Labo).order_by(Labo.name))
    labos = res.scalars().all()

    from app.main import templates

    return templates.TemplateResponse(
        "superuser/labo_stock_sync.html",
        {
            "request": request,
            "lang": "fr",
            "labos": labos,
        },
    )
