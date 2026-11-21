"""ADR-015: Alembic migrations and the owner/app role split (M1-M6). Every other test in this suite already
runs as the restricted app role; these prove the restrictions themselves."""
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, func, select, text

from conftest import new_request, pay
from paya import migrate
from paya.db import session_scope
from paya.migrations.meta import TARGET, include_name
from paya.models import LedgerEntry, Transaction


def owner():
    return create_engine(migrate.owner_url())


def test_m1_models_and_migrations_agree(client):
    with owner().connect() as c:
        ctx = MigrationContext.configure(c, opts={"include_schemas": True, "include_name": include_name,
                                                  "compare_type": True})
        diff = compare_metadata(ctx, TARGET)
    assert diff == [], f"models changed without a migration: {diff[:5]}"


def test_m2_database_is_at_head_and_upgrade_is_idempotent(client):
    first = migrate.upgrade()
    assert first["revision"] == migrate.upgrade()["revision"] == migrate.head_revision()
    assert first["app_role"] == "paya_app" and first["stamped_legacy_database"] is False


@pytest.mark.parametrize("stmt", [
    "ALTER TABLE ledger_entries DISABLE TRIGGER ALL",
    "DROP TABLE audit_log",
    "TRUNCATE journals",
    "DELETE FROM audit_log",
    "UPDATE transaction_status_history SET reason = 'x'",
    "CREATE TABLE public.sneaky (id int)",
    "ALTER TABLE accounts DROP CONSTRAINT ck_account_type",
    "DROP TRIGGER trg_journal_balanced ON ledger_entries",
])
def test_m3_app_role_cannot_change_structure_or_rewrite_evidence(client, stmt):
    with pytest.raises(Exception, match="permission denied|must be owner"):
        with session_scope() as s:
            s.execute(text(stmt))


def test_m4_app_role_can_do_its_job(client, as_):
    r = pay(client, as_, new_request(client, as_, 12_000))
    assert r.status_code == 202
    with session_scope() as s:
        assert s.execute(text("SELECT current_user")).scalar() == "paya_app"
        assert s.execute(select(func.count()).select_from(LedgerEntry)).scalar() > 0


def test_m5_legacy_database_is_stamped_not_rebuilt(client, as_):
    pay(client, as_, new_request(client, as_, 7_000))
    with session_scope() as s:
        before = s.execute(select(func.count()).select_from(Transaction)).scalar()
    # A database made by create_all before migrations existed: the baseline's tables, no version table.
    from alembic import command
    with owner().begin() as c:
        cfg = migrate._config(migrate.owner_url())
        cfg.attributes["connection"] = c
        command.downgrade(cfg, migrate.BASELINE)       # removes everything added after the baseline
        c.execute(text("DROP TABLE alembic_version"))
    out = migrate.upgrade()
    assert out["stamped_legacy_database"] is True and out["revision"] == migrate.head_revision()
    with session_scope() as s:
        assert s.execute(select(func.count()).select_from(Transaction)).scalar() == before


def test_m6_grants_follow_the_append_only_list(client):
    with owner().connect() as c:
        rows = c.execute(text(
            "SELECT table_name, privilege_type FROM information_schema.role_table_grants "
            "WHERE grantee = 'paya_app' AND table_schema = 'public'")).all()
    granted = {}
    for t, priv in rows:
        granted.setdefault(t, set()).add(priv)
    for t in migrate.APPEND_ONLY:
        assert granted[t] == {"SELECT", "INSERT"}, t
    assert granted["transactions"] == {"SELECT", "INSERT", "UPDATE", "DELETE"}
    assert all("TRUNCATE" not in p and "TRIGGER" not in p for p in granted.values())
