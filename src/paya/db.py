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


# The schema, including the database-level integrity guards (balanced journals, append-only evidence,
# business idempotency indexes), is defined by the Alembic migrations in paya/migrations (ADR-015).
def create_schema() -> dict:
    """Upgrade the database to the latest migration as the schema owner and apply the app role's grants."""
    from .migrate import upgrade

    return upgrade()


def drop_schema() -> None:
    """Tests and demo resets only. Runs as the schema owner: the app role cannot drop anything."""
    from .migrate import owner_url

    eng = create_engine(owner_url())
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"))
        conn.execute(text("DROP SCHEMA IF EXISTS rail CASCADE;"))
        conn.execute(text("DROP SCHEMA IF EXISTS registry CASCADE;"))
        conn.execute(text("DROP SCHEMA IF EXISTS chain CASCADE;"))
    eng.dispose()
