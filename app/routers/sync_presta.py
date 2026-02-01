from fastapi import APIRouter, Depends
from app.core.security import get_current_subject
from app.schemas import Msg
from app.tasks.jobs import queue_sync_presta

router = APIRouter(prefix="/sync-presta", tags=["sync-presta"])

@router.post("", response_model=Msg)
async def run_sync_presta(subject: str = Depends(get_current_subject)):
    queue_sync_presta(requested_by=subject)
    return Msg(ok=True, detail="Synchro Presta en file d'attente")
