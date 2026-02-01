# app/services/labo_documents_export_csv.py
from __future__ import annotations

from datetime import date, datetime
from io import StringIO
from typing import Iterable, List, Sequence, Tuple, Optional

import csv
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    LaboDocument,
    LaboDocumentItem,
    Product,
    Client,
    LaboClient,
    Agent,
    DeliveryAddress,
)


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def _safe(v) -> str:
    if v is None:
        return ""
    return str(v)


def _format_date(d: Optional[date]) -> str:
    if not d:
        return ""
    if isinstance(d, (date, datetime)):
        return d.isoformat()
    return str(d)


# ---------------------------------------------------------
# Fetch des documents + jointures
# ---------------------------------------------------------

async def fetch_labo_documents_with_items(
    session: AsyncSession,
    document_ids: Sequence[int],
    labo_id: Optional[int] = None,
) -> List[
    Tuple[
        LaboDocument,
        LaboDocumentItem,
        Optional[Product],
        Optional[Client],
        Optional[LaboClient],
        Optional[Agent],
        Optional[DeliveryAddress],
    ]
]:
    """
    Retourne toutes les lignes nécessaires à l'export :
    (document, item, product, client, laboclient, agent, delivery_address)
    """

    if not document_ids:
        return []

    # Jointure LaboClient = code client
    lc_join = and_(
        LaboClient.client_id == LaboDocument.client_id,
        LaboClient.labo_id == LaboDocument.labo_id,
    )

    # Adresse de livraison par défaut
    da_join = and_(
        DeliveryAddress.client_id == LaboDocument.client_id,
        DeliveryAddress.is_default.is_(True),
    )

    stmt = (
        select(
            LaboDocument,
            LaboDocumentItem,
            Product,
            Client,
            LaboClient,
            Agent,
            DeliveryAddress,
        )
        .join(LaboDocumentItem, LaboDocumentItem.document_id == LaboDocument.id)
        .join(Product, Product.id == LaboDocumentItem.product_id, isouter=True)
        .join(Client, Client.id == LaboDocument.client_id, isouter=True)
        .join(LaboClient, lc_join, isouter=True)
        .join(Agent, Agent.id == LaboDocument.agent_id, isouter=True)
        .join(DeliveryAddress, da_join, isouter=True)
        .where(LaboDocument.id.in_(document_ids))
        .order_by(LaboDocument.order_number, LaboDocumentItem.id)
    )

    if labo_id is not None:
        stmt = stmt.where(LaboDocument.labo_id == labo_id)

    res = await session.execute(stmt)
    return list(res.all())


# ---------------------------------------------------------
# Construction du CSV EASY VRP (sans header)
# ---------------------------------------------------------

def build_easy_vrp_csv(
    rows: Iterable[
        Tuple[
            LaboDocument,
            LaboDocumentItem,
            Optional[Product],
            Optional[Client],
            Optional[LaboClient],
            Optional[Agent],
            Optional[DeliveryAddress],
        ]
    ],
) -> str:
    """
    Construit un CSV conforme au format EASY VRP.

    Ordre strict des colonnes :

    1  Numéro de commande
    2  Code client
    3  Nom société
    4  Adresse facturation
    5  Code postal fact.
    6  Ville fact.
    7  Adresse livraison
    8  Code postal liv.
    9  Ville liv.
    10 Date commande (AAAA-MM-JJ)
    11 Date livraison (AAAA-MM-JJ)
    12 Nom représentant
    13 SKU
    14 Nom produit
    15 Quantité
    16 Prix unitaire HT
    17 Remise %
    18 TVA %
    19 Commentaire
    """

    output = StringIO()
    writer = csv.writer(output, delimiter=";", lineterminator="\n")

    for (
        doc,
        item,
        product,
        client,
        laboclient,
        agent,
        delivery,
    ) in rows:

        # -------------------------
        # 1. Numéro commande
        # -------------------------
        numero_commande = _safe(doc.order_number)

        # -------------------------
        # 2. Code client
        # -------------------------
        code_client = _safe(laboclient.code_client if laboclient else "")

        # -------------------------
        # 3. Nom société
        # -------------------------
        nom_societe = _safe(
            (client.company_name if client else None)
            or doc.client_name
        )

        # -------------------------
        # Facturation (Client)
        # -------------------------
        addr_fact = _safe(client.address1 if client else "")
        cp_fact = _safe(client.postcode if client else "")
        ville_fact = _safe(client.city if client else "")

        # -------------------------
        # Livraison (DeliveryAddress si dispo)
        # -------------------------
        addr_liv = _safe(delivery.address1 if delivery else addr_fact)
        cp_liv = _safe(delivery.postcode if delivery else cp_fact)
        ville_liv = _safe(delivery.city if delivery else ville_fact)

        # -------------------------
        # 10. Dates
        # -------------------------
        date_commande = _format_date(doc.order_date)
        date_livraison = _format_date(doc.delivery_date)

        # -------------------------
        # 12. Nom du représentant
        # -------------------------
        if agent:
            fn = (agent.firstname or "").strip()
            ln = (agent.lastname or "").strip()
            nom_representant = (fn + " " + ln).strip()
        else:
            nom_representant = ""

        # -------------------------
        # 13-14. Produit
        # -------------------------
        sku = _safe(item.sku or (product.sku if product else ""))
        nom_produit = _safe(
            (product.name if product else None)
            or item.sku
        )

        # -------------------------
        # 15. Quantité
        # -------------------------
        quantite = _safe(item.qty)

        # -------------------------
        # 16. Prix unitaire HT
        # -------------------------
        prix_unit_ht = _safe(item.unit_ht)

        # -------------------------
        # 17. Remise %
        # -------------------------
        remise_val = (
            getattr(item, "discount_percent", None)
            or getattr(item, "discount_pct", None)
            or getattr(doc, "discount_percent", None)
            or getattr(doc, "discount_pct", None)
            or 0
        )
        remise_pct = _safe(remise_val)

        # -------------------------
        # 18. TVA %
        # -------------------------
        tva_val = product.vat_rate if product and hasattr(product, "vat_rate") else 0
        tva = _safe(tva_val)

        # -------------------------
        # 19. Commentaire
        # -------------------------
        commentaire = _safe(
            getattr(item, "comment", None)
            or getattr(doc, "comment", None)
        )

        # -------------------------
        # Écriture CSV
        # -------------------------
        writer.writerow(
            [
                numero_commande,
                code_client,
                nom_societe,
                addr_fact,
                cp_fact,
                ville_fact,
                addr_liv,
                cp_liv,
                ville_liv,
                date_commande,
                date_livraison,
                nom_representant,
                sku,
                nom_produit,
                quantite,
                prix_unit_ht,
                remise_pct,
                tva,
                commentaire,
            ]
        )

    return output.getvalue()
