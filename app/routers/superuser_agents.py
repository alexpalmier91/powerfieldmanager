# app/routers/superuser_agents.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_async_session
from app.db.models import Agent
from app.core.security import require_role

router = APIRouter(prefix="/api-zenhub/superuser", tags=["superuser"])

@router.get("/agents")
async def list_agents(
    session: AsyncSession = Depends(get_async_session),
    _ = Depends(require_role(["SUPERUSER", "SUPERADMIN"]))
):
    q = await session.execute(select(Agent).order_by(Agent.lastname.asc()))
    agents = q.scalars().all()
    items = [{
        "id": a.id,
        "firstname": a.firstname,
        "lastname": a.lastname,
        "email": a.email,
        "phone": a.phone,
    } for a in agents]
    return {"items": items, "total": len(items)}
