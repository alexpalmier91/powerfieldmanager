from __future__ import annotations

from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Labo

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(tags=["superuser-import-product-prestashop-pages"])


@router.get(
    "/superuser/import/product-prestashop",
    response_class=HTMLResponse,
)
async def superuser_import_product_prestashop_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    # 🔹 Charger les labos
    res = await session.execute(
        select(Labo).order_by(Labo.name)
    )
    labos = res.scalars().all()

    # 🔹 Transformer en JSON-safe
    labos_json = [
        {
            "id": labo.id,
            "name": labo.name,
        }
        for labo in labos
    ]

    return templates.TemplateResponse(
        "superuser/import_product_prestashop.html",
        {
            "request": request,
            "labos": labos_json,  # 👈 SAFE POUR tojson
        },
    )
