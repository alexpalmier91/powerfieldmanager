from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, field_validator

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENV: str = "dev"
    API_PREFIX: str = "/api-zenhub"

    JWT_SECRET: str = "change_me"
    CORS_ORIGINS: List[AnyHttpUrl] | List[str] = []
    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def split_cors_csv(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    DATABASE_URL: str
    REDIS_URL: str

    PRESTA_BASE_URL: str = ""
    PRESTA_API_KEY: str = ""
    PRESTA_SHOP_ID: int = 1

    # SMTP pour envoi du code de connexion
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "no-reply@zentro"
    SUPERADMINS: List[str] | str = "admin@zentro"

    @field_validator("SUPERADMINS", mode="before")
    @classmethod
    def split_admins(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

settings = Settings()
