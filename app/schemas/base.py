from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

# --- AUTH / LOGIN ---
class LaboSignupIn(BaseModel):
    email: EmailStr
    firstname: str
    lastname: str
    labo_name: str
    address: Optional[str] = None
    phone: Optional[str] = None

class EmailIn(BaseModel):
    email: EmailStr

class CodeLoginIn(BaseModel):
    email: EmailStr
    code: str

class Msg(BaseModel):
    """Message simple (certains modules importent `Msg`)."""
    message: str

class MsgOut(BaseModel):
    """Alias plus explicite utilisé ailleurs."""
    message: str

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"

# --- IMPORTS / JOBS ---
class ImportStatus(BaseModel):
    id: int
    status: str
    total_rows: Optional[int] = 0
    inserted: Optional[int] = 0
    updated: Optional[int] = 0
    errors: Optional[str] = None
    filename: Optional[str] = None
    created_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
