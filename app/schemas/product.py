# app/schemas/products.py
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from decimal import Decimal

# Optionnel si ton dashboard affiche la catégorie
class CategoryOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None

class ProductOut(BaseModel):
    id: int
    sku: str
    name: str
    description: Optional[str] = None
    price_ht: Decimal
    stock: int
    ean13: Optional[str] = None
    category_id: Optional[int] = None
    category: Optional[CategoryOut] = None   # si tu renvoies l’objet catégorie
    updated_at: Optional[datetime] = None

# Si tu n'as pas de variantes côté DB, ce modèle reste minimal et non utilisé
class VariantOut(BaseModel):
    id: int
    product_id: int
    sku: Optional[str] = None
    name: Optional[str] = None
    price_ht: Optional[Decimal] = None
    stock: Optional[int] = None
    ean13: Optional[str] = None
