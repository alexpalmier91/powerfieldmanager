# app/routers/labo_clients_pages.py
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(
    prefix="/labo",
    tags=["labo-pages"],
)


@router.get("/clients", response_class=HTMLResponse)
async def labo_clients_page(request: Request):
    """
    Page Jinja "Mes clients" côté labo.
    Pas de dépendance Bearer ici : le JS fera les appels API avec le token.
    """
    return templates.TemplateResponse(
        "labo/clients.html",
        {"request": request}
    )


@router.get("/clients/{client_id}", response_class=HTMLResponse)
async def labo_client_detail_page(request: Request, client_id: int):
    """
    Page Jinja détail d'un client.
    Le JS ira chercher les infos via /api-zenhub/labo/clients/{client_id}.
    """
    return templates.TemplateResponse(
        "labo/client_detail.html",
        {
            "request": request,
            "client_id": client_id,
        }
    )
