from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Integer, String, DateTime, func, ForeignKey
from app.db.base import Base

class ImportJob(Base):
    __tablename__ = "import_job"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    total: Mapped[int] = mapped_column(Integer)
    inserted: Mapped[int] = mapped_column(Integer)
    updated: Mapped[int] = mapped_column(Integer)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
