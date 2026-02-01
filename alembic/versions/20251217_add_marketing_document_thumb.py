"""add thumb_filename to marketing_document

Revision ID: 20251217_add_marketing_document_thumb
Revises: 20251217_add_marketing_document2
Create Date: 2025-12-17
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251217_add_marketing_document_thumb"
down_revision = "20251217_add_marketing_document2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "marketing_document",
        sa.Column("thumb_filename", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("marketing_document", "thumb_filename")
