# versions/XXXXXXXX_agent_client_assoc.py
from alembic import op
import sqlalchemy as sa

revision = "20251107_agent_client_assoc"
down_revision = "20251106_add_client_id_to_order"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "agent_client",
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["agent_id"], ["agent.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["client.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("agent_id", "client_id"),
    )
    op.create_index("ix_agent_client_agent_id", "agent_client", ["agent_id"])
    op.create_index("ix_agent_client_client_id", "agent_client", ["client_id"])

    # Backfill: couples distincts agent/client depuis Order
    conn = op.get_bind()
    conn.execute(sa.text("""
        INSERT INTO agent_client (agent_id, client_id)
        SELECT DISTINCT o.agent_id, o.client_id
        FROM "order" o
        WHERE o.agent_id IS NOT NULL
          AND o.client_id IS NOT NULL
          -- évite les doublons si relance migration en dev (no-op si déjà là)
          AND NOT EXISTS (
            SELECT 1 FROM agent_client ac
            WHERE ac.agent_id = o.agent_id AND ac.client_id = o.client_id
          )
    """))

def downgrade():
    op.drop_index("ix_agent_client_client_id", table_name="agent_client")
    op.drop_index("ix_agent_client_agent_id", table_name="agent_client")
    op.drop_table("agent_client")
