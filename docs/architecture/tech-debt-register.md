# Technical debt register (Week 6)

| Item | Owner | Class | Target |
|---|---|---|---|
| Mock Raast rail instead of a licensed sandbox | Integrity lead | Strategic (no public Raast API) | Replace through `RailPort` once partner access exists |
| ~~Schema created with `create_all` plus integrity DDL (no Alembic migrations yet)~~ | Integrity lead | **Done (ADR-015)** | Alembic baseline `0001` + `0002`; drift test M1; legacy databases stamped |
| Outbox relay in-process; no RabbitMQ | Integrity lead | Temporary | Add RabbitMQ relay target and DLX (ADR-004) |
| Local JWT auth instead of an identity provider (e.g. Keycloak) | Security lead | Temporary | Keep for the prototype; document the OIDC path |
| Single-node PostgreSQL (RPO = last committed transaction while the volume survives; last dump if it is lost) | DevOps | Accepted for the prototype | Documented RTO/RPO; `pg_dump` in the runbook |
| Balances computed by aggregation | Integrity lead | Accepted | Add a balance projection if load tests require it |
| Login lockout state is in-process (resets on restart) | Security lead | Temporary | Store in DB or Redis; add MFA for staff |
| No JWT revocation list; tokens in browser localStorage | Security lead | Temporary | Short-lived tokens via OIDC + httpOnly cookies |
| No general API rate limiting | Security lead | Temporary | Gateway / reverse-proxy rate limits |
| ~~App DB role could ALTER tables (disable triggers)~~ | Integrity lead | **Done (ADR-015)** | `paya_app` is data-only, no UPDATE/DELETE on evidence; the API never holds owner credentials (`evidence/security/db-roles-2026-11-21.md`) |
| Mock rail has no message signing | Integrity lead | Strategic (mock) | mTLS + signed messages with the real operator |
| react-router 6.x: 2 moderate advisories (fix only in v7) | Channels lead | Compensated (UUID-only QR routing) | Upgrade to v7 after the semester |
| One API process caps at ~16 payments/s (CPU-bound) | Integrity lead | Accepted for prototype | Multiple API processes + separate worker + broker (ADR-004) |
| Active (head-turn) liveness only; not certified presentation-attack detection | Security lead | Strategic | Certified passive-liveness vendor behind `FaceEngine` before any pilot |
| Face recogniser not evaluated on real, consented faces (FMR/FNMR, group fairness) | AI lead | Strategic | Evaluation on a consented, balanced dataset before auto-approval is used for real |
| Simulated identity registry instead of a licensed verification service | Integrity lead | Strategic (no public access) | Replace through `RegistryPort` under the partner's licence |
| No rate limit on `/v1/onboarding/start` (application spam) | Security lead | Temporary | Gateway rate limits + device attestation |
