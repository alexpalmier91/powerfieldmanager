"""Make order_item.product_id nullable + add order.comment

Revision ID: 2025_11_25_2300_make_order_item_product_id_nullable
Revises: 2025_11_20_2200_add_bank_fields_to_client
Create Date: 2025-11-25 23:00:00
"""

from alembic import op
import sqlalchemy as sa


# Revision identifiers, used by Alembic.
revision = '2025_11_25_2300_make_order_item_product_id_nullable'
down_revision = '2025_11_20_2200_add_bank_fields_to_client'
branch_labels = None
depends_on = None


def upgrade():
    # 1) Colonne comment sur la table order
    op.add_column(
        'order',
        sa.Column('comment', sa.Text(), nullable=True)
    )

    # 2) Rend product_id nullable sur order_item
    op.alter_column(
        'order_item',
        'product_id',
        existing_type=sa.Integer(),
        nullable=True
    )


def downgrade():
    # 1) On remet product_id NOT NULL (⚠️ échouera si des lignes ont product_id = NULL)
    op.alter_column(
        'order_item',
        'product_id',
        existing_type=sa.Integer(),
        nullable=False
    )

    # 2) On supprime la colonne comment
    op.drop_column('order', 'comment')
