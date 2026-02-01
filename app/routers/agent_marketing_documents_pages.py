# app/routers/agent_marketing_documents_pages.py
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from jinja2 import pass_context
from app.i18n import t

router = APIRouter(tags=["agent-marketing-documents-pages"])

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


@router.get("/agent/marketing-documents", response_class=HTMLResponse)
async def agent_marketing_documents_page(request: Request):
    # Page HTML non protégée (token localStorage)
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
        "labos": [],
        "selected_labo_id": None,
    }
    return templates.TemplateResponse("agent/marketing_documents.html", ctx)


@router.get("/agent/marketing-documents/{doc_id}/view", response_class=HTMLResponse)
async def agent_marketing_document_view_page(request: Request, doc_id: int):
    # Viewer HTML (token localStorage côté JS)
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
        "doc_id": doc_id,
    }
    return templates.TemplateResponse("agent/marketing_document_view.html", ctx)
