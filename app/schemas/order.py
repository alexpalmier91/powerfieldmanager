# app/schemas/orders.py
from __future__ import annotations
from pydantic import BaseModel, conint, condecimal
from typing import List, Optional, Literal
from datetime import datetime

# Items envoyés à la création/mise à jour
class OrderItemIn(BaseModel):
    product_id: Optional[int] = None
    sku: Optional[str] = None
    quantity: conint(ge=1)
    price_ht: Optional[condecimal(max_digits=12, decimal_places=2)] = None  # optionnel si calculé côté serveur
    discount_ht: Optional[condecimal(max_digits=12, decimal_places=2)] = None

# Commande entrante (création)
class OrderIn(BaseModel):
    customer_id: int                                # id client (référentiel "clients")
    labo_id: Optional[int] = None                   # si multi-labo
    agent_id: Optional[int] = None                  # si saisi par agent
    comment: Optional[str] = None
    items: List[OrderItemIn]

# Item retourné par l’API
class OrderItemOut(BaseModel):
    id: int
    product_id: Optional[int] = None
    sku: Optional[str] = None
    name: Optional[str] = None
    quantity: int
    price_ht: condecimal(max_digits=12, decimal_places=2)
    discount_ht: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    total_ht: condecimal(max_digits=12, decimal_places=2)

# Statuts autorisés (adapte si besoin)
OrderStatus = Literal["draft", "submitted", "confirmed", "preparing", "shipped", "cancelled"]

# Patch statut
class OrderStatusPatch(BaseModel):
    status: OrderStatus

# Commande retournée par l’API
class OrderOut(BaseModel):
    id: int
    number: Optional[str] = None
    customer_id: int
    labo_id: Optional[int] = None
    agent_id: Optional[int] = None
    status: OrderStatus
    total_ht: condecimal(max_digits=12, decimal_places=2)
    total_ttc: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    items: List[OrderItemOut] = []
