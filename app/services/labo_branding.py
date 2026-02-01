from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.models import Labo

STATIC_DIR = Path("app/static").resolve()

@dataclass
class LaboBranding:
    labo_id: int
    name: str
    legal_name: Optional[str]
    siret: Optional[str]
    vat_number: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    address1: Optional[str]
    address2: Optional[str]
    zip: Optional[str]
    city: Optional[str]
    country: Optional[str]
    invoice_footer: Optional[str]
    logo_path: Optional[str]          # ex: "uploads/labos/12/logo.png"
    logo_abspath: Optional[str]       # ex: "/app/app/static/uploads/..."

async def get_labo_branding(session: AsyncSession, labo_id: int) -> LaboBranding:
    res = await session.execute(select(Labo).where(Labo.id == labo_id))
    labo = res.scalar_one_or_none()
    if not labo:
        raise ValueError("Labo not found")

    logo_abspath = None
    if labo.logo_path:
        p = (STATIC_DIR / labo.logo_path).resolve()
        # sécurité: forcer le logo à rester sous app/static
        if str(p).startswith(str(STATIC_DIR)) and p.exists():
            logo_abspath = str(p)

    return LaboBranding(
        labo_id=labo.id,
        name=labo.name,
        legal_name=labo.legal_name,
        siret=labo.siret,
        vat_number=labo.vat_number,
        email=labo.email,
        phone=labo.phone,
        address1=labo.address1,
        address2=labo.address2,
        zip=labo.zip,
        city=labo.city,
        country=labo.country,
        invoice_footer=labo.invoice_footer,
        logo_path=labo.logo_path,
        logo_abspath=logo_abspath,
    )
