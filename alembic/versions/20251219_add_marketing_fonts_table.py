"""add marketing fonts table

Revision ID: 9b42c8a7c1fd
Revises: <MET_TA_PRECEDENTE_REVISION>
Create Date: 2025-03-XX
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251219_add_marketing_fonts_table"
down_revision = "20251218_pdf_page_count"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "marketing_font",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "labo_id",
            sa.Integer(),
            sa.ForeignKey("labo.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "name",
            sa.String(length=255),
            nullable=False,
        ),
        sa.Column(
            "filename",
            sa.String(length=255),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_marketing_font_labo_name",
        "marketing_font",
        ["labo_id", "name"],
    )


def downgrade():
    op.drop_index("ix_marketing_font_labo_name", table_name="marketing_font")
    op.drop_table("marketing_font")
