# app/routers/superuser_presentoir_tagging_api.py
from __future__ import annotations

from typing import Any, List, Optional, Dict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func

from app.db.session import get_async_session
from app.db.models import (
    Presentoir,
    RfidTag,
    DisplayItem,
    RfidTagProductLink,
    DisplayProduct,
)
from app.core.security import require_role

router = APIRouter(
    prefix="/api-zenhub/superuser/presentoirs",
    tags=["superuser-presentoir-tagging"],
)

# =========================================================
#                   SCHEMAS
# =========================================================

class ScanTagItemOut(BaseModel):
    epc: str
    last_seen_at: Optional[datetime] = None
    already_linked: bool = False
    linked_display_product_id: Optional[int] = None
    linked_display_product_sku: Optional[str] = None


class ScanTagsResponse(BaseModel):
    presentoir_id: int
    total: int
    free_count: int
    linked_count: int
    items: List[ScanTagItemOut]


class AssignProductBulkPayload(BaseModel):
    display_product_id: int = Field(..., ge=1)
    epcs: List[str] = Field(default_factory=list)
    overwrite_existing_links: bool = False
    create_missing_tags: bool = True


# =========================================================
#                   SCAN TAGS PRESENTS
# =========================================================

@router.get("/{presentoir_id}/scan-tags", response_model=ScanTagsResponse)
async def scan_tags_present(
    presentoir_id: int,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    """
    Retourne les tags *actuellement présents* sur le présentoir
    (basé sur DisplayItem actifs), + info si déjà attribués à un display_product.
    """
    presentoir = await session.get(Presentoir, presentoir_id)
    if not presentoir:
        raise HTTPException(status_code=404, detail="Présentoir introuvable")

    # 1) EPC présents = DisplayItem actifs -> RfidTag.epc
    stmt = (
        select(RfidTag.epc, RfidTag.last_seen_at)
        .select_from(DisplayItem)
        .join(RfidTag, DisplayItem.rfid_tag_id == RfidTag.id)
        .where(
            DisplayItem.presentoir_id == presentoir_id,
            DisplayItem.unloaded_at.is_(None),
            DisplayItem.is_active.is_(True),
        )
        .order_by(RfidTag.last_seen_at.desc().nullslast(), RfidTag.epc.asc())
    )
    res = await session.execute(stmt)
    rows = res.all()

    epcs = [r.epc for r in rows]
    last_seen_by_epc: Dict[str, Optional[datetime]] = {r.epc: r.last_seen_at for r in rows}

    if not epcs:
        return ScanTagsResponse(
            presentoir_id=presentoir_id,
            total=0,
            free_count=0,
            linked_count=0,
            items=[],
        )

    # 2) liens existants EPC -> display_product
    stmt_links = (
        select(
            RfidTagProductLink.epc,
            RfidTagProductLink.display_product_id,
            DisplayProduct.sku,
        )
        .select_from(RfidTagProductLink)
        .join(DisplayProduct, DisplayProduct.id == RfidTagProductLink.display_product_id)
        .where(RfidTagProductLink.epc.in_(epcs))
    )
    res2 = await session.execute(stmt_links)
    link_rows = res2.all()

    link_by_epc: Dict[str, Dict[str, Any]] = {}
    for epc, dp_id, dp_sku in link_rows:
        link_by_epc[epc] = {
            "display_product_id": dp_id,
            "sku": dp_sku,
        }

    items: List[ScanTagItemOut] = []
    linked_count = 0

    for epc in epcs:
        link = link_by_epc.get(epc)
        already_linked = bool(link)
        if already_linked:
            linked_count += 1

        items.append(
            ScanTagItemOut(
                epc=epc,
                last_seen_at=last_seen_by_epc.get(epc),
                already_linked=already_linked,
                linked_display_product_id=link["display_product_id"] if link else None,
                linked_display_product_sku=link["sku"] if link else None,
            )
        )

    total = len(items)
    free_count = total - linked_count

    return ScanTagsResponse(
        presentoir_id=presentoir_id,
        total=total,
        free_count=free_count,
        linked_count=linked_count,
        items=items,
    )


# =========================================================
#               ASSIGN BULK
# =========================================================

@router.post("/{presentoir_id}/assign-product-bulk")
async def assign_product_bulk(
    presentoir_id: int,
    payload: AssignProductBulkPayload,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    # Vérif présentoir
    presentoir = await session.get(Presentoir, presentoir_id)
    if not presentoir:
        raise HTTPException(status_code=404, detail="Présentoir introuvable")

    epcs = [e.strip() for e in (payload.epcs or []) if (e or "").strip()]
    if not epcs:
        return {
            "status": "ok",
            "assigned": 0,
            "overwritten": 0,
            "skipped_existing": 0,
            "created_tags": 0,
            "created_display_items": 0,
        }

    # Récup tags existants
    res = await session.execute(select(RfidTag).where(RfidTag.epc.in_(epcs)))
    tags_by_epc = {t.epc: t for t in res.scalars().all()}

    created_tags = 0
    created_display_items = 0
    overwritten = 0
    skipped_existing = 0
    assigned = 0

    now = datetime.now(timezone.utc)

    # Charger links existants (epc -> link)
    res_links = await session.execute(
        select(RfidTagProductLink).where(RfidTagProductLink.epc.in_(epcs))
    )
    links_by_epc = {l.epc: l for l in res_links.scalars().all()}

    # Préparer map rfid_tag_id -> epc
    tag_id_to_epc = {t.id: t.epc for t in tags_by_epc.values() if t.id}

    # Charger DisplayItem actifs existants pour ce présentoir (pour éviter de recréer)
    active_item_by_epc: Dict[str, DisplayItem] = {}
    if tag_id_to_epc:
        res_items = await session.execute(
            select(DisplayItem)
            .where(
                DisplayItem.presentoir_id == presentoir_id,
                DisplayItem.unloaded_at.is_(None),
                DisplayItem.is_active.is_(True),
                DisplayItem.rfid_tag_id.in_(list(tag_id_to_epc.keys())),
            )
        )
        for di in res_items.scalars().all():
            epc = tag_id_to_epc.get(di.rfid_tag_id)
            if epc:
                active_item_by_epc[epc] = di

    # Transaction applicative
    for epc in epcs:
        tag = tags_by_epc.get(epc)

        # 1) créer tag si manquant
        if not tag:
            if not payload.create_missing_tags:
                continue
            tag = RfidTag(epc=epc)
            session.add(tag)
            await session.flush()  # récup id
            tags_by_epc[epc] = tag
            created_tags += 1

        # 2) lier EPC -> display_product_id
        existing_link = links_by_epc.get(epc)
        if existing_link:
            if existing_link.display_product_id != payload.display_product_id:
                if payload.overwrite_existing_links:
                    existing_link.display_product_id = payload.display_product_id
                    overwritten += 1
                    assigned += 1
                else:
                    skipped_existing += 1
            else:
                skipped_existing += 1
        else:
            session.add(
                RfidTagProductLink(
                    epc=epc,
                    display_product_id=payload.display_product_id,
                    linked_at=now,
                )
            )
            assigned += 1

        # 3) s'assurer DisplayItem actif présent
        if epc not in active_item_by_epc:
            session.add(
                DisplayItem(
                    presentoir_id=presentoir_id,
                    rfid_tag_id=tag.id,
                    loaded_at=now,
                    unloaded_at=None,
                    is_active=True,
                )
            )
            created_display_items += 1

    await session.commit()

    return {
        "status": "ok",
        "assigned": assigned,
        "overwritten": overwritten,
        "skipped_existing": skipped_existing,
        "created_tags": created_tags,
        "created_display_items": created_display_items,
    }
