# app/routers/superuser_agent_orders_auto_import_pages.py
from __future__ import annotations

import sqlalchemy as sa
from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Labo

# ⚠️ Pas de prefix="/superuser" ici, on met le chemin complet dans @router.get
# ⚠️ Pas de get_current_user / get_current_superuser : page HTML publique (comme les autres pages superuser)
router = APIRouter(tags=["superuser-pages"])


@router.get("/superuser/agent-orders/auto-import", include_in_schema=False)
async def superuser_agent_orders_auto_import_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Page HTML SuperUser → Configuration de l'import automatique
    des commandes agents (CSV Google Drive).
    """
    res = await session.execute(sa.select(Labo).order_by(Labo.name))
    labos = res.scalars().all()

    from app.main import templates

    return templates.TemplateResponse(
        "superuser/agent_orders_auto_import.html",
        {
            "request": request,
            "lang": "fr",
            "labos": labos,
        },
    )
