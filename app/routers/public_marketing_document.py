from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import MarketingDocument
from app.services.storage import (
    get_marketing_document_path,
)
from app.services.marketing_signed_url import parse_and_verify_marketing_token

router = APIRouter(tags=["public-marketing-documents"])


@router.get("/public/marketing-document")
async def public_marketing_document(
    token: str,
    session: AsyncSession = Depends(get_async_session),
):
    try:
        doc_id, kind = parse_and_verify_marketing_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Lien invalide ou expiré")

    doc = await session.get(MarketingDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")

    base = get_marketing_document_path(doc.labo_id, "")
    if kind == "thumb":
        if not doc.thumb_filename:
            raise HTTPException(status_code=404)
        path = base / doc.thumb_filename
        return FileResponse(path, media_type="image/png")

    # PDF en lecture (inline)
    path = base / doc.filename
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{doc.original_name}"'},
    )
