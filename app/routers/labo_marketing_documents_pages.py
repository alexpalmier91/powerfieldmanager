# app/routers/labo_marketing_documents_pages.py
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from jinja2 import pass_context
from app.i18n import t

router = APIRouter(tags=["labo-marketing-documents-pages"])

# Répertoire des templates
BASE_DIR = Path(__file__).resolve().parents[1]
TEMPLATES_DIR = BASE_DIR / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@pass_context
def jinja_gettext(ctx, key: str, **kwargs) -> str:
    lang = ctx.get("lang")
    if not lang:
        req = ctx.get("request")
        if req is not None:
            lang = getattr(getattr(req, "state", None), "lang", None)
    if not lang:
        lang = "fr"
    return t(lang, key, **kwargs)


templates.env.globals["t"] = t
templates.env.globals["_"] = jinja_gettext


@router.get("/labo/marketing-documents", response_class=HTMLResponse)
async def labo_marketing_documents_page(request: Request):
    """
    Page HTML : documents commerciaux du labo.
    Le JS /static/labo/marketing_documents.js consomme l'API :
      - GET/POST/DELETE /api-zenhub/labo/marketing-documents
      - GET /api-zenhub/labo/marketing-documents/{id}/download
    """
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
    }
    return templates.TemplateResponse("labo/marketing_documents.html", ctx)


@router.get("/labo/marketing-documents/{doc_id}/edit", response_class=HTMLResponse)
async def labo_marketing_document_edit_page(request: Request, doc_id: int):
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
        "doc_id": doc_id,
    }
    return templates.TemplateResponse("labo/marketing_document_editor.html", ctx)
