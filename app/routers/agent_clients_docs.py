# app/routers/agent_clients_docs.py
from __future__ import annotations
from typing import List, Optional, Tuple, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc
import csv
import io
from datetime import date, datetime

from app.db.session import get_async_session
from app.db.models import (
    Order, OrderItem,
    LaboDocument, LaboDocumentItem,
    Agent, Client, labo_agent
)
from app.core.security import get_current_user  # doit retourner un user dict/objet

router = APIRouter(prefix="/agent", tags=["agent: clients detail"])

# ---------- Utils sécurité & portée agent ----------

AGENT_ROLES = {"AGENT", "A"}
SUPERUSER_ROLES = {"SUPERUSER", "S"}

def _uget(u: Any, keys: List[str], default=None):
    """Récupère une valeur dans u (dict ou objet) en testant plusieurs clés/attributs."""
    for k in keys:
        if isinstance(u, dict):
            if k in u and u[k] is not None:
                return u[k]
        else:
            if hasattr(u, k):
                v = getattr(u, k)
                if v is not None:
                    return v
    return default

async def get_agent_scope(
    session: AsyncSession = Depends(get_async_session),
    user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Supporte user en dict (payload JWT) ou en objet ORM.
    Retourne:
      - is_superuser: bool
      - agent_id: int | None
      - allowed_labo_ids: set[int]
    """
    # role peut s'appeler role / Role / user_role ...
    role_raw = _uget(user, ["role", "Role", "ROLE", "user_role", "r", "R"], "")
    role = str(role_raw or "").upper()
    is_superuser = role in SUPERUSER_ROLES

    if is_superuser:
        return {"is_superuser": True, "agent_id": None, "allowed_labo_ids": set()}

    if role not in AGENT_ROLES:
        raise HTTPException(status_code=403, detail="Rôle non autorisé")

    # agent_id peut s'appeler agent_id / agentId / agentID / agent / aid ...
    agent_id = _uget(user, ["agent_id", "agentId", "agentID", "agent", "aid"], None)

    if not agent_id:
        # fallback: retrouver via Agent.user_id
        user_id = _uget(user, ["id", "user_id", "uid", "sub"], None)
        if not user_id:
            raise HTTPException(status_code=403, detail="Utilisateur non identifié")
        q = await session.execute(select(Agent.id).where(Agent.user_id == user_id))
        row = q.first()
        if not row:
            raise HTTPException(status_code=403, detail="Agent introuvable pour cet utilisateur")
        agent_id = row[0]

    # Labos accessibles via table d’association
    q2 = await session.execute(
        select(labo_agent.c.labo_id).where(labo_agent.c.agent_id == agent_id)
    )
    allowed = {lid for (lid,) in q2.all()}

    return {"is_superuser": False, "agent_id": agent_id, "allowed_labo_ids": allowed}

# ---------- Aide commune filtres/pagination ----------

def normalize_period(df: Optional[str], dt: Optional[str]) -> Tuple[Optional[date], Optional[date]]:
    dfrom = date.fromisoformat(df) if df else None
    dto = date.fromisoformat(dt) if dt else None
    return dfrom, dto

def clamp_pagination(page: int, page_size: int, max_page_size: int = 100) -> Tuple[int, int]:
    page = max(1, page)
    page_size = min(max(1, page_size), max_page_size)
    return page, page_size

def rows_to_csv(headers: List[str], rows: List[Dict[str, Any]]) -> StreamingResponse:
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=headers, delimiter=";")
    writer.writeheader()
    for r in rows:
        writer.writerow({k: r.get(k, "") for k in headers})
    buf.seek(0)
    return StreamingResponse(
        iter([buf.read()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="export.csv"'},
    )

# ---------- Endpoints: ORDERS (commandes agent) ----------

@router.get("/clients/{client_id}/orders")
async def list_client_orders_for_agent(
    client_id: int,
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    min_total: Optional[float] = Query(None),
    max_total: Optional[float] = Query(None),
    search_number: Optional[str] = Query(None, alias="q"),
    page: int = Query(1),
    page_size: int = Query(25),
    export: Optional[str] = Query(None),
    scope=Depends(get_agent_scope),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Liste paginée filtrée des orders de l'agent connecté pour ce client.
    Réponse JSON:
      { total, page, page_size, items: [{id, order_number, order_date, status, total_ht, labo_id}] }
    Si ?export=csv -> CSV des résultats filtrés (sans pagination).
    """
    dfrom, dto = normalize_period(date_from, date_to)
    page, page_size = clamp_pagination(page, page_size)

    filters = [Order.client_id == client_id]
    # Filtrage portée agent
    if not scope["is_superuser"]:
        filters.append(Order.agent_id == scope["agent_id"])

    if status:
        filters.append(Order.status == status)
    if dfrom:
        filters.append(Order.order_date >= dfrom)
    if dto:
        filters.append(Order.order_date <= dto)
    if min_total is not None:
        filters.append(Order.total_ht >= min_total)
    if max_total is not None:
        filters.append(Order.total_ht <= max_total)
    if search_number:
        like = f"%{search_number}%"
        filters.append(Order.order_number.ilike(like))

    # Total
    q_count = await session.execute(select(func.count()).select_from(Order).where(and_(*filters)))
    total = q_count.scalar_one()

    # Data
    stmt = (
        select(
            Order.id,
            Order.order_number,
            Order.order_date,
            Order.status,
            Order.total_ht,
            Order.labo_id,
        )
        .where(and_(*filters))
        .order_by(desc(Order.order_date), desc(Order.id))
    )

    if export == "csv":
        rows = (await session.execute(stmt)).all()
        items = [
            {
                "id": rid,
                "order_number": onum,
                "order_date": (odt.isoformat() if isinstance(odt, (date, datetime)) else odt),
                "status": st,
                "total_ht": float(tot) if tot is not None else 0.0,
                "labo_id": lid,
            }
            for (rid, onum, odt, st, tot, lid) in rows
        ]
        headers = ["id", "order_number", "order_date", "status", "total_ht", "labo_id"]
        return rows_to_csv(headers, items)

    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(stmt)).all()
    items = [
        {
            "id": rid,
            "order_number": onum,
            "order_date": (odt.isoformat() if isinstance(odt, (date, datetime)) else odt),
            "status": st,
            "total_ht": float(tot) if tot is not None else 0.0,
            "labo_id": lid,
        }
        for (rid, onum, odt, st, tot, lid) in rows
    ]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }

