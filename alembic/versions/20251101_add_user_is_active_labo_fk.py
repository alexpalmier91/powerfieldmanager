"""add user.is_active + labo_id foreign key (idempotent)

Revision ID: 20251101_add_user_is_active_labo_fk
Revises: 20251026_add_product_image_url
Create Date: 2025-11-01 10:42:00
"""
from alembic import op
import sqlalchemy as sa


revision = "20251101_add_user_is_active_labo_fk"
down_revision = "20251026_add_product_image_url"
branch_labels = None
depends_on = None


def upgrade():
    # Colonne is_active (idempotent)
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_active BOOLEAN')
    op.execute('ALTER TABLE "user" ALTER COLUMN is_active SET DEFAULT false')
    op.execute('UPDATE "user" SET is_active = false WHERE is_active IS NULL')
    op.execute('ALTER TABLE "user" ALTER COLUMN is_active SET NOT NULL')

    # Colonne labo_id (idempotent)
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS labo_id INTEGER')

    # Index sur labo_id (idempotent)
    op.execute('CREATE INDEX IF NOT EXISTS ix_user_labo_id ON "user"(labo_id)')

    # Clé étrangère vers labo.id (idempotent)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_labo'
            ) THEN
                ALTER TABLE "user"
                ADD CONSTRAINT fk_user_labo
                FOREIGN KEY (labo_id) REFERENCES labo(id) ON DELETE SET NULL;
            END IF;
        END$$;
        """
    )

    # (facultatif) enlever le DEFAULT si tu ne veux pas qu'il reste
    # op.execute('ALTER TABLE "user" ALTER COLUMN is_active DROP DEFAULT')


def downgrade():
    # Supprime la FK / index / colonnes (tolérant si déjà absentes)
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_labo'
            ) THEN
                ALTER TABLE "user" DROP CONSTRAINT fk_user_labo;
            END IF;
        END$$;
        """
    )
    op.execute('DROP INDEX IF EXISTS ix_user_labo_id')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS labo_id')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS is_active')
