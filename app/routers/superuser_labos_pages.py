# app/routers/superuser_labos_pages.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Labo

router = APIRouter(tags=["superuser-pages"])


@router.get("/superuser/labos", response_class=HTMLResponse, include_in_schema=False)
async def superuser_labos_list_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    # Optionnel: charger une liste rapide si tu veux l'afficher côté template
    res = await session.execute(select(Labo).order_by(Labo.name))
    labos = res.scalars().all()

    from app.main import templates
    return templates.TemplateResponse(
        "superuser/labos_list.html",
        {"request": request, "lang": "fr", "labos": labos},
    )


@router.get("/superuser/labos/new", response_class=HTMLResponse, include_in_schema=False)
async def superuser_labo_new_page(request: Request):
    from app.main import templates
    return templates.TemplateResponse(
        "superuser/labo_form.html",
        {"request": request, "lang": "fr", "labo_id": None},
    )


@router.get("/superuser/labos/{labo_id}", response_class=HTMLResponse, include_in_schema=False)
async def superuser_labo_edit_page(request: Request, labo_id: int):
    from app.main import templates
    return templates.TemplateResponse(
        "superuser/labo_form.html",
        {"request": request, "lang": "fr", "labo_id": labo_id},
    )
