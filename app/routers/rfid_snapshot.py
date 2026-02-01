# app/routers/rfid_snapshot.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import (
    Presentoir,
    Client,
    RfidTag,
    DisplayItem,
    DisplayAssignment,
    DisplaySaleEvent,
    RfidTagStatus,
    DisplaySaleEventType,
    Product,
    PresentoirEvent,  # ✅ AJOUT
)
# Si tu veux sécuriser avec un rôle / token plus tard :
# from app.core.security import require_role

router = APIRouter(
    prefix="/api-zenhub/rfid",
    tags=["rfid-snapshot"],
    # dependencies=[Depends(require_role(["SUPERUSER", "SUPERADMIN"]))],  # à activer si tu veux protéger
)


# ===================== SCHEMAS =====================

class RfidSnapshotPayload(BaseModel):
    hardware_id: str = Field(..., description="Identifiant hardware du présentoir (code)")
    tags: List[str] = Field(default_factory=list, description="Liste des EPC présents")
    captured_at: datetime = Field(..., description="Timestamp côté device (UTC de préférence)")


class RfidSnapshotResponse(BaseModel):
    status: str
    presentoir_id: int
    removed_count: int
    returned_count: int
    details: Dict[str, Any]


# ===================== HELPERS =====================

async def _get_presentoir_by_hardware_or_404(
    session: AsyncSession,
    hardware_id: str,
) -> Presentoir:
    """
    Pour l'instant on mappe hardware_id sur Presentoir.code
    (tu pourras ajouter un champ dédié si besoin).
    """
    result = await session.execute(
        select(Presentoir).where(Presentoir.code == hardware_id)
    )
    presentoir = result.scalar_one_or_none()
    if not presentoir:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Présentoir avec hardware_id/code='{hardware_id}' introuvable",
        )
    return presentoir


async def _get_active_assignment_for_ts(
    session: AsyncSession,
    presentoir_id: int,
    ts: datetime,
) -> Optional[DisplayAssignment]:
    result = await session.execute(
        select(DisplayAssignment).where(
            DisplayAssignment.presentoir_id == presentoir_id,
            DisplayAssignment.assigned_at <= ts,
            or_(
                DisplayAssignment.unassigned_at.is_(None),
                DisplayAssignment.unassigned_at > ts,
            ),
        )
    )
    return result.scalar_one_or_none()


async def _get_current_epc_state_for_presentoir(
    session: AsyncSession,
    presentoir_id: int,
) -> Dict[str, Dict[str, Any]]:
    """
    Retourne un dict:
    epc -> {
      "tag": RfidTag,
      "display_item": DisplayItem | None
    }
    pour tous les tags actuellement 'présents' (DisplayItem actif).
    """
    # jointure DisplayItem + RfidTag
    stmt = (
        select(DisplayItem, RfidTag)
        .join(RfidTag, DisplayItem.rfid_tag_id == RfidTag.id)
        .where(
            DisplayItem.presentoir_id == presentoir_id,
            DisplayItem.unloaded_at.is_(None),
            DisplayItem.is_active.is_(True),
        )
    )
    result = await session.execute(stmt)
    rows = result.all()

    epc_state: Dict[str, Dict[str, Any]] = {}
    for di, tag in rows:
        epc_state[tag.epc] = {"tag": tag, "display_item": di}
    return epc_state


async def _insert_presentoir_snapshot_events(
    session: AsyncSession,
    presentoir_id: int,
    epcs: List[str],
    ts_device: datetime,
):
    """
    ✅ IMPORTANT :
    On écrit une trace dans presentoir_events à chaque snapshot,
    sinon la page 'Taguer les produits' (scan) verra 0 tag.

    event_type est limité à 10 chars dans ton modèle -> on utilise "SNAP".
    """
    clean_epcs = []
    for e in epcs or []:
        e = (e or "").strip()
        if e:
            clean_epcs.append(e)

    if not clean_epcs:
        return

    # Essayer de retrouver le SKU depuis rfid_tag (si déjà connu)
    res = await session.execute(
        select(RfidTag.epc, RfidTag.sku).where(RfidTag.epc.in_(clean_epcs))
    )
    sku_by_epc = {row.epc: row.sku for row in res.all()}

    now_utc = datetime.now(timezone.utc)

    # Insert 1 ligne par EPC (snapshot)
    for epc in clean_epcs:
        session.add(
            PresentoirEvent(
                presentoir_id=presentoir_id,
                epc=epc,
                sku=sku_by_epc.get(epc),
                event_type="SNAP",
                ts_device=ts_device,
                ts_received=now_utc,
            )
        )


# ===================== ENDPOINT SNAPSHOT =====================

