"""add original_name to marketing_font

Revision ID: 20251221_add_original_name_marketing_font
Revises: <PUT_PREVIOUS_REVISION_ID_HERE>
Create Date: 2025-12-21
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251221_add_original_name_marketing_font"
down_revision = "20251221_add_marketing_font_meta_cols"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("marketing_font", sa.Column("original_name", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("marketing_font", "original_name")
