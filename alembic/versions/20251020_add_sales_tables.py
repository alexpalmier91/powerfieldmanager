from alembic import op
import sqlalchemy as sa

# Révisions
revision = "20251020_add_sales"
down_revision = "20251019_0001"  # <-- mets ici l'ID de ta migration précédente
branch_labels = None
depends_on = None

def upgrade():
    # agent
    op.create_table(
        "agent",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(180), nullable=False, unique=True),
        sa.Column("firstname", sa.String(100), nullable=True),
        sa.Column("lastname", sa.String(100), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
    )
    op.create_index("ix_agent_email", "agent", ["email"])

    # labo_agent (n..m)
    op.create_table(
        "labo_agent",
        sa.Column("labo_id", sa.Integer, sa.ForeignKey("labo.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("agent_id", sa.Integer, sa.ForeignKey("agent.id", ondelete="CASCADE"), primary_key=True),
    )

    # customer
    op.create_table(
        "customer",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(180), nullable=True),
        sa.Column("company", sa.String(255), nullable=True),
        sa.Column("vat", sa.String(32), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("address1", sa.String(255), nullable=True),
        sa.Column("address2", sa.String(255), nullable=True),
        sa.Column("postcode", sa.String(16), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("country", sa.String(120), nullable=True),
    )
    op.create_index("ix_customer_email", "customer", ["email"])

    # order
    op.create_table(
        "order",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("labo_id", sa.Integer, sa.ForeignKey("labo.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("agent_id", sa.Integer, sa.ForeignKey("agent.id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_id", sa.Integer, sa.ForeignKey("customer.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("status", sa.Enum("draft","pending","paid","canceled","shipped","completed", name="orderstatus"), nullable=False, server_default="draft"),
        sa.Column("total_ht", sa.Numeric(12,2), nullable=False, server_default="0"),
        sa.Column("total_ttc", sa.Numeric(12,2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_order_labo", "order", ["labo_id"])
    op.create_index("ix_order_agent", "order", ["agent_id"])
    op.create_index("ix_order_customer", "order", ["customer_id"])

    # order_item
    op.create_table(
        "order_item",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("order.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("product.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("variant_id", sa.Integer, sa.ForeignKey("variant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sku", sa.String(64), nullable=False),
        sa.Column("ean13", sa.String(13), nullable=True),
        sa.Column("qty", sa.Integer, nullable=False),
        sa.Column("unit_ht", sa.Numeric(12,2), nullable=False),
        sa.Column("line_ht", sa.Numeric(12,2), nullable=False),
    )
    op.create_index("ix_orderitem_order", "order_item", ["order_id"])
    op.create_index("ix_orderitem_product", "order_item", ["product_id"])
    op.create_index("ix_orderitem_variant", "order_item", ["variant_id"])
    op.create_index("ix_orderitem_ean13", "order_item", ["ean13"])
    op.create_unique_constraint("uq_orderitem_order_product_variant", "order_item", ["order_id","product_id","variant_id"])

def downgrade():
    op.drop_constraint("uq_orderitem_order_product_variant", "order_item", type_="unique")
    op.drop_index("ix_orderitem_ean13", table_name="order_item")
    op.drop_index("ix_orderitem_variant", table_name="order_item")
    op.drop_index("ix_orderitem_product", table_name="order_item")
    op.drop_index("ix_orderitem_order", table_name="order_item")
    op.drop_table("order_item")

    op.drop_index("ix_order_customer", table_name="order")
    op.drop_index("ix_order_agent", table_name="order")
    op.drop_index("ix_order_labo", table_name="order")
    op.drop_table("order")

    op.drop_index("ix_customer_email", table_name="customer")
    op.drop_table("customer")

    op.drop_table("labo_agent")

    op.drop_index("ix_agent_email", table_name="agent")
    op.drop_table("agent")
    op.execute("DROP TYPE IF EXISTS orderstatus")
