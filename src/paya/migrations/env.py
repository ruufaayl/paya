"""Alembic environment. Migrations run as the schema OWNER (PAYA_MIGRATION_DATABASE_URL), never as the
app role, which has data privileges only (see paya.migrate)."""
from alembic import context
from sqlalchemy import create_engine

from paya.migrations.meta import TARGET, include_name


def run() -> None:
    cfg = context.config
    url = cfg.attributes.get("url") or cfg.get_main_option("sqlalchemy.url")
    conn = cfg.attributes.get("connection")
    opts = dict(target_metadata=TARGET, include_schemas=True, include_name=include_name, compare_type=True)
    if conn is not None:
        context.configure(connection=conn, **opts)
        with context.begin_transaction():
            context.run_migrations()
        return
    eng = create_engine(url)
    with eng.connect() as c:
        context.configure(connection=c, **opts)
        with context.begin_transaction():
            context.run_migrations()


run()
