# app/routers/orders_pdf.py

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import Order, OrderItem, Client, Labo
from app.core.security import get_current_subject
from app.services.labo_pdf import (
    render_labo_invoice_pdf,
    render_labo_invoices_bulk_pdf,
)

router = APIRouter(
    prefix="/api-zenhub",
    tags=["orders.pdf"],
)


class BulkOrderPdfIn(BaseModel):
    order_ids: List[int]


async def _load_order_context(
    order_id: int,
    *,
    session: AsyncSession,
) -> Dict[str, Any]:
    """
    Charge une commande + client + labo + lignes,
    et renvoie le contexte attendu par labo_pdf.
    (On ne fait PAS de vérification poussée de droits ici,
    le simple fait d'avoir un JWT valide suffit.)
    """

    # --- 1) Commande + client + labo ---
    stmt = (
        select(Order, Client, Labo)
        .join(Client, Client.id == Order.client_id)
        .join(Labo, Labo.id == Order.labo_id)
        .where(Order.id == order_id)
    )
    res = await session.execute(stmt)
    row = res.one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail=f"Commande {order_id} introuvable")

    order, client, labo = row

    # --- 2) Lignes de commande ---
    items_stmt = (
        select(OrderItem)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id.asc())
    )
    items_res = await session.execute(items_stmt)
    lines = items_res.scalars().all()

    items: List[Dict[str, Any]] = []
    for it in lines:
        # Nom du produit : on essaie plusieurs colonnes possibles
        name_val = (
            getattr(it, "name", None)
            or getattr(it, "product_name", None)
            or getattr(it, "label", None)
            or getattr(it, "sku", None)
            or ""
        )

        # SKU / référence
        sku_val = (
            getattr(it, "sku", None)
            or getattr(it, "product_sku", None)
            or getattr(it, "reference", None)
        )

        vat_rate = getattr(it, "vat_rate", None) or 0

        items.append(
            {
                "sku": sku_val,
                "product_name": name_val,
                "qty": it.qty,
                "unit_ht": getattr(it, "unit_ht", 0),
                "total_ht": getattr(it, "line_ht", 0),
                "vat_rate": vat_rate,
            }
        )

    return {
        "doc": order,
        "items": items,
        "client": client,
        "labo": labo,
        "delivery": client,  # pour l’instant, même adresse que le client
    }


# ==========================================================
#   GET /api-zenhub/orders/{order_id}/pdf  (PDF unitaire)
# ==========================================================


@router.get("/orders/{order_id}/pdf")
async def order_pdf(
    order_id: int,
    subject: str = Depends(get_current_subject),  # juste pour vérifier le JWT
    session: AsyncSession = Depends(get_async_session),
):
    # subject n'est pas utilisé ici, mais force une auth JWT valide
    _ = subject

    ctx = await _load_order_context(order_id, session=session)
    pdf_bytes = render_labo_invoice_pdf(**ctx)

    order = ctx["doc"]
    number = getattr(order, "order_number", str(order_id))

    return Response(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="commande_{number}.pdf"'
        },
    )


# ==========================================================
#   POST /api-zenhub/orders/bulk-pdf  (PDF multi-commandes)
# ==========================================================


@router.post("/orders/bulk-pdf")
async def orders_bulk_pdf(
    body: BulkOrderPdfIn,
    subject: str = Depends(get_current_subject),  # JWT obligatoire
    session: AsyncSession = Depends(get_async_session),
):
    """
    Génère un seul PDF contenant toutes les commandes sélectionnées,
    une par page (ordre des IDs fourni).
    """
    _ = subject  # non utilisé, mais impose l'authentification

    if not body.order_ids:
        raise HTTPException(status_code=400, detail="order_ids vide")

    contexts: List[Dict[str, Any]] = []
    for oid in body.order_ids:
        ctx = await _load_order_context(oid, session=session)
        contexts.append(ctx)

    pdf_bytes = render_labo_invoices_bulk_pdf(contexts)

    return Response(
        pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="commandes_selection.pdf"'
        },
    )
