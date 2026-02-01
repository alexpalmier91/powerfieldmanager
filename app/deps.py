from fastapi import Depends
from app.core.security import get_current_subject

def auth_required(sub: str = Depends(get_current_subject)) -> str:
    return sub
