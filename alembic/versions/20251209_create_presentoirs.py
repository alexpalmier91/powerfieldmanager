"""create presentoir + presentoir_events tables

Revision ID: 20251209_create_presentoirs
Revises: <MET ICI L'ID DE TA PRÉCÉDENTE MIGRATION>
Create Date: 2025-12-09 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20251209_create_presentoirs"
down_revision = "20251208_link_labo_documents_delivery_address"
branch_labels = None
depends_on = None


def upgrade():
    # === Table presentoirs ===
    op.create_table(
        "presentoirs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(length=50), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=True),

        # 🔴 ICI la correction : table "client" (singulier)
        sa.Column(
            "pharmacy_id",
            sa.Integer,
            sa.ForeignKey("client.id", ondelete="SET NULL"),
            nullable=True,
        ),

        sa.Column("location", sa.String(length=255), nullable=True),

        sa.Column("tunnel_url", sa.String(length=255), nullable=True),
        sa.Column("last_ip", sa.String(length=64), nullable=True),

        sa.Column("firmware_version", sa.String(length=50), nullable=True),

        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=20), nullable=True),

        sa.Column(
            "is_active",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),

        sa.Column("api_token_hash", sa.String(length=128), nullable=True),
        sa.Column("current_num_products", sa.Integer, nullable=True),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )

    # Index pour les colonnes fréquemment filtrées
    op.create_index("ix_presentoirs_code", "presentoirs", ["code"], unique=True)
    op.create_index("ix_presentoirs_pharmacy_id", "presentoirs", ["pharmacy_id"])
    op.create_index("ix_presentoirs_last_status", "presentoirs", ["last_status"])

    # === Table presentoir_events ===
    op.create_table(
        "presentoir_events",
        sa.Column("id", sa.Integer, primary_key=True),

        sa.Column(
            "presentoir_id",
            sa.Integer,
            sa.ForeignKey("presentoirs.id", ondelete="CASCADE"),
            nullable=False,
        ),

        sa.Column("epc", sa.String(length=128), nullable=False),
        sa.Column("sku", sa.String(length=128), nullable=True),

        sa.Column("event_type", sa.String(length=10), nullable=False),  # POSE / RETIRE

        sa.Column("ts_device", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "ts_received",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )

    op.create_index("ix_presentoir_events_presentoir_id", "presentoir_events", ["presentoir_id"])
    op.create_index("ix_presentoir_events_epc", "presentoir_events", ["epc"])
    op.create_index("ix_presentoir_events_sku", "presentoir_events", ["sku"])
    op.create_index("ix_presentoir_events_event_type", "presentoir_events", ["event_type"])


def downgrade():
    op.drop_index("ix_presentoir_events_event_type", table_name="presentoir_events")
    op.drop_index("ix_presentoir_events_sku", table_name="presentoir_events")
    op.drop_index("ix_presentoir_events_epc", table_name="presentoir_events")
    op.drop_index("ix_presentoir_events_presentoir_id", table_name="presentoir_events")
    op.drop_table("presentoir_events")

    op.drop_index("ix_presentoirs_last_status", table_name="presentoirs")
    op.drop_index("ix_presentoirs_pharmacy_id", table_name="presentoirs")
    op.drop_index("ix_presentoirs_code", table_name="presentoirs")
    op.drop_table("presentoirs")
