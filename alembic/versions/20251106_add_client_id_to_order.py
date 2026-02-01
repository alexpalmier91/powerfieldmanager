# alembic/versions/20251106_add_client_id_to_order.py
from alembic import op
import sqlalchemy as sa

# ⚠️ adapte ce down_revision
revision = "20251106_add_client_id_to_order"
down_revision = "20251106_labo_client"
branch_labels = None
depends_on = None

def upgrade():
    # 1) ajouter la colonne nullable (pour ne pas casser l'existant)
    op.add_column(
        "order",
        sa.Column("client_id", sa.Integer(), nullable=True)
    )
    # 2) FK vers client.id (SET NULL si client supprimé)
    op.create_foreign_key(
        "order_client_id_fkey",
        "order", "client",
        ["client_id"], ["id"],
        ondelete="SET NULL",
    )
    # 3) (optionnel) si tu veux garder un libellé pratique
    #    si la colonne n'existe pas déjà, dé-commente :
    # op.add_column("order", sa.Column("client_name", sa.String(), nullable=True))

def downgrade():
    # si tu as ajouté client_name dans upgrade(), dé-commente :
    # op.drop_column("order", "client_name")
    op.drop_constraint("order_client_id_fkey", "order", type_="foreignkey")
    op.drop_column("order", "client_id")
