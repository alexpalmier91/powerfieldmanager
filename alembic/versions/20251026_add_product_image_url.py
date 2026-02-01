"""add product.image_url"""

from alembic import op
import sqlalchemy as sa

revision = "20251026_add_product_image_url"
down_revision = "20251025_add_product_category_id"  # ⬅️ mets ici l'ID exact de ton head actuel
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("product", sa.Column("image_url", sa.Text(), nullable=True))

def downgrade() -> None:
    op.drop_column("product", "image_url")
