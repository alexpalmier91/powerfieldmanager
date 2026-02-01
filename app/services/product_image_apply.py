# app/services/product_image_apply.py
from __future__ import annotations

from typing import Optional, List

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Product, ProductImage  # ⚠️ adapte si ton modèle s'appelle autrement
from app.schemas.import_product_prestashop import PrestashopProductIn


async def upsert_product_images_from_presta(
    *,
    session: AsyncSession,
    labo_id: int,
    product: Product,
    presta: PrestashopProductIn,
    image_results: List[dict],
    mode: str,
    limit: int,
) -> None:
    """
    image_results = list of dict:
      {
        "position": int,
        "is_cover": bool,
        "original_url": str,
        "thumb_url": str,
        "hd_jpg_url": str,
        "hd_webp_url": str,
        "checksum": str
      }

    - met à jour cover sur Product (thumb_url/hd_jpg_url/hd_webp_url)
    - upsert ProductImage (position unique par produit)
    - si mode=all_images : supprime les positions > max reçu (optionnel)
    """
    # 1) cover sur Product
    cover = None
    for it in image_results:
        if it.get("is_cover"):
            cover = it
            break
    if not cover and image_results:
        cover = image_results[0]

    if cover:
        product.thumb_url = cover["thumb_url"]
        product.hd_jpg_url = cover["hd_jpg_url"]
        product.hd_webp_url = cover["hd_webp_url"]

    # 2) upsert table galerie
    # si tu veux “main_only” sans galerie, tu peux skip.
    if mode == "main_only":
        # option: ne garde que cover en table ProductImage si tu veux quand même
        image_results = image_results[:1]

    # upsert par (product_id, position)
    for it in image_results[:limit]:
        pos = int(it["position"])
        stmt = select(ProductImage).where(ProductImage.product_id == product.id, ProductImage.position == pos)
        res = await session.execute(stmt)
        row = res.scalar_one_or_none()

        if row:
            row.is_cover = bool(it["is_cover"])
            row.original_url = it["original_url"]
            row.thumb_url = it["thumb_url"]
            row.hd_jpg_url = it["hd_jpg_url"]
            row.hd_webp_url = it["hd_webp_url"]
            if hasattr(row, "checksum"):
                row.checksum = it.get("checksum")
        else:
            row = ProductImage(
                product_id=product.id,
                position=pos,
                is_cover=bool(it["is_cover"]),
                original_url=it["original_url"],
                thumb_url=it["thumb_url"],
                hd_jpg_url=it["hd_jpg_url"],
                hd_webp_url=it["hd_webp_url"],
            )
            if hasattr(row, "checksum"):
                row.checksum = it.get("checksum")
            session.add(row)

    # 3) nettoyage si all_images: supprime positions au-delà de la nouvelle liste (facultatif)
    if mode == "all_images":
        keep_positions = {int(it["position"]) for it in image_results[:limit]}
        if keep_positions:
            await session.execute(
                delete(ProductImage).where(
                    ProductImage.product_id == product.id,
                    ProductImage.position.not_in(sorted(keep_positions)),
                )
            )
