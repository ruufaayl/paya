"""Database engine, sessions and database-level integrity guards."""
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal: sessionmaker | None = None


def engine():
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_pre_ping=True, future=True)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def reset_engine(url: str | None = None) -> None:
    """Used by tests to point the app at another database."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine, _SessionLocal = None, None
    if url:
        get_settings().database_url = url


@contextmanager
def session_scope() -> Iterator[Session]:
    """One unit of work = one database transaction. Commit on success, roll back on any error."""
    engine()
    assert _SessionLocal is not None
    s = _SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


# Guards enforced by PostgreSQL itself, so that no application bug (or manual SQL) can break them.
INTEGRITY_DDL = [
    # 0. Additive, idempotent column upgrades for databases created before Paya 2.0 (never destructive).
    "ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_to varchar(64)",
    "ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_at timestamptz",
    # 1. Every journal must balance (sum of debits = sum of credits) when the transaction commits.
    """
    CREATE OR REPLACE FUNCTION paya_check_journal_balanced() RETURNS trigger AS $$
    DECLARE d bigint; c bigint;
    BEGIN
      SELECT COALESCE(SUM(CASE WHEN direction = 'D' THEN amount_minor END), 0),
             COALESCE(SUM(CASE WHEN direction = 'C' THEN amount_minor END), 0)
        INTO d, c FROM ledger_entries WHERE journal_id = NEW.journal_id;
      IF d <> c OR d = 0 THEN
        RAISE EXCEPTION 'LEDGER_UNBALANCED: journal % debits=% credits=%', NEW.journal_id, d, c;
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql;
    """,
    "DROP TRIGGER IF EXISTS trg_journal_balanced ON ledger_entries;",
    """
    CREATE CONSTRAINT TRIGGER trg_journal_balanced AFTER INSERT ON ledger_entries
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION paya_check_journal_balanced();
    """,
    # 2. Financial evidence is append-only. Corrections are new reversing/adjusting journals.
    """
    CREATE OR REPLACE FUNCTION paya_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'APPEND_ONLY: % on % is not permitted', TG_OP, TG_TABLE_NAME;
    END $$ LANGUAGE plpgsql;
    """,
    *[
        f"DROP TRIGGER IF EXISTS trg_append_only_{t} ON {t}; "
        f"CREATE TRIGGER trg_append_only_{t} BEFORE UPDATE OR DELETE ON {t} "
        f"FOR EACH ROW EXECUTE FUNCTION paya_append_only();"
        for t in ("ledger_entries", "journals", "audit_log", "transaction_status_history")
    ],
    # 3. Business-level idempotency: only one live payment per payment request (QR / order).
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_one_live_payment_per_request ON transactions (payment_request_id)
      WHERE type = 'PAYMENT' AND status NOT IN ('REJECTED', 'FAILED', 'EXPIRED', 'REVERSED');
    """,
    # 3b. Exactly one house account per chart-of-accounts code (NULL owners would otherwise not conflict).
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_house_account ON accounts (code) WHERE owner_type IS NULL;",
    # 4. Only one reversal per original transaction.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_one_reversal_per_original ON transactions (original_txn_id)
      WHERE type = 'REVERSAL';
    """,
]


def create_schema() -> None:
    from . import models  # noqa: F401  (register tables)
    from .rail import RailBase
    from .registry import RegistryBase

    eng = engine()
    with eng.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS rail"))
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS registry"))
    Base.metadata.create_all(eng)
    RailBase.metadata.create_all(eng)
    RegistryBase.metadata.create_all(eng)
    with eng.begin() as conn:
        for stmt in INTEGRITY_DDL:
            conn.execute(text(stmt))


def drop_schema() -> None:
    eng = engine()
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"))
        conn.execute(text("DROP SCHEMA IF EXISTS rail CASCADE;"))
        conn.execute(text("DROP SCHEMA IF EXISTS registry CASCADE;"))
