"""add ean13 to display_product

Revision ID: 20251211_add_ean_to_display_product
Revises: 20251211_add_display_product_and_rfid_tag_product_link
Create Date: 2025-12-11 15:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20251211_add_ean_to_display_product"
down_revision: Union[str, None] = "20251211_add_display_product_and_rfid_tag_product_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "display_product",
        sa.Column("ean13", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("display_product", "ean13")
