# app/db/models.py
from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal
import enum
import sqlalchemy as sa
from typing import Optional

from sqlalchemy import (
    String, Integer, Numeric, ForeignKey, Text, DateTime, Enum,
    UniqueConstraint, Boolean, func, Column, Index
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

from app.db.base import Base

# =========================================================
#                     LABORATOIRES
# =========================================================
# =========================================================
#                     LABORATOIRES
# =========================================================
class Labo(Base):
    __tablename__ = "labo"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)

    # --- Profil / Branding ---
    legal_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    siret: Mapped[str | None] = mapped_column(String(14), nullable=True)
    vat_number: Mapped[str | None] = mapped_column(String(32), nullable=True)

    email: Mapped[str | None] = mapped_column(String(180), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    address1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    zip: Mapped[str | None] = mapped_column(String(16), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country: Mapped[str | None] = mapped_column(String(120), nullable=True)

    invoice_footer: Mapped[str | None] = mapped_column(Text(), nullable=True)

    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.text("true")
    )

    # Chemin relatif sous app/static (ex: "uploads/labos/12/logo.png")
    logo_path: Mapped[str | None] = mapped_column(Text(), nullable=True)

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    products: Mapped[list["Product"]] = relationship(
        back_populates="labo",
        cascade="all, delete-orphan",
    )

    agents: Mapped[list["Agent"]] = relationship(
        secondary="labo_agent",
        back_populates="labos",
    )

    labo_documents: Mapped[list["LaboDocument"]] = relationship(
        back_populates="labo",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    marketing_documents: Mapped[list["MarketingDocument"]] = relationship(
        back_populates="labo",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )    
    
    marketing_fonts: Mapped[list["MarketingFont"]] = relationship(
        "MarketingFont",
        back_populates="labo",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    

    appointments: Mapped[list["Appointment"]] = relationship(
        back_populates="labo",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    stock_sync_config: Mapped["LaboStockSyncConfig"] = relationship(
        "LaboStockSyncConfig",
        back_populates="labo",
        uselist=False,
        lazy="joined",
    )

    # ⚠️ On NE définit plus ici agent_orders_auto_import_config
    # pour ne pas activer / lier l'automatisation des commandes agents.
    
    
    
# =========================================================
#            CONFIG SYNCHRO STOCK LABO
# =========================================================
class LaboStockSyncConfig(Base):
    __tablename__ = "labo_stock_sync_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    labo_id: Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )

    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=sa.text("false"),
    )

    api_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    api_token: Mapped[str | None] = mapped_column(String(512), nullable=True)

    sku_field: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        server_default=sa.text("'sku'"),
    )
    qty_field: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        server_default=sa.text("'qty'"),
    )

    run_at: Mapped[Optional[datetime.time]] = mapped_column(sa.Time, nullable=True)

    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    labo: Mapped["Labo"] = relationship(
        "Labo",
        back_populates="stock_sync_config",
    )
    


class Category(Base):
    __tablename__ = "category"

    id: Mapped[int] = mapped_column(primary_key=True)
    labo_id: Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255), index=True)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("category.id", ondelete="SET NULL")
    )

    parent: Mapped["Category"] = relationship(remote_side="Category.id")
    products: Mapped[list["Product"]] = relationship(back_populates="category")

    __table_args__ = (
        UniqueConstraint("labo_id", "name", "parent_id", name="uq_category_labo_name_parent"),
    )

