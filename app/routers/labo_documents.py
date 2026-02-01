from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Optional
from datetime import date

from app.db.session import get_async_session
from app.db.models import LaboDocument, LaboDocumentType
from app.core.security import require_role  # ex: ["S","L"] (superuser, labo)

router = APIRouter(prefix="/api-zenhub/labo/documents", tags=["labo-documents"])

@router.get("")
async def list_documents(
    session: AsyncSession = Depends(get_async_session),
    _=Depends(require_role(["S","L"])),
    type: Optional[LaboDocumentType] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = select(LaboDocument)
    conds = []
    if type:
        conds.append(LaboDocument.type == type)
    if status:
        conds.append(LaboDocument.status == status)
    if date_from:
        conds.append(LaboDocument.order_date >= date_from)
    if date_to:
        conds.append(LaboDocument.order_date <= date_to)

    if conds:
        q = q.where(and_(*conds))

    q = q.order_by(LaboDocument.order_date.desc(), LaboDocument.id.desc())
    total = (await session.execute(q.with_only_columns(LaboDocument.id))).all()
    total_count = len(total)

    q = q.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(q)).scalars().all()

    return {
        "page": page,
        "page_size": page_size,
        "total": total_count,
        "items": [
            {
                "id": r.id,
                "labo_id": r.labo_id,
                "client_id": r.client_id,
                "customer_id": r.customer_id,
                "agent_id": r.agent_id,
                "order_number": r.order_number,
                "order_date": r.order_date,
                "type": r.type.value,
                "status": r.status.name if hasattr(r.status, "name") else r.status,
                "total_ht": str(r.total_ht) if r.total_ht is not None else None,
                "total_ttc": str(r.total_ttc) if r.total_ttc is not None else None,
                "currency": r.currency,
            }
            for r in rows
        ],
    }

@router.get("/{doc_id}")
async def get_document(doc_id: int, session: AsyncSession = Depends(get_async_session), _=Depends(require_role(["S","L"]))):
    doc = await session.get(LaboDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")

    return {
        "id": doc.id,
        "header": {
            "labo_id": doc.labo_id,
            "client_id": doc.client_id,
            "customer_id": doc.customer_id,
            "agent_id": doc.agent_id,
            "order_number": doc.order_number,
            "order_date": doc.order_date,
            "type": doc.type.value,
            "status": doc.status.name if hasattr(doc.status, "name") else doc.status,
            "total_ht": str(doc.total_ht) if doc.total_ht is not None else None,
            "total_ttc": str(doc.total_ttc) if doc.total_ttc is not None else None,
            "currency": doc.currency,
        },
        "items": [
            {
                "id": it.id,
                "product_id": it.product_id,
                "sku": it.sku,
                "name": it.name,
                "qty": str(it.qty),
                "unit_price": str(it.unit_price) if it.unit_price is not None else None,
                "total_ht": str(it.total_ht) if it.total_ht is not None else None,
                "total_ttc": str(it.total_ttc) if it.total_ttc is not None else None,
                "tax_rate": str(it.tax_rate) if it.tax_rate is not None else None,
            }
            for it in doc.items
        ],
    }
