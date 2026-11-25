"""Send money to a bank account (simulated): TRANSFER transactions and their beneficiary record.

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

TYPES = "'PAYMENT','TRANSFER','REVERSAL','REFUND','TOPUP','ADJUSTMENT','GREEN_POT_IN','GREEN_POT_OUT'"
ORIGINALS = "'PAYMENT','TRANSFER','TOPUP','ADJUSTMENT','GREEN_POT_IN','GREEN_POT_OUT'"


def upgrade() -> None:
    op.execute("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ck_txn_type")
    op.execute(f"ALTER TABLE transactions ADD CONSTRAINT ck_txn_type CHECK (type IN ({TYPES}))")
    op.execute("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ck_correction_links_original")
    op.execute(f"ALTER TABLE transactions ADD CONSTRAINT ck_correction_links_original "
               f"CHECK (type IN ({ORIGINALS}) OR original_txn_id IS NOT NULL)")
    op.create_table(
        "bank_transfers",
        sa.Column("txn_id", sa.UUID(), sa.ForeignKey("transactions.id"), primary_key=True),
        sa.Column("bank_code", sa.String(8), nullable=False),
        sa.Column("bank_name", sa.String(64), nullable=False),
        sa.Column("account_masked", sa.String(32), nullable=False),
        sa.Column("account_hash", sa.String(64), nullable=False),
        sa.Column("title", sa.String(64), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("title_fetch_ref", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bank_transfers_account", "bank_transfers", ["account_hash"])


def downgrade() -> None:
    op.drop_index("ix_bank_transfers_account", table_name="bank_transfers")
    op.drop_table("bank_transfers")
    op.execute("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ck_correction_links_original")
    op.execute("ALTER TABLE transactions ADD CONSTRAINT ck_correction_links_original CHECK (type IN "
               "('PAYMENT','TOPUP','ADJUSTMENT','GREEN_POT_IN','GREEN_POT_OUT') OR original_txn_id IS NOT NULL)")
    op.execute("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ck_txn_type")
    op.execute("ALTER TABLE transactions ADD CONSTRAINT ck_txn_type CHECK (type IN "
               "('PAYMENT','REVERSAL','REFUND','TOPUP','ADJUSTMENT','GREEN_POT_IN','GREEN_POT_OUT'))")
