# app/routers/labo_marketing_documents_editor_api.py
from __future__ import annotations

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
    prefix="/api-zenhub/labo/marketing-documents",
    tags=["labo-marketing-documents-editor"],
)


def _get_labo_id(user) -> int:
    labo_id = getattr(user, "labo_id", None)
    if labo_id is None and isinstance(user, dict):
        labo_id = user.get("labo_id")
    if not labo_id:
        raise HTTPException(status_code=403, detail="Compte labo inactif ou non rattaché")
    return int(labo_id)


# -------------------------
# Schemas
# -------------------------
class DraftOut(BaseModel):
    document_id: int
    draft_version: int
    data_json: dict


class DraftSaveIn(BaseModel):
    draft_version: int = Field(..., ge=1)
    data_json: dict = Field(default_factory=dict)


# -------------------------
# Helpers
# -------------------------
async def _get_doc_owned_by_labo(session: AsyncSession, labo_id: int, doc_id: int) -> MarketingDocument:
    doc = await session.get(MarketingDocument, doc_id)
    if not doc or doc.labo_id != labo_id:
        raise HTTPException(status_code=404, detail="Document introuvable")
    return doc


async def _get_or_create_draft(session: AsyncSession, doc_id: int, user_id: int | None) -> MarketingDocumentAnnotation:
    stmt = (
        select(MarketingDocumentAnnotation)
        .where(MarketingDocumentAnnotation.document_id == doc_id)
        .where(MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT)
        .limit(1)
    )
    draft = (await session.execute(stmt)).scalars().first()
    if draft:
        return draft

    draft = MarketingDocumentAnnotation(
        document_id=doc_id,
        status=MarketingAnnotationStatus.DRAFT,
        draft_version=1,
        data_json={},
        created_by_user_id=user_id,
        updated_by_user_id=user_id,
    )
    session.add(draft)
    await session.commit()
    await session.refresh(draft)
    return draft


def _get_user_id(user) -> int | None:
    # selon ton auth, tu as parfois dict claims
    if isinstance(user, dict):
        return user.get("user_id") or user.get("id")
    return getattr(user, "id", None) or getattr(user, "user_id", None)


# -------------------------
# 2.1 - GET draft
# -------------------------
@router.get("/{doc_id}/draft", response_model=DraftOut)
async def get_draft(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)
    await _get_doc_owned_by_labo(session, labo_id, doc_id)

    draft = await _get_or_create_draft(session, doc_id, _get_user_id(user))

    return DraftOut(
        document_id=doc_id,
        draft_version=int(draft.draft_version or 1),
        data_json=draft.data_json or {},
    )


# -------------------------
# 2.1 - PUT draft (save)
# -------------------------
@router.put("/{doc_id}/draft", response_model=DraftOut)
async def save_draft(
    doc_id: int,
    payload: DraftSaveIn,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)
    await _get_doc_owned_by_labo(session, labo_id, doc_id)

    draft = await _get_or_create_draft(session, doc_id, _get_user_id(user))

    current_version = int(draft.draft_version or 1)
    if int(payload.draft_version) != current_version:
        raise HTTPException(
            status_code=409,
            detail=f"Conflit de version (current={current_version}, payload={payload.draft_version})",
        )

    draft.data_json = payload.data_json or {}
    draft.draft_version = current_version + 1
    draft.updated_by_user_id = _get_user_id(user)

    session.add(draft)
    await session.commit()
    await session.refresh(draft)

    return DraftOut(
        document_id=doc_id,
        draft_version=int(draft.draft_version or 1),
        data_json=draft.data_json or {},
    )
