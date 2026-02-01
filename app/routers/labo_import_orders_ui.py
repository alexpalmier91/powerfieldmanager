# app/routers/labo_import_orders_ui.py
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(
    prefix="/labo",
    tags=["labo-import-ui"],
)

@router.get("/import/sales")
async def labo_import_sales_page(request: Request):
    """
    Page HTML du labo pour importer les ventes.
    L'authentification est gérée côté JS via le token stocké en localStorage.
    """
    return templates.TemplateResponse(
        "labo/sales_import.html",
        {"request": request}
    )
