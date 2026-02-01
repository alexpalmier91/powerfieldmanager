# app/routers/fonts_global.py
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.db.models import GlobalFont

router = APIRouter(tags=["fonts"])

@router.get("/fonts/global")
async def list_global_fonts(session: AsyncSession = Depends(get_async_session)):
    rows = await session.execute(
        select(GlobalFont)
        .where(GlobalFont.enabled == True)
        .order_by(GlobalFont.display_name.asc())
    )
    fonts = rows.scalars().all()

    return [
        {
            "id": f.id,
            "display_name": f.display_name,
            "family_key": f.family_key,
            "weight": f.weight,
            "style": f.style,
            # ✅ URL pour que le navigateur puisse charger la police
            "file_url": f"/api-zenhub/fonts/global/{f.id}/file",
        }
        for f in fonts
    ]


@router.get("/fonts/global/{font_id}/file")
async def get_global_font_file(font_id: int, session: AsyncSession = Depends(get_async_session)):
    f = await session.get(GlobalFont, font_id)
    if not f or not getattr(f, "enabled", True):
        raise HTTPException(status_code=404, detail="Police globale introuvable")

    p = Path(f.file_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Fichier de police manquant")

    ext = p.suffix.lower()
    media_type = (
        "font/ttf" if ext == ".ttf"
        else "font/otf" if ext == ".otf"
        else "application/octet-stream"
    )

    return FileResponse(
    str(p),
    media_type=media_type,
    filename=p.name,
    headers={
        # ✅ IMPORTANT: font en inline (sinon certains navigateurs/edge-cases bloquent)
        "Content-Disposition": f'inline; filename="{p.name}"',
        # optionnel mais recommandé
        "Cache-Control": "public, max-age=31536000, immutable",
    },
)

