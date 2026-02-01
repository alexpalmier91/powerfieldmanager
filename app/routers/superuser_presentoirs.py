# app/routers/superuser_presentoirs.py
from __future__ import annotations

from typing import Any, List, Optional, Dict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import (
    Presentoir,
    PresentoirEvent,  # legacy
    RfidTag,
    DisplayItem,
    DisplaySaleEvent,
    Product,
    DisplayOwnerClient,
    DisplayEndClient,
    DisplayProduct,         # ✅ NEW (table display_product)
    RfidTagProductLink,     # ✅ NEW (table rfid_tag_product_link)
)
from app.core.security import require_role  # pour l'API JSON

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(tags=["superuser-presentoirs"])

OFFLINE_AFTER_MINUTES = 5
OFFLINE_AFTER_SECONDS = 30


def _compute_presentoir_status(p: Presentoir) -> str:
    """
    Statut calculé à partir de last_seen_at.
    ONLINE si last_seen_at <= OFFLINE_AFTER_MINUTES
    OFFLINE sinon
    ERROR si last_status == "ERROR"
    """
    now = datetime.now(timezone.utc)

    computed = "OFFLINE"
    if getattr(p, "last_seen_at", None):
        last = p.last_seen_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)

        if (now - last) <= timedelta(seconds=OFFLINE_AFTER_SECONDS):
            computed = "ONLINE"
        else:
            computed = "OFFLINE"

    if getattr(p, "last_status", None) == "ERROR":
        computed = "ERROR"

    return computed


def _pick_sku(dprod: Optional[DisplayProduct], prod: Optional[Product], tag: RfidTag) -> str:
    """
    Priorité SKU :
    1) DisplayProduct.sku via rfid_tag_product_link (EPC -> display_product_id)
    2) Product.sku via rfid_tag.product_id (legacy)
    3) RfidTag.sku (fallback)
    """
    return (
        (dprod.sku if dprod is not None and getattr(dprod, "sku", None) else None)
        or (prod.sku if prod is not None and getattr(prod, "sku", None) else None)
        or (tag.sku if getattr(tag, "sku", None) else None)
        or "(SKU inconnu)"
    )


# ===================== PAGES HTML =====================

