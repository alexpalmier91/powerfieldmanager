# app/routers/labo_orders_pdf.py
from __future__ import annotations

import logging
from decimal import Decimal
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
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
    User,       # ✅ IMPORTANT (pour résoudre subject=email)
    UserRole,   # ✅ IMPORTANT
)
from app.core.security import get_current_subject
from app.services.labo_pdf import (
    render_agent_order_pdf,
    render_commercial_documents_bulk_pdf,  # ✅ nouveau bulk générique
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api-zenhub/labo/orders", tags=["labo-orders-pdf"])


# -------------------------------------------------------------------
# Helpers auth (support subject = email string)
# -------------------------------------------------------------------

def _role_str(role: Any) -> str:
    if role is None:
        return ""
    if hasattr(role, "value"):  # Enum
        role = role.value
    return str(role).strip().upper()


def _is_role(role: str, expected: str) -> bool:
    r = (role or "").upper()
    e = expected.upper()
    return r == e or e in r


async def _load_user_from_subject(session: AsyncSession, subject: Any) -> Optional[User]:
    """
    get_current_subject te renvoie parfois juste l'email (string).
    On charge le User pour récupérer role / labo_id.
    """
    if subject is None:
        return None

    # string = email ou id
    if isinstance(subject, str):
        s = subject.strip()
        if not s:
            return None
        # email
        if "@" in s:
            stmt = select(User).where(User.email == s)
            return (await session.scalars(stmt)).first()
        # id
        try:
            uid = int(s)
            return await session.get(User, uid)
        except Exception:
            return None

    # dict
    if isinstance(subject, dict):
        if subject.get("id"):
            try:
                return await session.get(User, int(subject["id"]))
            except Exception:
                pass
        if subject.get("email"):
            stmt = select(User).where(User.email == subject["email"])
            return (await session.scalars(stmt)).first()
        return None

    # objet
    uid = getattr(subject, "id", None)
    if uid:
        try:
            return await session.get(User, int(uid))
        except Exception:
            pass
    email = getattr(subject, "email", None)
    if email:
        stmt = select(User).where(User.email == email)
        return (await session.scalars(stmt)).first()

    return None


def _compute_agent_name(agent: Optional[Agent]) -> str:
    if not agent:
        return ""
    first = (getattr(agent, "firstname", None) or "").strip()
    last = (getattr(agent, "lastname", None) or "").strip()
    full = (f"{first} {last}").strip()
    if full:
        return full
    return (getattr(agent, "email", None) or "").strip()


def _assert_labo_access(user: Optional[User]) -> Dict[str, Any]:
    """
    Retourne {is_labo: bool, labo_id: Optional[int], role: str}
    et lève HTTPException si refus.
    """
    if not user:
        raise HTTPException(status_code=403, detail="Accès refusé (utilisateur introuvable).")

    role = _role_str(getattr(user, "role", None))
    labo_id = getattr(user, "labo_id", None)
    try:
        labo_id = int(labo_id) if labo_id is not None else None
    except Exception:
        labo_id = None

    allowed = (
        _is_role(role, "LABO")
        or _is_role(role, "SUPERUSER")
        or _is_role(role, "SUPERADMIN")
        or _is_role(role, "ADMIN")
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    is_labo = _is_role(role, "LABO") and not (
        _is_role(role, "SUPERUSER") or _is_role(role, "SUPERADMIN") or _is_role(role, "ADMIN")
    )

    if is_labo and not labo_id:
        raise HTTPException(status_code=403, detail="Compte labo sans labo_id.")

    return {"is_labo": is_labo, "labo_id": labo_id, "role": role}


async def _build_order_context(session: AsyncSession, order: Order) -> Dict[str, Any]:
    # client + labo
    if not order.client_id:
        raise HTTPException(status_code=400, detail="Commande sans client associé.")
    client = await session.get(Client, order.client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client introuvable.")

    labo = await session.get(Labo, order.labo_id)
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable.")

    # agent (nom dans pdf)
    agent_obj: Optional[Agent] = None
    if getattr(order, "agent_id", None):
        agent_obj = await session.get(Agent, order.agent_id)
    agent_name = _compute_agent_name(agent_obj)

    # delivery default
    delivery = client
    delivery_stmt = (
        select(DeliveryAddress)
        .where(
            DeliveryAddress.client_id == client.id,
            DeliveryAddress.is_default.is_(True),
        )
        .order_by(
            DeliveryAddress.updated_at.desc().nullslast(),
            DeliveryAddress.id.desc(),
        )
        .limit(1)
    )
    delivery_row = (await session.scalars(delivery_stmt)).first()
    if delivery_row:
        delivery = delivery_row

    # lignes
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
        vat_rate = getattr(p, "vat_rate", None) or Decimal("0")
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

    return {
        "doc": order,
        "doc_title": "Bon de commande",
        "doc_number": (order.order_number or str(order.id)),
        "order_date": getattr(order, "order_date", None) or getattr(order, "created_at", None),
        "delivery_date": getattr(order, "delivery_date", None),
        "currency": getattr(order, "currency", "EUR") or "EUR",
        "items": pdf_items,
        "client": client,
        "labo": labo,
        "delivery": delivery,
        "agent_name": agent_name,
    }


# -------------------------------------------------------------------
# Single PDF
# -------------------------------------------------------------------

@router.get(
    "/{order_id}/pdf",
    response_class=Response,
    include_in_schema=False,
)
async def labo_order_pdf(
    order_id: int,
    session: AsyncSession = Depends(get_async_session),
    subject=Depends(get_current_subject),
):
    logger.error("PDF LABO subject = %r", subject)

    user = await _load_user_from_subject(session, subject)
    access = _assert_labo_access(user)
    is_labo = access["is_labo"]
    labo_id = access["labo_id"]

    # commande (filtrée si compte LABO)
    stmt = select(Order).where(Order.id == order_id)
    if is_labo:
        stmt = stmt.where(Order.labo_id == labo_id)

    order = (await session.scalars(stmt)).first()
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable.")

    ctx = await _build_order_context(session, order)

    try:
        pdf_bytes = render_agent_order_pdf(
            doc=ctx["doc"],
            items=ctx["items"],
            client=ctx["client"],
            labo=ctx["labo"],
            delivery=ctx["delivery"],
            agent_name=ctx["agent_name"],  # ✅ agent dans le PDF
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur génération PDF: {exc}")

    filename = f"Bon-de-commande-{order.order_number or order.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# -------------------------------------------------------------------
# Bulk PDF (suite de bons de commande)
# -------------------------------------------------------------------

class BulkPdfPayload(BaseModel):
    order_ids: List[int] = Field(default_factory=list)


@router.post(
    "/bulk-pdf",
    response_class=Response,
    include_in_schema=False,
)
async def labo_orders_bulk_pdf(
    payload: BulkPdfPayload,
    session: AsyncSession = Depends(get_async_session),
    subject=Depends(get_current_subject),
):
    user = await _load_user_from_subject(session, subject)
    access = _assert_labo_access(user)
    is_labo = access["is_labo"]
    labo_id = access["labo_id"]

    order_ids = [int(x) for x in (payload.order_ids or []) if int(x) > 0]
    order_ids = list(dict.fromkeys(order_ids))
    if not order_ids:
        raise HTTPException(status_code=400, detail="Aucune commande fournie.")

    stmt = select(Order).where(Order.id.in_(order_ids))
    if is_labo:
        stmt = stmt.where(Order.labo_id == labo_id)

    orders = (await session.scalars(stmt)).all()
    if not orders:
        raise HTTPException(status_code=404, detail="Commandes introuvables (ou non autorisées).")

    by_id = {o.id: o for o in orders}
    ordered = [by_id[i] for i in order_ids if i in by_id]

    contexts: List[Dict[str, Any]] = []
    for order in ordered:
        contexts.append(await _build_order_context(session, order))

    try:
        pdf_bytes = render_commercial_documents_bulk_pdf(contexts)  # ✅ doc_title par ctx
    except Exception as exc:
        logger.exception("Erreur bulk PDF LABO")
        raise HTTPException(status_code=500, detail=f"Erreur génération PDF: {exc}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="bons_de_commande_selection.pdf"'},
    )
