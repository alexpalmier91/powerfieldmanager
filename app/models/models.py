from sqlalchemy import (
    Column, BigInteger, Text, Integer, Numeric, ForeignKey, TIMESTAMP, func,
    Boolean, Table, UniqueConstraint
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

# ==========================
# EXISTANT
# ==========================

class Category(Base):
    __tablename__ = "categories"
    id = Column(BigInteger, primary_key=True)
    name = Column(Text, nullable=False)
    parent_id = Column(BigInteger, ForeignKey("categories.id", ondelete="SET NULL"))
    parent = relationship("Category", remote_side=[id])


class Product(Base):
    __tablename__ = "products"
    id = Column(BigInteger, primary_key=True)
    sku = Column(Text, unique=True, nullable=False, index=True)
    name = Column(Text, nullable=False)
    description = Column(Text)
    price_ht = Column(Numeric(12, 2), default=0)
    stock = Column(Integer, default=0)
    ean13 = Column(Text)
    category_id = Column(BigInteger, ForeignKey("categories.id", ondelete="SET NULL"))
    category = relationship("Category")
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


class ImportJob(Base):
    __tablename__ = "imports"
    id = Column(BigInteger, primary_key=True)
    task_id = Column(Text, unique=True, nullable=False)
    filename = Column(Text)
    total_rows = Column(Integer, default=0)
    inserted = Column(Integer, default=0)
    updated = Column(Integer, default=0)
    errors = Column(Text)
    status = Column(Text, default="PENDING")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    finished_at = Column(TIMESTAMP(timezone=True))


# ==========================
# AJOUTS POUR SUPERUSER
# ==========================

class User(Base):
    """
    Utilisateur applicatif.
    role: 'labo' | 'agent' | 'superuser'
    """
    __tablename__ = "users"
    id = Column(BigInteger, primary_key=True)
    email = Column(Text, unique=True, nullable=False, index=True)
    password_hash = Column(Text, nullable=True)  # ← tu fais du login par code, on laisse nullable
    role = Column(Text, nullable=False, default="labo")  # labo / agent / superuser

    # ★ NEW: champs attendus par auth.py
    is_active = Column(Boolean, nullable=False, default=False)  # utilisé dans /request-code & /verify-code
    labo_id = Column(BigInteger, ForeignKey("labos.id", ondelete="SET NULL"), nullable=True)  # user rattaché à un labo (ou None)

    labo = relationship("Labo", back_populates="users")  # ★ NEW: lien inverse
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class Labo(Base):
    __tablename__ = "labos"
    id = Column(BigInteger, primary_key=True)
    name = Column(Text, nullable=False)
    email = Column(Text, unique=True, index=True)
    is_validated = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    agents = relationship(
        "Agent",
        secondary="labo_agent",
        back_populates="labos",
        cascade="save-update"
    )

    users = relationship("User", back_populates="labo")  # ★ NEW: liste des users liés à ce labo


class Agent(Base):
    __tablename__ = "agents"
    id = Column(BigInteger, primary_key=True)
    name = Column(Text, nullable=False)
    email = Column(Text, unique=True, index=True)
    is_validated = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    labos = relationship(
        "Labo",
        secondary="labo_agent",
        back_populates="agents",
        cascade="save-update"
    )


# Table d'association N<->N entre Labos et Agents
labo_agent = Table(
    "labo_agent",
    Base.metadata,
    Column("labo_id", BigInteger, ForeignKey("labos.id", ondelete="CASCADE"), nullable=False),
    Column("agent_id", BigInteger, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
    UniqueConstraint("labo_id", "agent_id", name="uq_labo_agent")
)


class Client(Base):
    """
    Référentiel clients commun (utilisé par labos et agents).
    Note: rib_pdf_hint = mémo/proposition (non importé en auto),
          rib_pdf_path = chemin réel sécurisé côté serveur (renseigné manuellement).
    """
    __tablename__ = "clients"
    id = Column(BigInteger, primary_key=True)

    company_name = Column(Text, nullable=False)   # nom société
    first_name   = Column(Text)                   # prenom
    last_name    = Column(Text)                   # nom
    address1     = Column(Text)                   # adresse
    postcode     = Column(Text)                   # code postal
    city         = Column(Text)                   # ville
    siret        = Column(Text, unique=True)      # numero de siret (14 chiffres FR), peut être NULL
    email        = Column(Text, index=True)       # email
    phone        = Column(Text)                   # telephone
    groupement   = Column(Text)                   # groupement

    rib_pdf_hint = Column(Text)                   # emplacement RIB Pdf (indice / mémo)
    rib_pdf_path = Column(Text)                   # chemin réel (sécurisé, hors webroot)

    created_at   = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at   = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