@router.get("/superuser/presentoirs", response_class=HTMLResponse)
async def superuser_presentoirs_list(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    stmt = select(Presentoir).order_by(Presentoir.code)
    result = await session.execute(stmt)
    presentoirs: List[Presentoir] = result.scalars().all()

    # ✅ statut calculé à partir de last_seen_at
    for p in presentoirs:
        p.computed_status = _compute_presentoir_status(p)

    return templates.TemplateResponse(
        "superuser/presentoirs_list.html",
        {
            "request": request,
            "presentoirs": presentoirs,
        },
    )


@router.get("/superuser/presentoirs/{presentoir_id}", response_class=HTMLResponse)
async def superuser_presentoir_detail(
    presentoir_id: int,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    # --- Présentoir ---
    stmt = select(Presentoir).where(Presentoir.id == presentoir_id)
    result = await session.execute(stmt)
    presentoir: Optional[Presentoir] = result.scalar_one_or_none()

    if not presentoir:
        raise HTTPException(status_code=404, detail="Presentoir not found")

    # ✅ statut calculé à partir de last_seen_at (comme la liste)
    computed_status = _compute_presentoir_status(presentoir)

    # =========================
    # Labels owner / client final
    # =========================
    owner_label: Optional[str] = None
    end_client_label: Optional[str] = None

    # Propriétaire du présentoir (DisplayOwnerClient)
    if presentoir.owner_client_id:
        res_owner = await session.execute(
            select(DisplayOwnerClient).where(
                DisplayOwnerClient.id == presentoir.owner_client_id
            )
        )
        owner = res_owner.scalar_one_or_none()
        if owner:
            owner_label = owner.name

    # Client final (DisplayEndClient)
    if presentoir.end_client_id:
        res_end = await session.execute(
            select(DisplayEndClient).where(
                DisplayEndClient.id == presentoir.end_client_id
            )
        )
        end_client = res_end.scalar_one_or_none()
        if end_client:
            parts = [end_client.name]
            if end_client.city:
                parts.append(end_client.city)
            end_client_label = " – ".join(parts)

    # =====================================================
    # 1) Produits présents actuellement sur le présentoir
    #    (SKU via display_product en priorité)
    # =====================================================
    stmt_current = (
        select(DisplayItem, RfidTag, DisplayProduct, Product)
        .join(RfidTag, DisplayItem.rfid_tag_id == RfidTag.id)
        .join(RfidTagProductLink, RfidTagProductLink.epc == RfidTag.epc, isouter=True)
        .join(DisplayProduct, DisplayProduct.id == RfidTagProductLink.display_product_id, isouter=True)
        .join(Product, RfidTag.product_id == Product.id, isouter=True)  # legacy
        .where(
            DisplayItem.presentoir_id == presentoir.id,
            DisplayItem.unloaded_at.is_(None),
            DisplayItem.is_active.is_(True),
        )
    )
    res_current = await session.execute(stmt_current)
    rows_current = res_current.all()

    sku_summary: Dict[str, Dict[str, Any]] = {}

    for di, tag, dprod, prod in rows_current:
        sku = _pick_sku(dprod, prod, tag)
        last_ts = tag.last_seen_at or di.loaded_at

        if sku not in sku_summary:
            sku_summary[sku] = {
                "sku": sku,
                "count": 0,
                "last_ts": last_ts,
            }

        sku_summary[sku]["count"] += 1
        if last_ts and (
            not sku_summary[sku]["last_ts"]
            or last_ts > sku_summary[sku]["last_ts"]
        ):
            sku_summary[sku]["last_ts"] = last_ts

    sku_summary_list = sorted(
        sku_summary.values(),
        key=lambda x: x["count"],
        reverse=True,
    )

    # =====================================================
    # 2) Historique des événements de vente / retour
    #    (SKU via display_product en priorité)
    # =====================================================
    stmt_events = (
        select(DisplaySaleEvent, RfidTag, DisplayProduct, Product)
        .join(RfidTag, DisplaySaleEvent.rfid_tag_id == RfidTag.id)
        .join(RfidTagProductLink, RfidTagProductLink.epc == RfidTag.epc, isouter=True)
        .join(DisplayProduct, DisplayProduct.id == RfidTagProductLink.display_product_id, isouter=True)
        .join(Product, DisplaySaleEvent.product_id == Product.id, isouter=True)
        .where(DisplaySaleEvent.presentoir_id == presentoir.id)
        .order_by(desc(DisplaySaleEvent.occurred_at))
        .limit(50)
    )
    res_events = await session.execute(stmt_events)
    rows_events = res_events.all()

    events_last50: List[Dict[str, Any]] = []
    for ev, tag, dprod, prod in rows_events:
        sku = _pick_sku(dprod, prod, tag)
        events_last50.append(
            {
                "occurred_at": ev.occurred_at,
                "event_type": ev.event_type.value,
                "sku": sku,
                "epc": tag.epc,
            }
        )

    last_event = events_last50[0] if events_last50 else None

    return templates.TemplateResponse(
        "superuser/presentoir_detail.html",
        {
            "request": request,
            "presentoir": presentoir,
            "sku_summary": sku_summary_list,
            "events": events_last50,
            "last_event": last_event,
            "owner_label": owner_label,
            "end_client_label": end_client_label,
            "computed_status": computed_status,
        },
    )


# ===================== API JSON (création / édition) =====================

class PresentoirCreate(BaseModel):
    code: str
    name: str | None = None

    # IDs envoyés par le front
    owner_id: int | None = None        # -> display_owner_client.id
    pharmacy_id: int | None = None     # -> display_end_client.id

    location: str | None = None
    tunnel_url: str | None = None


class PresentoirUpdate(BaseModel):
    name: str | None = None

    # IDs envoyés par le front
    owner_id: int | None = None        # -> display_owner_client.id
    pharmacy_id: int | None = None     # -> display_end_client.id

    location: str | None = None
    tunnel_url: str | None = None


@router.post("/api-zenhub/superuser/presentoirs", status_code=status.HTTP_201_CREATED)
async def superuser_create_presentoir(
    data: PresentoirCreate,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    existing = await session.execute(
        select(Presentoir).where(Presentoir.code == data.code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Un présentoir avec ce code existe déjà.",
        )

    presentoir = Presentoir(
        code=data.code,
        name=data.name,
        owner_client_id=data.owner_id,
        end_client_id=data.pharmacy_id,
        location=data.location,
        tunnel_url=data.tunnel_url,
        is_active=True,
    )

    session.add(presentoir)
    await session.commit()
    await session.refresh(presentoir)

    return {
        "status": "ok",
        "id": presentoir.id,
        "owner_id": presentoir.owner_client_id,
        "pharmacy_id": presentoir.end_client_id,
    }


@router.patch(
    "/api-zenhub/superuser/presentoirs/{presentoir_id}",
    status_code=status.HTTP_200_OK,
)
async def superuser_update_presentoir(
    presentoir_id: int,
    data: PresentoirUpdate,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    result = await session.execute(
        select(Presentoir).where(Presentoir.id == presentoir_id)
    )
    presentoir = result.scalar_one_or_none()
    if not presentoir:
        raise HTTPException(status_code=404, detail="Présentoir introuvable")

    if data.name is not None:
        presentoir.name = data.name

    if data.location is not None:
        presentoir.location = data.location

    if data.tunnel_url is not None:
        presentoir.tunnel_url = data.tunnel_url

    if data.owner_id is not None:
        presentoir.owner_client_id = data.owner_id

    if data.pharmacy_id is not None:
        presentoir.end_client_id = data.pharmacy_id

    await session.commit()
    await session.refresh(presentoir)

    return {
        "status": "ok",
        "id": presentoir.id,
        "owner_id": presentoir.owner_client_id,
        "pharmacy_id": presentoir.end_client_id,
    }


# =========================================================
#   LISTES POUR LES SELECTS (owners / clients finaux)
# =========================================================

@router.get("/api-zenhub/superuser/presentoirs/owners-options")
async def superuser_presentoir_owners_options(
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    stmt = select(DisplayOwnerClient).order_by(DisplayOwnerClient.name)
    res = await session.execute(stmt)
    owners: List[DisplayOwnerClient] = res.scalars().all()

    return {
        "items": [
            {
                "id": o.id,
                "name": o.name,
                "contact_name": o.contact_name,
            }
            for o in owners
        ]
    }


@router.get("/api-zenhub/superuser/presentoirs/end-clients-options")
async def superuser_presentoir_end_clients_options(
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    stmt = select(DisplayEndClient).order_by(DisplayEndClient.name)
    res = await session.execute(stmt)
    clients: List[DisplayEndClient] = res.scalars().all()

    return {
        "items": [
            {
                "id": c.id,
                "name": c.name,
                "city": c.city,
                "owner_client_id": c.owner_client_id,
            }
            for c in clients
        ]
    }


# =========================================================
#            API JSON "LIVE" pour monitoring temps réel
# =========================================================

async def _build_presentoir_live_payload(
    session: AsyncSession,
    presentoir_id: int,
) -> dict:
    """
    Construit le payload JSON "live" pour un présentoir :
    - infos de base (code, last_seen_at, compteur produits, computed_status)
    - produits présents (agrégés par SKU)
    - derniers événements (removal / return)
    """
    result = await session.execute(
        select(Presentoir).where(Presentoir.id == presentoir_id)
    )
    presentoir = result.scalar_one_or_none()
    if not presentoir:
        raise HTTPException(status_code=404, detail="Presentoir not found")

    live_status = _compute_presentoir_status(presentoir)

    # Tags actuellement chargés (DisplayItem actifs) + SKU via display_product
    stmt_items = (
        select(DisplayItem, RfidTag, DisplayProduct, Product)
        .join(RfidTag, DisplayItem.rfid_tag_id == RfidTag.id)
        .join(RfidTagProductLink, RfidTagProductLink.epc == RfidTag.epc, isouter=True)
        .join(DisplayProduct, DisplayProduct.id == RfidTagProductLink.display_product_id, isouter=True)
        .join(Product, RfidTag.product_id == Product.id, isouter=True)
        .where(
            DisplayItem.presentoir_id == presentoir.id,
            DisplayItem.unloaded_at.is_(None),
            DisplayItem.is_active.is_(True),
        )
    )
    res_items = await session.execute(stmt_items)
    rows_items = res_items.all()

    sku_summary: Dict[str, Dict[str, Any]] = {}
    for di, tag, dprod, prod in rows_items:
        sku = _pick_sku(dprod, prod, tag)
        last_ts = tag.last_seen_at or di.loaded_at

        if sku not in sku_summary:
            sku_summary[sku] = {
                "sku": sku,
                "count": 0,
                "last_ts": last_ts,
            }

        sku_summary[sku]["count"] += 1
        if last_ts and (
            not sku_summary[sku]["last_ts"]
            or last_ts > sku_summary[sku]["last_ts"]
        ):
            sku_summary[sku]["last_ts"] = last_ts

    current_items_by_sku = [
        {
            "sku": s["sku"],
            "count": s["count"],
            "last_movement": s["last_ts"].isoformat() if s["last_ts"] else None,
        }
        for s in sorted(
            sku_summary.values(),
            key=lambda x: x["count"],
            reverse=True,
        )
    ]

    # Derniers événements DisplaySaleEvent + SKU via display_product
    stmt_events = (
        select(DisplaySaleEvent, RfidTag, DisplayProduct, Product)
        .join(RfidTag, DisplaySaleEvent.rfid_tag_id == RfidTag.id)
        .join(RfidTagProductLink, RfidTagProductLink.epc == RfidTag.epc, isouter=True)
        .join(DisplayProduct, DisplayProduct.id == RfidTagProductLink.display_product_id, isouter=True)
        .join(Product, DisplaySaleEvent.product_id == Product.id, isouter=True)
        .where(DisplaySaleEvent.presentoir_id == presentoir.id)
        .order_by(desc(DisplaySaleEvent.occurred_at))
        .limit(50)
    )
    res_events = await session.execute(stmt_events)
    rows_events = res_events.all()

    events_payload: List[Dict[str, Any]] = []
    for ev, tag, dprod, prod in rows_events:
        sku = _pick_sku(dprod, prod, tag)
        events_payload.append(
            {
                "occurred_at": ev.occurred_at.isoformat() if ev.occurred_at else None,
                "event_type": ev.event_type.value,
                "sku": sku,
                "epc": tag.epc,
            }
        )

    return {
        "presentoir": {
            "id": presentoir.id,
            "code": presentoir.code,
            "name": presentoir.name,
            "last_seen_at": presentoir.last_seen_at.isoformat() if presentoir.last_seen_at else None,
            "current_num_products": presentoir.current_num_products or 0,
            "computed_status": live_status,
        },
        "current_items_by_sku": current_items_by_sku,
        "events": events_payload,
    }


@router.get("/api-zenhub/superuser/presentoirs/{presentoir_id}/live")
async def superuser_presentoir_live(
    presentoir_id: int,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    payload = await _build_presentoir_live_payload(session, presentoir_id)
    return {"status": "ok", **payload}
