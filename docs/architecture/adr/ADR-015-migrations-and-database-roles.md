# ADR-015: Alembic migrations, and separate database owner and application roles

**Status:** accepted · **Date:** 2026-11-21 · **Area:** data integrity, security, operations

## Context

Two items in the technical-debt register were promised before the final defence:
- The schema was built with `create_all` plus a list of integrity DDL run at every start. There was no versioned history and no safe way to change a production schema.
- The application connected as the database owner, so a bug, an injection or a stolen credential could `ALTER` a table, **disable the append-only and balanced-journal triggers**, `TRUNCATE` the ledger or rewrite the audit log. Threat T-03 rated this "medium for a DB superuser", and the decision slide listed separate roles as a pilot condition.

## Decision

1. **Alembic owns the schema.** Revision `0001` is the baseline: every table in `public` plus the three simulator schemas (`rail`, `registry`, `chain`), and a *frozen* copy of the database guards (balanced-journal constraint trigger, append-only triggers, business-idempotency partial indexes). Revision `0002` carries the idempotent upgrades older databases need. The partial unique indexes are now declared in the models too, so models and migrations describe the same schema.
2. **A test fails if they drift:** `compare_metadata` between the models and a migrated database must be empty (M1). Any model change needs a migration.
3. **Legacy databases are completed and stamped, not rebuilt.** A database created by `create_all` (it has tables but no `alembic_version`) may predate parts of the baseline, as a real one did: it had no `registry` schema. The migrator creates only the *missing* baseline schemas and tables, re-applies the idempotent guards, stamps it at `0001` and upgrades. Stamp and upgrade run in **one transaction**, so a failure leaves nothing behind (M8). Afterwards the schema is compared with the models, and the migrator refuses to finish if they differ. Nothing is altered or dropped (M5, M7).
4. **Two roles.**
   - **Owner** (`PAYA_MIGRATION_DATABASE_URL`) owns the schemas, runs migrations, and defines triggers and constraints.
   - **App** (`PAYA_DATABASE_URL`, e.g. `paya_app`) gets `SELECT, INSERT, UPDATE, DELETE` on tables and `USAGE` on sequences. It gets **no `UPDATE`/`DELETE` on the append-only evidence tables** (`ledger_entries`, `journals`, `audit_log`, `transaction_status_history`), and no `TRUNCATE`, `TRIGGER` or `CREATE`. It cannot alter or drop tables or disable triggers, because only the owner can. Grants are re-applied after every upgrade.
5. **The API never holds the owner credentials in Docker Compose.** A one-shot `migrate` service runs `python -m paya.migrate` as the owner. The API starts only after it succeeds, connects as `paya_app` with `PAYA_MIGRATE_ON_START=false`, and refuses to start if the schema is not at head. In local development and tests the API can migrate itself.
6. **Every backend test runs as the app role**, so the suite proves the application works with data privileges only.

## Consequences

- Evidence tampering now needs the owner credential, and even the owner still meets the append-only trigger (defence in depth).
- Schema changes are reviewable revisions, and CI catches a missing migration.
- One more secret (`PAYA_APP_DB_PASSWORD`) and one more compose service.
- Not covered: row-level security per customer, and a separate read-only role for reporting and audit tools (future).

## Alternatives rejected

- **Keep `create_all` and document it:** no history, no safe production change path.
- **Rely on triggers alone:** the owner can disable them, so triggers protect against bugs but not against a compromised app credential.
- **Run migrations inside the API with owner credentials:** the API process would hold the very privilege the split removes.
