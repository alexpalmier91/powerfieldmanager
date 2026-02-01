# alembic/versions/xxxx_labo_stock_sync_config.py
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# Identifiants Alembic
revision = "20251201_labo_stock_sync_config"
down_revision = "20251128_add_product_commission"  # à adapter
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "labo_stock_sync_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("labo_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("api_url", sa.String(length=512), nullable=True),
        sa.Column("api_token", sa.String(length=512), nullable=True),
        sa.Column("sku_field", sa.String(length=64), nullable=False, server_default="sku"),
        sa.Column("qty_field", sa.String(length=64), nullable=False, server_default="qty"),
        sa.Column("run_at", sa.Time(timezone=False), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=64), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["labo_id"], ["labo.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("labo_id", name="uq_labo_stock_sync_config_labo_id"),
    )


def downgrade():
    op.drop_table("labo_stock_sync_config")
