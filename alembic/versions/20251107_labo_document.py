"""create labo_document (+ items) tables

Revision ID: 20251107_labo_document
Revises: 20251107_agent_client_assoc
Create Date: 2025-11-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum  # ✅ important

revision = "20251107_labo_document"
down_revision = "20251107_agent_client_assoc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ✅ créer le type enum labodocumenttype seulement s'il n'existe pas
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'labodocumenttype'
      ) THEN
        CREATE TYPE labodocumenttype AS ENUM ('BC','BL','FA');
      END IF;
    END$$;
    """)

    # (Optionnel) s'assurer que orderstatus existe si pas déjà créé plus tôt
    # op.execute("""
    # DO $$
    # BEGIN
    #   IF NOT EXISTS (
    #     SELECT 1
    #     FROM pg_type t
    #     JOIN pg_namespace n ON n.oid = t.typnamespace
    #     WHERE t.typname = 'orderstatus'
    #   ) THEN
    #     CREATE TYPE orderstatus AS ENUM ('draft','pending','paid','canceled','shipped','completed');
    #   END IF;
    # END$$;
    # """)

    op.create_table(
        'labo_document',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('labo_id', sa.Integer, sa.ForeignKey('labo.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('client_id', sa.Integer, sa.ForeignKey('client.id', ondelete='SET NULL'), nullable=True),
        sa.Column('agent_id', sa.Integer, sa.ForeignKey('agent.id', ondelete='SET NULL'), nullable=True),
        sa.Column('order_number', sa.String(64), nullable=False),
        sa.Column('order_date', sa.Date, nullable=True),
        sa.Column('delivery_date', sa.Date, nullable=True),
        sa.Column('client_name', sa.String(255), nullable=True),
        sa.Column('currency', sa.String(3), server_default='EUR', nullable=False),
        sa.Column('payment_method', sa.String(64), nullable=True),
        # ✅ utiliser PGEnum + create_type=False pour NE PAS recréer le type
        sa.Column('type', PGEnum('BC', 'BL', 'FA', name='labodocumenttype', create_type=False), nullable=False),
        sa.Column('status', PGEnum('draft','pending','paid','canceled','shipped','completed', name='orderstatus', create_type=False), nullable=True),
        sa.Column('total_ht', sa.Numeric(12,2), server_default='0.00', nullable=False),
        sa.Column('total_ttc', sa.Numeric(12,2), server_default='0.00', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('labo_id', 'order_number', name='uq_labo_document_labo_number'),
    )

    op.create_table(
        'labo_document_item',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('document_id', sa.Integer, sa.ForeignKey('labo_document.id', ondelete='CASCADE'), nullable=False),
        sa.Column('product_id', sa.Integer, sa.ForeignKey('product.id', ondelete='SET NULL'), nullable=True),
        sa.Column('sku', sa.String(64), nullable=False),
        sa.Column('ean13', sa.String(13), nullable=True),
        sa.Column('qty', sa.Integer, nullable=False),
        sa.Column('unit_ht', sa.Numeric(12, 2), server_default='0.00', nullable=False),
        sa.Column('total_ht', sa.Numeric(12, 2), server_default='0.00', nullable=False),
        sa.UniqueConstraint('document_id', 'product_id', name='uq_labodocumentitem_doc_product'),
    )

    # 🔎 index utiles
    op.create_index('ix_labo_document_labo_id', 'labo_document', ['labo_id'])
    op.create_index('ix_labo_document_order_date', 'labo_document', ['order_date'])
    op.create_index('ix_labo_document_status', 'labo_document', ['status'])
    op.create_index('ix_labo_document_item_document', 'labo_document_item', ['document_id'])
    op.create_index('ix_labo_document_item_product', 'labo_document_item', ['product_id'])


def downgrade() -> None:
    op.drop_index('ix_labo_document_item_product', table_name='labo_document_item')
    op.drop_index('ix_labo_document_item_document', table_name='labo_document_item')
    op.drop_index('ix_labo_document_status', table_name='labo_document')
    op.drop_index('ix_labo_document_order_date', table_name='labo_document')
    op.drop_index('ix_labo_document_labo_id', table_name='labo_document')

    op.drop_table('labo_document_item')
    op.drop_table('labo_document')

    # 🧹 ne drop le type que s'il n'est plus référencé
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_depend d ON d.refobjid = t.oid
        WHERE t.typname = 'labodocumenttype'
      ) THEN
        DROP TYPE IF EXISTS labodocumenttype;
      END IF;
    END$$;
    """)
