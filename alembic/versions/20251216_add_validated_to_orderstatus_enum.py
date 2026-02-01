"""add validated to orderstatus enum

Revision ID: REPLACE_WITH_REVISION_ID
Revises: REPLACE_WITH_DOWN_REVISION_ID
Create Date: 2025-12-16
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20251216_add_validated_to_orderstatus_enum"
down_revision = "20251215_add_labo_profile"
branch_labels = None
depends_on = None


def upgrade():
    # PostgreSQL enum: add value (safe if already added)
    op.execute("ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'validated'")


def downgrade():
    # Downgrade d'une valeur ENUM Postgres = compliqué (recreate type + cast)
    # On ne fait rien pour éviter de casser les données.
    pass
