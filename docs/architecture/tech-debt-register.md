# Technical debt register (Week 6)

| Item | Owner | Class | Target |
|---|---|---|---|
| Mock Raast rail instead of a licensed sandbox | Integrity lead | Strategic (no public Raast API) | Replace through `RailPort` once partner access exists |
| Schema created with `create_all` plus integrity DDL (no Alembic migrations yet) | Integrity lead | Temporary workaround | Alembic baseline before the final defence |
| Outbox relay in-process; no RabbitMQ | Integrity lead | Temporary | Add RabbitMQ relay target and DLX (ADR-004) |
| Local JWT auth instead of an identity provider (e.g. Keycloak) | Security lead | Temporary | Keep for the prototype; document the OIDC path |
| Single-node PostgreSQL (RPO = last committed transaction while the volume survives; last dump if it is lost) | DevOps | Accepted for the prototype | Documented RTO/RPO; `pg_dump` in the runbook |
| Balances computed by aggregation | Integrity lead | Accepted | Add a balance projection if load tests require it |
