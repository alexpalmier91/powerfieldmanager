"""add display_product and rfid_tag_product_link

Revision ID: xxxxxxxxxxxx
Revises: <previous_revision_id>
Create Date: 2025-12-11 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20251211_add_display_product_and_rfid_tag_product_link"
down_revision: Union[str, None] = "20251211_add_owner_fk_to_display_end_client"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -----------------------------------------------------
    # Table display_product
    # -----------------------------------------------------
    op.create_table(
        "display_product",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "owner_client_id",
            sa.Integer(),
            sa.ForeignKey("display_owner_client.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sku", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # Unicité (owner_client_id, sku)
    op.create_unique_constraint(
        "uq_display_product_owner_sku",
        "display_product",
        ["owner_client_id", "sku"],
    )

    # -----------------------------------------------------
    # Table rfid_tag_product_link
    # -----------------------------------------------------
    op.create_table(
        "rfid_tag_product_link",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "epc",
            sa.String(length=128),
            nullable=False,
        ),
        sa.Column(
            "display_product_id",
            sa.Integer(),
            sa.ForeignKey("display_product.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "linked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # EPC unique + indexé
    op.create_index(
        "ix_rfid_tag_product_link_epc",
        "rfid_tag_product_link",
        ["epc"],
        unique=True,
    )

    # Index sur display_product_id
    op.create_index(
        "ix_rfid_tag_product_link_display_product_id",
        "rfid_tag_product_link",
        ["display_product_id"],
        unique=False,
    )


def downgrade() -> None:
    # rfid_tag_product_link
    op.drop_index(
        "ix_rfid_tag_product_link_display_product_id",
        table_name="rfid_tag_product_link",
    )
    op.drop_index(
        "ix_rfid_tag_product_link_epc",
        table_name="rfid_tag_product_link",
    )
    op.drop_table("rfid_tag_product_link")

    # display_product
    op.drop_constraint(
        "uq_display_product_owner_sku",
        "display_product",
        type_="unique",
    )
    op.drop_table("display_product")