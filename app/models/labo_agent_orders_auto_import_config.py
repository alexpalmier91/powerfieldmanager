# app/models/labo_agent_orders_auto_import_config.py
from __future__ import annotations

from datetime import datetime, time
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Time,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.db.base import Base  # ✅ même Base que dans app/db/models.py


class LaboAgentOrdersAutoImportConfig(Base):
    __tablename__ = "labo_agent_orders_auto_import_config"
    __table_args__ = (
        UniqueConstraint("labo_id", name="uq_labo_agent_orders_auto_import_config_labo_id"),
    )

    id: int = Column(Integer, primary_key=True, index=True)
    labo_id: int = Column(Integer, ForeignKey("labo.id"), nullable=False, index=True)

    enabled: bool = Column(Boolean, nullable=False, default=False)

    # Dossier Google Drive contenant les CSV
    drive_folder_id: Optional[str] = Column(String(256), nullable=True)

    # Heure de lancement souhaitée (optionnelle)
    run_at: Optional[time] = Column(Time(timezone=False), nullable=True)

    last_run_at: Optional[datetime] = Column(DateTime(timezone=True), nullable=True)
    last_status: Optional[str] = Column(String(64), nullable=True)
    last_error: Optional[str] = Column(Text, nullable=True)

    # Résumé JSON (stats d’import)
    last_summary = Column(JSONB, nullable=True)

    created_at: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
    )
    updated_at: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # 🔁 Relation Labo SANS back_populates (on ne veut plus lier à Labo.agent_orders_auto_import_config)
    labo = relationship("Labo", lazy="joined")
