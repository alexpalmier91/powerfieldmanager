from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db import models
from app.core.security import get_current_payload
from .agent_orders import ensure_agent_labo_scope, _role_name

from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from io import BytesIO
from datetime import datetime

router = APIRouter(prefix="/api-zenhub", tags=["orders.pdf"])


@router.get("/orders/{order_id}/pdf")
async def order_pdf(
    order_id: int,
    payload=Depends(get_current_payload),
    db: AsyncSession = Depends(get_session)
):
    """
    Génère le PDF du bon de commande.
    Accessible par :
    - agent (commande liée à son agent_id)
    - labo (commande liée à son labo_id)
    - superuser (toutes commandes)
    """

    # --- 1) Récupération user role ---
    email = payload.get("email")
    role = payload.get("role")
    is_superuser = _role_name(role).upper() == "SUPERUSER"

    # --- 2) Charge order + client + labo + agent ---
    row = (
        await db.execute(
            sa.select(models.Order, models.Client, models.Labo, models.Agent)
            .join(models.Client, models.Client.id == models.Order.client_id)
            .join(models.Labo, models.Labo.id == models.Order.labo_id)
            .join(models.Agent, models.Agent.id == models.Order.agent_id)
            .where(models.Order.id == order_id)
        )
    ).one_or_none()

    if not row:
        raise HTTPException(404, "Commande introuvable")

    order, client, labo, agent = row

    # --- 3) Vérification des droits ---
    if not is_superuser:
        # Si agent → il doit être lié
        if role == "AGENT":
            if agent.email != email:
                raise HTTPException(403, "Non autorisé")

        # Si labo → il doit être lié
        if role == "LABO":
            labos = (
                await db.execute(
                    sa.select(models.Labo.id)
                    .join(models.labo_agent, models.labo_agent.c.labo_id == models.Labo.id)
                    .join(models.Agent, models.Agent.id == models.labo_agent.c.agent_id)
                    .where(models.Labo.id == order.labo_id)
                )
            ).all()

            if not labos:
                raise HTTPException(403, "Non autorisé")

    # --- 4) Lignes produits ---
    lines = (
        await db.execute(
            sa.select(
                models.OrderItem.sku,
                models.OrderItem.qty,
                models.OrderItem.unit_ht,
                models.OrderItem.line_ht,
                models.Product.name
            )
            .join(models.Product, models.Product.id == models.OrderItem.product_id)
            .where(models.OrderItem.order_id == order_id)
            .order_by(models.OrderItem.id.asc())
        )
    ).all()

    # --- 5) Génération PDF ---
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    story = []

    styles = getSampleStyleSheet()
    h1 = styles["Heading1"]
    h2 = styles["Heading2"]
    normal = styles["Normal"]

    # ---------------------------------------------------------
    # HEADER LABO + AGENT
    # ---------------------------------------------------------
    story.append(Paragraph(f"<b>{labo.name}</b>", h1))
    story.append(Paragraph(f"Agent : {agent.email}", h2))
    story.append(Spacer(1, 12))

    # ---------------------------------------------------------
    # CLIENT
    # ---------------------------------------------------------
    story.append(Paragraph("<b>Client</b>", h2))
    story.append(Paragraph(client.company_name or "", normal))
    if client.first_name or client.last_name:
        story.append(Paragraph(f"Contact : {client.first_name or ''} {client.last_name or ''}", normal))

    story.append(Paragraph(client.address1 or "", normal))
    story.append(Paragraph(f"{client.postcode or ''} {client.city or ''}", normal))
    if client.phone:
        story.append(Paragraph(f"Téléphone : {client.phone}", normal))
    if client.email:
        story.append(Paragraph(f"Email : {client.email}", normal))

    story.append(Spacer(1, 20))

    # ---------------------------------------------------------
    # INFO COMMANDE
    # ---------------------------------------------------------
    story.append(Paragraph("<b>Informations commande</b>", h2))
    story.append(Paragraph(f"Numéro : {order.order_number}", normal))
    story.append(Paragraph(f"Date : {order.order_date or order.created_at.date()}", normal))
    story.append(Paragraph(f"Livraison : {order.delivery_date or '-'}", normal))
    story.append(Spacer(1, 20))

    # ---------------------------------------------------------
    # TABLE PRODUITS
    # ---------------------------------------------------------
    data = [["Code", "Désignation", "Qté", "Prix HT", "TVA", "Total HT"]]

    for sku, qty, unit_ht, line_ht, name in lines:
        data.append([
            sku,
            name,
            str(qty),
            f"{unit_ht:.2f} €",
            "20%",
            f"{line_ht:.2f} €",
        ])

    table = Table(data, colWidths=[70, 200, 40, 60, 40, 60])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT")
    ]))

    story.append(table)
    story.append(Spacer(1, 20))

    # ---------------------------------------------------------
    # TOTALS
    # ---------------------------------------------------------
    total_tva = float(order.total_ht) * 0.20
    total_ttc = float(order.total_ht) + total_tva

    story.append(Paragraph(f"<b>Total HT :</b> {order.total_ht:.2f} €", h2))
    story.append(Paragraph(f"<b>Total TVA :</b> {total_tva:.2f} €", h2))
    story.append(Paragraph(f"<b>Total TTC :</b> {total_ttc:.2f} €", h2))

    doc.build(story)

    buffer.seek(0)

    return Response(
        buffer.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename=commande_{order.order_number}.pdf"
        }
    )