# =========================================================
#                     PRODUITS
# =========================================================
class Product(Base):
    __tablename__ = "product"

    id = Column(Integer, primary_key=True)
    labo_id = Column(Integer, ForeignKey("labo.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("category.id", ondelete="SET NULL"), nullable=True)

    sku = Column(String(128), nullable=False)
    name = Column(String(512), nullable=False)
    description = Column(Text)
    image_url = Column(Text)
    
    thumb_url = Column(String(1024), nullable=True)   # ex: /media/products/labo_1/123/sku_ABC_0_xxx_thumb.webp
    hd_jpg_url = Column(String(1024), nullable=True)  # ex: ..._hd.jpg
    hd_webp_url = Column(String(1024), nullable=True) # ex: ..._hd.webp    

    ean13 = Column(String(32))
    price_ht = Column(Numeric(12, 2), nullable=False, default=0)
    stock = Column(Integer, nullable=False, default=0)

    is_active = Column(Boolean, nullable=False, server_default=sa.text("true"))

    # 👇 Taux de TVA en %
    vat_rate = Column(Numeric(5, 2), nullable=False, server_default="20.00")

    # 👇 Taux de commission agent en %
    commission = Column(Numeric(5, 2), nullable=True, server_default="0.00")

    # Relations
    labo = relationship("Labo", back_populates="products")
    category = relationship("Category", back_populates="products")

    price_tiers = relationship("PriceTier", backref="product", cascade="all, delete-orphan")
    
    
    images = relationship(
        "ProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProductImage.position.asc()",
    )    

    # RFID / présentoirs
    rfid_tags: Mapped[list["RfidTag"]] = relationship(
        "RfidTag",
        back_populates="product",
        cascade="all, delete-orphan",
    )

    display_sale_events: Mapped[list["DisplaySaleEvent"]] = relationship(
        "DisplaySaleEvent",
        back_populates="product",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ux_product_labo_sku", "labo_id", "sku", unique=True),
    )


class PriceTier(Base):
    __tablename__ = "price_tier"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("product.id", ondelete="CASCADE"), nullable=False)
    qty_min = Column(Integer, nullable=False)
    price_ht = Column(Numeric(12, 2), nullable=False)

    __table_args__ = (
        Index("ux_price_tier_unique", "product_id", "qty_min", unique=True),
    )
    
    
class ProductImage(Base):
    __tablename__ = "product_image"

    id = Column(Integer, primary_key=True)

    product_id = Column(Integer, ForeignKey("product.id", ondelete="CASCADE"), nullable=False, index=True)

    position = Column(Integer, nullable=False, default=0)
    is_cover = Column(Boolean, nullable=False, server_default=sa.text("false"))

    # URLs servies par /media
    thumb_url = Column(String(1024), nullable=True)
    hd_jpg_url = Column(String(1024), nullable=True)
    hd_webp_url = Column(String(1024), nullable=True)

    # Source (Presta ou autre)
    original_url = Column(String(2048), nullable=True)

    # Anti-redownload / dédup
    checksum = Column(String(128), nullable=True)  # sha1 hex
    source_etag = Column(String(256), nullable=True)
    source_last_modified = Column(String(256), nullable=True)
    source_size = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    product = relationship("Product", back_populates="images")

    __table_args__ = (
        UniqueConstraint("product_id", "position", name="uq_product_image_product_position"),
        Index("ix_product_image_product_id", "product_id"),
    )
    

# =========================================================
#                     RELATION LABO <-> AGENT
# =========================================================
labo_agent = sa.Table(
    "labo_agent",
    Base.metadata,
    sa.Column("labo_id", sa.Integer, sa.ForeignKey("labo.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("agent_id", sa.Integer, sa.ForeignKey("agent.id", ondelete="CASCADE"), primary_key=True),
)

# =========================================================
#                     AGENTS
# =========================================================
class Agent(Base):
    __tablename__ = "agent"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    firstname: Mapped[str | None] = mapped_column(String(100))
    lastname: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(32))

    labos: Mapped[list["Labo"]] = relationship(
        secondary="labo_agent", back_populates="agents"
    )
    orders: Mapped[list["Order"]] = relationship(back_populates="agent")

    # Documents labo liés à un agent (rare, nullable)
    labo_documents: Mapped[list["LaboDocument"]] = relationship(back_populates="agent")

    # relation many-to-many avec le référentiel Client
    clients: Mapped[list["Client"]] = relationship(
        secondary="agent_client", back_populates="agents", lazy="selectin"
    )

    # Rendez-vous de l’agent
    appointments: Mapped[list["Appointment"]] = relationship(
        back_populates="agent",
        cascade="all, delete-orphan",
    )

# =========================================================
#                     CLIENTS (legacy commandes)
# =========================================================
class Customer(Base):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str | None] = mapped_column(String(180), index=True)
    company: Mapped[str | None] = mapped_column(String(255))
    vat: Mapped[str | None] = mapped_column(String(32))
    phone: Mapped[str | None] = mapped_column(String(32))

    address1: Mapped[str | None] = mapped_column(String(255))
    address2: Mapped[str | None] = mapped_column(String(255))
    postcode: Mapped[str | None] = mapped_column(String(16))
    city: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(120))

    orders: Mapped[list["Order"]] = relationship(back_populates="customer")
    labo_documents: Mapped[list["LaboDocument"]] = relationship(back_populates="customer")

