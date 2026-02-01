# app/routers/labo_marketing_documents_annotations_api.py
from __future__ import annotations

from typing import Any, Dict, Optional

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import (
    MarketingDocument,
    MarketingDocumentAnnotation,
    MarketingAnnotationStatus,
)
from app.core.security import require_role

router = APIRouter(
    prefix="/api-zenhub/marketing",
    tags=["labo-marketing-documents-annotations"],
)


def _get_labo_id(user) -> int:
    labo_id = getattr(user, "labo_id", None)
    if labo_id is None and isinstance(user, dict):
        labo_id = user.get("labo_id")
    if not labo_id:
        raise HTTPException(status_code=403, detail="Compte labo inactif ou non rattaché")
    try:
        return int(labo_id)
    except Exception:
        raise HTTPException(status_code=403, detail="Contexte labo invalide")


class DraftUpsertPayload(BaseModel):
    data_json: Dict[str, Any] = Field(default_factory=dict)
    draft_version: Optional[int] = None  # si tu veux check optimistic côté API


@router.get("/documents/{doc_id}/draft")
async def get_marketing_document_draft(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    doc = await session.get(MarketingDocument, doc_id)
    if not doc or int(doc.labo_id) != labo_id:
        raise HTTPException(status_code=404, detail="Document introuvable")

    stmt = select(MarketingDocumentAnnotation).where(
        MarketingDocumentAnnotation.document_id == doc_id,
        MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT,
    )
    anno = (await session.execute(stmt)).scalars().first()

    if not anno:
        # renvoie draft vide si pas encore créé
        return {"draft": {"pages": []}, "draft_version": 1}

    return {"draft": anno.data_json or {}, "draft_version": int(anno.draft_version or 1)}


@router.put("/documents/{doc_id}/draft")
async def upsert_marketing_document_draft(
    doc_id: int,
    payload: DraftUpsertPayload,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    doc = await session.get(MarketingDocument, doc_id)
    if not doc or int(doc.labo_id) != labo_id:
        raise HTTPException(status_code=404, detail="Document introuvable")

    # lock doc row
    # (optionnel mais utile si tu veux éviter des races)
    await session.execute(
        select(MarketingDocument.id).where(MarketingDocument.id == doc_id).with_for_update()
    )

    stmt = select(MarketingDocumentAnnotation).where(
        MarketingDocumentAnnotation.document_id == doc_id,
        MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT,
    )
    anno = (await session.execute(stmt)).scalars().first()

    if not anno:
        anno = MarketingDocumentAnnotation(
            document_id=doc_id,
            status=MarketingAnnotationStatus.DRAFT,
            draft_version=1,
            data_json=payload.data_json or {},
        )
        session.add(anno)
    else:
        # optimistic: si tu veux, tu peux vérifier payload.draft_version == anno.draft_version
        anno.data_json = payload.data_json or {}
        anno.draft_version = int(anno.draft_version or 1) + 1

    await session.commit()
    return {"ok": True, "draft_version": int(anno.draft_version or 1)}
