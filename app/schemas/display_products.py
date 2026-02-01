# app/schemas/display_products.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DisplayProductBase(BaseModel):
    owner_client_id: int
    sku: str
    name: str
    description: Optional[str] = None


class DisplayProductCreate(DisplayProductBase):
    pass


class DisplayProductOut(DisplayProductBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class RfidTagLinkCreate(BaseModel):
    epc: str


class RfidTagLinkOut(BaseModel):
    id: int
    epc: str
    display_product_id: int
    linked_at: datetime

    class Config:
        orm_mode = True


class UnassignedEpcOut(BaseModel):
    epc: str
    last_seen_at: Optional[datetime] = None
