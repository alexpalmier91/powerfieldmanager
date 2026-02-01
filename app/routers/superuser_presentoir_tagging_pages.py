from __future__ import annotations

from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Presentoir, DisplayProduct

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(tags=["superuser-presentoir-tagging-pages"])


@router.get(
    "/superuser/presentoirs/{presentoir_id}/taguer-produits",
    response_class=HTMLResponse,
)
async def taguer_produits_page(
    presentoir_id: int,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    presentoir = await session.get(Presentoir, presentoir_id)
    if not presentoir:
        raise HTTPException(status_code=404, detail="Présentoir introuvable")

    products = []
    if presentoir.owner_client_id:
        res = await session.execute(
            select(DisplayProduct)
            .where(DisplayProduct.owner_client_id == presentoir.owner_client_id)
            .order_by(DisplayProduct.sku)
        )
        products = res.scalars().all()

    return templates.TemplateResponse(
        "superuser/presentoir_taguer_produits.html",
        {
            "request": request,
            "presentoir": presentoir,
            "display_products": [
                {"id": p.id, "sku": p.sku, "name": p.name}
                for p in products
            ],
        },
    )
