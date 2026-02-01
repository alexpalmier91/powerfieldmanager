from alembic import op
import sqlalchemy as sa

revision = "20251021_auth_labo"
down_revision = "20251020_add_sales"  # <— mets l’ID de ta dernière migration
branch_labels = None
depends_on = None

def upgrade():
    # user
    op.create_table(
        "user",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(180), nullable=False, unique=True),
        sa.Column("role", sa.Enum("SUPERADMIN","LABO", name="userrole"), nullable=False, server_default="LABO"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("labo_id", sa.Integer, sa.ForeignKey("labo.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_user_email", "user", ["email"])

    # labo_application
    op.create_table(
        "labo_application",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(180), nullable=False),
        sa.Column("firstname", sa.String(100), nullable=False),
        sa.Column("lastname", sa.String(100), nullable=False),
        sa.Column("labo_name", sa.String(255), nullable=False),
        sa.Column("address", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("approved", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_labo_application_email", "labo_application", ["email"])

    # auth_code
    op.create_table(
        "auth_code",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(180), nullable=False),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_auth_code_email", "auth_code", ["email"])
    op.create_index("ix_auth_code_code", "auth_code", ["code"])

def downgrade():
    op.drop_index("ix_auth_code_code", table_name="auth_code")
    op.drop_index("ix_auth_code_email", table_name="auth_code")
    op.drop_table("auth_code")
    op.drop_index("ix_labo_application_email", table_name="labo_application")
    op.drop_table("labo_application")
    op.drop_index("ix_user_email", table_name="user")
    op.drop_table("user")
    op.execute("DROP TYPE IF EXISTS userrole")
