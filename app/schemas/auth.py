from pydantic import BaseModel, EmailStr

class LaboSignupIn(BaseModel):
    firstname: str
    lastname: str
    labo_name: str
    address: str
    email: EmailStr
    phone: str

class EmailIn(BaseModel):
    email: EmailStr

class CodeLoginIn(BaseModel):
    email: EmailStr
    code: str

class MsgOut(BaseModel):
    ok: bool = True
    detail: str = "ok"


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
