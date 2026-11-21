# 12: Observability, SLIs and SLOs

**Gate:** Week 13, security/observability (metrics, logging) and the brief's resilience requirement (SLO/SLI definitions).
**Week 9 principle:** "A green API can still produce a red business outcome." So every target below is either a **business** signal or a technical signal tied to one.

## 1. What is observable, and where

| Signal | Implementation | Example |
|---|---|---|
| **Structured logs** | One JSON object per line on stdout (`observability.py`). Every request line carries `correlation_id`, method, route template, status and `duration_ms`. Business telemetry (risk, ledger, rail, recon) is logged too, with `txn_ref`, and with the request's `correlation_id` when it happens inside a request. Worker-side lines join on `txn_ref`, because the transaction row stores its correlation ID. Sensitive keys are scrubbed | `{"msg":"http_request","correlation_id":"corr-log-1","route":"/v1/payments","status":202,"duration_ms":50.7}` |
| **Correlation and trace ID** | `X-Correlation-ID` accepted (validated) or generated, echoed on every response, and stored on the transaction, every journal, every status change, the outbox event and the audit row | `GET /v1/transactions/{ref}` → `references.correlation_id` |
| **Business status** | Transaction state machine plus status history (an event log usable for process mining) | Mission Control timeline, inspector |
| **Metrics** | `GET /metrics` (Prometheus text): payments by status, money in transit, open cases, breaker state, unpublished outbox, and per-route request counters and latency histograms | `paya_http_request_duration_ms_bucket{route="/v1/payments",le="250"}` |
| **Integrity** | `GET /v1/finance/integrity`: 11 checks across the four reconciliation layers | PASS / WARN / FAIL with values |
| **Dashboards** | **Mission Control** (live service map, metrics bar, human gates, feed, inspector) for operations; `/v1/metrics/summary` and `/v1/finance/trial-balance` for finance | `evidence/screenshots/` |
| **Audit** | Hash-chained `audit_log`, verifiable with `GET /v1/audit/verify` | — |

Prometheus and Grafana can scrape `/metrics` directly. They are optional, and the prototype does not depend on them.

## 2. SLIs and SLOs

The measured values come from the load test (`evidence/performance/`) and the recovery drill (`evidence/resilience/`). They describe **one laptop-class container running one API process**. They are **not** production capacity claims.

| # | SLI (how measured) | SLO (target) | Why this target (business justification) | Measured | Met |
|---|---|---|---|---|---|
| SLO-1 | Payment initiation latency: client-side p95 of `POST /v1/payments` | p95 ≤ 1,000 ms at the design load of 10 concurrent customers | The customer is standing at a counter; over ~1 s feels broken | 84 ms (c=1); 792 ms (c=10) | yes |
| SLO-2 | **Time to authoritative status**: SETTLE journal time − creation time | p95 ≤ 3 s with a healthy rail | The cashier must not wait to hand over goods; this is the product promise | 102 ms (c=1); 1.8 s (c=10) | yes |
| SLO-3 | **Duplicate financial effect**: transactions with more than one SETTLE or AUTH_POST journal | **0, always** (error budget = zero) | Money integrity is not traded for speed | 0 of 400 (incl. duplicate-ack storm) | yes |
| SLO-4 | Payment success rate: settled ÷ attempted, excluding business declines | ≥ 99.5% over 30 days | Failures must be rare *and* explained | 100% in tests (400/400) | yes |
| SLO-5 | Uncertainty resolved: PENDING older than 15 min without escalation | 0 (every uncertain payment is resolved or owned by a human within 15 min) | Week 9: every partial failure needs an owner and a timeout | Integrity check `pending_beyond_review_window` = 0 | yes |
| SLO-6 | Customer told: settled payments without a customer notice after 30 s | 0 | Operational reconciliation; prevents support calls | Integrity check = 0 | yes |
| SLO-7 | Reconciliation match rate per daily file | ≥ 99% matched; every break has an owner within 24 h | Finance close; regulatory evidence | 100% on drill days; breaks auto-owned | yes |
| SLO-8 | API availability (`/healthz` success) | 99.5% monthly (prototype) | A single node can't promise more honestly | — (not measured over 30 days) | n/a |

**Capacity finding (measured, stated honestly):**
- One payment costs about 60 ms of service time.
- One Python process therefore saturates at about **16 payments/s** however many clients wait, because the work is CPU-bound in one interpreter.
- At 10 concurrent clients, the extra latency is queueing.
- **Scaling path:**
  - several API processes, plus a separate worker process (the row locks added after the load test already make concurrent workers safe);
  - a broker for fan-out of the live stream (ADR-004);
  - PgBouncer.
- None of these are needed for the semester demo.

## 3. Alerts (what should page whom)

| Alert | Condition | Owner | Action (runbook) |
|---|---|---|---|
| Rail breaker open | `paya_rail_breaker_open == 1` for 1 min | Ops | RB-1 Rail outage |
| Uncertainty building | `paya_payments_total{status="PENDING"}` rising for 5 min, or integrity `pending_beyond_review_window` > 0 | Ops | RB-2 Stuck payments |
| Relay stalled | `paya_outbox_unpublished` > 0 for 2 min, or integrity `outbox_relay_lag` FAIL | Engineering | RB-3 Worker or relay down |
| Money integrity | Integrity `trial_balance_balanced` or `in_transit_equals_open_payments` FAIL | Finance + Engineering (P1) | RB-4 Ledger integrity breach: stop payments |
| Recon breaks ageing | Integrity `cases_within_sla` WARN | Finance | RB-5 Reconciliation breaks |
| Brute force | `security.login_locked` events > 3 in 10 min | Security | RB-6 Suspicious access |

Following Week 2 and Week 8: alerts are few, each has one owner with authority to act, and each points to a runbook. That avoids the "collection of unowned alerts".
