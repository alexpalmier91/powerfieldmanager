# app/routers/superuser_labos_api.py
from __future__ import annotations

from pathlib import Path
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_async_session
from app.db.models import Labo
from app.core.security import require_role

router = APIRouter(
    prefix="/api-zenhub/superuser/labos",
    tags=["superuser-labos-api"],
)

# ------------------------
# CONFIG UPLOAD LOGO
# ------------------------
STATIC_DIR = Path("app/static").resolve()
UPLOAD_ROOT = STATIC_DIR / "uploads" / "labos"
MAX_LOGO_BYTES = 2 * 1024 * 1024
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".svg"}


# =========================================================
#                     SCHEMAS
# =========================================================

class LaboBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)

    legal_name: Optional[str] = Field(default=None, max_length=255)
    siret: Optional[str] = Field(default=None, max_length=14)
    vat_number: Optional[str] = Field(default=None, max_length=32)

    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=32)

    address1: Optional[str] = Field(default=None, max_length=255)
    address2: Optional[str] = Field(default=None, max_length=255)
    zip: Optional[str] = Field(default=None, max_length=16)
    city: Optional[str] = Field(default=None, max_length=120)
    country: Optional[str] = Field(default=None, max_length=120)

    invoice_footer: Optional[str] = None
    is_active: bool = True

    @field_validator("siret")
    @classmethod
    def validate_siret(cls, v: Optional[str]):
        if not v:
            return None
        v = v.strip()
        if not v.isdigit() or len(v) != 14:
            raise ValueError("SIRET invalide (14 chiffres requis)")
        return v


class LaboCreate(LaboBase):
    pass


class LaboUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)

    legal_name: Optional[str] = Field(default=None, max_length=255)
    siret: Optional[str] = Field(default=None, max_length=14)
    vat_number: Optional[str] = Field(default=None, max_length=32)

    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=32)

    address1: Optional[str] = Field(default=None, max_length=255)
    address2: Optional[str] = Field(default=None, max_length=255)
    zip: Optional[str] = Field(default=None, max_length=16)
    city: Optional[str] = Field(default=None, max_length=120)
    country: Optional[str] = Field(default=None, max_length=120)

    invoice_footer: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("siret")
    @classmethod
    def validate_siret(cls, v: Optional[str]):
        if v is None or v == "":
            return None
        v = v.strip()
        if not v.isdigit() or len(v) != 14:
            raise ValueError("SIRET invalide (14 chiffres requis)")
        return v


class LaboOut(BaseModel):
    id: int
    name: str

    legal_name: Optional[str] = None
    siret: Optional[str] = None
    vat_number: Optional[str] = None

    email: Optional[str] = None
    phone: Optional[str] = None

    address1: Optional[str] = None
    address2: Optional[str] = None
    zip: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None

    invoice_footer: Optional[str] = None
    is_active: bool
    logo_path: Optional[str] = None

    class Config:
        from_attributes = True


class LaboListOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[LaboOut]


# =========================================================
#                     ENDPOINTS API
# =========================================================

@router.get("", response_model=LaboListOut)
async def list_labos(
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    """
    Liste paginée des labos avec CHAMPS COMPLETS (email, city, is_active, logo_path, etc.)
    Réponse: { items, total, page, page_size }
    """
    offset = (page - 1) * page_size

    stmt = select(Labo)
    stmt_count = select(func.count()).select_from(Labo)

    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Labo.name.ilike(like))
        stmt_count = stmt_count.where(Labo.name.ilike(like))

    stmt = stmt.order_by(Labo.name.asc()).limit(page_size).offset(offset)

    total = (await session.execute(stmt_count)).scalar_one()
    items = (await session.execute(stmt)).scalars().all()

    return {
      "total": total,
      "page": page,
      "page_size": page_size,
      "items": items,
      "_debug": "LABOS_API_COMPLET_V2"
    }


@router.get("/{labo_id}", response_model=LaboOut)
async def get_labo(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    labo = (await session.execute(select(Labo).where(Labo.id == labo_id))).scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable")
    return labo


@router.post("", response_model=LaboOut)
async def create_labo(
    payload: LaboCreate,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    existing = (await session.execute(select(Labo).where(Labo.name == payload.name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Un labo avec ce nom existe déjà")

    labo = Labo(**payload.model_dump())
    session.add(labo)
    await session.commit()
    await session.refresh(labo)
    return labo


@router.put("/{labo_id}", response_model=LaboOut)
async def update_labo(
    labo_id: int,
    payload: LaboUpdate,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    labo = (await session.execute(select(Labo).where(Labo.id == labo_id))).scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"] != labo.name:
        existing = (await session.execute(select(Labo).where(Labo.name == data["name"]))).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="Un labo avec ce nom existe déjà")

    for k, v in data.items():
        setattr(labo, k, v)

    await session.commit()
    await session.refresh(labo)
    return labo


# =========================================================
#                     LOGO LABO
# =========================================================

def _safe_ext(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".jpeg":
        return ".jpg"
    return ext


@router.post("/{labo_id}/logo", response_model=LaboOut)
async def upload_labo_logo(
    labo_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    labo = (await session.execute(select(Labo).where(Labo.id == labo_id))).scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    ext = _safe_ext(file.filename or "")
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Format non supporté (PNG / JPG / SVG)")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(content) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo trop volumineux (max 2 Mo)")

    dest_dir = (UPLOAD_ROOT / str(labo_id)).resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    dest_file = (dest_dir / f"logo{ext}").resolve()
    if not str(dest_file).startswith(str(STATIC_DIR)):
        raise HTTPException(status_code=400, detail="Chemin fichier invalide")

    with open(dest_file, "wb") as f:
        f.write(content)

    labo.logo_path = dest_file.relative_to(STATIC_DIR).as_posix()
    await session.commit()
    await session.refresh(labo)
    return labo


@router.delete("/{labo_id}/logo", response_model=LaboOut)
async def delete_labo_logo(
    labo_id: int,
    session: AsyncSession = Depends(get_async_session),
    _: Any = Depends(require_role(["SUPERUSER", "SUPERADMIN"])),
):
    labo = (await session.execute(select(Labo).where(Labo.id == labo_id))).scalar_one_or_none()
    if not labo:
        raise HTTPException(status_code=404, detail="Labo introuvable")

    if labo.logo_path:
        p = (STATIC_DIR / labo.logo_path).resolve()
        if str(p).startswith(str(STATIC_DIR)) and p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    labo.logo_path = None
    await session.commit()
    await session.refresh(labo)
    return labo
