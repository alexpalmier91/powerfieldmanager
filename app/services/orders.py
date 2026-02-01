
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.models import Order, OrderItem

TVA_DEFAULT = Decimal("0.20")  # simple: TTC = HT * 1.20

async def recompute_totals(db: AsyncSession, order_id: int) -> None:
    res = await db.execute(select(OrderItem).where(OrderItem.order_id == order_id))
    items = res.scalars().all()
    total_ht = sum((Decimal(i.line_ht) for i in items), Decimal("0"))
    total_ttc = (total_ht * (Decimal("1") + TVA_DEFAULT)).quantize(Decimal("0.01"))
    ord = await db.get(Order, order_id)
    ord.total_ht = total_ht
    ord.total_ttc = total_ttc
    await db.flush()