# =========================================================
#                     CLIENTS (référentiel)
# =========================================================
class Client(Base):
    __tablename__ = "client"

    id: Mapped[int] = mapped_column(primary_key=True)

    company_name: Mapped[str]        = mapped_column(String(255))
    first_name:   Mapped[str | None] = mapped_column(String(100))
    last_name:    Mapped[str | None] = mapped_column(String(100))
    address1:     Mapped[str | None] = mapped_column(String(255))
    postcode:     Mapped[str | None] = mapped_column(String(16))
    city:         Mapped[str | None] = mapped_column(String(120))
    siret:        Mapped[str | None] = mapped_column(String(14), unique=True)
    email:        Mapped[str | None] = mapped_column(String(180), index=True)
    phone:        Mapped[str | None] = mapped_column(String(32))
    groupement:   Mapped[str | None] = mapped_column(String(120))
    country:      Mapped[str | None] = mapped_column(String(120))
    iban: Mapped[Optional[str]] = mapped_column(String(34), nullable=True)
    bic: Mapped[Optional[str]] = mapped_column(String(11), nullable=True)
    payment_terms: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    credit_limit: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    sepa_mandate_ref: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    rib_pdf_hint: Mapped[str | None] = mapped_column(Text())
    rib_pdf_path: Mapped[str | None] = mapped_column(Text())

    created_at:   Mapped[DateTime]   = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at:   Mapped[DateTime]   = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    orders: Mapped[list["Order"]] = relationship(
        back_populates="client",
        passive_deletes=True,
    )

    labo_documents: Mapped[list["LaboDocument"]] = relationship(
        back_populates="client",
        passive_deletes=True,
    )

    agents: Mapped[list["Agent"]] = relationship(
        secondary="agent_client", back_populates="clients", lazy="selectin"
    )

    # Rendez-vous liés à ce client
    appointments: Mapped[list["Appointment"]] = relationship(
        back_populates="client",
        passive_deletes=True,
    )
    
    delivery_addresses: Mapped[list["DeliveryAddress"]] = relationship(
        "DeliveryAddress",
        back_populates="client",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # RFID / présentoirs
    display_assignments: Mapped[list["DisplayAssignment"]] = relationship(
        "DisplayAssignment",
        back_populates="pharmacy",
        passive_deletes=True,
    )

    display_sale_events: Mapped[list["DisplaySaleEvent"]] = relationship(
        "DisplaySaleEvent",
        back_populates="pharmacy",
        passive_deletes=True,
    )

# =========================================================
#                ADRESSES DE LIVRAISON CLIENT
# =========================================================
class DeliveryAddress(Base):
    __tablename__ = "delivery_address"

    id: Mapped[int] = mapped_column(primary_key=True)

    client_id: Mapped[int] = mapped_column(
        ForeignKey("client.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # Optionnel : si un jour tu veux des adresses différentes par labo
    # labo_id: Mapped[int | None] = mapped_column(
    #     ForeignKey("labo.id", ondelete="SET NULL"),
    #     index=True,
    #     nullable=True,
    # )

    label: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        doc="Libellé interne (ex: 'Officine', 'Magasin', 'Entrepôt', etc.)",
    )

    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    address1: Mapped[str] = mapped_column(String(255))
    address2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    postcode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country: Mapped[str | None] = mapped_column(String(120), nullable=True)

    is_default: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=sa.text("true"),
        doc="Adresse de livraison par défaut pour ce client",
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    client: Mapped["Client"] = relationship(
        "Client",
        back_populates="delivery_addresses",
    )

    __table_args__ = (
        # On autorise plusieurs adresses par client,
        # mais une seule 'is_default = true'
        sa.Index(
            "ix_delivery_address_client_default",
            "client_id",
            "is_default",
        ),
    )

# =========================================================
#            ASSOCIATION LABO / CLIENT (code client)
# =========================================================
class LaboClient(Base):
    __tablename__ = "labo_client"

    labo_id:   Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="CASCADE"), primary_key=True
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("client.id", ondelete="CASCADE"), primary_key=True
    )

    code_client: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    labo:   Mapped["Labo"]   = relationship("Labo", backref="labo_clients")
    client: Mapped["Client"] = relationship("Client", backref="labo_clients")

    __table_args__ = (
        UniqueConstraint("labo_id", "code_client", name="uq_labo_client_code"),
    )

# =========================================================
#        AGENT <-> CLIENT (référentiel) — TABLE D’ASSOCIATION
# =========================================================
agent_client = sa.Table(
    "agent_client",
    Base.metadata,
    sa.Column("agent_id", sa.Integer, sa.ForeignKey("agent.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("client_id", sa.Integer, sa.ForeignKey("client.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("linked_at", sa.DateTime(timezone=True), server_default=func.now(), nullable=False),
)

# =========================================================
#                     COMMANDES (AGENTS)
# =========================================================
class OrderStatus(enum.Enum):
    draft = "draft"
    pending = "pending"
    validated = "validated"   # ✅ AJOUT
    paid = "paid"
    canceled = "canceled"
    shipped = "shipped"
    completed = "completed"


class Order(Base):
    __tablename__ = "order"

    id: Mapped[int] = mapped_column(primary_key=True)

    # rattachement
    labo_id: Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="RESTRICT"), index=True
    )
    agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent.id", ondelete="SET NULL"), index=True
    )

    # mapping du client référentiel
    client_id: Mapped[int | None] = mapped_column(
        ForeignKey("client.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # legacy Customer (si encore utilisé)
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customer.id", ondelete="RESTRICT"), index=True, nullable=True
    )

    # infos commande
    order_number:   Mapped[str]         = mapped_column(String(64), index=True)
    order_date:     Mapped[date | None] = mapped_column(sa.Date)
    delivery_date:  Mapped[date | None] = mapped_column(sa.Date, nullable=True)
    client_name:    Mapped[str | None]  = mapped_column(String(255))
    currency:       Mapped[str]         = mapped_column(String(3), default="EUR")
    payment_method: Mapped[str | None]  = mapped_column(String(64))

    # commentaire importé depuis Excel (désormais aussi saisi par l'agent)
    comment:        Mapped[str | None]  = mapped_column(Text(), nullable=True)

    status:         Mapped[OrderStatus] = mapped_column(
        PGEnum(OrderStatus, name="orderstatus", create_type=False),
        default=OrderStatus.draft,
    )
    total_ht:       Mapped[Numeric]     = mapped_column(Numeric(12, 2), default=0)
    total_ttc:      Mapped[Numeric]     = mapped_column(Numeric(12, 2), default=0)
    created_at:     Mapped[DateTime]    = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at:     Mapped[DateTime]    = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    labo:     Mapped["Labo"]            = relationship()
    agent:    Mapped["Agent | None"]    = relationship(back_populates="orders")
    customer: Mapped["Customer | None"] = relationship(back_populates="orders")
    client:   Mapped["Client | None"]   = relationship(back_populates="orders")

    items:    Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("labo_id", "order_number", name="uq_order_labo_number"),
    )


