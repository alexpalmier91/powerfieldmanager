from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Integer, String
from app.db.base import Base

class Client(Base):
    __tablename__ = "client"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(50))
    city: Mapped[str] = mapped_column(String(120))
    zipcode: Mapped[str] = mapped_column(String(20), nullable=True)
    address: Mapped[str] = mapped_column(String(255), nullable=True)
    siret: Mapped[str] = mapped_column(String(20), nullable=True)
