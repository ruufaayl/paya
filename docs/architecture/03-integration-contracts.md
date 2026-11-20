# 03: Integration contracts, event decision and idempotency strategy

**Gate:** Week 10, integration contracts.
**Machine-readable contracts:** `api/openapi.json` (synchronous) and `api/events/*.schema.json` (asynchronous).

## 1. Integration decision table (Week 5)

One journey uses several integration patterns, and each choice is justified:

| Exchange | Pattern | Why (latency / coupling / consistency / recovery) |
|---|---|---|
| Customer pays; cashier creates QR | **Synchronous API (command)** | The user waits for an answer. Validation, authorisation and posting must be atomic. Retries are made safe by idempotency. |
| Status changes (`payment.*`, `case.opened`, `recon.completed`) | **Event, via transactional outbox** | Many consumers (notifier, live screens, future analytics). Producers must not know consumers. Delivery is at least once; consumers de-duplicate. |
| Rail credit transfer and status enquiry | **Synchronous call through `RailPort`** | Request/response with an 8 s timeout. A timeout means **unknown outcome**, never failure. |
| Rail acknowledgement callbacks | **Asynchronous message (inbox)** | The rail pushes them; they may be duplicated or delayed. Consumed with `processed_events` de-duplication. |
| Rail settlement file | **Batch file with control trailer** | Completeness and cut-off matter more than speed. The trailer carries record count, value total and SHA-256. |
| Live operations view | **WebSocket stream** | Push to screens. Display only, never a source of truth. |

Commands, events and queries are kept separate (Week 5): `POST` changes state, `GET` never does, and events report facts that have already happened.

## 2. Synchronous API catalogue

All endpoints are versioned under `/v1`. Every response carries `X-Correlation-ID`. If the client sends that header, the value is echoed back; otherwise the server generates one.

