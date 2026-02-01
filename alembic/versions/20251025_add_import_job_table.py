"""add import_job table"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# Révisions
revision = "20251025_add_import_job_table"
down_revision = "20251021_auth_labo"  # <-- ton head actuel
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "import_job",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.Text()),
        sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inserted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_import_job_task_id", "import_job", ["task_id"], unique=True)

def downgrade() -> None:
    op.drop_index("ix_import_job_task_id", table_name="import_job")
    op.drop_table("import_job")
