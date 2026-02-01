"""add marketing pdf editor tables (annotations, product links, publications, assets)

Revision ID: REVISION_ID
Revises: DOWN_REVISION_ID
Create Date: 2025-12-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20251218_pdf_modification_structure"
down_revision = "20251217_add_marketing_document_thumb"
branch_labels = None
depends_on = None


def _create_pg_enum_if_not_exists(enum_name: str, values: list[str]) -> None:
    # Postgres: pas de CREATE TYPE IF NOT EXISTS fiable partout => DO block
    vals = ", ".join([f"'{v}'" for v in values])
    op.execute(
        f"""
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{enum_name}') THEN
        CREATE TYPE {enum_name} AS ENUM ({vals});
    END IF;
END$$;
"""
    )


def _drop_pg_enum_if_exists(enum_name: str) -> None:
    op.execute(
        f"""
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = '{enum_name}') THEN
        DROP TYPE {enum_name};
    END IF;
END$$;
"""
    )


def upgrade() -> None:
    # ---------------------------------------------------------
    # ENUMS
    # ---------------------------------------------------------
    _create_pg_enum_if_not_exists("marketingannotationstatus", ["DRAFT", "LOCKED"])
    _create_pg_enum_if_not_exists(
        "marketingpublicationstatus", ["PENDING", "RENDERING", "READY", "FAILED"]
    )

    # ---------------------------------------------------------
    # TABLE: marketing_document_annotation
    # ---------------------------------------------------------
    op.create_table(
        "marketing_document_annotation",
        sa.Column("id", sa.Integer(), primary_key=True),

        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("marketing_document.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),

        sa.Column(
            "status",
            postgresql.ENUM(
                "DRAFT",
                "LOCKED",
                name="marketingannotationstatus",
                create_type=False,
            ),
            nullable=False,
            server_default=sa.text("'DRAFT'"),
        ),

        sa.Column(
            "draft_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),

        sa.Column(
            "data_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),

        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),

        sa.UniqueConstraint(
            "document_id",
            "status",
            name="uq_marketing_doc_annotation_doc_status",
        ),
    )

    op.create_index(
        "ix_marketing_doc_annotation_document_id",
        "marketing_document_annotation",
        ["document_id"],
    )
    op.create_index(
        "ix_marketing_doc_annotation_created_by_user_id",
        "marketing_document_annotation",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_marketing_doc_annotation_updated_by_user_id",
        "marketing_document_annotation",
        ["updated_by_user_id"],
    )
    op.create_index(
        "ix_marketing_doc_annotation_json_gin",
        "marketing_document_annotation",
        ["data_json"],
        postgresql_using="gin",
    )

    # ---------------------------------------------------------
    # TABLE: marketing_document_product_link
    # ---------------------------------------------------------
    op.create_table(
        "marketing_document_product_link",
        sa.Column("id", sa.Integer(), primary_key=True),

        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("marketing_document.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),

        sa.Column("page_index", sa.Integer(), nullable=False),

        sa.Column("x", sa.Numeric(8, 6), nullable=False),
        sa.Column("y", sa.Numeric(8, 6), nullable=False),
        sa.Column("w", sa.Numeric(8, 6), nullable=False),
        sa.Column("h", sa.Numeric(8, 6), nullable=False),

        sa.Column(
            "rotation_deg",
            sa.Numeric(8, 3),
            nullable=False,
            server_default=sa.text("0"),
        ),

        sa.Column(
            "product_id",
            sa.Integer(),
            sa.ForeignKey("product.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),

        sa.Column("sku", sa.String(length=128), nullable=True),
        sa.Column("ean13", sa.String(length=32), nullable=True),

        sa.Column(
            "behavior_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "ix_marketing_doc_product_link_doc_page",
        "marketing_document_product_link",
        ["document_id", "page_index"],
    )
    op.create_index(
        "ix_marketing_doc_product_link_product_id",
        "marketing_document_product_link",
        ["product_id"],
    )

    # ---------------------------------------------------------
    # TABLE: marketing_document_publication
    # ---------------------------------------------------------
    op.create_table(
        "marketing_document_publication",
        sa.Column("id", sa.Integer(), primary_key=True),

        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("marketing_document.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),

        sa.Column(
            "annotation_locked_id",
            sa.Integer(),
            sa.ForeignKey("marketing_document_annotation.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),

        sa.Column("version", sa.Integer(), nullable=False),

        sa.Column(
            "status",
            postgresql.ENUM(
                "PENDING",
                "RENDERING",
                "READY",
                "FAILED",
                name="marketingpublicationstatus",
                create_type=False,
            ),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),

        sa.Column("published_pdf_filename", sa.String(length=255), nullable=True),
        sa.Column("published_pdf_sha256", sa.Text(), nullable=True),

        sa.Column("error_message", sa.Text(), nullable=True),

        sa.Column(
            "render_options_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),

        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),

        sa.UniqueConstraint(
            "document_id",
            "version",
            name="uq_marketing_doc_publication_doc_version",
        ),
    )

    op.create_index(
        "ix_marketing_doc_publication_doc_status",
        "marketing_document_publication",
        ["document_id", "status"],
    )

    # ---------------------------------------------------------
    # (OPTIONNEL MAIS RECOMMANDÉ) TABLE: marketing_document_asset
    # ---------------------------------------------------------
    op.create_table(
        "marketing_document_asset",
        sa.Column("id", sa.Integer(), primary_key=True),

        sa.Column(
            "labo_id",
            sa.Integer(),
            sa.ForeignKey("labo.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),

        sa.Column("filename", sa.String(length=255), nullable=False),       # uuid.png
        sa.Column("original_name", sa.String(length=255), nullable=False), # nom uploadé
        sa.Column("mime_type", sa.String(length=64), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),

        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "ix_marketing_asset_labo_created",
        "marketing_document_asset",
        ["labo_id", "created_at"],
    )


def downgrade() -> None:
    # drop tables (reverse order)
    op.drop_index("ix_marketing_asset_labo_created", table_name="marketing_document_asset")
    op.drop_table("marketing_document_asset")

    op.drop_index("ix_marketing_doc_publication_doc_status", table_name="marketing_document_publication")
    op.drop_table("marketing_document_publication")

    op.drop_index("ix_marketing_doc_product_link_product_id", table_name="marketing_document_product_link")
    op.drop_index("ix_marketing_doc_product_link_doc_page", table_name="marketing_document_product_link")
    op.drop_table("marketing_document_product_link")

    op.drop_index("ix_marketing_doc_annotation_json_gin", table_name="marketing_document_annotation")
    op.drop_index("ix_marketing_doc_annotation_updated_by_user_id", table_name="marketing_document_annotation")
    op.drop_index("ix_marketing_doc_annotation_created_by_user_id", table_name="marketing_document_annotation")
    op.drop_index("ix_marketing_doc_annotation_document_id", table_name="marketing_document_annotation")
    op.drop_table("marketing_document_annotation")

    # drop enums
    _drop_pg_enum_if_exists("marketingpublicationstatus")
    _drop_pg_enum_if_exists("marketingannotationstatus")
