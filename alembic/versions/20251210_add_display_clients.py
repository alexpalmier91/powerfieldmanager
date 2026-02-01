# alembic/versions/20251210_add_display_clients.py
from alembic import op
import sqlalchemy as sa

# Révision
revision = "20251210_add_display_clients"
down_revision = "20251210_add_display_owner"  # à remplacer

def upgrade():
    # 1) Table propriétaires
    op.create_table(
        "display_owner_client",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=180), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("company_number", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_display_owner_client_name",
        "display_owner_client",
        ["name"],
    )
    op.create_index(
        "ix_display_owner_client_email",
        "display_owner_client",
        ["email"],
    )

    # 2) Table clients finaux
    op.create_table(
        "display_end_client",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=True),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=180), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("address1", sa.String(length=255), nullable=True),
        sa.Column("address2", sa.String(length=255), nullable=True),
        sa.Column("postcode", sa.String(length=16), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("country", sa.String(length=120), nullable=True),
        sa.Column("external_ref", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_display_end_client_name",
        "display_end_client",
        ["name"],
    )
    op.create_index(
        "ix_display_end_client_email",
        "display_end_client",
        ["email"],
    )
    op.create_index(
        "ix_display_end_client_external_ref",
        "display_end_client",
        ["external_ref"],
    )

    # 3) Colonnes sur presentoirs
    with op.batch_alter_table("presentoirs") as batch_op:
        batch_op.add_column(
            sa.Column("owner_client_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("end_client_id", sa.Integer(), nullable=True)
        )
        batch_op.create_index(
            "ix_presentoirs_owner_client_id",
            ["owner_client_id"],
        )
        batch_op.create_index(
            "ix_presentoirs_end_client_id",
            ["end_client_id"],
        )
        batch_op.create_foreign_key(
            "fk_presentoirs_owner_client",
            "display_owner_client",
            ["owner_client_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_presentoirs_end_client",
            "display_end_client",
            ["end_client_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("presentoirs") as batch_op:
        batch_op.drop_constraint("fk_presentoirs_end_client", type_="foreignkey")
        batch_op.drop_constraint("fk_presentoirs_owner_client", type_="foreignkey")
        batch_op.drop_index("ix_presentoirs_end_client_id")
        batch_op.drop_index("ix_presentoirs_owner_client_id")
        batch_op.drop_column("end_client_id")
        batch_op.drop_column("owner_client_id")

    op.drop_index("ix_display_end_client_external_ref", table_name="display_end_client")
    op.drop_index("ix_display_end_client_email", table_name="display_end_client")
    op.drop_index("ix_display_end_client_name", table_name="display_end_client")
    op.drop_table("display_end_client")

    op.drop_index("ix_display_owner_client_email", table_name="display_owner_client")
    op.drop_index("ix_display_owner_client_name", table_name="display_owner_client")
    op.drop_table("display_owner_client")
