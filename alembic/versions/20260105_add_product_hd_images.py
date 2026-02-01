"""add product hd image urls + product_image gallery table

Revision ID: 20260105_add_product_hd_images
Revises: <PUT_PREVIOUS_REVISION_ID>
Create Date: 2026-01-05
"""
from alembic import op
import sqlalchemy as sa


revision = "20260105_add_product_hd_images"
down_revision = "20251231_add_global_fonts"
branch_labels = None
depends_on = None


def upgrade():
    # --- product: 3 new columns
    op.add_column("product", sa.Column("thumb_url", sa.String(length=1024), nullable=True))
    op.add_column("product", sa.Column("hd_jpg_url", sa.String(length=1024), nullable=True))
    op.add_column("product", sa.Column("hd_webp_url", sa.String(length=1024), nullable=True))

    # --- product_image table
    op.create_table(
        "product_image",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.id", ondelete="CASCADE"), nullable=False),

        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_cover", sa.Boolean(), nullable=False, server_default=sa.text("false")),

        sa.Column("thumb_url", sa.String(length=1024), nullable=True),
        sa.Column("hd_jpg_url", sa.String(length=1024), nullable=True),
        sa.Column("hd_webp_url", sa.String(length=1024), nullable=True),

        sa.Column("original_url", sa.String(length=2048), nullable=True),

        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("source_etag", sa.String(length=256), nullable=True),
        sa.Column("source_last_modified", sa.String(length=256), nullable=True),
        sa.Column("source_size", sa.Integer(), nullable=True),

        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),

        sa.UniqueConstraint("product_id", "position", name="uq_product_image_product_position"),
    )

    op.create_index("ix_product_image_product_id", "product_image", ["product_id"])

    # cleanup defaults
    op.alter_column("product_image", "position", server_default=None)
    op.alter_column("product_image", "is_cover", server_default=None)


def downgrade():
    op.drop_index("ix_product_image_product_id", table_name="product_image")
    op.drop_table("product_image")

    op.drop_column("product", "hd_webp_url")
    op.drop_column("product", "hd_jpg_url")
    op.drop_column("product", "thumb_url")
