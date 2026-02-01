# app/routers/agent_appointments.py
from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.db.session import get_async_session
from app.db.models import (
    Agent,
    Client,
    Appointment,
    AppointmentStatus,
)
from app.core.security import get_current_user
from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentUpdate,
    AppointmentOut,
)

router = APIRouter(
    prefix="/api-zenhub/agent",
    tags=["agent-appointments"],
)

# =========================================================
#   Helper ultra-tolérant : identifiant d’agent courant
# =========================================================
async def get_current_agent_id(
    current_user: Any = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> int:
    """
    Essaie plusieurs méthodes pour trouver l'agent :
      1) current_user.agent_id (attribut ou dict)
      2) current_user.impersonated_agent_id (mode SU)
      3) Agent.user_id == current_user.id
    Si rien n'est trouvé -> 403.
    """

    def get_attr(obj: Any, name: str, default=None):
        if isinstance(obj, dict):
            return obj.get(name, default)
        return getattr(obj, name, default)

    # 1) agent_id direct dans le token
    agent_id = get_attr(current_user, "agent_id", None) or get_attr(
        current_user, "agentId", None
    )
    if agent_id:
        return int(agent_id)

    # 2) impersonation (superuser)
    imp_id = get_attr(current_user, "impersonated_agent_id", None) or get_attr(
        current_user, "impersonatedAgentId", None
    )
    if imp_id:
        return int(imp_id)

    # 3) lookup par user_id -> Agent.user_id
    user_id = get_attr(current_user, "id", None)
    if user_id:
        stmt = select(Agent.id).where(Agent.user_id == user_id)
        res = await session.execute(stmt)
        found = res.scalar_one_or_none()
        if found:
            return int(found)

    # 4) Rien trouvé : on bloque
    raise HTTPException(
        status_code=403,
        detail="Accès réservé aux agents (aucun agent lié à cet utilisateur).",
    )


# =========================================================
#   Liste RDV
# =========================================================
@router.get("/appointments", response_model=List[AppointmentOut])
async def list_appointments(
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime] = Query(None, alias="to"),
    session: AsyncSession = Depends(get_async_session),
    agent_id: int = Depends(get_current_agent_id),
):
    if date_from is None:
        date_from = datetime.utcnow() - timedelta(days=30)
    if date_to is None:
        date_to = datetime.utcnow() + timedelta(days=30)

    stmt = (
        select(Appointment, Client.company_name)
        .outerjoin(Client, Client.id == Appointment.client_id)
        .where(
            and_(
                Appointment.agent_id == agent_id,
                Appointment.start_datetime >= date_from,
                Appointment.start_datetime <= date_to,
            )
        )
        .order_by(Appointment.start_datetime.asc())
    )

    rows = (await session.execute(stmt)).all()
    out: List[AppointmentOut] = []

    for appt, cname in rows:
        out.append(
            AppointmentOut(
                id=appt.id,
                client_id=appt.client_id,
                labo_id=None,
                title=appt.title or "",
                notes=appt.notes,
                start_datetime=appt.start_datetime,
                end_datetime=appt.end_datetime,
                status=appt.status,
                client_name=cname,
            )
        )

    return out


# =========================================================
#   Lecture RDV
# =========================================================
@router.get("/appointments/{appointment_id}", response_model=AppointmentOut)
async def get_appointment(
    appointment_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent_id: int = Depends(get_current_agent_id),
):
    stmt = (
        select(Appointment, Client.company_name)
        .outerjoin(Client, Client.id == Appointment.client_id)
        .where(
            Appointment.id == appointment_id,
            Appointment.agent_id == agent_id,
        )
    )
    row = (await session.execute(stmt)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Rendez-vous introuvable.")

    appt, cname = row

    return AppointmentOut(
        id=appt.id,
        client_id=appt.client_id,
        labo_id=None,
        title=appt.title,
        notes=appt.notes,
        start_datetime=appt.start_datetime,
        end_datetime=appt.end_datetime,
        status=appt.status,
        client_name=cname,
    )


# =========================================================
#   Création RDV
# =========================================================
@router.post("/appointments", response_model=AppointmentOut)
async def create_appointment(
    payload: AppointmentCreate,
    session: AsyncSession = Depends(get_async_session),
    agent_id: int = Depends(get_current_agent_id),
):
    start_dt = payload.start_datetime
    end_dt = payload.end_datetime or (start_dt + timedelta(minutes=30))

    rdv = Appointment(
        agent_id=agent_id,
        client_id=payload.client_id,
        title=(payload.title or "")[:255],
        notes=payload.notes or "",
        start_datetime=start_dt,
        end_datetime=end_dt,
        status=payload.status or AppointmentStatus.planned,
    )

    session.add(rdv)
    await session.commit()
    await session.refresh(rdv)

    cname: Optional[str] = None
    if rdv.client_id:
        client = await session.get(Client, rdv.client_id)
        if client:
            cname = client.company_name

    return AppointmentOut(
        id=rdv.id,
        client_id=rdv.client_id,
        labo_id=None,
        title=rdv.title,
        notes=rdv.notes,
        start_datetime=rdv.start_datetime,
        end_datetime=rdv.end_datetime,
        status=rdv.status,
        client_name=cname,
    )


# =========================================================
#   Mise à jour RDV
# =========================================================
@router.put("/appointments/{appointment_id}", response_model=AppointmentOut)
async def update_appointment(
    appointment_id: int,
    payload: AppointmentUpdate,
    session: AsyncSession = Depends(get_async_session),
    agent_id: int = Depends(get_current_agent_id),
):
    appt: Appointment | None = await session.get(Appointment, appointment_id)
    if not appt or appt.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Rendez-vous introuvable.")

    if payload.client_id is not None:
        appt.client_id = payload.client_id
    if payload.title is not None:
        appt.title = (payload.title or "")[:255]
    if payload.notes is not None:
        appt.notes = payload.notes
    if payload.start_datetime is not None:
        appt.start_datetime = payload.start_datetime
    if payload.end_datetime is not None:
        appt.end_datetime = payload.end_datetime
    elif payload.start_datetime is not None and appt.end_datetime is None:
        appt.end_datetime = payload.start_datetime + timedelta(minutes=30)
    if payload.status is not None:
        appt.status = payload.status

    await session.commit()
    await session.refresh(appt)

    cname: Optional[str] = None
    if appt.client_id:
        client = await session.get(Client, appt.client_id)
        if client:
            cname = client.company_name

    return AppointmentOut(
        id=appt.id,
        client_id=appt.client_id,
        labo_id=None,
        title=appt.title,
        notes=appt.notes,
        start_datetime=appt.start_datetime,
        end_datetime=appt.end_datetime,
        status=appt.status,
        client_name=cname,
    )


# =========================================================
#   Suppression RDV
# =========================================================
@router.delete("/appointments/{appointment_id}", status_code=204)
async def delete_appointment(
    appointment_id: int,
    session: AsyncSession = Depends(get_async_session),
    agent_id: int = Depends(get_current_agent_id),
):
    appt: Appointment | None = await session.get(Appointment, appointment_id)
    if not appt or appt.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Rendez-vous introuvable.")

    await session.delete(appt)
    await session.commit()
    return Response(status_code=204)
