"""Add discount_percent column to order_item"""

from alembic import op
import sqlalchemy as sa

# Identifiants à adapter selon ton projet
revision = "20251204_add_discount_percent"
down_revision = "20251203_labo_agent_orders_auto_import"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "order_item",
        sa.Column(
            "discount_percent",
            sa.Numeric(5, 2),
            nullable=True,
            comment="Remise % saisie par l'agent",
        ),
    )


def downgrade():
    op.drop_column("order_item", "discount_percent")