| Method and path | Purpose | Allowed roles | Idempotency | Typical errors |
|---|---|---|---|---|
| `POST /v1/auth/login` | Issue a JWT (60 min) | anyone | n/a | 401 `UNAUTHENTICATED` (attempt audited) |
| `POST /v1/payment-requests` | Create dynamic QR / Request-to-Pay | CASHIER, MERCHANT_ADMIN | `UNIQUE(merchant_id, order_ref)` | 403, 422 |
| `GET /v1/payment-requests/{id}` | QR details and latest payment | owner merchant, customer | n/a | 404, 403 |
| `POST /v1/payments` | **Pay a payment request** | CUSTOMER | **`Idempotency-Key` required**, plus one live payment per request | 409 `PAYMENT_ALREADY_IN_PROGRESS`, 409 `IDEMPOTENCY_IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED`, 409 `PAYMENT_REQUEST_CLOSED`, 503 `RAIL_UNAVAILABLE` |
| `GET /v1/transactions/{txn_ref}` | Full lifecycle: timeline, ledger, risk, cases, recon, audit | customer (own), merchant (own), back office | n/a | 404 (also returned for other customers' references, so they are never revealed) |
| `GET /v1/wallet` | Ledger and available balance, history | CUSTOMER | n/a | 401 |
| `POST /v1/compliance/holds/{ref}/decision` | Release or reject a hold | COMPLIANCE | State-guarded (only from UNDER_REVIEW with an open case) | 403, 409 `INVALID_STATE` |
| `POST /v1/ops/transactions/{ref}/reversal-requests` | Maker step | OPS | One reversal per original (DB unique index) | 409 `INVALID_STATE` |
| `POST /v1/finance/approvals/{id}/approve` | Checker step | FINANCE | Approval state-guarded | 403 `SEGREGATION_OF_DUTIES` |
| `POST /v1/finance/recon/run` | Import rail file and reconcile | FINANCE | **File hash unique** | 409 `DUPLICATE_SETTLEMENT_FILE`, 422 control totals |
| `GET /v1/finance/trial-balance`, `GET /v1/finance/recon/runs` | Finance reporting | FINANCE, AUDITOR | n/a | 403 |
| `GET /v1/audit/verify` | Recompute the audit hash chain | AUDITOR, COMPLIANCE | n/a | 403 |
| `GET /v1/cases`, `GET /v1/finance/approvals` | Human work queues | OPS, COMPLIANCE, FINANCE, AUDITOR | n/a | 403 |
| `GET/POST /v1/chaos/*` | Demo-only failure injection | SYSADMIN, OPS (demo mode only) | n/a | 403 outside demo mode |
| `WS /v1/stream?token=` | Live events and telemetry, filtered by role | any authenticated | n/a | close 4401 |

### Error model (one shape everywhere)

```json
{
  "error": { "code": "PAYMENT_ALREADY_IN_PROGRESS", "message": "this payment request already has a live payment",
             "txn_ref": "PAYA-20261120-ED0F19", "status": "PENDING" },
  "correlation_id": "corr-438d74ddca6d49e4b77b"
}
```

`code` is stable and machine-readable. `message` is for humans. Extra fields carry recovery hints, such as the existing `txn_ref` the client should track.

### Sample request and response: pay

```http
POST /v1/payments
Authorization: Bearer <customer JWT>
Idempotency-Key: paya-3f1c6b7e-1d2a-4c55-9b0e-7a51f0c2d9aa
X-Correlation-ID: corr-demo-0001
Content-Type: application/json

{ "payment_request_id": "6a0a7815-2f88-481b-8b17-9f6acd6187d9" }
```

```http
HTTP/1.1 202 Accepted
Idempotent-Replayed: false
X-Correlation-ID: corr-demo-0001

{ "txn_ref": "PAYA-20261120-ED0F19", "txn_id": "f4f74480-…", "status": "PENDING",
  "display_status": "Sent - awaiting confirmation", "amount": { "minor": 245000, "pkr": "2,450.00" },
  "failure_reason": null, "correlation_id": "corr-demo-0001" }
```

The endpoint returns **202 Accepted, not 200 OK**. At that point the money is posted to *payments in transit*, but Raast has not yet confirmed. The client must follow the authoritative status through `GET /v1/transactions/{ref}` or the stream. It must never show "Paid" from this response.

## 3. Event decision and catalogue

**Decision:** a transactional outbox in PostgreSQL, relayed at least once, with an inbox (`processed_events`) on every consumer. A broker such as RabbitMQ can be added later as the relay target without changing producers or consumers ([ADR-004](adr/ADR-004-outbox-before-broker.md)).

| Event | Producer | Consumers | Schema |
|---|---|---|---|
| `payment.created` and `payment.<state>` for every state change | Payments (`state.transition`) | Notifier, live stream | `api/events/payment-event.v1.schema.json` |
| `case.opened` | Payments / Recon (`open_case`) | Live stream (human gates) | `api/events/case-opened.v1.schema.json` |
| `recon.completed` | Reconciliation | Live stream, finance view | `api/events/recon-completed.v1.schema.json` |
| `rail.ack` (inbound callback) | Mock Raast rail | Payments (`rail-ack-consumer`) | `api/events/rail-ack.v1.schema.json` |

**Envelope (all events):** `event_id` (UUID, the de-duplication key), `seq` (ordering), `type`, `schema_version`, `aggregate_id` (transaction id), `correlation_id`, `occurred_at`, `payload`. This meets the brief's minimum fields: event ID, correlation ID, transaction ID, version and timestamp.

**Data contract (Week 5 template):**

| Field | Value |
|---|---|
| Owner | Payments context |
| Producer | Transaction service, in the same database transaction as the state change |
| Consumers | Notifier, Mission Control, live wallet/till screens |
| Allowable staleness | Notifier ≤ 2 s (worker tick); screens are real time |
| Privacy class | Internal identifiers only; no names, IBANs or identity numbers |
| Retention | Outbox kept for evidence in the prototype; a production policy is required |

**Change policy:** adding an optional field is backward compatible. Renaming or removing a field, or changing its meaning, needs `schema_version` 2, a deprecation notice and a consumer migration.

## 4. Idempotency strategy (summary of [ADR-003](adr/ADR-003-idempotency-store.md))

| Layer | Mechanism | Protects against | Test |
|---|---|---|---|
| HTTP request | `Idempotency-Key` → `(principal, operation, key)` with a request hash and stored response | Client retry after a timeout | `test_s2_*` |
| Business intent | Partial unique index: one live payment per `payment_request_id` | Second tap from a new session with a **new** key (Week 9 workshop) | `test_s11_*` |
| Ledger posting | `UNIQUE(txn_id, posting_type)` | A worker or retry posting twice | `test_s3_*`, `test_s4_*` |
| Rail | Same `rail_e2e_id` on resend; the rail is idempotent on it | Resend after "never received" | `test_s4_*` |
| Event consumers | `processed_events(consumer, event_id)` primary key | Duplicate delivery or replay | `test_s3_*` |
| Settlement file | `UNIQUE(file_sha256)` | Same file imported twice | `test_s13_*` |

Keys are random UUIDs and never contain personal data (Week 9).

## 5. Retry classification

| Failure | Classification | Action |
|---|---|---|
| Rail timeout | `UNKNOWN_OUTCOME` | Stay PENDING. Status enquiry at 5 s, 15 s, 45 s, 2 min, 5 min. After 15 min, UNDER_REVIEW and an Ops case. |
| Rail "not found" on enquiry | Safe to resend | Resend with the **same** E2E id |
| Rail connection refused | `TRANSIENT` | Circuit breaker opens after 3 failures. **New** payments are refused before any debit (503). |
| Rail reject | `BUSINESS_REJECT` | Never retried. Compensating reversal. |
| KYC fail, limit breach, insufficient funds | `BUSINESS_REJECT` | Never retried. REJECTED with a reason. |
| Consumer exception | `PROCESSOR_ERROR` | Shown on the DLQ telemetry; the event stays replayable from the outbox |
