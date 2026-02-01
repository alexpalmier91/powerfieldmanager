"""add category table"""

from alembic import op
import sqlalchemy as sa

revision = "20251025_add_category_table"
down_revision = "20251025_add_import_job_table"  # <-- ton head actuel juste avant la FK
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "category",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
    )
    op.create_index("ix_category_name", "category", ["name"], unique=True)

def downgrade() -> None:
    op.drop_index("ix_category_name", table_name="category")
    op.drop_table("category")
