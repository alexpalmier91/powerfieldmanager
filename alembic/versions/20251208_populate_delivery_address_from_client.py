"""Populate delivery_address from existing client addresses

Revision ID: 20251208_populate_delivery_address_from_client
Revises: xxxx_delivery_address
Create Date: 2025-12-08 00:00:00.000000

"""
from alembic import op

revision = "20251208_populate_delivery_address_from_client"
down_revision = "20251208_delivery_address"  # <-- laisse l'ID de ta migration de création de delivery_address
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Pour chaque client ayant une adresse (address1 / postcode / city),
    on crée une ligne dans delivery_address.

    Hypothèse : la table delivery_address a au moins les colonnes :
      - client_id
      - label
      - address1
      - postcode
      - city
      - country
      - created_at
      - updated_at
    """
    op.execute(
        """
        INSERT INTO delivery_address (
            client_id,
            label,
            address1,
            postcode,
            city,
            country,
            created_at,
            updated_at
        )
        SELECT
            c.id AS client_id,
            'Adresse principale (auto)' AS label,
            COALESCE(c.address1, '') AS address1,
            COALESCE(c.postcode, '') AS postcode,
            COALESCE(c.city, '') AS city,
            COALESCE(c.country, 'FR') AS country,
            NOW() AS created_at,
            NOW() AS updated_at
        FROM client c
        WHERE
            (c.address1 IS NOT NULL AND c.address1 <> '')
            OR (c.postcode IS NOT NULL AND c.postcode <> '')
            OR (c.city IS NOT NULL AND c.city <> '');
        """
    )


def downgrade() -> None:
    """
    On supprime uniquement les adresses créées automatiquement
    (label = 'Adresse principale (auto)').
    """
    op.execute(
        """
        DELETE FROM delivery_address
        WHERE label = 'Adresse principale (auto)';
        """
    )
