# app/schemas/appointment.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.db.models import AppointmentStatus


class AppointmentBase(BaseModel):
    client_id: Optional[int] = None
    labo_id: Optional[int] = None  # inutilisé mais on le garde pour compat
    title: Optional[str] = None    # idem
    notes: Optional[str] = None

    start_datetime: datetime
    # ⬇⬇⬇ optionnel
    end_datetime: Optional[datetime] = None

    status: AppointmentStatus = AppointmentStatus.planned


class AppointmentCreate(AppointmentBase):
    pass


class AppointmentUpdate(BaseModel):
    client_id: Optional[int] = None
    labo_id: Optional[int] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    status: Optional[AppointmentStatus] = None


class AppointmentOut(AppointmentBase):
    id: int
    client_name: Optional[str] = None

    class Config:
        from_attributes = True  # Pydantic v2
