# app/db/session.py

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker as sessionmaker_sync

from typing import Generator

from app.core.config import settings


# -------------------------------------------------------------------
# 🔵 ASYNC ENGINE (existant)
# -------------------------------------------------------------------

engine = create_async_engine(settings.DATABASE_URL, future=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_async_session():
    """
    Dépendance FastAPI pour les endpoints ASYNC.
    """
    async with AsyncSessionLocal() as session:
        yield session

# Compatibilité avec anciens imports
get_session = get_async_session


# -------------------------------------------------------------------
# 🔴 SYNC ENGINE (ajouté pour Celery & routers sync)
# -------------------------------------------------------------------

# ⚠️ IMPORTANT :
# On remplace "postgresql+asyncpg://" par "postgresql://" pour le moteur sync

SYNC_DATABASE_URL = settings.DATABASE_URL.replace("+asyncpg", "")

sync_engine = create_engine(SYNC_DATABASE_URL, future=True)
SessionLocal = sessionmaker_sync(bind=sync_engine, autocommit=False, autoflush=False)


def get_db() -> Generator:
    """
    Dépendance FastAPI pour les endpoints SYNCHRONES.
    Utilisé par :
      - superuser_labo_stock_sync.py
      - Celery (via SessionLocal dans les tasks)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
