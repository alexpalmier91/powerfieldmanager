from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20251116_create_appointment_table"
down_revision = "20251113_add_vat_rate_to_product"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) S'assurer que le type ENUM existe (si déjà là → on ne fait rien)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'appointmentstatus'
            ) THEN
                CREATE TYPE appointmentstatus AS ENUM ('planned', 'done', 'cancelled');
            END IF;
        END
        $$;
        """
    )

    # 2) Déclarer l'ENUM côté SQLAlchemy sans le recréer
    appointment_status_enum = postgresql.ENUM(
        "planned",
        "done",
        "cancelled",
        name="appointmentstatus",
        create_type=False,  # <<< ne pas recréer le type, il existe déjà
    )

    # 3) Créer la table appointment
    op.create_table(
        "appointment",
        sa.Column("id", sa.Integer, primary_key=True),

        sa.Column(
            "agent_id",
            sa.Integer,
            sa.ForeignKey("agent.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "client_id",
            sa.Integer,
            sa.ForeignKey("client.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "labo_id",
            sa.Integer,
            sa.ForeignKey("labo.id", ondelete="SET NULL"),
            nullable=True,
        ),

        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),

        sa.Column("start_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_datetime", sa.DateTime(timezone=True), nullable=False),

        sa.Column(
            "status",
            appointment_status_enum,
            nullable=False,
            server_default="planned",
        ),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_appointment_agent_start",
        "appointment",
        ["agent_id", "start_datetime"],
    )


def downgrade() -> None:
    op.drop_index("ix_appointment_agent_start", table_name="appointment")
    op.drop_table("appointment")
    # On laisse le type ENUM en place (il peut servir ailleurs)
