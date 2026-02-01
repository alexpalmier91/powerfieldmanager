"""create delivery_address table

Revision ID: 20250101_01_delivery_address
Revises: <met la révision précédente ici>
Create Date: 2025-01-01 12:00:00
"""

from alembic import op
import sqlalchemy as sa


# Identifiants de migration
revision = "20251208_delivery_address"
down_revision = "20251204_add_discount_percent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "delivery_address",
        sa.Column("id", sa.Integer(), primary_key=True),

        sa.Column("client_id", sa.Integer(), sa.ForeignKey("client.id", ondelete="CASCADE"), nullable=False),

        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),

        sa.Column("address1", sa.String(length=255), nullable=False),
        sa.Column("address2", sa.String(length=255), nullable=True),
        sa.Column("postcode", sa.String(length=16), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("country", sa.String(length=120), nullable=True),

        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("true")),

        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    # Index pour accélérer la recherche de l'adresse de livraison par défaut
    op.create_index(
        "ix_delivery_address_client_default",
        "delivery_address",
        ["client_id", "is_default"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_delivery_address_client_default", table_name="delivery_address")
    op.drop_table("delivery_address")
