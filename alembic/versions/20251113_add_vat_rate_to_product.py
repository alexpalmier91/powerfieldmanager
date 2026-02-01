from alembic import op
import sqlalchemy as sa

revision = "20251113_add_vat_rate_to_product"
down_revision = "20251110_labo_document_add_customer"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "product",
        sa.Column(
            "vat_rate",
            sa.Numeric(5, 2),
            nullable=False,
            server_default="20.00",  # adapte si besoin
        ),
    )


def downgrade():
    op.drop_column("product", "vat_rate")