class OrderItem(Base):
    __tablename__ = "order_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("order.id", ondelete="CASCADE"),
        index=True,
    )

    # ⚠️ product_id peut être NULL (import agent sans mapping produit)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("product.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )

    sku: Mapped[str] = mapped_column(String(64))
    # snapshot du nom produit au moment de la commande
    name: Mapped[str | None] = mapped_column(String(512), nullable=True)

    ean13: Mapped[str | None] = mapped_column(String(13), index=True)
    qty: Mapped[int] = mapped_column(Integer)

    # Remise en % appliquée sur la ligne (0–100)
    discount_percent: Mapped[Numeric] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="0.00"
    )

    # Prix unitaire HT avant remise
    unit_ht: Mapped[Numeric] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0.00"
    )

    # Pour compat : on les remplit dans create_order
    # price_ht = unit_ht (PU HT), total_ht = line_ht (total HT remisé)
    price_ht: Mapped[Numeric | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_ht: Mapped[Numeric | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Total ligne HT après remise (référence principale)
    line_ht = sa.Column(
        sa.Numeric(12, 2),
        nullable=False,
        server_default="0.00",
    )

    order:   Mapped["Order"]          = relationship(back_populates="items")
    product: Mapped["Product | None"] = relationship()   # <- peut être None

    __table_args__ = (
        UniqueConstraint("order_id", "product_id", name="uq_orderitem_order_product"),
    )
    
    

# =========================================================
#        MARKETING DOCUMENTS (PDF catalogues / promos)
# =========================================================
class MarketingDocument(Base):
    __tablename__ = "marketing_document"

    id: Mapped[int] = mapped_column(primary_key=True)

    labo_id: Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)         # uuid.pdf
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)   # nom uploadé

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text(), nullable=True)
    doc_type: Mapped[str | None] = mapped_column(String(50), nullable=True)   # catalogue, offre_promotionnelle...

    thumb_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ✅ utile pour l’éditeur (multi-pages) et le cache
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_sha256: Mapped[str | None] = mapped_column(Text(), nullable=True)

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    labo: Mapped["Labo"] = relationship(
        "Labo",
        back_populates="marketing_documents",
    )

    # ✅ relations vers les nouvelles tables
    annotations: Mapped[list["MarketingDocumentAnnotation"]] = relationship(
        "MarketingDocumentAnnotation",
        back_populates="document",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    product_links: Mapped[list["MarketingDocumentProductLink"]] = relationship(
        "MarketingDocumentProductLink",
        back_populates="document",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    publications: Mapped[list["MarketingDocumentPublication"]] = relationship(
        "MarketingDocumentPublication",
        back_populates="document",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_marketing_document_labo_created_at", "labo_id", "created_at"),
    )


# =========================================================
#   MARKETING PDF EDITOR (annotations / zones produits / publication)
# =========================================================

class MarketingAnnotationStatus(enum.Enum):
    DRAFT = "DRAFT"
    LOCKED = "LOCKED"


class MarketingPublicationStatus(enum.Enum):
    PENDING = "PENDING"
    RENDERING = "RENDERING"
    READY = "READY"
    FAILED = "FAILED"


class MarketingDocumentAnnotation(Base):
    """
    Stocke le JSON complet de l'éditeur.
    - 1 DRAFT par document (unique)
    - des LOCKED : snapshots utilisés pour une publication
    """
    __tablename__ = "marketing_document_annotation"

    id: Mapped[int] = mapped_column(primary_key=True)

    document_id: Mapped[int] = mapped_column(
        ForeignKey("marketing_document.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    status: Mapped[MarketingAnnotationStatus] = mapped_column(
        PGEnum(MarketingAnnotationStatus, name="marketingannotationstatus", create_type=False),
        nullable=False,
        server_default=sa.text("'DRAFT'"),
    )


    # optimistic locking (frontend)
    draft_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa.text("1")
    )    

    # JSON: pages -> objects, rules, fonts, etc.
    data_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )

    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    document: Mapped["MarketingDocument"] = relationship(
        "MarketingDocument",
        back_populates="annotations",
    )

    __table_args__ = (
        UniqueConstraint("document_id", "status", name="uq_marketing_doc_annotation_doc_status"),
        Index("ix_marketing_doc_annotation_json_gin", "data_json", postgresql_using="gin"),
    )


class MarketingDocumentProductLink(Base):
    """
    Zones cliquables sur le PDF liées à un produit réel (Product).
    Coordonnées normalisées 0..1 (indépendantes du zoom).
    """
    __tablename__ = "marketing_document_product_link"

    id: Mapped[int] = mapped_column(primary_key=True)

    document_id: Mapped[int] = mapped_column(
        ForeignKey("marketing_document.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    page_index: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-based

    # coords normalisées (0..1)
    x: Mapped[Decimal] = mapped_column(Numeric(8, 6), nullable=False)
    y: Mapped[Decimal] = mapped_column(Numeric(8, 6), nullable=False)
    w: Mapped[Decimal] = mapped_column(Numeric(8, 6), nullable=False)
    h: Mapped[Decimal] = mapped_column(Numeric(8, 6), nullable=False)

    rotation_deg: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False, server_default="0")

    # Produit réel (stock)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("product.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    # snapshots optionnels (robustesse / affichage)
    sku: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ean13: Mapped[str | None] = mapped_column(String(32), nullable=True)

    behavior_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    document: Mapped["MarketingDocument"] = relationship(
        "MarketingDocument",
        back_populates="product_links",
    )
    product: Mapped["Product | None"] = relationship("Product")

    __table_args__ = (
        Index("ix_marketing_doc_product_link_doc_page", "document_id", "page_index"),
        Index("ix_marketing_doc_product_link_product", "product_id"),
    )


class MarketingDocumentPublication(Base):
    """
    Publication figée : PDF final généré (source + annotations + ruptures).
    Pointe vers un snapshot LOCKED d'annotations.
    """
    __tablename__ = "marketing_document_publication"

    id: Mapped[int] = mapped_column(primary_key=True)

    document_id: Mapped[int] = mapped_column(
        ForeignKey("marketing_document.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    annotation_locked_id: Mapped[int] = mapped_column(
        ForeignKey("marketing_document_annotation.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )

    version: Mapped[int] = mapped_column(Integer, nullable=False)

    status: Mapped[MarketingPublicationStatus] = mapped_column(
        PGEnum(MarketingPublicationStatus, name="marketingpublicationstatus", create_type=False),
        nullable=False,
        server_default=sa.text("'PENDING'"),
    )


    published_pdf_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)  # uuid.pdf
    published_pdf_sha256: Mapped[str | None] = mapped_column(Text(), nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)

    render_options_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )

    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    document: Mapped["MarketingDocument"] = relationship(
        "MarketingDocument",
        back_populates="publications",
    )

    annotation_locked: Mapped["MarketingDocumentAnnotation"] = relationship(
        "MarketingDocumentAnnotation",
        foreign_keys=[annotation_locked_id],
    )

    __table_args__ = (
        UniqueConstraint("document_id", "version", name="uq_marketing_doc_publication_doc_version"),
        Index("ix_marketing_doc_publication_doc_status", "document_id", "status"),
    )


class MarketingDocumentAsset(Base):
    """
    Assets (images) uploadés par le labo pour les overlays (badges, pictos...).
    """
    __tablename__ = "marketing_document_asset"

    id: Mapped[int] = mapped_column(primary_key=True)

    labo_id: Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)        # uuid.png
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)  # nom uploadé
    mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    labo: Mapped["Labo"] = relationship(
        "Labo",
        backref="marketing_assets",
    )

    __table_args__ = (
        Index("ix_marketing_asset_labo_created", "labo_id", "created_at"),
    )

# =========================================================
#        MARKETING FONTS (WOFF2 uploadés par le labo)
# =========================================================
class MarketingFont(Base):
    __tablename__ = "marketing_font"

    id: Mapped[int] = mapped_column(primary_key=True)

    labo_id: Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # Nom affiché dans l'éditeur (ex: "Montserrat SemiBold")
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Nom de fichier stocké (ex: uuid.woff2)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    
    # Nom original uploadé (ex: Montserrat-SemiBold.ttf ou .woff2)
    original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # WOFF2 only
    format: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=sa.text("'woff2'"),
    )

    mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Optionnel : checksum pour éviter doublons exacts
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    labo: Mapped["Labo"] = relationship(
        "Labo",
        back_populates="marketing_fonts",
    )

    __table_args__ = (
        # un même labo ne peut pas avoir 2 polices avec le même nom
        UniqueConstraint("labo_id", "name", name="uq_marketing_font_labo_name"),
        Index("ix_marketing_font_labo_created_at", "labo_id", "created_at"),
    )






