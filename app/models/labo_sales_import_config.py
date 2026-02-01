# app/models/labo_sales_import_config.py
from __future__ import annotations

from datetime import datetime, time

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Time, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LaboSalesImportConfig(Base):
    """
    Configuration de l'import automatique des ventes (documents labos) par labo.

    - file_url : lien vers le fichier Excel (Google Drive, etc.)
    - enabled  : activer / désactiver l'import automatique
    - run_at   : heure cible (optionnelle) pour l'import quotidien (future utilisation)
    - last_*   : infos de la dernière exécution
        * last_status : "success", "error", "missing_file_url", etc.
        * last_error  : texte libre de l’erreur éventuelle
    """

    __tablename__ = "labo_sales_import_config"

    labo_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("labo.id", ondelete="CASCADE"),
        primary_key=True,
    )

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    file_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Heure d'exécution quotidienne souhaitée (optionnelle)
    run_at: Mapped[time | None] = mapped_column(Time(timezone=False), nullable=True)

    # Infos sur la dernière exécution
    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