@router.post(
    "/snapshot",
    response_model=RfidSnapshotResponse,
)
async def receive_rfid_snapshot(
    payload: RfidSnapshotPayload,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Reçoit un snapshot de tags présents sur le présentoir.

    - Compare avec l'état actuel (DisplayItem actifs)
    - EPC disparus => event 'removal' (vente/retrait)
    - EPC réapparus => event 'return'
    - ✅ En plus : écrit dans presentoir_events pour permettre le "scan" côté UI
    """
    presentoir = await _get_presentoir_by_hardware_or_404(
        session,
        payload.hardware_id,
    )

    snapshot_ts = payload.captured_at

    # 1) assignment actif à ce moment-là
    active_assignment = await _get_active_assignment_for_ts(
        session,
        presentoir_id=presentoir.id,
        ts=snapshot_ts,
    )
    pharmacy_id: Optional[int] = (
        active_assignment.pharmacy_id if active_assignment else presentoir.pharmacy_id
    )

    # 2) état actuel : tags 'vus' sur ce présentoir
    current_state = await _get_current_epc_state_for_presentoir(
        session,
        presentoir_id=presentoir.id,
    )
    current_epcs = set(current_state.keys())

    # 3) nouvel état d'après le snapshot
    new_epcs = set(payload.tags or [])

    # EPC disparus : présents avant, absents maintenant => 'removal'
    disappeared = current_epcs - new_epcs
    # EPC apparus : absents avant, présents maintenant => 'return' (ou première pose)
    appeared = new_epcs - current_epcs

    removed_count = 0
    returned_count = 0

    # 4) Gestion des EPC disparus => ventes/retraits
    for epc in disappeared:
        state = current_state.get(epc)
        if not state:
            continue

        tag: RfidTag = state["tag"]
        display_item: DisplayItem = state["display_item"]

        # On clôt le DisplayItem
        display_item.unloaded_at = snapshot_ts
        display_item.is_active = False

        # On crée un DisplaySaleEvent 'removal'
        product_id = tag.product_id
        unit_price_ht = None

        if product_id:
            prod_res = await session.execute(
                select(Product).where(Product.id == product_id)
            )
            product = prod_res.scalar_one_or_none()
            if product:
                unit_price_ht = product.price_ht

        sale_event = DisplaySaleEvent(
            presentoir_id=presentoir.id,
            pharmacy_id=pharmacy_id,
            rfid_tag_id=tag.id,
            product_id=product_id,
            event_type=DisplaySaleEventType.removal,
            occurred_at=snapshot_ts,
            unit_price_ht=unit_price_ht,
        )
        session.add(sale_event)

        # On marque le tag comme vendu (logique simple)
        tag.status = RfidTagStatus.sold
        tag.last_seen_at = snapshot_ts

        removed_count += 1

    # 5) Gestion des EPC apparus => 'return' (ou première fois)
    if appeared:
        res_tags = await session.execute(
            select(RfidTag).where(RfidTag.epc.in_(list(appeared)))
        )
        tags_by_epc = {t.epc: t for t in res_tags.scalars().all()}

        for epc in appeared:
            tag = tags_by_epc.get(epc)
            if not tag:
                # Tag inconnu : on le crée sans mapping produit pour l'instant
                tag = RfidTag(
                    epc=epc,
                    status=RfidTagStatus.loaded_on_display,
                    last_seen_at=snapshot_ts,
                )
                session.add(tag)
                await session.flush()
                tags_by_epc[epc] = tag
            else:
                # Tag existant : on le repasse en 'loaded_on_display'
                tag.status = RfidTagStatus.loaded_on_display
                tag.last_seen_at = snapshot_ts

            # On crée un DisplayItem actif
            new_display_item = DisplayItem(
                presentoir_id=presentoir.id,
                rfid_tag_id=tag.id,
                level_index=None,
                position_index=None,
                loaded_at=snapshot_ts,
                unloaded_at=None,
                is_active=True,
            )
            session.add(new_display_item)

            # On crée un event 'return'
            sale_event = DisplaySaleEvent(
                presentoir_id=presentoir.id,
                pharmacy_id=pharmacy_id,
                rfid_tag_id=tag.id,
                product_id=tag.product_id,
                event_type=DisplaySaleEventType.return_,
                occurred_at=snapshot_ts,
                unit_price_ht=None,
            )
            session.add(sale_event)

            returned_count += 1

    # ✅ 5bis) INSÉRER UN SNAPSHOT DANS presentoir_events (pour le scan UI)
    await _insert_presentoir_snapshot_events(
        session=session,
        presentoir_id=presentoir.id,
        epcs=list(new_epcs),
        ts_device=snapshot_ts,
    )

    # 6) Mise à jour du présentoir (last_seen_at / current_num_products)
    presentoir.last_seen_at = snapshot_ts
    presentoir.current_num_products = len(new_epcs)

    await session.commit()

    return RfidSnapshotResponse(
        status="ok",
        presentoir_id=presentoir.id,
        removed_count=removed_count,
        returned_count=returned_count,
        details={
            "disappeared_epcs": list(disappeared),
            "appeared_epcs": list(appeared),
        },
    )
