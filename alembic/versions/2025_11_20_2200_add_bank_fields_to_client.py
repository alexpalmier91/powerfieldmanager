from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '2025_11_20_2200_add_bank_fields_to_client'
down_revision = '20251116_create_appointment_table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'client',
        sa.Column('iban', sa.String(length=64), nullable=True)
    )
    op.add_column(
        'client',
        sa.Column('bic', sa.String(length=32), nullable=True)
    )
    op.add_column(
        'client',
        sa.Column('payment_terms', sa.String(length=120), nullable=True)
    )
    op.add_column(
        'client',
        sa.Column('credit_limit', sa.Numeric(14, 2), nullable=True)
    )
    op.add_column(
        'client',
        sa.Column('sepa_mandate_ref', sa.String(length=120), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('client', 'sepa_mandate_ref')
    op.drop_column('client', 'credit_limit')
    op.drop_column('client', 'payment_terms')
    op.drop_column('client', 'bic')
    op.drop_column('client', 'iban')
