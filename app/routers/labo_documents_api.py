# app/routers/labo_documents_api.py
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_async_session
from app.db.models import LaboDocument
from app.core.security import require_role, get_current_subject
from app.services.storage import save_labo_pdf

router = APIRouter(prefix="/api/labo/documents", tags=["labo-documents"])

MAX_SIZE = 10 * 1024 * 1024  # 10MB

@router.post("")
async def upload_document(
    title: str = Form(...),
    comment: str = Form(""),
    doc_type: str = Form(None),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    user = Depends(require_role("LABO")),
):
    if file.content_type != "application/pdf":
        raise HTTPException(400, "PDF uniquement")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "Fichier trop volumineux")

    file.file.seek(0)

    filename = save_labo_pdf(user.labo_id, file)

    doc = LaboDocument(
        labo_id=user.labo_id,
        filename=filename,
        original_name=file.filename,
        title=title,
        comment=comment,
        doc_type=doc_type,
    )
    session.add(doc)
    await session.commit()

    return {"status": "ok"}
