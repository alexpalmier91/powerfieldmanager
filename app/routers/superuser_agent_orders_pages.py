# app/routers/superuser_agent_orders_pages.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Labo

router = APIRouter(tags=["superuser-pages"])


@router.get("/superuser/import/agent-orders", include_in_schema=False)
async def superuser_import_agent_orders_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Page HTML SuperUser → Import des commandes agents.

    ⚠️ On ne met PAS de get_current_user ici, comme pour /superuser/dashboard.
    La sécurité est gérée côté API d'import (POST /api-zenhub/superuser/agent-orders/import)
    qui vérifie bien le rôle SUPERUSER / SUPERADMIN.
    """

    # Charger la liste des labos pour le <select>
    res = await session.execute(select(Labo).order_by(Labo.name))
    labos = res.scalars().all()

    # Import lazy pour éviter le circular import avec app.main
    from app.main import templates

    return templates.TemplateResponse(
        "superuser/agent_orders_import.html",
        {
            "request": request,
            "lang": "fr",  # superuser toujours en FR
            "labos": labos,
        },
    )
