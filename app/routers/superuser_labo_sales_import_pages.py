# app/routers/superuser_labo_sales_import_pages.py
from __future__ import annotations

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Labo

router = APIRouter(tags=["superuser-pages"])


@router.get("/superuser/labos/sales-import-sync", include_in_schema=False)
async def superuser_labo_sales_import_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Page HTML SuperUser → Configuration des imports automatiques de ventes (fichiers Excel Drive).
    """
    res = await session.execute(sa.select(Labo).order_by(Labo.name))
    labos = res.scalars().all()

    from app.main import templates

    return templates.TemplateResponse(
        "superuser/labo_sales_import_sync.html",
        {
            "request": request,
            "lang": "fr",
            "labos": labos,
        },
    )
