# app/services/agent_orders_csv_import.py
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, date
from decimal import Decimal
from io import StringIO
from typing import Any, Dict, List, Optional

import csv
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    Agent,
    Client,
    LaboClient,
    Order,
    OrderItem,
    labo_agent,
)


def parse_date_safe(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            pass
    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        return None


def parse_decimal_safe(v: Any) -> Decimal:
    if v is None or v == "":
        return Decimal("0")
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v))
    s = str(v).replace(",", ".").strip()
    try:
        return Decimal(s)
    except Exception:
        return Decimal("0")


def normalize_agent_key(raw: Any) -> Optional[str]:
    if not raw:
        return None
    s = str(raw).strip().lower()
    return s or None


def normalize_code_client(v: Any) -> Optional[str]:
    if not v:
        return None
    s = str(v).strip().lower()
    return s or None


async def build_agent_index_for_labo(labo_id: int, session: AsyncSession) -> Dict[str, Agent]:
    res = await session.execute(
        select(Agent)
        .join(labo_agent, labo_agent.c.agent_id == Agent.id)
        .where(labo_agent.c.labo_id == labo_id)
    )
    agents = res.scalars().all()

    index: Dict[str, Agent] = {}
    for ag in agents:
        ln = (ag.lastname or "").strip().lower()
        fn = (ag.firstname or "").strip().lower()
        if ln:
            index[ln] = ag
        if fn and ln:
            index[f"{fn} {ln}"] = ag
    return index


async def build_client_index_for_labo(labo_id: int, session: AsyncSession) -> Dict[str, Client]:
    res = await session.execute(
        select(LaboClient, Client)
        .join(Client, Client.id == LaboClient.client_id)
        .where(LaboClient.labo_id == labo_id)
    )
    rows = res.all()

    index: Dict[str, Client] = {}
    for lc, c in rows:
        if lc.code_client:
            key = lc.code_client.strip().lower()
            if key:
                index[key] = c
    return index


async def import_agent_orders_from_csv_bytes(
    session: AsyncSession,
    labo_id: int,
    csv_bytes: bytes,
    filename: str | None = None,
    encoding: str = "utf-8",
    delimiter: str = ";",
) -> Dict[str, Any]:
    """
    Import / mise à jour des commandes agents pour un labo depuis un CSV.

    ⚠️ AUCUN TRUNCATE / DELETE global.
    On ne fait que :
      - INSERT si (labo_id, order_number) n'existe pas
      - UPDATE + remplacement des lignes pour CETTE commande si elle existe.
    """
    try:
        text = csv_bytes.decode(encoding, errors="replace")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erreur d'encodage du CSV {filename or ''} : {e}")

    reader = csv.DictReader(StringIO(text), delimiter=delimiter)
    header = reader.fieldnames or []

    required = [
        "order_number", "company_name", "order_date", "delivery_date",
        "agent", "sku", "qty", "unit_ht", "code_client",
    ]
    missing = [c for c in required if c not in header]
    if missing:
        raise HTTPException(status_code=400, detail=f"Colonnes manquantes dans le CSV {filename or ''} : {missing}")

    has_comment = "comment" in header

    total_rows = 0
    skipped_rows = 0
    errors: List[str] = []
    grouped: dict[str, list[dict]] = defaultdict(list)

    for row in reader:
        total_rows += 1
        order_number = (row.get("order_number") or "").strip()
        if not order_number:
            skipped_rows += 1
            errors.append(f"L{total_rows+1} ({filename or ''}): order_number vide → ignorée")
            continue

        grouped[order_number].append({
            "order_number": order_number,
            "company_name": row.get("company_name"),
            "order_date": row.get("order_date"),
            "delivery_date": row.get("delivery_date"),
            "agent_raw": row.get("agent"),
            "sku": row.get("sku"),
            "qty": row.get("qty"),
            "unit_ht": row.get("unit_ht"),
            "code_client_raw": row.get("code_client"),
            "comment": row.get("comment") if has_comment else None,
        })

    agent_index = await build_agent_index_for_labo(labo_id, session)
    client_index = await build_client_index_for_labo(labo_id, session)

    created_orders = 0
    updated_orders = 0
    summaries = []

    for order_number, rows in grouped.items():
        sample = rows[0]

        agent_key = normalize_agent_key(sample["agent_raw"])
        agent = agent_index.get(agent_key)
        if not agent:
            errors.append(f"{order_number} ({filename or ''}): agent '{sample['agent_raw']}' introuvable → ignoré")
            skipped_rows += len(rows)
            continue

        cc_key = normalize_code_client(sample["code_client_raw"])
        client = client_index.get(cc_key)
        if not client:
            errors.append(f"{order_number} ({filename or ''}): client '{sample['code_client_raw']}' introuvable → ignoré")
            skipped_rows += len(rows)
            continue

        od = parse_date_safe(sample["order_date"])
        dd = parse_date_safe(sample["delivery_date"])

        res = await session.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(Order.labo_id == labo_id, Order.order_number == order_number)
        )
        order = res.scalar_one_or_none()

        if order:
            updated_orders += 1
            order.items.clear()
        else:
            order = Order(labo_id=labo_id, order_number=order_number)
            session.add(order)
            created_orders += 1

        order.agent_id = agent.id
        order.client_id = client.id
        order.client_name = sample["company_name"] or client.company_name
        order.order_date = od
        order.delivery_date = dd
        order.currency = "EUR"
        order.comment = sample["comment"]

        total_ht = Decimal("0")

        for r in rows:
            sku = (r["sku"] or "").strip()
            if not sku:
                errors.append(f"{order_number} ({filename or ''}): ligne sans SKU → ignorée")
                skipped_rows += 1
                continue

            qty = int(r["qty"] or 0)
            unit_ht = parse_decimal_safe(r["unit_ht"])
            line_ht = unit_ht * qty
            total_ht += line_ht

            item = OrderItem(
                product_id=None,
                sku=sku,
                ean13=None,
                qty=qty,
                unit_ht=unit_ht,
                price_ht=line_ht,
                total_ht=line_ht,
                line_ht=line_ht,
            )
            order.items.append(item)

        order.total_ht = total_ht
        order.total_ttc = total_ht

        summaries.append(
            {
                "order_number": order_number,
                "client_id": client.id,
                "agent_id": agent.id,
                "total_ht": float(total_ht),
            }
        )

    await session.commit()

    return {
        "labo_id": labo_id,
        "total_rows": total_rows,
        "created_orders": created_orders,
        "updated_orders": updated_orders,
        "skipped_rows": skipped_rows,
        "errors": errors,
        "orders": summaries,
        "source_filename": filename,
    }
