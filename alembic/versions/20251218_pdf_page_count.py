from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251218_pdf_page_count"
down_revision = "20251218_pdf_modification_structure"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("marketing_document", sa.Column("page_count", sa.Integer(), nullable=True))
    op.add_column("marketing_document", sa.Column("source_sha256", sa.String(length=64), nullable=True))

    op.create_index(
        "ix_marketing_document_labo_page_count",
        "marketing_document",
        ["labo_id", "page_count"],
        unique=False,
    )
    op.create_index(
        "ix_marketing_document_labo_source_sha256",
        "marketing_document",
        ["labo_id", "source_sha256"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_marketing_document_labo_source_sha256", table_name="marketing_document")
    op.drop_index("ix_marketing_document_labo_page_count", table_name="marketing_document")

    op.drop_column("marketing_document", "source_sha256")
    op.drop_column("marketing_document", "page_count")
