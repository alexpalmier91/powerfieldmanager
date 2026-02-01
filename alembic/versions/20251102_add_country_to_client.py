"""add country to client (referentiel)"""

from alembic import op
import sqlalchemy as sa

# ⚠️ Remplace par l'ID réel généré par Alembic
revision = "20251102_add_country_to_client"
down_revision = "20251030_merge_client_user_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "client",
        sa.Column("country", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("client", "country")
