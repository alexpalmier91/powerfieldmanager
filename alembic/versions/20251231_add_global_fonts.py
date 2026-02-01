"""add global_fonts table

Revision ID: XXXX_add_global_fonts
Revises: <PREV_REVISION_ID>
Create Date: 2025-12-31
"""

from alembic import op
import sqlalchemy as sa


revision = "20251231_add_global_fonts"
down_revision = "20251221_add_original_name_marketing_font"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "global_fonts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("family_key", sa.String(length=64), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=True),
        sa.Column("style", sa.String(length=16), nullable=True),
        sa.Column("file_path", sa.String(length=1024), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_global_fonts_family_key", "global_fonts", ["family_key"], unique=True)
    op.create_index("ix_global_fonts_enabled", "global_fonts", ["enabled"], unique=False)


def downgrade():
    op.drop_index("ix_global_fonts_enabled", table_name="global_fonts")
    op.drop_index("ix_global_fonts_family_key", table_name="global_fonts")
    op.drop_table("global_fonts")
