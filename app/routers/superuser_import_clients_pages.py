# app/routers/superuser_import_clients_pages.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Labo

router = APIRouter(tags=["superuser-pages"])


@router.get("/superuser/import/clients", include_in_schema=False)
async def superuser_import_clients_page(
    request: Request,
):
    """
    Page HTML SuperUser → Import des clients.

    ⚠️ Pas de vérification Bearer ici.
    La sécurité est gérée côté API (/api-zenhub/superuser/client-import)
    qui vérifie le rôle SUPERUSER / SUPERADMIN.
    """
    from app.main import templates

    return templates.TemplateResponse(
        "superuser/import_clients.html",
        {
            "request": request,
            "lang": "fr",  # superuser toujours en FR
        },
    )


@router.get("/superuser/import/client-mapping", include_in_schema=False)
async def superuser_import_client_mapping_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Page HTML SuperUser → Mapping labo / client.
    Liste les labos pour le <select>.
    """
    res = await session.execute(select(Labo).order_by(Labo.name))
    labos = res.scalars().all()

    from app.main import templates

    return templates.TemplateResponse(
        "superuser/import_client_mapping.html",
        {
            "request": request,
            "lang": "fr",
            "labos": labos,
        },
    )
