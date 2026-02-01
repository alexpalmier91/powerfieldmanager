# app/routers/labo_marketing_fonts_api.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_async_session
from app.db.models import MarketingFont
from app.core.security import require_role

from app.services.storage import (
    store_temp_file,
    store_marketing_font,
    delete_marketing_font_file,
    get_marketing_font_path,  # optionnel (non utilisé ici)
)

router = APIRouter(
    prefix="/api-zenhub/labo/marketing-fonts",
    tags=["labo-marketing-fonts"],
)

MAX_FONT_SIZE = 2 * 1024 * 1024  # 2MB


# ---------------------------------------------------------
# Helpers auth/context
# ---------------------------------------------------------
def _get_labo_id(user) -> int:
    labo_id = getattr(user, "labo_id", None)
    if labo_id is None and isinstance(user, dict):
        labo_id = user.get("labo_id")

    if not labo_id:
        raise HTTPException(status_code=403, detail="Compte labo inactif ou non rattaché")

    try:
        return int(labo_id)
    except Exception:
        raise HTTPException(status_code=403, detail="Contexte labo invalide")


# ---------------------------------------------------------
# Helpers media url
# ---------------------------------------------------------
def _media_font_url(labo_id: int, filename: str) -> str:
    return f"/media/marketing_fonts/labo_{labo_id}/{filename}"


# ---------------------------------------------------------
# 1) LIST
# ---------------------------------------------------------
@router.get("")
async def list_fonts(
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    stmt = (
        select(MarketingFont)
        .where(MarketingFont.labo_id == labo_id)
        .order_by(MarketingFont.created_at.desc())
    )
    res = await session.execute(stmt)
    fonts = res.scalars().all()

    out = []
    for f in fonts:
        out.append(
            {
                "id": f.id,
                "labo_id": f.labo_id,
                # ✅ ton modèle a "name" (pas display_name)
                "display_name": f.name,
                "filename": f.filename,
                # ✅ champ ajouté côté model (à aligner avec ta DB)
                "original_name": getattr(f, "original_name", None),
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "woff2_url": _media_font_url(f.labo_id, f.filename),
            }
        )
    return out


# ---------------------------------------------------------
# 2) UPLOAD
# ---------------------------------------------------------
@router.post("")
async def upload_font(
    display_name: str = Form(...),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    original = (file.filename or "").strip()
    if not original.lower().endswith(".woff2"):
        raise HTTPException(status_code=400, detail="WOFF2 uniquement (.woff2)")

    content_type = (file.content_type or "").lower().strip()
    # certains navigateurs envoient application/octet-stream
    allowed = {
        "font/woff2",
        "application/font-woff2",
        "application/octet-stream",
        "binary/octet-stream",
    }
    if content_type and content_type not in allowed:
        raise HTTPException(status_code=400, detail="WOFF2 uniquement")

    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(blob) > MAX_FONT_SIZE:
        raise HTTPException(status_code=400, detail="Police trop volumineuse (2 Mo max)")

    temp_path = store_temp_file(original, blob)

    try:
        stored_filename = store_marketing_font(
            labo_id=labo_id,
            original_filename=original,
            temp_path=temp_path,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # ✅ modèle = name / filename / original_name
    f = MarketingFont(
        labo_id=labo_id,
        name=display_name.strip(),   # <- champ DB
        filename=stored_filename,
        original_name=original,      # <- nécessite l'ajout du champ dans le model
    )
    session.add(f)
    await session.commit()
    await session.refresh(f)

    return {
        "ok": True,
        "id": f.id,
        "display_name": f.name,
        "filename": f.filename,
        "original_name": getattr(f, "original_name", None),
        "woff2_url": _media_font_url(f.labo_id, f.filename),
    }


# ---------------------------------------------------------
# 3) DELETE
# ---------------------------------------------------------
@router.delete("/{font_id}")
async def delete_font(
    font_id: int,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_role("LABO")),
):
    labo_id = _get_labo_id(user)

    f = await session.get(MarketingFont, font_id)
    if not f or f.labo_id != labo_id:
        raise HTTPException(status_code=404, detail="Police introuvable")

    # best effort delete file
    try:
        delete_marketing_font_file(f.labo_id, f.filename)  # ✅ bon nom de fonction
    except Exception:
        pass

    await session.delete(f)
    await session.commit()
    return {"ok": True}
