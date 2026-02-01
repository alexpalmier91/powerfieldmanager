# app/routers/superuser_presentoir_clients.py
from __future__ import annotations

from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import DisplayOwnerClient, DisplayEndClient
from app.core.security import require_role

templates = Jinja2Templates(directory="app/templates")

# ✅ AUCUNE dépendance ici : les pages HTML restent accessibles
router = APIRouter(tags=["superuser-presentoir-clients"])


# ===================== PAGES HTML =====================

@router.get("/superuser/presentoir-clients", response_class=HTMLResponse)
async def superuser_presentoir_clients(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    owners_result = await session.execute(
        select(DisplayOwnerClient).order_by(DisplayOwnerClient.name)
    )
    owners: List[DisplayOwnerClient] = owners_result.scalars().all()

    end_result = await session.execute(
        select(DisplayEndClient).order_by(DisplayEndClient.name)
    )
    end_clients: List[DisplayEndClient] = end_result.scalars().all()

    return templates.TemplateResponse(
        "superuser/presentoir_clients.html",
        {
            "request": request,
            "owners": owners,
            "end_clients": end_clients,
        },
    )


# ===================== API JSON (création) =====================

class DisplayOwnerClientCreate(BaseModel):
    name: str
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    company_number: str | None = None


class DisplayEndClientCreate(BaseModel):
    name: str
    type: str | None = None
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    address1: str | None = None
    address2: str | None = None
    postcode: str | None = None
    city: str | None = None
    country: str | None = None
    external_ref: str | None = None


@router.post(
    "/api-zenhub/superuser/display-owner-clients",
    status_code=status.HTTP_201_CREATED,
)
async def api_create_display_owner_client(
    data: DisplayOwnerClientCreate,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    owner = DisplayOwnerClient(
        name=data.name,
        contact_name=data.contact_name,
        email=data.email,
        phone=data.phone,
        company_number=data.company_number,
    )
    session.add(owner)
    await session.commit()
    await session.refresh(owner)
    return {"status": "ok", "id": owner.id}


@router.post(
    "/api-zenhub/superuser/display-end-clients",
    status_code=status.HTTP_201_CREATED,
)
async def api_create_display_end_client(
    data: DisplayEndClientCreate,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    end_client = DisplayEndClient(
        name=data.name,
        type=data.type,
        contact_name=data.contact_name,
        email=data.email,
        phone=data.phone,
        address1=data.address1,
        address2=data.address2,
        postcode=data.postcode,
        city=data.city,
        country=data.country,
        external_ref=data.external_ref,
    )
    session.add(end_client)
    await session.commit()
    await session.refresh(end_client)
    return {"status": "ok", "id": end_client.id}
