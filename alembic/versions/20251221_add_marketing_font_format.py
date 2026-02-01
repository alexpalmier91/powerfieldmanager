"""add format to marketing_font

Revision ID: add_marketing_font_format
Revises: <REMPLACE_PAR_LA_REVISION_PRECEDENTE>
Create Date: 2025-12-21
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251221_add_marketing_font_format"
down_revision = "20251219_add_marketing_fonts_table"
branch_labels = None
depends_on = None


def upgrade():
    # Ajout de la colonne "format"
    op.add_column(
        "marketing_font",
        sa.Column("format", sa.String(length=32), nullable=True),
    )


def downgrade():
    # Suppression de la colonne "format"
    op.drop_column("marketing_font", "format")
