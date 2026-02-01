from __future__ import annotations

from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_session
from app.db.models import (
    Order,
    OrderItem,
    Product,
    OrderStatus,
    Client,
    Labo,
    Agent,
)
from app.schemas import OrderIn, OrderOut, OrderItemOut, OrderItemIn, OrderStatusPatch
from app.services.orders import recompute_totals

# PDF / reportlab
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

router = APIRouter(prefix="/orders", tags=["orders"])


def _to_item_out(i: OrderItem) -> OrderItemOut:
    return OrderItemOut(
        id=i.id,
        product_id=i.product_id,
        sku=i.sku,
        ean13=i.ean13,
        qty=i.qty,
        unit_ht=float(i.unit_ht),
        line_ht=float(i.line_ht),
    )


def _to_order_out(o: Order) -> OrderOut:
    return OrderOut(
        id=o.id,
        labo_id=o.labo_id,
        customer_id=o.customer_id,
        agent_id=o.agent_id,
        currency=o.currency,
        status=o.status.value,
        total_ht=float(o.total_ht),
        total_ttc=float(o.total_ttc),
        items=[_to_item_out(i) for i in o.items],
    )


@router.get("", response_model=list[OrderOut])
async def list_orders(
    labo_id: int | None = None,
    customer_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_session),
):
    stmt = (
        select(Order)
        .offset(offset)
        .limit(limit)
        .order_by(Order.id.desc())
    )
    if labo_id:
        stmt = stmt.where(Order.labo_id == labo_id)
    if customer_id:
        stmt = stmt.where(Order.customer_id == customer_id)
    res = (await db.execute(stmt)).scalars().unique().all()
    return [_to_order_out(o) for o in res]


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(order_id: int, db: AsyncSession = Depends(get_session)):
    o = await db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Order not found")
    # s'assure que items sont chargés via relationship
    await db.refresh(o)
    return _to_order_out(o)


@router.post("", response_model=OrderOut, status_code=201)
async def create_order(payload: OrderIn, db: AsyncSession = Depends(get_session)):
    # créer l'entête
    o = Order(
        labo_id=payload.labo_id,
        customer_id=payload.customer_id,
        agent_id=payload.agent_id,
        currency=payload.currency,
        status=OrderStatus.draft,
        total_ht=0,
        total_ttc=0,
    )
    db.add(o)
    await db.flush()  # obtient o.id

    # lignes si fournies (sans variantes)
    for it in payload.items:
        p = await db.get(Product, it.product_id)
        if not p:
            raise HTTPException(400, f"Unknown product_id={it.product_id}")

        line_ht = round(it.qty * it.unit_ht, 2)
        db.add(
            OrderItem(
                order_id=o.id,
                product_id=p.id,
                sku=it.sku,
                ean13=it.ean13,
                qty=it.qty,
                unit_ht=it.unit_ht,
                line_ht=line_ht,
            )
        )

    await recompute_totals(db, o.id)
    await db.commit()
    await db.refresh(o)
    return _to_order_out(o)


@router.post("/{order_id}/items", response_model=OrderOut)
async def add_item(order_id: int, item: OrderItemIn, db: AsyncSession = Depends(get_session)):
    o = await db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Order not found")
    if o.status not in (OrderStatus.draft, OrderStatus.pending):
        raise HTTPException(400, "Order is not editable in this status")

    p = await db.get(Product, item.product_id)
    if not p:
        raise HTTPException(400, f"Unknown product_id={item.product_id}")

    line_ht = round(item.qty * item.unit_ht, 2)
    db.add(
        OrderItem(
            order_id=o.id,
            product_id=p.id,
            sku=item.sku,
            ean13=item.ean13,
            qty=item.qty,
            unit_ht=item.unit_ht,
            line_ht=line_ht,
        )
    )
    await recompute_totals(db, o.id)
    await db.commit()
    await db.refresh(o)
    return _to_order_out(o)


@router.patch("/{order_id}/status", response_model=OrderOut)
async def patch_status(order_id: int, body: OrderStatusPatch, db: AsyncSession = Depends(get_session)):
    o = await db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Order not found")
    o.status = OrderStatus(body.status)
    await db.flush()
    await db.commit()
    await db.refresh(o)
    return _to_order_out(o)


# =====================================================================
#  PDF bon de commande
#  GET /api-zenhub/orders/{order_id}/pdf
# =====================================================================