@router.get("/orders/{order_id}")
async def get_order_detail(
    order_id: int,
    scope=Depends(get_agent_scope),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Détail d'une commande (entête + items) avec contrôle d'accès:
      - AGENT: order.agent_id == agent_id
      - SUPERUSER: libre
    """
    q = await session.execute(
        select(Order).where(Order.id == order_id)
    )
    order = q.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")

    if not scope["is_superuser"]:
        if order.agent_id != scope["agent_id"]:
            raise HTTPException(status_code=403, detail="Accès refusé")

    q_items = await session.execute(
        select(
            OrderItem.sku,
            OrderItem.name,
            OrderItem.qty,
            OrderItem.unit_ht,
            OrderItem.total_ht,
            OrderItem.ean13,
        ).where(OrderItem.order_id == order.id)
    )
    items = []
    for (sku, name, qty, unit_ht, total_ht, ean13) in q_items.all():
        items.append({
            "sku": sku,
            "name": name,
            "qty": float(qty) if qty is not None else 0,
            "unit_ht": float(unit_ht) if unit_ht is not None else 0.0,
            "total_ht": float(total_ht) if total_ht is not None else 0.0,
            "ean13": ean13,
        })

    head = {
        "id": order.id,
        "order_number": order.order_number,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "status": order.status,
        "total_ht": float(order.total_ht) if order.total_ht is not None else 0.0,
        "client_id": order.client_id,
        "agent_id": order.agent_id,
        "labo_id": order.labo_id,
    }
    return {"header": head, "items": items}

# ---------- Endpoints: LABO DOCUMENTS (BC/BL/FA) ----------

@router.get("/clients/{client_id}/labo-docs")
async def list_client_labo_docs_for_agent(
    client_id: int,
    type: Optional[str] = Query(None, description="BC|BL|FA"),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    min_total: Optional[float] = Query(None),
    max_total: Optional[float] = Query(None),
    search_number: Optional[str] = Query(None, alias="q"),
    page: int = Query(1),
    page_size: int = Query(25),
    export: Optional[str] = Query(None),
    scope=Depends(get_agent_scope),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Liste paginée filtrée des documents labo pour ce client,
    restreints aux labos liés à l’agent via labo_agent.
    Réponse JSON:
      { total, page, page_size, items: [{id, order_number, order_date, status, total_ht, labo_id, type}] }
    Si ?export=csv -> CSV complet (sans pagination).
    """
    dfrom, dto = normalize_period(date_from, date_to)
    page, page_size = clamp_pagination(page, page_size)

    filters = [LaboDocument.client_id == client_id]

    if type:
        filters.append(LaboDocument.type == type)
    if status:
        filters.append(LaboDocument.status == status)
    if dfrom:
        filters.append(LaboDocument.order_date >= dfrom)
    if dto:
        filters.append(LaboDocument.order_date <= dto)
    if min_total is not None:
        filters.append(LaboDocument.total_ht >= min_total)
    if max_total is not None:
        filters.append(LaboDocument.total_ht <= max_total)
    if search_number:
        like = f"%{search_number}%"
        filters.append(LaboDocument.order_number.ilike(like))

    # Restriction labos accessibles (sauf superuser)
    if not scope["is_superuser"]:
        if not scope["allowed_labo_ids"]:
            # Aucun labo rattaché -> aucun document
            return {"total": 0, "page": page, "page_size": page_size, "items": []}
        filters.append(LaboDocument.labo_id.in_(scope["allowed_labo_ids"]))

    # Total
    q_count = await session.execute(
        select(func.count()).select_from(LaboDocument).where(and_(*filters))
    )
    total = q_count.scalar_one()

    # Data
    stmt = (
        select(
            LaboDocument.id,
            LaboDocument.order_number,
            LaboDocument.order_date,
            LaboDocument.status,
            LaboDocument.total_ht,
            LaboDocument.labo_id,
            LaboDocument.type,
        )
        .where(and_(*filters))
        .order_by(desc(LaboDocument.order_date), desc(LaboDocument.id))
    )

    if export == "csv":
        rows = (await session.execute(stmt)).all()
        items = [
            {
                "id": rid,
                "order_number": onum,
                "order_date": (odt.isoformat() if isinstance(odt, (date, datetime)) else odt),
                "status": st,
                "total_ht": float(tot) if tot is not None else 0.0,
                "labo_id": lid,
                "type": tp,
            }
            for (rid, onum, odt, st, tot, lid, tp) in rows
        ]
        headers = ["id", "order_number", "order_date", "status", "total_ht", "labo_id", "type"]
        return rows_to_csv(headers, items)

    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(stmt)).all()
    items = [
        {
            "id": rid,
            "order_number": onum,
            "order_date": (odt.isoformat() if isinstance(odt, (date, datetime)) else odt),
            "status": st,
            "total_ht": float(tot) if tot is not None else 0.0,
            "labo_id": lid,
            "type": tp,
        }
        for (rid, onum, odt, st, tot, lid, tp) in rows
    ]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }

