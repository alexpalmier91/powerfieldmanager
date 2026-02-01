import os
import asyncio
from decimal import Decimal
from typing import Optional, Tuple, Dict

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
import sqlalchemy as sa

from app.db.models import (
    Order, OrderItem,
    LaboDocument, LaboDocumentItem,
    LaboDocumentType, OrderStatus,
)

BATCH_SIZE = 1000


def _make_async_url(url: str) -> str:
    if not url:
        raise RuntimeError("DATABASE_URL manquant dans l'environment")
    if "+asyncpg" in url:
        return url
    if "+psycopg2" in url:
        return url.replace("+psycopg2", "+asyncpg")
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def _infer_type_from_number(onum: Optional[str]) -> LaboDocumentType:
    if not onum:
        return LaboDocumentType.FA
    p = onum.strip().upper()
    if p.startswith("CO"):
        return LaboDocumentType.BC
    if p.startswith("BL"):
        return LaboDocumentType.BL
    if p.startswith("FA"):
        return LaboDocumentType.FA
    return LaboDocumentType.FA


def _coerce_status(val) -> Optional[OrderStatus]:
    if val is None:
        return None
    if isinstance(val, OrderStatus):
        return val
    try:
        s = str(val).strip().lower()
        return OrderStatus[s]
    except Exception:
        return None


def _to_decimal(x, default: Decimal = Decimal("0")) -> Decimal:
    if x is None:
        return default
    try:
        if isinstance(x, Decimal):
            return x
        return Decimal(str(x))
    except Exception:
        return default


async def copy_batch(session: AsyncSession, offset: int, limit: int) -> Tuple[int, int, int]:
    # On évite les orders sans numéro en amont (sécurité)
    q = (
        sa.select(Order)
        .where(Order.order_number.isnot(None))
        .order_by(Order.id.asc())
        .offset(offset)
        .limit(limit)
    )
    orders = (await session.execute(q)).scalars().all()
    if not orders:
        return (0, 0, 0)

    inserted = 0
    updated = 0
    items_total = 0

    for o in orders:
        onum = getattr(o, "order_number", None)
        if not onum:
            print(f"[WARN] Order id={o.id} ignoré : order_number NULL/vidé")
            continue

        # Document existant ?
        existing = (
            await session.execute(
                sa.select(LaboDocument).where(
                    LaboDocument.labo_id == o.labo_id,
                    LaboDocument.order_number == onum,
                )
            )
        ).scalars().first()

        if existing:
            doc = existing
            updated += 1
        else:
            doc = LaboDocument(labo_id=o.labo_id, order_number=onum)
            session.add(doc)
            inserted += 1

        # Champs tête
        doc.client_id = getattr(o, "client_id", None)
        if hasattr(doc, "customer_id"):
            doc.customer_id = getattr(o, "customer_id", None)
        doc.agent_id = getattr(o, "agent_id", None)
        doc.order_date = getattr(o, "order_date", None)
        doc.delivery_date = getattr(o, "delivery_date", None)
        doc.client_name = getattr(o, "client_name", None)
        doc.currency = getattr(o, "currency", "EUR")
        doc.payment_method = getattr(o, "payment_method", None)
        doc.status = _coerce_status(getattr(o, "status", None))
        doc.type = _infer_type_from_number(onum)
        doc.total_ht = _to_decimal(getattr(o, "total_ht", 0))
        doc.total_ttc = _to_decimal(getattr(o, "total_ttc", 0))

        await session.flush()

        # Reset des lignes (idempotent)
        await session.execute(
            sa.delete(LaboDocumentItem).where(LaboDocumentItem.document_id == doc.id)
        )
        await session.flush()

        # Lignes source
        src_items = (
            await session.execute(
                sa.select(OrderItem)
                .where(OrderItem.order_id == o.id)
                .order_by(OrderItem.id.asc())
            )
        ).scalars().all()

        # 🔹 AGRÉGATION par product_id pour éviter le doublon (document_id, product_id) unique
        #    - somme des qty
        #    - somme des total_ht
        #    - unit_ht recalculé = total_ht / qty (si qty > 0), sinon fallback premier unit_ht non nul
        agg: Dict[Optional[int], Dict[str, object]] = {}

        for it in src_items:
            pid = getattr(it, "product_id", None)  # None autorisé : UNIQUE accepte plusieurs NULL
            qty = int(getattr(it, "qty", 0) or 0)

            unit_ht = getattr(it, "unit_ht", None)
            if unit_ht is None:
                unit_ht = getattr(it, "price_ht", None)
            unit_ht = _to_decimal(unit_ht)

            total_ht = getattr(it, "total_ht", None)
            if total_ht is None:
                total_ht = getattr(it, "line_ht", None)
            if total_ht is None and qty:
                total_ht = unit_ht * Decimal(qty)
            total_ht = _to_decimal(total_ht)

            sku = (getattr(it, "sku", None) or "")
            ean = getattr(it, "ean13", None)

            if pid not in agg:
                agg[pid] = {
                    "sku": sku,
                    "ean13": ean,
                    "qty": qty,
                    "sum_total": total_ht,
                    "first_unit": unit_ht if unit_ht != Decimal("0") else None,
                }
            else:
                agg[pid]["qty"] = int(agg[pid]["qty"]) + qty
                agg[pid]["sum_total"] = _to_decimal(agg[pid]["sum_total"]) + total_ht
                # garde le premier unit non nul si on n'en a pas encore
                if agg[pid]["first_unit"] in (None, Decimal("0")) and unit_ht != Decimal("0"):
                    agg[pid]["first_unit"] = unit_ht

        # Insertion des lignes agrégées
        for pid, data in agg.items():
            qty = int(data["qty"])
            sum_total = _to_decimal(data["sum_total"])
            if qty > 0:
                unit_ht_final = (sum_total / Decimal(qty)).quantize(Decimal("0.01"))
            else:
                unit_ht_final = _to_decimal(data.get("first_unit", Decimal("0")))

            new_item = LaboDocumentItem(
                document_id=doc.id,
                product_id=pid,
                sku=str(data["sku"] or ""),
                ean13=data.get("ean13"),
                qty=qty,
                unit_ht=unit_ht_final,
                total_ht=sum_total.quantize(Decimal("0.01")),
            )
            session.add(new_item)
            items_total += 1

    return (inserted, updated, items_total)