# =========================================================
#        DOCUMENTS LABO (BC/BL/FA)
# =========================================================
class LaboDocumentType(enum.Enum):
    BC = "BC"  # Bon de commande
    BL = "BL"  # Bon de livraison
    FA = "FA"  # Facture


class LaboDocument(Base):
    __tablename__ = "labo_document"

    id: Mapped[int] = mapped_column(primary_key=True)

    labo_id: Mapped[int] = mapped_column(
        ForeignKey("labo.id", ondelete="RESTRICT"), index=True
    )
    client_id: Mapped[int | None] = mapped_column(
        ForeignKey("client.id", ondelete="SET NULL"), index=True
    )
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customer.id", ondelete="SET NULL"), index=True
    )
    agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent.id", ondelete="SET NULL"), index=True
    )

    order_number: Mapped[str] = mapped_column(String(64), index=True)
    order_date: Mapped[date | None] = mapped_column(sa.Date)
    delivery_date: Mapped[date | None] = mapped_column(sa.Date, nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(255))
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    payment_method: Mapped[str | None] = mapped_column(String(64))

    type: Mapped[LaboDocumentType] = mapped_column(
        PGEnum(LaboDocumentType, name="labodocumenttype", create_type=False),
        nullable=False,
    )
    status: Mapped[OrderStatus | None] = mapped_column(
        PGEnum(OrderStatus, name="orderstatus", create_type=False),
        nullable=True,
    )

    total_ht: Mapped[Numeric] = mapped_column(Numeric(12, 2), default=0)
    total_ttc: Mapped[Numeric] = mapped_column(Numeric(12, 2), default=0)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    # 🔁 Relations réciproques
    labo:     Mapped["Labo"]            = relationship(back_populates="labo_documents")
    client:   Mapped["Client | None"]   = relationship(back_populates="labo_documents")
    customer: Mapped["Customer | None"] = relationship(back_populates="labo_documents")
    agent:    Mapped["Agent | None"]    = relationship(back_populates="labo_documents")

    items: Mapped[list["LaboDocumentItem"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("labo_id", "order_number", name="uq_labo_document_labo_number"),
    )


class LaboDocumentItem(Base):
    __tablename__ = "labo_document_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("labo_document.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("product.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    sku: Mapped[str] = mapped_column(String(64))
    ean13: Mapped[str | None] = mapped_column(String(13), index=True)
    qty: Mapped[int] = mapped_column(Integer)
    unit_ht: Mapped[Numeric] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0.00"
    )
    total_ht: Mapped[Numeric] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0.00"
    )

    document: Mapped["LaboDocument"]      = relationship(back_populates="items")
    product:  Mapped["Product | None"]    = relationship()

    __table_args__ = (
        UniqueConstraint("document_id", "product_id", name="uq_labodocumentitem_doc_product"),
    )

