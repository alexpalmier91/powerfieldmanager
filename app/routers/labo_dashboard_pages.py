# app/routers/labo_dashboard_pages.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.db.models import Labo
from app.core.security import get_current_user
from app.db.session import get_async_session
from sqlalchemy.ext.asyncio import AsyncSession

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(prefix="/labo", tags=["labo-pages"])


async def get_current_labo_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Version "pages" éventuellement différente, si tu as déjà un helper,
    tu peux remplacer par un import.
    """
    user = request.state.user  # si ton middleware set request.state.user
    if not user or not getattr(user, "labo_id", None):
        # adapter à ta stack (redirect / 403…)
        raise HTTPException(status_code=403, detail="Non autorisé")
    labo = await session.get(Labo, user.labo_id)
    return labo


@router.get("/dashboard", response_class=HTMLResponse)
async def labo_dashboard_page(
    request: Request,
    labo: Labo = Depends(get_current_labo_page),
):
    return templates.TemplateResponse(
        "labo/dashboard.html",
        {
            "request": request,
            "labo": labo,
        },
    )