@router.get("/{order_id}/pdf")
async def order_pdf(
    order_id: int,
    db: AsyncSession = Depends(get_session),
):
    """
    Génère le PDF du bon de commande.
    Utilise Order + Client + Labo + Agent + OrderItem + Product.
    """

    # ---- Entête commande + labo + agent + client (table CLIENT, pas CUSTOMER) ----
    stmt = (
        select(Order, Client, Labo, Agent)
        .join(Client, Client.id == Order.client_id, isouter=True)
        .join(Labo, Labo.id == Order.labo_id, isouter=True)
        .join(Agent, Agent.id == Order.agent_id, isouter=True)
        .where(Order.id == order_id)
    )

    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Commande introuvable")

    order, client, labo, agent = row

    # ---- Lignes produits ----
    lines_q = (
        select(OrderItem, Product)
        .join(Product, Product.id == OrderItem.product_id, isouter=True)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id.asc())
    )
    lines_rows = (await db.execute(lines_q)).all()

    items = []

    # On recalcule les totaux à partir des lignes et de Product.vat_rate
    total_ht = 0.0
    total_tva = 0.0

    for oi, prod in lines_rows:
        sku = oi.sku or (prod.sku if prod else "")
        name = getattr(prod, "name", "") or ""
        qty = oi.qty
        unit_ht = float(oi.unit_ht or 0)
        line_ht = float(oi.line_ht or 0)

        # <-- Taux de TVA pris sur le produit
        vat_rate = float(getattr(prod, "vat_rate", 0) or 0)
        line_tva = line_ht * vat_rate / 100.0

        total_ht += line_ht
        total_tva += line_tva

        items.append(
            [
                sku,
                name,
                qty,
                f"{unit_ht:.2f}",
                f"{vat_rate:.0f} %",
                f"{line_ht:.2f}",
            ]
        )

    total_ttc = total_ht + total_tva


    # ---- Construction du PDF ----
    buff = BytesIO()
    doc = SimpleDocTemplate(
        buff,
        pagesize=A4,
        leftMargin=30,
        rightMargin=30,
        topMargin=30,
        bottomMargin=30,
    )
    styles = getSampleStyleSheet()
    story = []

    # En-tête labo + agent
    labo_name = labo.name if labo else "Labo"
    story.append(Paragraph(f"<b>{labo_name}</b>", styles["Title"]))

    agent_label = ""
    if agent:
        agent_label = f"{(agent.firstname or '')} {(agent.lastname or '')}".strip()
        if not agent_label:
            agent_label = agent.email or ""
    if agent_label:
        story.append(Paragraph(f"Agent : {agent_label}", styles["Normal"]))
    story.append(Spacer(1, 12))

    # Bloc client (table CLIENT)
    if client:
        client_lines = [f"<b>Client</b> : {client.company_name or ''}"]
        contact = " ".join(filter(None, [client.first_name, client.last_name]))
        if contact:
            client_lines.append(f"Contact : {contact}")
        if client.address1:
            client_lines.append(client.address1)
        cp_ville = " ".join(filter(None, [client.postcode, client.city]))
        if cp_ville:
            client_lines.append(cp_ville)
        if client.phone:
            client_lines.append(f"Téléphone : {client.phone}")
        if client.email:
            client_lines.append(f"Email : {client.email}")

        for line in client_lines:
            story.append(Paragraph(line, styles["Normal"]))
        story.append(Spacer(1, 12))

    # Infos commande
    order_num = order.order_number or str(order.id)
    story.append(Paragraph(f"<b>Bon de commande n° {order_num}</b>", styles["Heading2"]))

    if getattr(order, "order_date", None):
        story.append(
            Paragraph(
                f"Date de commande : {order.order_date.strftime('%d/%m/%Y')}",
                styles["Normal"],
            )
        )
    if getattr(order, "delivery_date", None):
        story.append(
            Paragraph(
                f"Date de livraison : {order.delivery_date.strftime('%d/%m/%Y')}",
                styles["Normal"],
            )
        )
    story.append(Spacer(1, 12))

    # Tableau produits
    data = [["Code", "Désignation", "Qté", "PU HT", "TVA", "Total HT"]] + items

    table = Table(data, colWidths=[70, 230, 40, 60, 40, 70])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.black),
                ("ALIGN", (2, 1), (5, -1), "RIGHT"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 12))

    # Totaux
    story.append(Paragraph(f"Total HT : <b>{total_ht:.2f} €</b>", styles["Normal"]))
    story.append(Paragraph(f"Total TVA : <b>{total_tva:.2f} €</b>", styles["Normal"]))
    story.append(Paragraph(f"Total TTC : <b>{total_ttc:.2f} €</b>", styles["Normal"]))

    doc.build(story)
    buff.seek(0)

    filename = f"bon_commande_{order_num}.pdf"
    return StreamingResponse(
        buff,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