# =========================================================
#                     APPOINTMENTS (AGENDA AGENT)
# =========================================================
class AppointmentStatus(enum.Enum):
    planned = "planned"
    done = "done"
    cancelled = "cancelled"


class Appointment(Base):
    __tablename__ = "appointment"

    id: Mapped[int] = mapped_column(primary_key=True)

    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agent.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    client_id: Mapped[int | None] = mapped_column(
        ForeignKey("client.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    labo_id: Mapped[int | None] = mapped_column(
        ForeignKey("labo.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    title: Mapped[str] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text())

    start_datetime: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        index=True,
        nullable=False,
    )
    end_datetime: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        index=True,
        nullable=True,
    )

    status: Mapped[AppointmentStatus] = mapped_column(
        PGEnum(AppointmentStatus, name="appointmentstatus", create_type=False),
        default=AppointmentStatus.planned,
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    agent:  Mapped["Agent"]          = relationship(back_populates="appointments")
    client: Mapped["Client | None"]  = relationship(back_populates="appointments")
    labo:   Mapped["Labo | None"]    = relationship(back_populates="appointments")

    __table_args__ = (
        Index("ix_appointment_agent_start", "agent_id", "start_datetime"),
    )

# =========================================================
#                     UTILISATEURS / AUTH
# =========================================================
class UserRole(enum.Enum):
    SUPERADMIN = "SUPERADMIN"
    SUPERUSER  = "SUPERUSER"
    LABO       = "LABO"
    AGENT      = "AGENT"
    CLIENT     = "CLIENT"


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.LABO)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    labo_id: Mapped[int | None] = mapped_column(
        ForeignKey("labo.id", ondelete="SET NULL"),
        index=True,
        default=None,
    )


class LaboApplication(Base):
    __tablename__ = "labo_application"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(180), index=True)
    firstname: Mapped[str] = mapped_column(String(100))
    lastname: Mapped[str] = mapped_column(String(100))
    labo_name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    approved: Mapped[bool] = mapped_column(Boolean, default=False)


class AuthCode(Base):
    __tablename__ = "auth_code"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(180), index=True)
    code: Mapped[str] = mapped_column(String(6), index=True)
    expires_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)

# =========================================================
#                     IMPORTS / JOURNAL
# =========================================================
class ImportStatusEnum(enum.Enum):
    PENDING = "PENDING"
    STARTED = "STARTED"
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class ImportJob(Base):
    __tablename__ = "import_job"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    filename: Mapped[str | None] = mapped_column(Text())

    total_rows: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    inserted:   Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    updated:    Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )

    errors: Mapped[list] = mapped_column(
        JSONB, server_default="[]", nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(32), server_default="PENDING", nullable=False
    )

    created_at:  Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )

# =========================================================
#                     ENUMS RFID / EVENT
# =========================================================
class RfidTagStatus(enum.Enum):
    in_stock = "in_stock"
    loaded_on_display = "loaded_on_display"
    sold = "sold"
    lost = "lost"


class DisplaySaleEventType(str, enum.Enum):
    removal = "removal"
    return_ = "return_"   # <— important : même string que dans Postgres

