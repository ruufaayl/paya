"""Live feed: a short-lived telemetry log so screens connected to any server instance see every event.

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telemetry_log",
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("msg", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("seq"),
    )
    op.create_index("ix_telemetry_log_at", "telemetry_log", ["at"])


def downgrade() -> None:
    op.drop_index("ix_telemetry_log_at", table_name="telemetry_log")
    op.drop_table("telemetry_log")
