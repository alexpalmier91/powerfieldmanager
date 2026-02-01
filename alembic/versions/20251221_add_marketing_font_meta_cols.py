"""add missing meta columns to marketing_font

Revision ID: add_marketing_font_meta_cols
Revises: <REMPLACE_PAR_REVISION_PRECEDENTE>
Create Date: 2025-12-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20251221_add_marketing_font_meta_cols"
down_revision = "20251221_add_marketing_font_format"
branch_labels = None
depends_on = None


def upgrade():
    # NOTE: on ajoute en nullable=True pour ne rien casser sur les lignes existantes
    op.add_column("marketing_font", sa.Column("mime_type", sa.String(length=120), nullable=True))
    op.add_column("marketing_font", sa.Column("size_bytes", sa.Integer(), nullable=True))
    op.add_column("marketing_font", sa.Column("sha256", sa.String(length=64), nullable=True))

    # (optionnel) index utile si tu veux dédupliquer par hash plus tard
    op.create_index("ix_marketing_font_sha256", "marketing_font", ["sha256"], unique=False)


def downgrade():
    op.drop_index("ix_marketing_font_sha256", table_name="marketing_font")
    op.drop_column("marketing_font", "sha256")
    op.drop_column("marketing_font", "size_bytes")
    op.drop_column("marketing_font", "mime_type")
