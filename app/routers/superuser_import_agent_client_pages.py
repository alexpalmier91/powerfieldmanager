# app/routers/superuser_import_agent_client_pages.py
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(
    prefix="/superuser",
    tags=["Superuser - Agent / Client matching (pages)"],
)

@router.get(
    "/import/agent-client",
    response_class=HTMLResponse,
    include_in_schema=False,
)
async def superuser_import_agent_client_page(request: Request):
    """
    Page HTML pour importer le fichier de matching agent/client.
    URL : /superuser/import/agent-client
    """
    from app.main import templates

    context = {
        "request": request,
        "lang": "fr",  # superuser en FR par défaut
    }
    return templates.TemplateResponse(
        "superuser/import_agent_client.html",
        context,
    )
