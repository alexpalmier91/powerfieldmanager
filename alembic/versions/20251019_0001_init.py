from alembic import op
import sqlalchemy as sa

revision = "20251019_0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "labo",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
    )
    op.create_table(
        "product",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("labo_id", sa.Integer, sa.ForeignKey("labo.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_index("ix_product_sku", "product", ["sku"])
    op.create_table(
        "variant",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("product.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ean13", sa.String(length=13), nullable=True),
        sa.Column("price_ht", sa.Numeric(12,2), nullable=False, server_default="0"),
        sa.Column("stock", sa.Integer, nullable=False, server_default="0"),
    )

def downgrade():
    op.drop_table("variant")
    op.drop_index("ix_product_sku", table_name="product")
    op.drop_table("product")
    op.drop_table("labo")