# =========================================================
#                     PRÉSENTOIRS RFID
# =========================================================
class Presentoir(Base):
    __tablename__ = "presentoirs"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ⚠️ ANCIEN CHAMP : encore là pour compat
    pharmacy_id: Mapped[int | None] = mapped_column(
        ForeignKey("client.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    # 🔹 NOUVEAU : propriétaire du présentoir (client “owner” dédié)
    owner_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("display_owner_client.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    # 🔹 NOUVEAU : client final (base dédiée)
    end_client_id: Mapped[int | None] = mapped_column(
        ForeignKey("display_end_client.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tunnel_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_seen_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_status: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=sa.text("true"),
    )
    api_token_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    current_num_products: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relations legacy
    events: Mapped[list["PresentoirEvent"]] = relationship(
        "PresentoirEvent",
        back_populates="presentoir",
        cascade="all, delete-orphan",
    )

    # ⚠️ Client “global” legacy (à garder pour l’instant)
    client: Mapped["Client | None"] = relationship(
        "Client",
        backref="presentoirs",
    )

    # 🚀 Nouveaux liens clients dédiés aux présentoirs
    owner_client: Mapped["DisplayOwnerClient | None"] = relationship(
        "DisplayOwnerClient",
        back_populates="presentoirs_owned",
    )

    end_client: Mapped["DisplayEndClient | None"] = relationship(
        "DisplayEndClient",
        back_populates="presentoirs_installed",
    )

    # 🚀 Nouveaux liens RFID “logiques”
    rfid_items: Mapped[list["DisplayItem"]] = relationship(
        "DisplayItem",
        back_populates="presentoir",
        cascade="all, delete-orphan",
    )

    assignments: Mapped[list["DisplayAssignment"]] = relationship(
        "DisplayAssignment",
        back_populates="presentoir",
        cascade="all, delete-orphan",
    )

    sale_events: Mapped[list["DisplaySaleEvent"]] = relationship(
        "DisplaySaleEvent",
        back_populates="presentoir",
        cascade="all, delete-orphan",
    )


class PresentoirEvent(Base):
    __tablename__ = "presentoir_events"

    id: Mapped[int] = mapped_column(primary_key=True)

    presentoir_id: Mapped[int] = mapped_column(
        ForeignKey("presentoirs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    epc: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        index=True,
    )
    sku: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        index=True,
    )

    # "POSE" ou "RETIRE"
    event_type: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        index=True,
    )

    ts_device: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    ts_received: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    presentoir: Mapped["Presentoir"] = relationship(
        "Presentoir",
        back_populates="events",
    )

# -------------------- RFID LOGIQUE -----------------------

class RfidTag(Base):
    __tablename__ = "rfid_tag"

    id: Mapped[int] = mapped_column(primary_key=True)

    epc: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
    )

    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("product.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sku: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        index=True,
    )

    status: Mapped[RfidTagStatus] = mapped_column(
        PGEnum(RfidTagStatus, name="rfidtagstatus", create_type=False),
        nullable=False,
        server_default="in_stock",
    )

    last_seen_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relations
    product: Mapped["Product | None"] = relationship(
        "Product",
        back_populates="rfid_tags",
    )

    display_items: Mapped[list["DisplayItem"]] = relationship(
        "DisplayItem",
        back_populates="rfid_tag",
        cascade="all, delete-orphan",
    )

    sale_events: Mapped[list["DisplaySaleEvent"]] = relationship(
        "DisplaySaleEvent",
        back_populates="rfid_tag",
        cascade="all, delete-orphan",
    )


class DisplayItem(Base):
    """
    Tag RFID chargé physiquement sur un présentoir.
    """
    __tablename__ = "display_item"
    __table_args__ = (
        UniqueConstraint(
            "presentoir_id",
            "rfid_tag_id",
            "unloaded_at",
            name="uq_display_item_presentoir_tag_unloaded",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    presentoir_id: Mapped[int] = mapped_column(
        ForeignKey("presentoirs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    rfid_tag_id: Mapped[int] = mapped_column(
        ForeignKey("rfid_tag.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    level_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position_index: Mapped[int | None] = mapped_column(Integer, nullable=True)

    loaded_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    unloaded_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=sa.text("true"),
    )

    presentoir: Mapped["Presentoir"] = relationship(
        "Presentoir",
        back_populates="rfid_items",
    )
    rfid_tag: Mapped["RfidTag"] = relationship(
        "RfidTag",
        back_populates="display_items",
    )


class DisplayAssignment(Base):
    """
    Historique d’assignation d’un présentoir à une pharmacie (Client).
    """
    __tablename__ = "display_assignment"

    id: Mapped[int] = mapped_column(primary_key=True)

    presentoir_id: Mapped[int] = mapped_column(
        ForeignKey("presentoirs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    pharmacy_id: Mapped[int] = mapped_column(
        ForeignKey("client.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    assigned_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    unassigned_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    presentoir: Mapped["Presentoir"] = relationship(
        "Presentoir",
        back_populates="assignments",
    )
    pharmacy: Mapped["Client"] = relationship(
        "Client",
        back_populates="display_assignments",
    )


class DisplaySaleEvent(Base):
    """
    Événements de vente (retrait) ou retour détectés via RFID.
    """
    __tablename__ = "display_sale_event"

    id: Mapped[int] = mapped_column(primary_key=True)

    presentoir_id: Mapped[int] = mapped_column(
        ForeignKey("presentoirs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    pharmacy_id: Mapped[int | None] = mapped_column(
        ForeignKey("client.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    rfid_tag_id: Mapped[int] = mapped_column(
        ForeignKey("rfid_tag.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("product.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    event_type: Mapped[DisplaySaleEventType] = mapped_column(
        PGEnum(DisplaySaleEventType, name="displaysaleeventtype", create_type=False),
        nullable=False,
    )


    occurred_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    unit_price_ht: Mapped[Numeric | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )

    presentoir: Mapped["Presentoir"] = relationship(
        "Presentoir",
        back_populates="sale_events",
    )
    pharmacy: Mapped["Client | None"] = relationship(
        "Client",
        back_populates="display_sale_events",
    )
    rfid_tag: Mapped["RfidTag"] = relationship(
        "RfidTag",
        back_populates="sale_events",
    )
    product: Mapped["Product | None"] = relationship(
        "Product",
        back_populates="display_sale_events",
    )


# =========================================================
#         CLIENTS PRÉSENTOIRS (PROPRIÉTAIRES / FINAUX)
# =========================================================

class DisplayOwnerClient(Base):
    """
    Client propriétaire des présentoirs (celui qui achète / loue le parc).
    Exemple : un labo, une centrale, un grossiste…
    """
    __tablename__ = "display_owner_client"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(String(255), index=True)
    contact_name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(180), index=True)
    phone: Mapped[str | None] = mapped_column(String(32))

    company_number: Mapped[str | None] = mapped_column(
        String(64),
        doc="N° société / identifiant interne si besoin",
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    # Présentoirs possédés par ce client
    presentoirs_owned: Mapped[list["Presentoir"]] = relationship(
        "Presentoir",
        back_populates="owner_client",
    )

    end_clients: Mapped[list["DisplayEndClient"]] = relationship(
        "DisplayEndClient",
        back_populates="owner_client",
    )

    # 🔹 NOUVEAU : produits destinés aux présentoirs de cet owner
    display_products: Mapped[list["DisplayProduct"]] = relationship(
        "DisplayProduct",
        back_populates="owner_client",
        cascade="all, delete-orphan",
    )



class DisplayEndClient(Base):
    """
    Client final où le présentoir est installé physiquement
    (pharmacie, magasin, point de vente, etc.).
    Décorrélé de ta table Client “globale”.
    """
    __tablename__ = "display_end_client"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(String(255), index=True)
    type: Mapped[str | None] = mapped_column(
        String(64),
        doc="Type de point de vente (pharmacie, parapharmacie, magasin, etc.)",
    )
    contact_name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(180), index=True)
    phone: Mapped[str | None] = mapped_column(String(32))

    address1: Mapped[str | None] = mapped_column(String(255))
    address2: Mapped[str | None] = mapped_column(String(255))
    postcode: Mapped[str | None] = mapped_column(String(16))
    city: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(120))

    external_ref: Mapped[str | None] = mapped_column(
        String(64),
        doc="Code externe éventuel (Sage, Presta, etc.)",
        index=True,
    )
    
    # 🔹 NOUVEAU : lien vers un client propriétaire déjà créé
    owner_client_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("display_owner_client.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )    

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    # Présentoirs installés chez ce client final
    presentoirs_installed: Mapped[list["Presentoir"]] = relationship(
        "Presentoir",
        back_populates="end_client",
    )

    owner_client: Mapped["DisplayOwnerClient | None"] = relationship(
        "DisplayOwnerClient",
        back_populates="end_clients",
    )    


# =========================================================
#         PRODUITS PRÉSENTOIRS (DISPLAY PRODUCTS)
# =========================================================

class DisplayProduct(Base):
    __tablename__ = "display_product"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_client_id: Mapped[int] = mapped_column(
        sa.Integer,
        sa.ForeignKey("display_owner_client.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)

    # 👇 NOUVEAU : EAN (optionnel)
    ean13: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)

    created_at: Mapped[DateTime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[DateTime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    owner_client: Mapped["DisplayOwnerClient"] = relationship(
        "DisplayOwnerClient",
        back_populates="display_products",
    )

    rfid_links: Mapped[list["RfidTagProductLink"]] = relationship(
        "RfidTagProductLink",
        back_populates="display_product",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "owner_client_id",
            "sku",
            name="uq_display_product_owner_sku",
        ),
    )



class RfidTagProductLink(Base):
    """
    Lien entre un EPC (tag RFID) et un Display Product.
    On garde l'EPC en clair, sans FK direct vers rfid_tag,
    pour pouvoir lier même des EPC pas encore "normalisés" dans rfid_tag.
    """
    __tablename__ = "rfid_tag_product_link"

    id: Mapped[int] = mapped_column(primary_key=True)

    epc: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
    )

    display_product_id: Mapped[int] = mapped_column(
        ForeignKey("display_product.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    linked_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    display_product: Mapped["DisplayProduct"] = relationship(
        "DisplayProduct",
        back_populates="rfid_links",
    )



# =========================================================
#         FONT PAR DEFAUT PDF
# =========================================================

   
    
class GlobalFont(Base):
    __tablename__ = "global_fonts"

    id = Column(Integer, primary_key=True, index=True)

    display_name = Column(String(255), nullable=False)
    family_key = Column(String(64), unique=True, nullable=False, index=True)  # ex: GLOBAL_FONT_xxxxx

    weight = Column(Integer, nullable=True)  # 400/700...
    style = Column(String(16), nullable=True)  # normal/italic

    file_path = Column(String(1024), nullable=False)  # chemin local .ttf/.otf dans container
    enabled = Column(Boolean, nullable=False, server_default="true")

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())    