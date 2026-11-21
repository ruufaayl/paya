# Recovery drill - 2026-11-21 03:06 UTC

Stack: Docker Compose (`paya-api` + `postgres:16-alpine`) on the development container. Mock Raast rail. Synthetic data.

## D1 - API process killed (SIGKILL) while payments are in flight

- Rail set to *lost request*; 3 payments created: `PAYA-20261121-6756FB` PENDING, `PAYA-20261121-A7A150` PENDING, `PAYA-20261121-3F2030` PENDING
- 4th payment refused with **503 RAIL_UNAVAILABLE**: the circuit breaker opened after 3 rail timeouts, before any money was taken
- `docker kill -s KILL paya-api-1` (no graceful shutdown; worker thread dies mid-loop)
- Container restarted; **API healthy after 1.3 s**. Chaos state is in-memory, so the restarted process sees a healthy rail (as when the rail itself recovers).
- Worker resumed from the database: status enquiry → NOT_FOUND → resend with the same E2E id → settled.
- **All in-flight payments correct 6.0 s after the crash**: `PAYA-20261121-6756FB` SETTLED, `PAYA-20261121-A7A150` SETTLED, `PAYA-20261121-3F2030` SETTLED
- Each payment has exactly one AUTH_POST, one SETTLE and one FEE journal: **True**
- Rail-side records for these 3 payments: **3** (no duplicate credits from the resend)
- Integrity checks after recovery: **PASS**

## D2 - Database restarted under a running API

- `docker restart paya-db-1`; API health back after **0.7 s** (connection pool `pre_ping` discards dead connections)
- New payment after the restart: `PAYA-20261121-E5D192` → **SETTLED**
- Committed transactions still present after the restart: 1951 rows (RPO = 0 for committed data while the volume survives)

## D3 - Backup and restore drill

- `pg_dump -Fc` took 0.5 s (3.1M); `pg_restore` into a fresh database took 0.6 s
- Account balances identical between live and restored copy: **True**
- Integrity triggers restored with the data: 5 triggers present

## Result

| Drill | Measured | Target (see 13-resilience-and-recovery.md) | Met |
|---|---|---|---|
| D1 API crash → healthy | 1.3 s | RTO 5 min | yes |
| D1 crash → in-flight payments correct | 6.0 s | 15 min (pending review window) | yes |
| D2 DB restart → API healthy | 0.7 s | RTO 5 min | yes |
| D3 restore matches live ledger | True | exact match | yes |
| Committed data lost | 0 | RPO 0 (volume intact) | yes |
