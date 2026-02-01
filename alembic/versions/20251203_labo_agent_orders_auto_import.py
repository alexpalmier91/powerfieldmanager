from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# Identifiants Alembic
revision = "20251203_labo_agent_orders_auto_import"
down_revision = "20251201_labo_sales_import_config"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "labo_agent_orders_auto_import_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("labo_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("drive_folder_id", sa.String(length=512), nullable=True),
        sa.Column("drive_folder_url", sa.String(length=1024), nullable=True),
        sa.Column("run_at", sa.Time(timezone=False), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=64), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_summary", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["labo_id"], ["labo.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("labo_id", name="uq_labo_agent_orders_auto_import_labo_id"),
    )


def downgrade():
    op.drop_table("labo_agent_orders_auto_import_config")
