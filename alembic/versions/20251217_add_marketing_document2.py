"""add marketing_document table

Revision ID: <remplace_par_ton_id>
Revises: <remplace_par_la_revision_precedente>
Create Date: <auto>
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251217_add_marketing_document2"
down_revision = "20251216_add_validated_to_orderstatus_enum"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "marketing_document",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("labo_id", sa.Integer(), sa.ForeignKey("labo.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("doc_type", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    
    op.create_index("ix_marketing_document_created_at", "marketing_document", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_marketing_document_created_at", table_name="marketing_document")

    op.drop_table("marketing_document")
