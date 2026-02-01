# app/routers/labo_pages.py
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from jinja2 import pass_context

from app.i18n import t

router = APIRouter(tags=["labo-pages"])

# On recrée un env Jinja ici, mais on y injecte aussi t() et _()
BASE_DIR = Path(__file__).resolve().parents[1]
TEMPLATES_DIR = BASE_DIR / "templates"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@pass_context
def jinja_gettext(ctx, key: str, **kwargs) -> str:
    """
    Wrapper pour utiliser {{ _("clé") }} dans les templates Labo.
    On récupère la langue depuis le contexte ou request.state.lang.
    """
    # Lang depuis le contexte
    lang = ctx.get("lang")

    # Fallback : essayer request.state.lang
    if not lang:
        req = ctx.get("request")
        if req is not None:
            lang = getattr(getattr(req, "state", None), "lang", None)

    # Fallback final : français
    if not lang:
        lang = "fr"

    # Fonction i18n existante : t(lang, key)
    return t(lang, key, **kwargs)


# Injection des helpers de traduction dans cet environnement Jinja
templates.env.globals["t"] = t             # usage : {{ t(lang, "labo.orders.title") }}
templates.env.globals["_"] = jinja_gettext  # usage : {{ _("labo.orders.title") }}


@router.get("/labo/dashboard", response_class=HTMLResponse)
async def labo_dashboard_page(request: Request):
    """
    Page HTML du dashboard Labo.
    Le JavaScript de la page appellera /api-zenhub/labo/dashboard avec le Bearer token.
    """
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
    }
    return templates.TemplateResponse("labo/dashboard.html", ctx)


@router.get("/labo/orders", response_class=HTMLResponse)
async def labo_orders_page(request: Request):
    """
    Page HTML : commandes reçues du labo.
    Le JS /static/labo/orders.js appellera l'API /api-zenhub/labo/orders.
    """
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
    }
    return templates.TemplateResponse("labo/orders.html", ctx)


@router.get("/labo/agents", response_class=HTMLResponse)
async def labo_agents_page(request: Request):
    """
    Page HTML : liste des agents commerciaux rattachés au labo.
    Le JS /static/labo/agents.js appellera l'API /api-zenhub/labo/agents.
    """
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
    }
    return templates.TemplateResponse("labo/agents.html", ctx)
