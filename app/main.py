# app/main.py

import mimetypes
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("image/webp", ".webp")

from fastapi import FastAPI, APIRouter, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        # Désactive le cache navigateur + proxies
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path

from jinja2 import pass_context

from app.middleware.no_cache_middleware import NoCacheMiddleware


from app.middleware.i18n_middleware import I18nMiddleware
from app.i18n import load_translations, t

from app.core.config import settings

# API Routers
from app.routers import fonts_global
from app.routers import imports, products, sync_presta
from app.routers import orders, auth, admin, labo_dashboard
from app.routers import superuser as superuser_router
from app.routers import superuser_clients
from app.routers import superuser_import_orders
from app.routers import superuser_import_clients, superuser_import_clients_pages
from app.routers import agent_orders          # API Agent
from app.routers import agent_dashboard       # API Dashboard Agent
from app.routers import agent_appointments
from app.routers import agent_client_detail
from app.routers import agent_clients_create
from app.routers import agent_dashboard_stats
from app.routers import agent_labos_catalog   # 👈 nouveau catalogue agent (commission + tiers)
from app.routers import agent_clients_import_export
from app.routers.agent_stats import router as agent_stats_router
from app.routers import superuser_import
from app.routers import superuser_agents
from app.routers import superuser_labo_stock_sync
from app.routers import superuser_labo_stock_sync_pages
from app.routers import superuser_labo_sales_import_sync
from app.routers import superuser_labo_sales_import_pages
from app.routers.superuser_import_product_prestashop import router as import_ps_router
from app.routers.superuser_import_product_prestashop_page import router as import_ps_page_router

from app.routers.agent_clients_docs import router as agent_clients_docs_router
from app.routers import superuser_impersonate
from app.routers import superuser_import_agent_client
from app.routers import superuser_import_agent_client_pages
from app.routers import superuser_agent_orders_auto_import
from app.routers import superuser_agent_orders_auto_import_pages
from app.routers.superuser_labos_pages import router as superuser_labos_pages_router
from app.routers.superuser_labos_api import router as superuser_labos_api_router
from app.routers import superuser_global_fonts

from app.routers import labo_marketing_documents_pages, agent_marketing_documents_pages
from app.routers import labo_pages
from app.routers import labo_products_api, labo_products_pages
from app.routers import labo_orders_api
from app.routers import labo_agents
from app.routers import labo_import_orders
from app.routers import labo_import_orders_ui
from app.routers import labo_clients_api
from app.routers import labo_clients_pages
from app.routers import orders_pdf
from app.routers.superuser_agent_orders_import import router as su_agent_orders_import_router
from app.routers.superuser_agent_orders_pages import router as su_agent_orders_pages_router

from app.routers import agent_orders_pdf, labo_orders_pdf

# 🔹 Nouveau : stats dashboard Labo (API)
from app.routers import labo_dashboard_stats

# 🔹 gestion presentoir connecté
from app.routers import superuser_presentoirs
from app.routers import iot_presentoirs
from app.routers import rfid_snapshot
from app.routers import superuser_rfid_tags
from app.routers import superuser_display_clients
from app.routers import superuser_presentoir_clients
from app.routers import superuser_display_products_api
from app.routers import superuser_display_products_pages
from app.routers import superuser_rfid_last_seen_api
from app.routers.superuser_presentoir_tagging_pages import (
    router as superuser_presentoir_tagging_pages_router
)
from app.routers.superuser_presentoir_tagging_api import (
    router as superuser_presentoir_tagging_api_router
)

from app.routers import (
    labo_marketing_documents_api,
    agent_marketing_documents_api,
)
from app.routers import labo_marketing_documents_editor_api
from app.routers import public_marketing_document
from app.routers import labo_marketing_documents_editor_pages
from app.routers import labo_marketing_fonts_api
from app.routers import labo_marketing_dynamic_products_api
# from app.routers import labo_marketing_documents_draft_api
from app.routers import labo_marketing_documents_annotations_api
from app.routers import labo_marketing_documents_publish_api
from app.routers import labo_marketing_remove_bg
# ------------------------
# Paths / Templates
# ------------------------
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

# Charger translations en mémoire
load_translations()

app = FastAPI(
    title="ZenHub API",
    openapi_url=f"{settings.API_PREFIX}/openapi.json"
)

# ------------------------
# CORS
# ------------------------
origins = [o.strip() for o in (settings.CORS_ORIGINS or [])]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(NoCacheMiddleware)

# ------------------------
# MIDDLEWARE I18N
# ------------------------
app.add_middleware(I18nMiddleware)

# ------------------------
# Static + Templates
# ------------------------
app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")
ASSETS_DIR = BASE_DIR / "assets"
app.mount("/assets", NoCacheStaticFiles(directory=str(ASSETS_DIR)), name="assets")

MEDIA_ROOT = Path("media")
app.mount("/media", NoCacheStaticFiles(directory=str(MEDIA_ROOT)), name="media")



templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


# === Wrapper Jinja pour i18n : _("clé") ===
@pass_context
def jinja_gettext(ctx, key: str) -> str:
    """
    Utilisation dans les templates :
      {{ _("agent.dashboard.title") }}
    On récupère la langue depuis le contexte (lang ou request.state.lang),
    puis on appelle t(key, lang).
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

    # Appel correct : t(key, lang)
    return t(key, lang)


# Injection des helpers de traduction dans Jinja
# Usage attendu dans les templates :
#   {{ t("agent.dashboard.title", lang) }}
templates.env.globals["t"] = t
templates.env.globals["_"] = jinja_gettext  # usage : {{ _("agent.dashboard.title") }}



# ------------------------
# Helper pour servir une page template ou fallback HTML
# ------------------------
def render_template_or_static(
    request: Request,
    template_relpath: str,
    static_relpath: str,
    context: dict | None = None,
):
    """
    Rend en priorité un template Jinja (templates/...), sinon bascule
    sur un fichier statique (static/...). Si rien n'existe, 404.
    """
    context = context or {}
    tpl_file = TEMPLATES_DIR / template_relpath

    # Injecte la langue automatiquement dans tout template rendu,
    # sauf si elle est déjà présente dans le contexte (ex: superuser forcé en "fr").
    if "lang" not in context:
        context["lang"] = getattr(request.state, "lang", "fr")

    context["request"] = request

    if tpl_file.exists():
        return templates.TemplateResponse(template_relpath, context)

    static_file = STATIC_DIR / static_relpath
    if static_file.exists():
        return FileResponse(str(static_file))

    raise HTTPException(
        status_code=404,
        detail=f"Template '{template_relpath}' ou fichier statique '{static_relpath}' introuvable."
    )

# ------------------------
# ROUTES FRONT HTML
# ------------------------


@app.get("/", include_in_schema=False)
async def home_page(request: Request):
    return render_template_or_static(
        request,
        "index.html",     # templates/index.html (ta page avec fond + logo + login)
        "index.html",     # fallback static (rarement utilisé)
        {}
    )


@app.get("/login", include_in_schema=False)
async def login_page(request: Request):
    return render_template_or_static(request, "login.html", "login.html", {})


@app.get("/dashboard", include_in_schema=False)
async def dashboard_page(request: Request):
    return render_template_or_static(request, "agent/dashboard.html", "dashboard.html", {})


@app.get("/superuser/dashboard", include_in_schema=False)
async def superuser_dashboard_page(request: Request):
    # Langue forcée FR côté SuperUser
    return render_template_or_static(
        request,
        "superuser/dashboard.html",
        "superuser/dashboard.html",
        {"lang": "fr"}
    )

# ---------- Agent Pages ----------

@app.get("/agent/dashboard", include_in_schema=False)
async def agent_dashboard_page(request: Request):
    return render_template_or_static(request, "agent/dashboard.html", "agent/dashboard.html", {})


@app.get("/agent/clients", include_in_schema=False)
async def agent_clients_page(request: Request):
    return render_template_or_static(request, "agent/clients.html", "agent/clients.html", {})


@app.get("/agent/orders", include_in_schema=False)
async def agent_orders_page(request: Request):
    return render_template_or_static(request, "agent/orders.html", "agent/orders.html", {})


@app.get("/agent/orders/new", include_in_schema=False)
async def agent_orders_new_page(request: Request):
    return render_template_or_static(
        request,
        "agent/orders_new.html",
        "agent/orders_new.html",
        {}
    )


@app.get("/agent/agenda", include_in_schema=False)
async def agent_agenda_page(request: Request):
    return render_template_or_static(
        request,
        "agent/agenda.html",      # template Jinja : app/templates/agent/agenda.html
        "agent/agenda.html",      # fallback éventuel : app/static/agent/agenda.html
        {}
    )


@app.get("/agent/labos", include_in_schema=False)
async def agent_labos_page(request: Request):
    return render_template_or_static(request, "agent/labos.html", "agent/labos.html", {})


@app.get("/agent/order.html", include_in_schema=False)
async def agent_order_page(request: Request):
    return render_template_or_static(request, "agent/order.html", "agent/order.html", {})


@app.get("/agent/stats-sales", include_in_schema=False)
async def agent_stats_sales_page(request: Request):
    return templates.TemplateResponse("agent/stats_sales.html", {"request": request})


# ---------- Labo Pages ----------

@app.get("/labo/dashboard", include_in_schema=False)
async def labo_dashboard_page(request: Request):
    """
    Page d'accueil du dashboard Labo.
    Utilise le template Jinja : app/templates/labo/dashboard.html
    (fallback éventuel : app/static/labo/dashboard.html).
    """
    return render_template_or_static(
        request,
        "labo/dashboard.html",
        "labo/dashboard.html",
        {}
    )
    
    

# ------------------------
# Healthchecks
# ------------------------
@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/health")
async def health():
    return {"status": "ok"}

# ------------------------
# Dev ping Celery
# ------------------------
router = APIRouter()

@router.post("/celery-test")
async def celery_test():
    from app.tasks.imports import ping
    res = ping.delay()
    return {"task_id": res.id}

app.include_router(router, prefix=settings.API_PREFIX, tags=["dev"])

# ------------------------
# API BACKEND (ROUTERS)
# ------------------------

# Public / Admin
app.include_router(imports.router,        prefix=settings.API_PREFIX)
app.include_router(products.router,       prefix=settings.API_PREFIX)
app.include_router(sync_presta.router,    prefix=settings.API_PREFIX)
app.include_router(orders.router,         prefix=settings.API_PREFIX)
app.include_router(auth.router,           prefix=settings.API_PREFIX)
app.include_router(admin.router,          prefix=settings.API_PREFIX)
app.include_router(labo_dashboard.router, prefix=settings.API_PREFIX)
app.include_router(fonts_global.router, prefix=settings.API_PREFIX)

# Agent API routes (déjà préfixées)
app.include_router(agent_orders.router)
app.include_router(agent_dashboard.router)
app.include_router(agent_appointments.router)
app.include_router(agent_client_detail.page_router)
app.include_router(agent_client_detail.api_router)
app.include_router(agent_clients_create.router)
app.include_router(agent_dashboard_stats.router)
app.include_router(agent_labos_catalog.router)   # 👈 branche le catalogue agent
app.include_router(agent_stats_router)
app.include_router(agent_clients_import_export.router)
app.include_router(agent_marketing_documents_api.router)

# Superuser routes
# Superuser – pages HTML
app.include_router(superuser_clients.router)
app.include_router(superuser_import.router)
app.include_router(superuser_agents.router)
app.include_router(superuser_impersonate.router)


app.include_router(superuser_import_clients.router)
app.include_router(superuser_import_clients_pages.router)
app.include_router(superuser_import_agent_client.router)
app.include_router(superuser_import_agent_client_pages.router)
app.include_router(superuser_labo_stock_sync.router)
app.include_router(superuser_labo_stock_sync_pages.router)
app.include_router(superuser_labo_sales_import_sync.router)
app.include_router(superuser_labo_sales_import_pages.router)
app.include_router(superuser_labos_pages_router)
app.include_router(superuser_labos_api_router)
app.include_router(superuser_global_fonts.router)

# Superuser – API JSON
app.include_router(superuser_import_orders.router,  prefix=settings.API_PREFIX)
app.include_router(superuser_router.router,         prefix=settings.API_PREFIX, tags=["superuser"])
app.include_router(superuser_agent_orders_auto_import.router)
app.include_router(superuser_agent_orders_auto_import_pages.router)
app.include_router(su_agent_orders_import_router)  # prefix déjà dans le router
app.include_router(su_agent_orders_pages_router)
app.include_router(import_ps_router)
app.include_router(import_ps_page_router)

# Labo routes
app.include_router(labo_pages.router)
app.include_router(labo_products_api.router)
app.include_router(labo_products_pages.router)
app.include_router(labo_orders_api.router)
app.include_router(labo_agents.router)
app.include_router(labo_import_orders.router)
app.include_router(labo_import_orders_ui.router)
app.include_router(labo_clients_api.router)
app.include_router(labo_clients_pages.router)
app.include_router(labo_marketing_documents_api.router)
app.include_router(labo_marketing_documents_pages.router)
app.include_router(agent_marketing_documents_pages.router)
app.include_router(public_marketing_document.router)
app.include_router(labo_marketing_documents_editor_api.router)
app.include_router(labo_marketing_documents_editor_pages.router)
app.include_router(labo_marketing_fonts_api.router)
app.include_router(labo_marketing_dynamic_products_api.router)
# app.include_router(labo_marketing_documents_draft_api.router)
app.include_router(labo_marketing_documents_annotations_api.router)
app.include_router(labo_marketing_documents_publish_api.router)
app.include_router(labo_marketing_remove_bg.router)


# 🔹 Nouveau : API stats dashboard Labo
app.include_router(labo_dashboard_stats.router)

app.include_router(orders_pdf.router)

# Agent docs
app.include_router(agent_clients_docs_router, prefix="/api-zenhub")
app.include_router(agent_orders_pdf.router)
app.include_router(labo_orders_pdf.router)

#gestion presentoir connecté
app.include_router(superuser_presentoirs.router)
app.include_router(iot_presentoirs.router)
app.include_router(rfid_snapshot.router)
app.include_router(superuser_rfid_tags.router)
app.include_router(superuser_display_clients.router)
app.include_router(superuser_presentoir_clients.router)
app.include_router(superuser_display_products_api.router)
app.include_router(superuser_display_products_pages.router)
app.include_router(superuser_rfid_last_seen_api.router)
app.include_router(superuser_presentoir_tagging_pages_router)
app.include_router(superuser_presentoir_tagging_api_router)