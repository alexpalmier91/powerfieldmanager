from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class PrestashopTierPriceIn(BaseModel):
    from_: int
    unit_ht: float

    class Config:
        populate_by_name = True
        fields = {"from_": "from"}  # JSON key "from" -> python "from_"


class PrestashopImageItemIn(BaseModel):
    position: int = 0
    is_cover: bool = False

    # côté Presta API (ta capture)
    hd_url: Optional[str] = None

    # (optionnels si tu les ajoutes plus tard côté Presta)
    thumb_url: Optional[str] = None
    original_url: Optional[str] = None


class PrestashopImagesIn(BaseModel):
    mode: Optional[str] = None
    limit: Optional[int] = None
    hd_size: Optional[str] = None
    thumb_size: Optional[str] = None
    items: List[PrestashopImageItemIn] = []


class PrestashopProductIn(BaseModel):
    # --- Champs réels vogapi ---
    id: int
    ref: str
    name: str
    ean13: Optional[str] = None

    price_ht: float
    stock: int

    image_url: Optional[str] = None
    description: Optional[str] = None
    description_short: Optional[str] = None

    tax_rate: Optional[float] = None
    minimal_quantity: Optional[int] = None
    date_upd: Optional[datetime] = None

    # ✅ Nouveaux champs
    tier_prices: List[PrestashopTierPriceIn] = []
    images: Optional[PrestashopImagesIn] = None

    # --- ALIAS MÉTIER (pour ton service existant) ---
    @property
    def reference(self) -> str:
        return self.ref

    @property
    def designation(self) -> str:
        return self.name

    @property
    def ean(self) -> Optional[str]:
        return self.ean13

    @property
    def quantity(self) -> int:
        return self.stock
