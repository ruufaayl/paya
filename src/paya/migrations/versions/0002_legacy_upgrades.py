"""Idempotent upgrades for databases created before migrations existed (by create_all), which are stamped
at the baseline: Rupay 2.0 case assignment columns, and the Theme 2 widening of three CHECK lists.
On a database built from the baseline every statement is a no-op.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

STATEMENTS = [
    'ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_to varchar(64)',
    'ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_at timestamptz',
    "ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ck_txn_type; ALTER TABLE transactions ADD CONSTRAINT ck_txn_type CHECK (type IN ('PAYMENT','REVERSAL','REFUND','TOPUP','ADJUSTMENT','GREEN_POT_IN','GREEN_POT_OUT'))",
    "ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ck_correction_links_original; ALTER TABLE transactions ADD CONSTRAINT ck_correction_links_original CHECK (type IN ('PAYMENT','TOPUP','ADJUSTMENT','GREEN_POT_IN','GREEN_POT_OUT') OR original_txn_id IS NOT NULL)",
    "ALTER TABLE journals DROP CONSTRAINT IF EXISTS ck_posting_type; ALTER TABLE journals ADD CONSTRAINT ck_posting_type CHECK (posting_type IN ('AUTH_POST','SETTLE','FEE','REVERSAL','REFUND','ADJUSTMENT','CLAIM','TOPUP','GREEN_POT_IN','GREEN_POT_OUT'))",
]


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    pass  # nothing to undo: the baseline already has these columns and constraints
