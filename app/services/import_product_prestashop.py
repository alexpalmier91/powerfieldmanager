from __future__ import annotations

from typing import Dict, Any, List, Optional, Tuple

import httpx
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Product, ProductImage, PriceTier
from app.schemas.import_product_prestashop import PrestashopProductIn
from app.services.product_image_pipeline import ProductImagePipeline

PRESTASHOP_API_URL = "https://www.vogprotect.fr/module/vogapi/products"
PRESTASHOP_TOKEN = "kCNPhdMjp16rm2B5dcpUNMMhrgk3aHCX"
PRESTASHOP_SHOP_ID = 9


# ---------------------------------------------------------
# Fetch produits depuis l'API PrestaShop (vogapi)
# ---------------------------------------------------------
async def fetch_prestashop_products(
    labo_id: int,
    *,
    images_mode: str = "main_only",   # "main_only" | "all_images"
    images_limit: int = 6,
    limit: int = 500,
    since: Optional[str] = None,
    q: Optional[str] = None,
) -> list[PrestashopProductIn]:
    params: Dict[str, Any] = {
        "shop_id": PRESTASHOP_SHOP_ID,
        "limit": min(int(limit), 500),
        "token": PRESTASHOP_TOKEN,
        "images_mode": images_mode,
        "images_limit": int(images_limit),
    }
    if since:
        params["since"] = since
    if q:
        params["q"] = q

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(PRESTASHOP_API_URL, params=params)
        resp.raise_for_status()

        data = resp.json()
        if not isinstance(data, dict):
            raise ValueError("Format API PrestaShop invalide: JSON objet attendu")

        raw_products = data.get("products", [])
        if not isinstance(raw_products, list):
            raise ValueError("Format API PrestaShop invalide: 'products' doit être une liste")

        products: list[PrestashopProductIn] = []
        ignored = 0
        for raw in raw_products:
            if not isinstance(raw, dict):
                ignored += 1
                continue
            try:
                products.append(PrestashopProductIn(**raw))
            except Exception:
                ignored += 1

        print(
            f"[PRESTASHOP IMPORT] shop_id={PRESTASHOP_SHOP_ID} "
            f"received={len(raw_products)} parsed={len(products)} ignored={ignored}"
        )
        return products


async def _get_existing_images_by_position(
    session: AsyncSession,
    product_id: int
) -> Dict[int, ProductImage]:
    res = await session.execute(
        select(ProductImage).where(ProductImage.product_id == product_id)
    )
    rows = res.scalars().all()
    out: Dict[int, ProductImage] = {}
    for r in rows:
        try:
            out[int(r.position)] = r
        except Exception:
            continue
    return out


async def _apply_cover_to_product(product: Product, image_row: ProductImage) -> None:
    # Champs cover dans Product
    product.thumb_url = image_row.thumb_url
    product.hd_jpg_url = image_row.hd_jpg_url
    product.hd_webp_url = image_row.hd_webp_url
    # legacy (facultatif)
    if image_row.original_url and not product.image_url:
        product.image_url = image_row.original_url


async def _sync_price_tiers(
    session: AsyncSession,
    product_id: int,
    tiers_in: List[Any],
) -> Tuple[int, int, int]:
    """
    Sync strict des paliers:
      - clé = qty_min (from_)
      - update price_ht si change
      - insert manquants
      - delete ceux qui ne sont plus dans Presta
    """
    # normalise (qty_min -> price)
    normalized: Dict[int, float] = {}
    for t in (tiers_in or []):
        try:
            qty_min = int(getattr(t, "from_", None) if not isinstance(t, dict) else t.get("from_") or t.get("from"))
            unit_ht = float(getattr(t, "unit_ht", None) if not isinstance(t, dict) else t.get("unit_ht"))
        except Exception:
            continue
        if qty_min and qty_min > 1 and unit_ht and unit_ht > 0:
            normalized[qty_min] = unit_ht

    # load existing
    res = await session.execute(
        select(PriceTier).where(PriceTier.product_id == product_id)
    )
    existing_rows = res.scalars().all()
    existing_by_qty: Dict[int, PriceTier] = {int(r.qty_min): r for r in existing_rows if r.qty_min is not None}

    created = 0
    updated = 0

    keep_qty = set()

    for qty_min, unit_ht in normalized.items():
        keep_qty.add(qty_min)
        row = existing_by_qty.get(qty_min)
        if row is None:
            session.add(
                PriceTier(
                    product_id=product_id,
                    qty_min=qty_min,
                    price_ht=unit_ht,
                )
            )
            created += 1
        else:
            # compare simple
            try:
                old = float(row.price_ht)
            except Exception:
                old = None
            if old is None or abs(old - unit_ht) > 1e-6:
                row.price_ht = unit_ht
                updated += 1

    # delete missing
    deleted = 0
    if existing_rows:
        for r in existing_rows:
            try:
                q = int(r.qty_min)
            except Exception:
                continue
            if q not in keep_qty:
                await session.delete(r)
                deleted += 1

    return created, updated, deleted


