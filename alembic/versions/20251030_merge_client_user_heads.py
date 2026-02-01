"""merge heads: client_table + user_fields

Revision ID: 20251030_merge_client_user_heads
Revises: 20251030_create_client_table, 20251101_add_user_is_active_labo_fk
Create Date: 2025-10-30 12:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20251030_merge_client_user_heads"
down_revision = ("20251030_create_client_table", "20251101_add_user_is_active_labo_fk")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
