from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

# ⚠️ adapte ces valeurs
revision = "20251209_add_rfid_display_tables"
down_revision = "20251209_create_presentoirs"
branch_labels = None
depends_on = None

# Enum SQLAlchemy qui pointent vers les types Postgres
rfidtagstatus_enum = PGEnum(
    "in_stock",
    "loaded_on_display",
    "sold",
    "lost",
    name="rfidtagstatus",
    create_type=False,  # on NE crée PAS le type automatiquement
)

displaysaleeventtype_enum = PGEnum(
    "removal",
    "return",
    name="displaysaleeventtype",
    create_type=False,
)


def upgrade():
    # 1) Créer les types ENUM côté Postgres s'ils n'existent pas
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rfidtagstatus') THEN
                CREATE TYPE rfidtagstatus AS ENUM ('in_stock', 'loaded_on_display', 'sold', 'lost');
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'displaysaleeventtype') THEN
                CREATE TYPE displaysaleeventtype AS ENUM ('removal', 'return');
            END IF;
        END
        $$;
        """
    )

    # 2) Table rfid_tag
    op.create_table(
        "rfid_tag",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("epc", sa.String(length=128), nullable=False),
        sa.Column(
            "product_id",
            sa.Integer,
            sa.ForeignKey("product.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sku", sa.String(length=128), nullable=True),
        sa.Column(
            "status",
            rfidtagstatus_enum,
            nullable=False,
            server_default="in_stock",
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_rfid_tag_id", "rfid_tag", ["id"])
    op.create_index("ix_rfid_tag_epc", "rfid_tag", ["epc"], unique=True)
    op.create_index("ix_rfid_tag_product_id", "rfid_tag", ["product_id"])
    op.create_index("ix_rfid_tag_sku", "rfid_tag", ["sku"])

    # 3) Table display_item
    op.create_table(
        "display_item",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "presentoir_id",
            sa.Integer,
            sa.ForeignKey("presentoirs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rfid_tag_id",
            sa.Integer,
            sa.ForeignKey("rfid_tag.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("level_index", sa.Integer, nullable=True),
        sa.Column("position_index", sa.Integer, nullable=True),
        sa.Column(
            "loaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("unloaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.UniqueConstraint(
            "presentoir_id",
            "rfid_tag_id",
            "unloaded_at",
            name="uq_display_item_presentoir_tag_unloaded",
        ),
    )
    op.create_index("ix_display_item_id", "display_item", ["id"])
    op.create_index(
        "ix_display_item_presentoir_id",
        "display_item",
        ["presentoir_id"],
    )
    op.create_index("ix_display_item_rfid_tag_id", "display_item", ["rfid_tag_id"])

    # 4) Table display_assignment
    op.create_table(
        "display_assignment",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "presentoir_id",
            sa.Integer,
            sa.ForeignKey("presentoirs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "pharmacy_id",
            sa.Integer,
            sa.ForeignKey("client.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("unassigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_display_assignment_id", "display_assignment", ["id"])
    op.create_index(
        "ix_display_assignment_presentoir_id",
        "display_assignment",
        ["presentoir_id"],
    )
    op.create_index(
        "ix_display_assignment_pharmacy_id",
        "display_assignment",
        ["pharmacy_id"],
    )

    # 5) Table display_sale_event
    op.create_table(
        "display_sale_event",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "presentoir_id",
            sa.Integer,
            sa.ForeignKey("presentoirs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "pharmacy_id",
            sa.Integer,
            sa.ForeignKey("client.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "rfid_tag_id",
            sa.Integer,
            sa.ForeignKey("rfid_tag.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            sa.Integer,
            sa.ForeignKey("product.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "event_type",
            displaysaleeventtype_enum,
            nullable=False,
        ),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("unit_price_ht", sa.Numeric(12, 2), nullable=True),
    )
    op.create_index("ix_display_sale_event_id", "display_sale_event", ["id"])
    op.create_index(
        "ix_display_sale_event_presentoir_id",
        "display_sale_event",
        ["presentoir_id"],
    )
    op.create_index(
        "ix_display_sale_event_pharmacy_id",
        "display_sale_event",
        ["pharmacy_id"],
    )
    op.create_index(
        "ix_display_sale_event_product_id",
        "display_sale_event",
        ["product_id"],
    )
    op.create_index(
        "ix_display_sale_event_rfid_tag_id",
        "display_sale_event",
        ["rfid_tag_id"],
    )
    op.create_index(
        "ix_display_sale_event_occurred_at",
        "display_sale_event",
        ["occurred_at"],
    )


def downgrade():
    # On droppe seulement les tables et index, on laisse les types ENUM (ils peuvent être réutilisés).
    op.drop_index(
        "ix_display_sale_event_occurred_at",
        table_name="display_sale_event",
    )
    op.drop_index(
        "ix_display_sale_event_rfid_tag_id",
        table_name="display_sale_event",
    )
    op.drop_index(
        "ix_display_sale_event_product_id",
        table_name="display_sale_event",
    )
    op.drop_index(
        "ix_display_sale_event_pharmacy_id",
        table_name="display_sale_event",
    )
    op.drop_index(
        "ix_display_sale_event_presentoir_id",
        table_name="display_sale_event",
    )
    op.drop_index("ix_display_sale_event_id", table_name="display_sale_event")
    op.drop_table("display_sale_event")

    op.drop_index(
        "ix_display_assignment_pharmacy_id",
        table_name="display_assignment",
    )
    op.drop_index(
        "ix_display_assignment_presentoir_id",
        table_name="display_assignment",
    )
    op.drop_index("ix_display_assignment_id", table_name="display_assignment")
    op.drop_table("display_assignment")

    op.drop_index("ix_display_item_rfid_tag_id", table_name="display_item")
    op.drop_index(
        "ix_display_item_presentoir_id",
        table_name="display_item",
    )
    op.drop_index("ix_display_item_id", table_name="display_item")
    op.drop_table("display_item")

    op.drop_index("ix_rfid_tag_sku", table_name="rfid_tag")
    op.drop_index("ix_rfid_tag_product_id", table_name="rfid_tag")
    op.drop_index("ix_rfid_tag_epc", table_name="rfid_tag")
    op.drop_index("ix_rfid_tag_id", table_name="rfid_tag")
    op.drop_table("rfid_tag")
