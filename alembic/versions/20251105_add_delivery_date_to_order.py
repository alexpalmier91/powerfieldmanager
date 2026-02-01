from alembic import op

# Alembic identifiers
revision = "add_delivery_date_to_order"
down_revision = "20251102_add_country_to_client"  # ex: "20251029_xxx"
branch_labels = None
depends_on = None


def upgrade():
    # Postgres supporte IF NOT EXISTS pour ADD COLUMN
    op.execute('ALTER TABLE "order" ADD COLUMN IF NOT EXISTS delivery_date DATE')


def downgrade():
    # Sûr et idempotent
    op.execute('ALTER TABLE "order" DROP COLUMN IF EXISTS delivery_date')
