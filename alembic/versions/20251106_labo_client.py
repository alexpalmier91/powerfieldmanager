from alembic import op
import sqlalchemy as sa

revision = "20251106_labo_client"
down_revision = "7b8a2f1c5a3d"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # Crée la table seulement si elle n'existe pas
    if "labo_client" not in insp.get_table_names():
        op.create_table(
            "labo_client",
            sa.Column("labo_id", sa.Integer(), nullable=False),
            sa.Column("client_id", sa.Integer(), nullable=False),
            sa.Column("code_client", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("labo_id", "client_id"),
            sa.ForeignKeyConstraint(["labo_id"], ["labo.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["client_id"], ["client.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("labo_id", "code_client", name="uq_labo_client_code"),
        )
        op.create_index("ix_labo_client_code_client", "labo_client", ["code_client"])

def downgrade():
    op.drop_index("ix_labo_client_code_client", table_name="labo_client")
    op.drop_table("labo_client")
