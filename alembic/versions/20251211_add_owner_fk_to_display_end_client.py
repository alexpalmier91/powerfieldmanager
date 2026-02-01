"""add owner_client_id to display_end_client

Revision ID: 2025xxxx_add_owner_fk_to_display_end_client
Revises: 20251210_add_display_clients
Create Date: 2025-12-11
"""
from alembic import op
import sqlalchemy as sa


# Remplace ces valeurs par les bonnes
revision = "20251211_add_owner_fk_to_display_end_client"
down_revision = "20251210_add_display_clients"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Ajout de la colonne
    op.add_column(
        "display_end_client",
        sa.Column("owner_client_id", sa.Integer(), nullable=True),
    )

    # 2) Index pour les perfs
    op.create_index(
        "ix_display_end_client_owner_client_id",
        "display_end_client",
        ["owner_client_id"],
    )

    # 3) Clé étrangère -> display_owner_client.id
    op.create_foreign_key(
        "fk_display_end_client_owner_client",
        "display_end_client",
        "display_owner_client",
        ["owner_client_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_display_end_client_owner_client",
        "display_end_client",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_display_end_client_owner_client_id",
        table_name="display_end_client",
    )
    op.drop_column("display_end_client", "owner_client_id")
