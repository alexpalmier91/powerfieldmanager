"""Link existing labo_documents to delivery_address (billing + shipping)

Revision ID: 20251208_link_labo_documents_delivery_address
Revises: 20251208_populate_delivery_address_from_client
Create Date: 2025-12-08 00:10:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20251208_link_labo_documents_delivery_address"
down_revision = "20251208_populate_delivery_address_from_client"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Ajout des colonnes sur labo_document si elles n'existent pas encore
    op.add_column(
        "labo_document",
        sa.Column("billing_address_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "labo_document",
        sa.Column("shipping_address_id", sa.Integer(), nullable=True),
    )

    # 2) FK vers delivery_address
    op.create_foreign_key(
        "fk_labo_document_billing_address",
        "labo_document",
        "delivery_address",
        ["billing_address_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_labo_document_shipping_address",
        "labo_document",
        "delivery_address",
        ["shipping_address_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 3) Peupler les colonnes pour les documents existants
    op.execute(
        """
        UPDATE labo_document ld
        SET
            billing_address_id = da.id,
            shipping_address_id = da.id
        FROM client c
        JOIN delivery_address da
          ON da.client_id = c.id
        WHERE ld.client_id = c.id
          AND (ld.billing_address_id IS NULL OR ld.shipping_address_id IS NULL);
        """
    )


def downgrade() -> None:
    # On remet tout à NULL par sécurité
    op.execute(
        """
        UPDATE labo_document
        SET
          billing_address_id = NULL,
          shipping_address_id = NULL;
        """
    )

    # Suppression des FK puis des colonnes
    op.drop_constraint(
        "fk_labo_document_billing_address",
        "labo_document",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_labo_document_shipping_address",
        "labo_document",
        type_="foreignkey",
    )

    op.drop_column("labo_document", "billing_address_id")
    op.drop_column("labo_document", "shipping_address_id")
