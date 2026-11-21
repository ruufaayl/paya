# Technical debt register (Week 6)

| Item | Owner | Class | Target |
|---|---|---|---|
| Mock Raast rail instead of a licensed sandbox | Integrity lead | Strategic (no public Raast API) | Replace through `RailPort` once partner access exists |
| Schema created with `create_all` plus integrity DDL (no Alembic migrations yet) | Integrity lead | Temporary workaround | Alembic baseline before the final defence |
| Outbox relay in-process; no RabbitMQ | Integrity lead | Temporary | Add RabbitMQ relay target and DLX (ADR-004) |
| Local JWT auth instead of an identity provider (e.g. Keycloak) | Security lead | Temporary | Keep for the prototype; document the OIDC path |
| Single-node PostgreSQL (RPO = last committed transaction while the volume survives; last dump if it is lost) | DevOps | Accepted for the prototype | Documented RTO/RPO; `pg_dump` in the runbook |
| Balances computed by aggregation | Integrity lead | Accepted | Add a balance projection if load tests require it |
| Login lockout state is in-process (resets on restart) | Security lead | Temporary | Store in DB or Redis; add MFA for staff |
| No JWT revocation list; tokens in browser localStorage | Security lead | Temporary | Short-lived tokens via OIDC + httpOnly cookies |
| No general API rate limiting | Security lead | Temporary | Gateway / reverse-proxy rate limits |
| App DB role could ALTER tables (disable triggers) | Integrity lead | Temporary | Separate owner and app roles; app role DML only |
| Mock rail has no message signing | Integrity lead | Strategic (mock) | mTLS + signed messages with the real operator |
| react-router 6.x: 2 moderate advisories (fix only in v7) | Channels lead | Compensated (UUID-only QR routing) | Upgrade to v7 after the semester |
| One API process caps at ~16 payments/s (CPU-bound) | Integrity lead | Accepted for prototype | Multiple API processes + separate worker + broker (ADR-004) |
