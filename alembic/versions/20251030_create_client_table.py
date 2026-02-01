"""create client table

Revision ID: 20251030_create_client_table
Revises: 20251026_add_product_image_url
Create Date: 2025-10-30 10:00:00
"""

from alembic import op
import sqlalchemy as sa


# --- Révisions ---
revision = "20251030_create_client_table"
down_revision = "20251026_add_product_image_url"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "client",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("company_name", sa.String(255), nullable=False),
        sa.Column("first_name", sa.String(100), nullable=True),
        sa.Column("last_name", sa.String(100), nullable=True),
        sa.Column("address1", sa.String(255), nullable=True),
        sa.Column("postcode", sa.String(16), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("siret", sa.String(14), nullable=True, unique=True),
        sa.Column("email", sa.String(180), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("groupement", sa.String(120), nullable=True),
        sa.Column("rib_pdf_hint", sa.Text(), nullable=True),
        sa.Column("rib_pdf_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    # Index utiles
    op.create_index("ix_client_email", "client", ["email"])
    op.create_index("ix_client_company_name", "client", ["company_name"])
    op.create_index("ix_client_postcode_city", "client", ["postcode", "city"])


def downgrade():
    op.drop_index("ix_client_postcode_city", table_name="client")
    op.drop_index("ix_client_company_name", table_name="client")
    op.drop_index("ix_client_email", table_name="client")
    op.drop_table("client")
