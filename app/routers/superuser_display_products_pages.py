# app/routers/superuser_display_products_pages.py
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_async_session
from app.db.models import DisplayProduct, DisplayOwnerClient

templates = Jinja2Templates(directory="app/templates")

# ✅ AUCUNE dépendance ici : les pages HTML restent accessibles
router = APIRouter(tags=["superuser-display-products-pages"])


@router.get("/superuser/display-products", response_class=HTMLResponse)
async def superuser_display_products_list(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    owner_client_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
):
    stmt = (
        select(DisplayProduct)
        .options(
            selectinload(DisplayProduct.owner_client),
            selectinload(DisplayProduct.rfid_links),
        )
        .order_by(DisplayProduct.created_at.desc())
    )

    if owner_client_id is not None:
        stmt = stmt.where(DisplayProduct.owner_client_id == owner_client_id)

    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (DisplayProduct.sku.ilike(like)) |
            (DisplayProduct.name.ilike(like))
        )

    result = await session.execute(stmt)
    products: List[DisplayProduct] = result.scalars().all()

    owners_result = await session.execute(
        select(DisplayOwnerClient).order_by(DisplayOwnerClient.name)
    )
    owners: List[DisplayOwnerClient] = owners_result.scalars().all()

    return templates.TemplateResponse(
        "superuser/display_products_list.html",
        {
            "request": request,
            "products": products,
            "owners": owners,
        },
    )


@router.get("/superuser/display-products/import-excel", response_class=HTMLResponse)
async def superuser_display_products_import_excel(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    owners_result = await session.execute(
        select(DisplayOwnerClient).order_by(DisplayOwnerClient.name)
    )
    owners: List[DisplayOwnerClient] = owners_result.scalars().all()

    return templates.TemplateResponse(
        "superuser/display_products_import.html",
        {
            "request": request,
            "owners": owners,
        },
    )


@router.get("/superuser/display-products/new", response_class=HTMLResponse)
async def superuser_display_product_new(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    owners_result = await session.execute(
        select(DisplayOwnerClient).order_by(DisplayOwnerClient.name)
    )
    owners: List[DisplayOwnerClient] = owners_result.scalars().all()

    return templates.TemplateResponse(
        "superuser/display_product_new.html",
        {
            "request": request,
            "owners": owners,
        },
    )


@router.get("/superuser/display-products/{display_product_id}", response_class=HTMLResponse)
async def superuser_display_product_detail(
    display_product_id: int,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    stmt = (
        select(DisplayProduct)
        .options(
            selectinload(DisplayProduct.owner_client),
            selectinload(DisplayProduct.rfid_links),
        )
        .where(DisplayProduct.id == display_product_id)
    )
    res = await session.execute(stmt)
    dp = res.scalars().first()

    if not dp:
        raise HTTPException(status_code=404, detail="Display Product introuvable")

    return templates.TemplateResponse(
        "superuser/display_product_detail.html",
        {
            "request": request,
            "product": dp,
        },
    )
