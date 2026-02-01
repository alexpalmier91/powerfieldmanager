"""add display_owner table and owner_id on presentoir

Revision ID: 20251210_add_display_owner
Revises: 20251209_add_rfid_display_tables
Create Date: 2025-12-10 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251210_add_display_owner"
down_revision = "20251209_add_rfid_display_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "display_owner",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("email", sa.String(length=180), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["client.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_display_owner_client_id",
        "display_owner",
        ["client_id"],
    )

    # Ajout de owner_id sur presentoirs
    op.add_column(
        "presentoirs",
        sa.Column("owner_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_presentoirs_owner_id",
        "presentoirs",
        ["owner_id"],
    )
    op.create_foreign_key(
        "fk_presentoirs_owner_id",
        "presentoirs",
        "display_owner",
        ["owner_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_presentoirs_owner_id", "presentoirs", type_="foreignkey")
    op.drop_index("ix_presentoirs_owner_id", table_name="presentoirs")
    op.drop_column("presentoirs", "owner_id")

    op.drop_index("ix_display_owner_client_id", table_name="display_owner")
    op.drop_table("display_owner")
