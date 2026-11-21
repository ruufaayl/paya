# 13: Resilience, failure handling and recovery (RTO/RPO)

**Gate:** Week 13 failure/resilience gate (timeout, duplicate and partial-failure behaviour) and the brief's resilience standard: failure states, retry/backoff, dead-letter or exception handling, RTO/RPO assumptions and a recovery test.
**Evidence:**
- [`evidence/resilience/recovery-drill-2026-11-21.md`](../../evidence/resilience/recovery-drill-2026-11-21.md)
- [`evidence/performance/`](../../evidence/performance/)
- `tests/` (25 automated tests)

## 1. Failure-mode catalogue

| # | Failure | Detection | Automatic response | Human step | Proven by |
|---|---|---|---|---|---|
| F1 | Client retries after a lost response | Same `Idempotency-Key` | Stored response replayed; no second debit | none | S2 |
| F2 | Second tap from a new session | Partial unique index on the payment request | `409` with the existing `txn_ref` to follow | none | S11 |
| F3 | Rail timeout; outcome unknown | `RailTimeout` | Stay PENDING; status enquiry at 5 s, 15 s, 45 s, 2 min, 5 min; resend the same E2E only on NOT_FOUND | After 15 min: Ops maker → Finance checker | S4, S6 |
| F4 | Rail rejects after we debited (partial failure) | ACCEPTED/REJECTED answer | Compensating REVERSAL journal, linked transaction | none | S5 |
| F5 | Duplicate ack or callback | Inbox `processed_events`; row lock; `UNIQUE(txn_id,'SETTLE')` | No-op, logged as duplicate | none | S3, load test phase B |
| F6 | Rail down | `RailUnavailable` × 3 → breaker OPEN | New payments refused **before** debit (`503`); half-open probe after 30 s | Ops watches the breaker | S12, drill D1 |
| F7 | API process crash mid-flight | Container restart policy | Worker resumes from the DB: undispatched sends, enquiries and expiries | none | S9, drill D1 |
| F8 | Database restart | `pool_pre_ping` | Dead connections discarded; requests resume | none | drill D2 |
| F9 | Settlement line missing or late | Reconciliation | MISSING_EXTERNAL case, or TIMING_DIFFERENCE; auto-close on a later match | Ops | S10, S10b |
| F10 | Same settlement file imported twice | `UNIQUE(file_sha256)` | `409`, nothing posted | none | S13 |
| F11 | Event consumer error | Exception in subscriber | Logged as `dlq.consumer_error`; event stays replayable from the outbox (at-least-once) | Engineering | design (outbox) |
| F12 | Concurrent dispatch, callback and enquiry for one payment (found by the load test) | Row lock on every rail-answer path; atomic first-send claim | Exactly one settlement | none | `test_concurrent_*` (5/5 runs) |
| F13 | Notification lost | Integrity check `settled_without_customer_notice` | Flagged FAIL | Ops re-sends from the event | `test_integrity_checks_*` |

**Retry policy:**
- Retry only when the outcome is unknown or the request is safe to repeat.
- Never retry business rejections such as KYC failure, limit breach or insufficient funds.

**Dead-letter handling:** there is no broker in the prototype (ADR-004). A consumer failure is shown on Mission Control and in the logs. The outbox row is the durable record, so the event can be replayed. Every consumer de-duplicates, so a replay is safe.

## 2. Recovery objectives

Week 12: availability targets need a business justification.

| Service / data | RTO | RPO | Business justification | Assumption |
|---|---|---|---|---|
| Payment initiation (API) | **5 min** | n/a | While it is down, cashiers fall back to cash or another rail. Short outages are tolerable; wrong money is not | One API container with the Docker restart policy |
| Transaction state and ledger (PostgreSQL) | **30 min** (restore from dump) | **0** for committed transactions while the volume survives; **≤ 24 h** if the volume is lost (daily `pg_dump`) | The ledger is the financial record; losing a committed posting is unacceptable | Single node; no streaming replica in the prototype. Production: synchronous replica (RPO 0) and PITR |
| In-flight payments after a crash | **15 min** to a correct, explained state | 0 | Matches the pending-review window; a human owns anything older | Worker resumes from the DB |
| Reconciliation | Next business day | 0 (files re-requestable) | Finance close is D+1 | Rail can re-issue files |
| Mission Control / live stream | Best effort | n/a (display only, not truth) | Losing the screen loses no money | Reconnects automatically |

## 3. Recovery test results (measured on 2026-11-21)

| Drill | What we did | Result |
|---|---|---|
| D1 | `docker kill -s KILL` the API while 3 payments were PENDING behind a "lost request" rail | API healthy after **1.3 s**; all 3 payments correctly **SETTLED 6.0 s** after the crash; exactly one AUTH_POST, SETTLE and FEE each; 3 rail records (no duplicate credit); integrity checks PASS. The 4th payment before the crash was refused by the circuit breaker (`503`) with no debit |
| D2 | `docker restart` the database under a running API | API healthy after **0.7 s**; a new payment settled; no committed data lost |
| D3 | `pg_dump -Fc` → `pg_restore` into a fresh database | Dump 0.5 s, restore 0.6 s (3.1 MB); **account balances identical**; integrity triggers restored with the schema |

All targets in §2 were met in the drill. The drill is scripted (`docs/architecture/tools/recovery_drill.py`), so it can be repeated live in the demo.

## 4. Finding from load testing (and what we changed)

The first load test found a **race**. The API's background dispatch and the recovery worker could both act on the same PENDING payment.
- **No money was wrong:** the database refused the second SETTLE (`UNIQUE(txn_id, posting_type)`) and the second rail record.
- **But:** the refusal surfaced as an unhandled exception, and an exception escaping a background task dropped the client's keep-alive connection.
- **Fixes:**
  - every rail-answer path takes a row lock;
  - the worker's first send is an atomic claim;
  - the mock rail serialises per E2E id;
  - account get-or-create is race-safe, with a new unique index for house accounts;
  - background tasks can no longer raise into the server.
- **Regression proof:** `test_concurrent_dispatch_callbacks_and_enquiries_settle_exactly_once` (stable over 5 repeated runs), and a clean re-run of the load test (0 errors in the API log).
- **The lesson:** database constraints are the last line of defence. They held. The application still has to avoid relying on them as normal control flow.