# ---------------------------------------------------------
# Import en base + pipeline images local + tiers price
# ---------------------------------------------------------
async def import_product_prestashop(
    session: AsyncSession,
    labo_id: int,
    *,
    images_mode: str = "main_only",  # "main_only" | "all_images"
    images_limit: int = 6,
    limit: int = 500,
    since: Optional[str] = None,
) -> Dict[str, Any]:
    products = await fetch_prestashop_products(
        labo_id,
        images_mode=images_mode,
        images_limit=images_limit,
        limit=limit,
        since=since,
    )

    pipeline = ProductImagePipeline(
        media_root="/app/media",
        media_base_url="/media",
        max_download_bytes=15 * 1024 * 1024,
        thumb_max_px=400,
        retries=2,
    )

    created = 0
    updated = 0
    ignored = 0

    # tiers price counters
    tiers_created = 0
    tiers_updated = 0
    tiers_deleted = 0

    # images counters
    images_ok = 0
    images_failed = 0
    images_skipped_cache = 0

    for p in products:
        # ----------------------------
        # Upsert Product
        # ----------------------------
        stmt = select(Product).where(Product.labo_id == labo_id, Product.sku == p.reference)
        res = await session.execute(stmt)
        product = res.scalar_one_or_none()

        if product:
            product.stock = p.quantity
            if p.designation and product.name != p.designation:
                product.name = p.designation
            if p.ean and not product.ean13:
                product.ean13 = p.ean
            if getattr(p, "description", None):
                product.description = p.description
            # price_ht: à toi de décider si tu veux écraser systématiquement ou non
            # product.price_ht = p.price_ht
            updated += 1
        else:
            product = Product(
                labo_id=labo_id,
                sku=p.reference,
                name=p.designation,
                ean13=p.ean,
                description=p.description or None,
                image_url=p.image_url,  # legacy
                stock=p.quantity,
                price_ht=p.price_ht,
                is_active=True,
            )
            session.add(product)
            await session.flush()  # product.id
            created += 1

        # ----------------------------
        # Sync tiers prices (PriceTier)
        # ----------------------------
        try:
            c, u, d = await _sync_price_tiers(session, product.id, getattr(p, "tier_prices", []) or [])
            tiers_created += c
            tiers_updated += u
            tiers_deleted += d
        except Exception as e:
            print(f"[PRESTASHOP IMPORT] tiers error sku={p.reference} err={e}")

        # ----------------------------
        # Images : normalize items
        # ----------------------------
        try:
            items: List[Dict[str, Any]] = []

            # Nouveau JSON (images.items)
            if getattr(p, "images", None) is not None and getattr(p.images, "items", None):
                for it in (p.images.items or []):
                    # pydantic model -> attributs
                    pos = int(getattr(it, "position", 0))
                    is_cover = bool(getattr(it, "is_cover", False))
                    hd_url = getattr(it, "hd_url", None)

                    if not hd_url:
                        continue
                    items.append({"position": pos, "is_cover": is_cover, "hd_url": str(hd_url)})

            # Fallback legacy image_url (cover seul)
            elif p.image_url:
                items = [{"position": 0, "is_cover": True, "hd_url": str(p.image_url)}]

            # mode / limit
            if images_mode == "main_only":
                items = items[:1]
            else:
                items = items[: int(images_limit)]

            if not items:
                continue

            # Existing DB rows by position (pour checksum + update)
            existing = await _get_existing_images_by_position(session, product.id)

            # Track positions for cleanup
            keep_positions = set()

            for it in items:
                pos = int(it["position"])
                keep_positions.add(pos)

                row = existing.get(pos)
                existing_checksum = row.checksum if (row and row.checksum) else None

                out = await pipeline.ensure_image_set(
                    labo_id=labo_id,
                    sku=product.sku,
                    image_index=pos,
                    source_url=it["hd_url"],
                    existing_checksum=existing_checksum,
                )

                if not out:
                    images_failed += 1
                    continue

                # si pipeline a pu skipper car checksum identique
                if out.source_bytes == 0 and existing_checksum:
                    images_skipped_cache += 1

                images_ok += 1

                # upsert ProductImage row
                if row is None:
                    row = ProductImage(
                        product_id=product.id,
                        position=pos,
                    )
                    session.add(row)

                row.is_cover = bool(it["is_cover"])
                row.original_url = it["hd_url"]

                row.thumb_url = out.thumb_url
                row.hd_jpg_url = out.hd_jpg_url
                row.hd_webp_url = out.hd_webp_url

                row.checksum = out.checksum_sha1
                row.source_etag = out.source_etag
                row.source_last_modified = out.source_last_modified
                row.source_size = out.source_size

            # Cover : priorité à is_cover sinon position 0 sinon 1ère
            await session.flush()
            res2 = await session.execute(
                select(ProductImage)
                .where(ProductImage.product_id == product.id)
                .order_by(ProductImage.position.asc())
            )
            all_rows = res2.scalars().all()

            cover_row: Optional[ProductImage] = None
            for r in all_rows:
                if r.is_cover:
                    cover_row = r
                    break
            if cover_row is None:
                for r in all_rows:
                    if r.position == 0:
                        cover_row = r
                        break
            if cover_row is None and all_rows:
                cover_row = all_rows[0]

            if cover_row:
                await _apply_cover_to_product(product, cover_row)

            # cleanup : seulement en all_images
            if images_mode == "all_images" and keep_positions:
                await session.execute(
                    delete(ProductImage).where(
                        ProductImage.product_id == product.id,
                        ProductImage.position.not_in(sorted(keep_positions)),
                    )
                )

        except Exception as e:
            print(f"[PRESTASHOP IMPORT] images error sku={p.reference} err={e}")

    await session.commit()

    return {
        "status": "SUCCESS",
        "labo_id": labo_id,
        "total_received": len(products),
        "created": created,
        "updated": updated,
        "ignored": ignored,
        "images_mode": images_mode,
        "images_limit": int(images_limit),
        "images_ok": images_ok,
        "images_failed": images_failed,
        "images_skipped_cache": images_skipped_cache,
        "tiers_created": tiers_created,
        "tiers_updated": tiers_updated,
        "tiers_deleted": tiers_deleted,
    }
