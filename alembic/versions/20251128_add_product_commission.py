"""Add commission column on product

Revision ID: 20251128_add_product_commission
Revises: <METTRE_ICI_DOWN_REVISION>
Create Date: 2025-11-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# Identifiants de migration Alembic
revision = "20251128_add_product_commission"
down_revision = "2025_11_25_2300_make_order_item_product_id_nullable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Ajout de la colonne commission sur la table product
    op.add_column(
        "product",
        sa.Column(
            "commission",
            sa.Numeric(5, 2),
            nullable=True,          # nullable=True comme demandé
            server_default="0.00",  # valeur par défaut DB pour les nouvelles lignes
        ),
    )

    # 2) Mise à jour des lignes existantes à 0
    op.execute("UPDATE product SET commission = 0.00 WHERE commission IS NULL")

    # 3) Optionnel : on peut garder le server_default
    #    (ou l'enlever si tu préfères gérer la valeur par défaut uniquement côté ORM)
    # op.alter_column("product", "commission", server_default=None)


def downgrade() -> None:
    # Suppression de la colonne (rollback)
    op.drop_column("product", "commission")
