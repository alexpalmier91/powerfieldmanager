# app/routers/agent_orders_pdf.py
from __future__ import annotations

from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import (
    Agent,
    Order,
    OrderItem,
    Product,
    Client,
    Labo,
    DeliveryAddress,
)

from app.routers.agent_clients import get_current_agent
from app.services.labo_pdf import render_agent_order_pdf

router = APIRouter(prefix="/api-zenhub/agent/orders", tags=["agent-orders-pdf"])


def _agent_display_name(agent: Agent) -> str:
    fn = (getattr(agent, "firstname", None) or "").strip()
    ln = (getattr(agent, "lastname", None) or "").strip()
    full = f"{fn} {ln}".strip()
    return full or (getattr(agent, "email", None) or "Agent")


@router.get(
    "/{order_id}/pdf",
    response_class=Response,
    include_in_schema=False,
)
async def agent_order_pdf(
    order_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent: Agent = Depends(get_current_agent),
):
    # 1) Charger la commande (sécurité agent)
    order_stmt = select(Order).where(
        Order.id == order_id,
        Order.agent_id == agent.id,
    )
    order = (await session.scalars(order_stmt)).first()
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable.")

    # 2) Charger client + labo
    if not order.client_id:
        raise HTTPException(status_code=400, detail="Commande sans client associé.")
    client = await session.get(Client, order.client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client introuvable.")

    labo = await session.get(Labo, order.labo_id)
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable.")

    # 3) Adresse de livraison (default) -> fallback client
    delivery = client
    delivery_stmt = (
        select(DeliveryAddress)
        .where(
            DeliveryAddress.client_id == client.id,
            DeliveryAddress.is_default.is_(True),
        )
        .order_by(DeliveryAddress.updated_at.desc().nullslast(), DeliveryAddress.id.desc())
        .limit(1)
    )
    delivery_row = (await session.scalars(delivery_stmt)).first()
    if delivery_row:
        delivery = delivery_row

    # 4) Lignes : join Product
    items_stmt = (
        select(OrderItem, Product)
        .select_from(OrderItem)
        .join(Product, Product.id == OrderItem.product_id)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id.asc())
    )
    rows = (await session.execute(items_stmt)).all()

    pdf_items: List[dict] = []
    for oi, p in rows:
        vat_rate = getattr(p, "vat_rate", None)
        if vat_rate is None:
            vat_rate = Decimal("0")

        line_total_ht = getattr(oi, "line_ht", None)
        if line_total_ht is None:
            line_total_ht = oi.total_ht

        pdf_items.append(
            {
                "sku": p.sku,
                "product_name": p.name,
                "qty": oi.qty,
                "unit_ht": oi.unit_ht,
                "total_ht": line_total_ht,
                "vat_rate": vat_rate,
            }
        )

    # ✅ 5) Nom agent (à afficher sous le numéro)
    agent_name = _agent_display_name(agent)

    # 6) Générer PDF
    try:
        pdf_bytes = render_agent_order_pdf(
            doc=order,
            items=pdf_items,
            client=client,
            labo=labo,
            delivery=delivery,
            agent_name=agent_name,  # ✅ NOUVEAU
        )
    except TypeError:
        # Sécurité si ton service n'est pas encore modifié
        raise HTTPException(
            status_code=500,
            detail="Le service PDF ne supporte pas encore agent_name. Modifie app/services/labo_pdf.py (voir patch).",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur génération PDF: {exc}")

    filename = f"Bon-de-commande-{order.order_number or order.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
