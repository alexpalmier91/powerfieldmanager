# app/routers/labo_marketing_documents_editor_pages.py
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path

router = APIRouter(tags=["labo-marketing-documents-editor"])

BASE_DIR = Path(__file__).resolve().parents[1]
TEMPLATES_DIR = BASE_DIR / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get(
    "/labo/marketing-documents/{doc_id}/edit",
    response_class=HTMLResponse,
)
async def labo_marketing_document_editor_page(
    request: Request,
    doc_id: int,
):
    """
    Page éditeur PDF LABO (lecture PDF + overlay JS)
    """
    return templates.TemplateResponse(
        "labo/marketing_document_editor.html",
        {"request": request, "doc_id": doc_id, "ts": int(time.time())}
        
        ,
    )
