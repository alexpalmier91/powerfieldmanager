"""add labo_sales_import_config

Revision ID: 20251201_labo_sales_import_config
Revises: <met ICI l'ID de la révision précédente>
Create Date: 2025-12-01 22:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251201_labo_sales_import_config"
down_revision = "20251201_labo_stock_sync_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "labo_sales_import_config",
        sa.Column("labo_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("file_url", sa.String(length=512), nullable=True),
        sa.Column("run_at", sa.Time(timezone=False), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=32), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["labo_id"], ["labo.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("labo_id"),
    )


def downgrade() -> None:
    op.drop_table("labo_sales_import_config")
