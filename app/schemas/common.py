from pydantic import BaseModel

class Msg(BaseModel):
    ok: bool = True
    detail: str = "ok"
