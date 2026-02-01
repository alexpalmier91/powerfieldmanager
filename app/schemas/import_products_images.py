from __future__ import annotations

from typing import Optional, List, Literal
from pydantic import BaseModel, Field, HttpUrl


ImagesMode = Literal["main_only", "all_images"]


class IncomingProductImage(BaseModel):
    position: int = 0
    is_cover: bool = False

    # Option A : URL HD (recommandé)
    hd_url: Optional[HttpUrl] = None

    # fallbacks (si tu veux les envoyer)
    large_url: Optional[HttpUrl] = None
    medium_url: Optional[HttpUrl] = None
    thumb_url: Optional[HttpUrl] = None

    # Option B : ids bruts (si API reconstruit)
    id_image: Optional[int] = None


class IncomingImagesBlock(BaseModel):
    images_mode: ImagesMode = "main_only"
    images_limit: int = Field(default=6, ge=1, le=20)
    images: List[IncomingProductImage] = Field(default_factory=list)
