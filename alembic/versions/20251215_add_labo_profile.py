"""add labo profile + branding fields

Revision ID: 20251215_add_labo_profile
Revises: <PUT_YOUR_PREVIOUS_REVISION_ID_HERE>
Create Date: 2025-12-15
"""
from alembic import op
import sqlalchemy as sa


revision = "20251215_add_labo_profile"
down_revision = "20251211_add_ean_to_display_product"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("labo", sa.Column("legal_name", sa.String(length=255), nullable=True))
    op.add_column("labo", sa.Column("siret", sa.String(length=14), nullable=True))
    op.add_column("labo", sa.Column("vat_number", sa.String(length=32), nullable=True))
    op.add_column("labo", sa.Column("email", sa.String(length=180), nullable=True))
    op.add_column("labo", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column("labo", sa.Column("address1", sa.String(length=255), nullable=True))
    op.add_column("labo", sa.Column("address2", sa.String(length=255), nullable=True))
    op.add_column("labo", sa.Column("zip", sa.String(length=16), nullable=True))
    op.add_column("labo", sa.Column("city", sa.String(length=120), nullable=True))
    op.add_column("labo", sa.Column("country", sa.String(length=120), nullable=True))
    op.add_column("labo", sa.Column("invoice_footer", sa.Text(), nullable=True))
    op.add_column("labo", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("labo", sa.Column("logo_path", sa.Text(), nullable=True))

    op.add_column("labo", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))
    op.add_column("labo", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True))

    op.create_index("ix_labo_is_active", "labo", ["is_active"], unique=False)
    op.create_index("ix_labo_city", "labo", ["city"], unique=False)


def downgrade():
    op.drop_index("ix_labo_city", table_name="labo")
    op.drop_index("ix_labo_is_active", table_name="labo")

    op.drop_column("labo", "updated_at")
    op.drop_column("labo", "created_at")

    op.drop_column("labo", "logo_path")
    op.drop_column("labo", "is_active")
    op.drop_column("labo", "invoice_footer")
    op.drop_column("labo", "country")
    op.drop_column("labo", "city")
    op.drop_column("labo", "zip")
    op.drop_column("labo", "address2")
    op.drop_column("labo", "address1")
    op.drop_column("labo", "phone")
    op.drop_column("labo", "email")
    op.drop_column("labo", "vat_number")
    op.drop_column("labo", "siret")
    op.drop_column("labo", "legal_name")
