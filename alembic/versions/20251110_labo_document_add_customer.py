"""add customer_id to labo_document

Revision ID: 20251110_labo_document_add_customer
Revises: 20251107_labo_document
Create Date: 2025-11-10
"""
from alembic import op
import sqlalchemy as sa

# Identifiants de migration
revision = "20251110_labo_document_add_customer"
down_revision = "20251107_labo_document"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ajout de la colonne customer_id dans labo_document
    op.add_column(
        "labo_document",
        sa.Column("customer_id", sa.Integer(), nullable=True)
    )
    op.create_index(
        "ix_labo_document_customer_id", "labo_document", ["customer_id"]
    )
    op.create_foreign_key(
        "fk_labo_document_customer",
        source_table="labo_document",
        referent_table="customer",
        local_cols=["customer_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Suppression propre
    op.drop_constraint("fk_labo_document_customer", "labo_document", type_="foreignkey")
    op.drop_index("ix_labo_document_customer_id", table_name="labo_document")
    op.drop_column("labo_document", "customer_id")