async def purge_orders(session: AsyncSession):
    # Attention : "order" est un mot réservé → quotes
    await session.execute(sa.text("DELETE FROM order_item"))
    await session.execute(sa.text('DELETE FROM "order"'))


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Duplicate orders -> labo_document (optionally move).")
    parser.add_argument("--move", action="store_true", help="Purge order/order_item after successful copy.")
    parser.add_argument("--batch", type=int, default=BATCH_SIZE, help="Batch size (default 1000).")
    args = parser.parse_args()

    db_url = _make_async_url(os.getenv("DATABASE_URL", ""))
    engine = create_async_engine(db_url, pool_pre_ping=True)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    orders_total = 0
    inserted_total = 0
    updated_total = 0
    items_total = 0

    async with Session() as session:
        # On ne compte que les orders avec order_number NON NULL (aligné avec copy_batch)
        orders_total = (
            await session.execute(
                sa.select(sa.func.count()).select_from(
                    sa.select(Order.id).where(Order.order_number.isnot(None)).subquery()
                )
            )
        ).scalar_one()

        print(f"[INFO] Orders à traiter (order_number NOT NULL): {orders_total}")

        if orders_total == 0:
            print("[INFO] Rien à dupliquer. Fin.")
        else:
            offset = 0
            while offset < orders_total:
                ins, upd, itc = await copy_batch(session, offset=offset, limit=args.batch)
                inserted_total += ins
                updated_total += upd
                items_total += itc

                await session.commit()
                print(f"[BATCH] offset={offset} +{ins} inserted, +{upd} updated, +{itc} items")
                offset += args.batch

            if args.move:
                print("[INFO] Purge de order_item et order …")
                await purge_orders(session)
                await session.commit()

    await engine.dispose()

    print("\n======== Résumé ========")
    print(f"Orders source (numérotés) : {orders_total}")
    print(f"LaboDocuments insérés     : {inserted_total}")
    print(f"LaboDocuments mis à jour  : {updated_total}")
    print(f"Items copiés              : {items_total}")
    print(f"Mode                      : {'MOVE (purge après copie)' if args.move else 'COPY ONLY'}")
    print("========================\n")


if __name__ == "__main__":
    asyncio.run(main())
