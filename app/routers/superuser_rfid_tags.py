# app/routers/superuser_rfid_tags.py
from __future__ import annotations

from typing import Any, Optional, Dict, List

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    Query,
    status,
)
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import (
    RfidTag,
    RfidTagStatus,
    Product,
    Presentoir,
    Client,
    DisplayItem,
)
from app.core.security import require_role

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(tags=["superuser-rfid-tags"])


# ============================================================
# 0) VUES GROUPÉES : PAR PRÉSENTOIR / PAR CLIENT
# ============================================================

@router.get("/superuser/rfid/by-presentoir", response_class=HTMLResponse)
async def superuser_rfid_by_presentoir(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Vue groupée : Présentoir -> Tags actifs (DisplayItem actifs)
    """
    stmt = (
        select(Presentoir, Client, DisplayItem, RfidTag, Product)
        .join(Client, Presentoir.pharmacy_id == Client.id, isouter=True)
        .join(DisplayItem, DisplayItem.presentoir_id == Presentoir.id, isouter=True)
        .join(RfidTag, DisplayItem.rfid_tag_id == RfidTag.id, isouter=True)
        .join(Product, RfidTag.product_id == Product.id, isouter=True)
        .order_by(Presentoir.code)
    )

    result = await session.execute(stmt)
    rows = result.all()

    presentoir_map: Dict[int, Dict[str, Any]] = {}

    for pres, client, di, tag, prod in rows:
        if pres.id not in presentoir_map:
            presentoir_map[pres.id] = {
                "presentoir": pres,
                "client": client,
                "tags": [],
            }

        # Pas de tag si pas de DisplayItem / pas de RfidTag
        if di is None or tag is None:
            continue

        # On ne garde que les items "actifs" (présents sur le présentoir)
        if not di.is_active or di.unloaded_at is not None:
            continue

        presentoir_map[pres.id]["tags"].append(
            {
                "epc": tag.epc,
                "sku": tag.sku,
                "status": tag.status.value,
                "product_id": prod.id if prod else tag.product_id,
                "product_name": prod.name if prod else None,
                "level_index": di.level_index,
                "position_index": di.position_index,
                "last_seen_at": tag.last_seen_at,
            }
        )

    presentoir_groups = list(presentoir_map.values())

    return templates.TemplateResponse(
        "superuser/rfid_by_presentoir.html",
        {
            "request": request,
            "presentoir_groups": presentoir_groups,
        },
    )


@router.get("/superuser/rfid/by-client", response_class=HTMLResponse)
async def superuser_rfid_by_client(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    q: str = Query("", description="Filtre sur le nom client"),
):
    """
    Vue groupée : Client -> Présentoirs -> Tags actifs
    """
    stmt = (
        select(Client, Presentoir, DisplayItem, RfidTag, Product)
        .join(Presentoir, Presentoir.pharmacy_id == Client.id, isouter=True)
        .join(DisplayItem, DisplayItem.presentoir_id == Presentoir.id, isouter=True)
        .join(RfidTag, DisplayItem.rfid_tag_id == RfidTag.id, isouter=True)
        .join(Product, RfidTag.product_id == Product.id, isouter=True)
        .order_by(Client.company_name, Presentoir.code)
    )

    # Filtre sur le client
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Client.company_name.ilike(like))

    result = await session.execute(stmt)
    rows = result.all()

    client_map: Dict[int, Dict[str, Any]] = {}

    for client, pres, di, tag, prod in rows:
        # On ignore les clients sans présentoir associé
        if pres is None:
            continue

        if client.id not in client_map:
            client_map[client.id] = {
                "client": client,
                "presentoirs": {},
            }

        pres_map = client_map[client.id]["presentoirs"]
        if pres.id not in pres_map:
            pres_map[pres.id] = {
                "presentoir": pres,
                "tags": [],
            }

        if di is None or tag is None:
            continue
        if not di.is_active or di.unloaded_at is not None:
            continue

        pres_map[pres.id]["tags"].append(
            {
                "epc": tag.epc,
                "sku": tag.sku,
                "status": tag.status.value,
                "product_id": prod.id if prod else tag.product_id,
                "product_name": prod.name if prod else None,
                "level_index": di.level_index,
                "position_index": di.position_index,
                "last_seen_at": tag.last_seen_at,
            }
        )

    # On ne garde que les clients qui ont au moins un présentoir avec des tags
    client_groups: List[Dict[str, Any]] = []
    for cid, entry in client_map.items():
        # filtrer les présentoirs vides si besoin
        pres_with_tags = {
            pid: pinfo for pid, pinfo in entry["presentoirs"].items() if pinfo["tags"]
        }
        if not pres_with_tags:
            continue
        entry["presentoirs"] = pres_with_tags
        client_groups.append(entry)

    # Tri par nom client pour l'affichage
    client_groups.sort(key=lambda e: (e["client"].company_name or "").lower())

    return templates.TemplateResponse(
        "superuser/rfid_by_client.html",
        {
            "request": request,
            "client_groups": client_groups,
            "q": q,
        },
    )


# ============================================================
# 1) PAGE LISTE TAGS RFID (vue globale)
# ============================================================

@router.get("/superuser/rfid-tags", response_class=HTMLResponse)
async def superuser_rfid_tags_list(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    page: int = Query(1, ge=1),
    q: Optional[str] = "",
    status_filter: Optional[str] = "",
):
    PAGE_SIZE = 50

    stmt = select(RfidTag)

    # recherche texte
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                RfidTag.epc.ilike(like),
                RfidTag.sku.ilike(like),
            )
        )

    # filtre statut
    if status_filter:
        try:
            status_enum = RfidTagStatus(status_filter)
            stmt = stmt.where(RfidTag.status == status_enum)
        except ValueError:
            pass

    # total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await session.execute(count_stmt)).scalar_one()

    total_pages = max((total + PAGE_SIZE - 1) // PAGE_SIZE, 1)
    offset = (page - 1) * PAGE_SIZE

    stmt = stmt.order_by(RfidTag.id).offset(offset).limit(PAGE_SIZE)
    result = await session.execute(stmt)
    tags = result.scalars().all()

    return templates.TemplateResponse(
        "superuser/rfid_tags_list.html",
        {
            "request": request,
            "tags": tags,
            "page": page,
            "total_pages": total_pages,
            "q": q,
            "status_filter": status_filter,
        },
    )


# ============================================================
# 2) PAGE DETAIL / EDITION
# ============================================================

@router.get("/superuser/rfid-tags/{tag_id}", response_class=HTMLResponse)
async def superuser_rfid_tag_detail(
    tag_id: int,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    result = await session.execute(
        select(RfidTag).where(RfidTag.id == tag_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag RFID introuvable")

    # produit lié ?
    product = None
    if tag.product_id:
        prod_res = await session.execute(
            select(Product).where(Product.id == tag.product_id)
        )
        product = prod_res.scalar_one_or_none()

    return templates.TemplateResponse(
        "superuser/rfid_tag_edit.html",
        {
            "request": request,
            "tag": tag,
            "product": product,
            "all_status": list(RfidTagStatus),
        },
    )


# ============================================================
# 3) PATCH : Mise à jour RFID TAG
# ============================================================

class RfidTagUpdate(BaseModel):
    sku: Optional[str] = None
    product_id: Optional[int] = None
    status: Optional[str] = None


@router.patch(
    "/api-zenhub/superuser/rfid-tags/{tag_id}",
    dependencies=[Depends(require_role(["SUPERUSER", "SUPERADMIN"]))],
)
async def api_update_rfid_tag(
    tag_id: int,
    payload: RfidTagUpdate,
    session: AsyncSession = Depends(get_async_session),
):
    result = await session.execute(
        select(RfidTag).where(RfidTag.id == tag_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag RFID introuvable")

    # Maj SKU
    tag.sku = payload.sku or None

    # Maj produit
    tag.product_id = payload.product_id

    # Maj statut
    if payload.status:
        try:
            tag.status = RfidTagStatus(payload.status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Statut invalide")

    await session.commit()
    await session.refresh(tag)

    return {"status": "ok", "tag_id": tag.id}


# ============================================================
# 4) API JSON Autocomplete produit
# ============================================================

@router.get(
    "/api-zenhub/superuser/products/search",
    dependencies=[Depends(require_role(["SUPERUSER", "SUPERADMIN"]))],
)
async def api_search_products_for_rfid(
    q: str = Query(..., min_length=2),
    limit: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
):
    like = f"%{q}%"

    stmt = (
        select(Product)
        .where(
            or_(
                Product.sku.ilike(like),
                Product.name.ilike(like),
            )
        )
        .order_by(Product.sku.asc())
        .limit(limit)
    )

    result = await session.execute(stmt)
    products = result.scalars().all()

    return [
        {
            "id": p.id,
            "sku": p.sku,
            "name": p.name,
        }
        for p in products
    ]
