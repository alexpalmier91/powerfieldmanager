"""add product.category_id FK -> category.id"""

from alembic import op
import sqlalchemy as sa

# Révisions
revision = "20251025_add_product_category_id"
down_revision = "20251025_add_category_table"  # <-- la dernière migration appliquée chez toi
branch_labels = None
depends_on = None

def upgrade() -> None:
    # 1) Ajouter la colonne nullable
    op.add_column("product", sa.Column("category_id", sa.Integer(), nullable=True))

    # 2) Index (non unique)
    op.create_index("ix_product_category_id", "product", ["category_id"], unique=False)

    # 3) Contrainte FK
    op.create_foreign_key(
        "fk_product_category",
        source_table="product",
        referent_table="category",
        local_cols=["category_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )

def downgrade() -> None:
    op.drop_constraint("fk_product_category", "product", type_="foreignkey")
    op.drop_index("ix_product_category_id", table_name="product")
    op.drop_column("product", "category_id")
