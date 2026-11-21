"""Schema migrations (Alembic) and the database role split.

Two roles (ADR-015):
  owner  (PAYA_MIGRATION_DATABASE_URL) owns the schemas, runs migrations, defines triggers and constraints.
  app    (PAYA_DATABASE_URL)           what the API and worker use: SELECT/INSERT/UPDATE/DELETE only, and
                                       no UPDATE/DELETE at all on the append-only evidence tables. It cannot
                                       ALTER, DROP or TRUNCATE a table or disable a trigger.

`python -m paya.migrate` upgrades to head and (re)applies the app role's grants. A database created before
migrations existed (by create_all) is detected and stamped at the baseline first; nothing is dropped.
"""
import pathlib
import re
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from .config import get_settings

BASELINE = "0001"
SCHEMAS = ("public", "rail", "registry", "chain")
APPEND_ONLY = ("ledger_entries", "journals", "audit_log", "transaction_status_history")


def owner_url() -> str:
    s = get_settings()
    return s.migration_database_url or s.database_url


def _config(url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(pathlib.Path(__file__).parent / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    cfg.attributes["url"] = url
    return cfg


def app_role() -> str | None:
    """The app role's name, when the app connects as a different role from the owner."""
    s = get_settings()
    app_user, owner_user = make_url(s.database_url).username, make_url(owner_url()).username
    return app_user if app_user and app_user != owner_user else None


def grant_statements(role: str) -> list[str]:
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise SystemExit(f"unexpected app role name {role!r}")
    q = f'"{role}"'
    out = []
    for sch in SCHEMAS:
        out += [
            f"GRANT USAGE ON SCHEMA {sch} TO {q}",
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {sch} TO {q}",
            f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {sch} TO {q}",
            f"REVOKE CREATE ON SCHEMA {sch} FROM {q}",
            f"REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA {sch} FROM {q}",
        ]
    # Evidence is append-only for the app at the PRIVILEGE level too (the trigger is the second wall).
    out += [f"REVOKE UPDATE, DELETE ON {t} FROM {q}" for t in APPEND_ONLY]
    out += [f"REVOKE CREATE ON SCHEMA public FROM PUBLIC"]
    return out


def ensure_app_role(conn, role: str, password: str | None) -> None:
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise SystemExit(f"unexpected app role name {role!r}")
    exists = conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}).scalar()
    if not exists:
        if not password:
            raise SystemExit(f"app role {role!r} does not exist; create it or set PAYA_APP_DB_PASSWORD")
        literal = "'" + password.replace("'", "''") + "'"   # DDL takes no bind parameters; quote as a literal
        conn.exec_driver_sql(f'CREATE ROLE "{role}" LOGIN PASSWORD {literal} NOSUPERUSER NOCREATEDB NOCREATEROLE')


def head_revision() -> str:
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(_config(owner_url())).get_current_head()


def check_at_head() -> str:
    """For an API that must not migrate (it holds only the app role): refuse to start on an old schema."""
    from .db import session_scope

    with session_scope() as s:
        current = s.execute(text("SELECT version_num FROM alembic_version")).scalar()
    if current != head_revision():
        raise SystemExit(f"database is at migration {current}, code expects {head_revision()}: run the migrate job")
    return current


def upgrade(revision: str = "head") -> dict:
    url = owner_url()
    eng = create_engine(url)
    stamped = False
    with eng.begin() as conn:
        names = inspect(conn).get_table_names()
        if "transactions" in names and "alembic_version" not in names:
            # created before migrations: record it as the baseline instead of re-creating anything
            cfg = _config(url)
            cfg.attributes["connection"] = conn
            command.stamp(cfg, BASELINE)
            stamped = True
    with eng.begin() as conn:
        cfg = _config(url)
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, revision)
        role = app_role()
        if role:
            ensure_app_role(conn, role, get_settings().app_db_password)
            for stmt in grant_statements(role):
                conn.execute(text(stmt))
        head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    eng.dispose()
    return {"revision": head, "stamped_legacy_database": stamped, "app_role": role}


if __name__ == "__main__":
    print(upgrade(sys.argv[1] if len(sys.argv) > 1 else "head"))
