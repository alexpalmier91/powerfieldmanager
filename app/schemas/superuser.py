from pydantic import BaseModel
from typing import List, Optional, Literal

class PendingItem(BaseModel):
    id: int
    name: Optional[str] = None
    email: Optional[str] = None

class PendingResponse(BaseModel):
    labos: List[PendingItem]
    agents: List[PendingItem]

class ApproveRequest(BaseModel):
    type: Literal["labo", "agent"]
    id: int

class LinkRequest(BaseModel):
    labo_id: int
    agent_id: int

class UnlinkRequest(BaseModel):
    labo_id: int
    agent_id: int

class ImportClientsResult(BaseModel):
    ok: bool
    inserted: int
    updated: int
    errors: List[str]