@router.get("/labo-docs/{document_id}")
async def get_labo_document_detail(
    document_id: int,
    scope=Depends(get_agent_scope),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Détail d’un document labo (entête + items),
    avec restriction aux labos rattachés à l’agent (sauf superuser).
    """
    q = await session.execute(select(LaboDocument).where(LaboDocument.id == document_id))
    doc = q.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")

    if not scope["is_superuser"]:
        if doc.labo_id not in scope["allowed_labo_ids"]:
            raise HTTPException(status_code=403, detail="Accès refusé")

    q_items = await session.execute(
        select(
            LaboDocumentItem.sku,
            LaboDocumentItem.name,
            LaboDocumentItem.qty,
            LaboDocumentItem.unit_ht,
            LaboDocumentItem.total_ht,
            LaboDocumentItem.ean13,
        ).where(LaboDocumentItem.document_id == doc.id)
    )
    items = []
    for (sku, name, qty, unit_ht, total_ht, ean13) in q_items.all():
        items.append({
            "sku": sku,
            "name": name,
            "qty": float(qty) if qty is not None else 0,
            "unit_ht": float(unit_ht) if unit_ht is not None else 0.0,
            "total_ht": float(total_ht) if total_ht is not None else 0.0,
            "ean13": ean13,
        })

    head = {
        "id": doc.id,
        "order_number": doc.order_number,
        "order_date": doc.order_date.isoformat() if doc.order_date else None,
        "status": doc.status,
        "total_ht": float(doc.total_ht) if doc.total_ht is not None else 0.0,
        "client_id": doc.client_id,
        "labo_id": doc.labo_id,
        "type": doc.type,
    }
    return {"header": head, "items": items}
