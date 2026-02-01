"""add product.is_active and create labo_client table

Revision ID: 7b8a2f1c5a3d
Revises: <met ici l'ID de la précédente migration>
Create Date: 2025-11-05 18:35:00.000000

"""
from alembic import op
import sqlalchemy as sa

# Révisions
revision = '7b8a2f1c5a3d'
down_revision = 'add_delivery_date_to_order'
branch_labels = None
depends_on = None


def upgrade():
    # 1) Colonne product.is_active (bool, non nul, défaut TRUE)
    op.add_column(
        'product',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true())
    )
    # Optionnel : on peut retirer le server_default après backfill pour ne pas figer le défaut côté DB
    op.alter_column('product', 'is_active', server_default=None)

    # 2) Table labo_client (associatif: labo ↔ customer avec code_client propre au labo)
    op.create_table(
        'labo_client',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('labo_id', sa.Integer(), sa.ForeignKey('labo.id', ondelete='CASCADE'), nullable=False),
        sa.Column('client_id', sa.Integer(), sa.ForeignKey('customer.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code_client', sa.String(length=128), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),

        # Un même code_client ne peut exister qu'une seule fois dans un labo
        sa.UniqueConstraint('labo_id', 'code_client', name='uq_labo_codeclient'),

        # Optionnel mais pratique : éviter les doublons de lien pour le même client dans un labo
        sa.UniqueConstraint('labo_id', 'client_id', name='uq_labo_client_pair'),
    )

    # Index utiles pour les recherches
    op.create_index('ix_labo_client_labo_code', 'labo_client', ['labo_id', 'code_client'])
    op.create_index('ix_labo_client_client', 'labo_client', ['client_id'])


def downgrade():
    # rollback dans l'ordre inverse
    op.drop_index('ix_labo_client_client', table_name='labo_client')
    op.drop_index('ix_labo_client_labo_code', table_name='labo_client')
    op.drop_table('labo_client')

    op.drop_column('product', 'is_active')
