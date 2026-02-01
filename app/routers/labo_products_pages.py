# app/routers/labo_products_pages.py
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import Product, Labo





from jinja2 import pass_context

from app.i18n import t

router = APIRouter(tags=["labo-products-pages"])

# Répertoire des templates
BASE_DIR = Path(__file__).resolve().parents[1]
TEMPLATES_DIR = BASE_DIR / "templates"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@pass_context
def jinja_gettext(ctx, key: str, **kwargs) -> str:
    """
    Wrapper pour utiliser {{ _("clé") }} dans les templates Labo produits.
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


# Injection des helpers dans CET environnement Jinja
templates.env.globals["t"] = t              # usage : {{ t(lang, "labo.products.title") }}
templates.env.globals["_"] = jinja_gettext  # usage : {{ _("labo.products.title") }}


@router.get("/labo/products", response_class=HTMLResponse)
async def labo_products_page(request: Request):
    """
    Page HTML : listing des produits du labo.
    Le JS /static/labo/products.js consomme l'API /api-zenhub/labo/products
    et gère notamment l'édition à la volée de la commission produit.
    """
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
    }
    return templates.TemplateResponse("labo/products.html", ctx)


@router.get("/labo/products/import", response_class=HTMLResponse)
async def labo_products_import_page(request: Request):
    """
    Page HTML : import des produits labo depuis un fichier Excel.
    Le JS /static/labo/products_import.js consomme /api-zenhub/labo/products/import.
    """
    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
    }
    return templates.TemplateResponse("labo/products_import.html", ctx)


@router.get("/labo/products/{product_id}/stats", response_class=HTMLResponse)
async def labo_product_stats_page(
    request: Request,
    product_id: int,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Page HTML : statistiques d'un produit.
    Le JS /static/labo/product_stats.js consomme les endpoints :
      - /api-zenhub/labo/products/{product_id}/stats/...
    """
    # On charge le produit + son labo pour l'en-tête
    stmt = (
        select(Product, Labo)
        .join(Labo, Labo.id == Product.labo_id)
        .where(Product.id == product_id)
    )
    row = (await session.execute(stmt)).first()
    if not row:
        return templates.TemplateResponse(
            "errors/404.html",
            {
                "request": request,
                "lang": getattr(request.state, "lang", "fr"),
            },
            status_code=404,
        )

    product, labo = row

    ctx = {
        "request": request,
        "lang": getattr(request.state, "lang", "fr"),
        "product": product,
        "labo": labo,
    }
    return templates.TemplateResponse("labo/product_stats.html", ctx)

