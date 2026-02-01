# app/routers/superuser_presentoir_clients.py
from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import (
    DisplayOwnerClient,
    DisplayEndClient,
)
from app.core.security import require_role

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(tags=["superuser-presentoir-clients"])


# ===================== PAGE HTML =====================

@router.get("/superuser/presentoir-clients", response_class=HTMLResponse)
async def superuser_presentoir_clients_page(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    """
    Page de gestion des clients de présentoirs :
    - Clients propriétaires (DisplayOwnerClient)
    - Clients finaux (DisplayEndClient)
    """
    owners_res = await session.execute(
        select(DisplayOwnerClient).order_by(DisplayOwnerClient.name)
    )
    owners: List[DisplayOwnerClient] = owners_res.scalars().all()

    end_clients_res = await session.execute(
        select(DisplayEndClient).order_by(DisplayEndClient.name)
    )
    end_clients: List[DisplayEndClient] = end_clients_res.scalars().all()

    return templates.TemplateResponse(
        "superuser/presentoir_clients.html",
        {
            "request": request,
            "owners": owners,
            "end_clients": end_clients,
        },
    )


# ===================== SCHEMAS =====================

class DisplayOwnerCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company_number: Optional[str] = None


class DisplayEndClientCreate(BaseModel):
    name: str
    type: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address1: Optional[str] = None
    address2: Optional[str] = None
    postcode: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    external_ref: Optional[str] = None
    owner_client_id: Optional[int] = None


# ===================== API JSON OWNERS =====================

@router.get("/api-zenhub/superuser/display-owners")
async def api_list_display_owners(
    q: Optional[str] = None,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    stmt = select(DisplayOwnerClient)
    if q:
        # filtre simple sur le nom
        stmt = stmt.where(DisplayOwnerClient.name.ilike(f"%{q}%"))
    stmt = stmt.order_by(DisplayOwnerClient.name)

    res = await session.execute(stmt)
    owners: List[DisplayOwnerClient] = res.scalars().all()

    return {
        "status": "ok",
        "items": [
            {
                "id": o.id,
                "name": o.name,
                "contact_name": o.contact_name,
                "email": o.email,
            }
            for o in owners
        ],
    }


@router.post(
    "/api-zenhub/superuser/display-owners",
    status_code=status.HTTP_201_CREATED,
)
async def api_create_display_owner(
    data: DisplayOwnerCreate,
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

    return {
        "status": "ok",
        "id": owner.id,
        "name": owner.name,
    }


# ===================== API JSON END CLIENTS =====================

@router.get("/api-zenhub/superuser/display-end-clients")
async def api_list_display_end_clients(
    q: Optional[str] = None,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    stmt = select(DisplayEndClient)
    if q:
        stmt = stmt.where(DisplayEndClient.name.ilike(f"%{q}%"))
    stmt = stmt.order_by(DisplayEndClient.name)

    res = await session.execute(stmt)
    end_clients: List[DisplayEndClient] = res.scalars().all()

    return {
        "status": "ok",
        "items": [
            {
                "id": c.id,
                "name": c.name,
                "type": c.type,
                "city": c.city,
                "postcode": c.postcode,
                "owner_client_id": c.owner_client_id,
                "owner_client_name": c.owner_client.name if c.owner_client else None,
            }
            for c in end_clients
        ],
    }



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
        owner_client_id=data.owner_client_id,   # 🔹 ICI
    )
    session.add(end_client)
    await session.commit()
    await session.refresh(end_client)

    return {
        "status": "ok",
        "id": end_client.id,
        "name": end_client.name,
        "owner_client_id": end_client.owner_client_id,
    }

