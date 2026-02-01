# app/routers/labo_marketing_documents_publish_api.py
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from app.db.session import get_async_session
from app.db.models import (
    MarketingDocument,
    MarketingDocumentAnnotation,
    MarketingDocumentPublication,
    MarketingAnnotationStatus,
    MarketingPublicationStatus,
)
from app.core.security import require_role

router = APIRouter(
    prefix="/api-zenhub/marketing/documents",
    tags=["labo-marketing-publish"],
)

MEDIA_DIR = Path("/app/media/marketing_documents")


def _get_user_id(user) -> int | None:
    if isinstance(user, dict):
        return user.get("id")
    return getattr(user, "id", None)


def _get_labo_id(user) -> int:
    labo_id = getattr(user, "labo_id", None)
    if labo_id is None and isinstance(user, dict):
        labo_id = user.get("labo_id")
    if not labo_id:
        raise HTTPException(status_code=403, detail="Compte labo inactif ou non rattaché")
    return int(labo_id)


async def _get_doc_for_labo(session: AsyncSession, labo_id: int, doc_id: int) -> MarketingDocument:
    doc = await session.get(MarketingDocument, doc_id)
    if not doc or doc.labo_id != labo_id:
        raise HTTPException(status_code=404, detail="Document introuvable")
    return doc


async def _get_draft(session: AsyncSession, doc_id: int) -> MarketingDocumentAnnotation | None:
    stmt = (
        select(MarketingDocumentAnnotation)
        .where(
            MarketingDocumentAnnotation.document_id == doc_id,
            MarketingDocumentAnnotation.status == MarketingAnnotationStatus.DRAFT,
        )
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


async def _next_publication_version(session: AsyncSession, doc_id: int) -> int:
    ver_stmt = select(func.coalesce(func.max(MarketingDocumentPublication.version), 0)).where(
        MarketingDocumentPublication.document_id == doc_id
    )
    current_max = (await session.execute(ver_stmt)).scalar() or 0
    return int(current_max) + 1


async def _upsert_locked_annotation(
    session: AsyncSession,
    *,
    doc_id: int,
    draft_version: int,
    data_json: dict,
    user_id: int | None,
) -> int:
    """
    ✅ IMPORTANT :
    On a une contrainte unique (document_id, status) => un seul LOCKED par document.
    On fait donc un UPSERT pour éviter le crash:
      duplicate key value violates unique constraint uq_marketing_doc_annotation_doc_status
    """
    stmt = (
        insert(MarketingDocumentAnnotation)
        .values(
            document_id=doc_id,
            status=MarketingAnnotationStatus.LOCKED,
            draft_version=draft_version,
            data_json=data_json,
            created_by_user_id=user_id,
            updated_by_user_id=user_id,
        )
        .on_conflict_do_update(
            index_elements=["document_id", "status"],
            set_={
                "draft_version": draft_version,
                "data_json": data_json,
                "updated_by_user_id": user_id,
                # updated_at est géré par onupdate=func.now() sur le modèle
            },
        )
        .returning(MarketingDocumentAnnotation.id)
    )

    locked_id = (await session.execute(stmt)).scalar_one()
    return int(locked_id)


@router.post("/{doc_id}/publish")
async def publish_marketing_document(
    doc_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    """
    Publish:
    - récupère le DRAFT
    - UPSERT snapshot LOCKED (un seul par document)
    - crée une publication (PENDING/RENDERING)
    - MVP: copie le PDF source en published/ puis READY
    """
    labo_id = _get_labo_id(user)
    user_id = _get_user_id(user)

    doc = await _get_doc_for_labo(session, labo_id, doc_id)

    # 1) récupère le DRAFT
    draft = await _get_draft(session, doc.id)
    if not draft:
        raise HTTPException(status_code=400, detail="Aucun draft à publier")

    # 2) calcule next version
    new_version = await _next_publication_version(session, doc.id)

    # 3) UPSERT snapshot LOCKED (évite doublon)
    locked_id = await _upsert_locked_annotation(
        session,
        doc_id=doc.id,
        draft_version=int(draft.draft_version or 1),
        data_json=draft.data_json or {"pages": []},
        user_id=user_id,
    )

    # 4) crée publication
    pub = MarketingDocumentPublication(
        document_id=doc.id,
        annotation_locked_id=locked_id,
        version=new_version,
        status=MarketingPublicationStatus.RENDERING,  # MVP: immédiat
        created_by_user_id=user_id,
        render_options_json={},
    )
    session.add(pub)
    await session.flush()  # pub.id

    # 5) MVP génération: copie le PDF source comme "published"
    published_dir = MEDIA_DIR / f"labo_{doc.labo_id}" / "published"
    published_dir.mkdir(parents=True, exist_ok=True)

    src_pdf = MEDIA_DIR / f"labo_{doc.labo_id}" / doc.filename
    if not src_pdf.exists():
        pub.status = MarketingPublicationStatus.FAILED
        pub.error_message = "PDF source introuvable sur disque"
        await session.commit()
        raise HTTPException(status_code=500, detail="PDF source introuvable")

    out_name = f"{uuid.uuid4().hex}.pdf"
    out_pdf = published_dir / out_name
    out_pdf.write_bytes(src_pdf.read_bytes())

    pub.published_pdf_filename = f"published/{out_name}"
    pub.status = MarketingPublicationStatus.READY

    await session.commit()

    return {
        "publication_id": pub.id,
        "version": pub.version,
        "status": pub.status.value,
        "published_pdf_filename": pub.published_pdf_filename,
        "locked_annotation_id": locked_id,
    }
