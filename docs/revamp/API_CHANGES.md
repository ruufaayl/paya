# API changes (Paya 2.0)

All changes are **additive**. No existing endpoint changed its path, input, or meaning. Financial domain modules (`ledger`, `payments`, `state`, `rail`, `recon`, `kyc`, `idempotency`) were **not modified**. The new endpoints live in `src/paya/api/ops.py`; tests are in `tests/test_ops_api.py` (O1–O9). OpenAPI: 41 → 55 operations (`api/openapi.json`).

## New endpoints

| Method & path | Permission (roles) | Purpose | Moves money? |
|---|---|---|---|
| `GET /v1/ops/transactions` | `backoffice:read` (OPS, COMPLIANCE, FINANCE, AUDITOR, SYSADMIN) | Transaction Explorer search: `q` (reference / E2E / correlation, contains), `status` (comma list), `type`, `merchant`, `customer`, `min_amount_minor`, `max_amount_minor`, `date_from`, `date_to`, `recon` (`RECONCILED`/`UNRECONCILED`/`BREAK`), `rail` (`NOT_SENT`/`SENT`/`RETRIED`), `flagged`, `page`, `page_size ≤ 100`. Returns `{items, total, page, page_size}` with flags `SCREENING`/`CASE` | No |
| `GET /v1/ops/overview` | `backoffice:read` | One read model for the Overview page: payments by status, success rate (settled ÷ decided), in flight, awaiting rail ack, value in transit (ledger 2150), human work (open cases by kind, overdue, unassigned, approvals waiting, KYC referred), rail and registry modes (flagged `simulated: true`), integrity summary, latest reconciliation | No |
| `GET /v1/ops/timeseries?window_minutes&buckets` | `backoffice:read` | Payments created per bucket by current outcome; value settled; time-to-settle p50 per bucket and p50/p95 overall (from `transaction_status_history`) | No |
| `GET /v1/events?type_prefix&correlation_id&txn_ref&before_seq&limit` | `backoffice:read` | Durable event history from the transactional outbox (paged by `seq`) | No |
| `GET /v1/finance/recon/runs/{run_id}/items?category` | `backoffice:read` | Every line of a reconciliation run with ledger amount, rail amount, difference, transaction reference and case (state, owner, assignee) | No |
| `GET /v1/cases/{case_ref}` | `cases:read` | Case detail: transaction, KYC application reference, AI suggestions, approvals, assignment, SLA, and the decision trail (audit rows for the case, its transaction and its application) | No |
| `POST /v1/cases/{case_ref}/assign` `{assignee}` | `cases:assign` (OPS, COMPLIANCE, FINANCE) **and** the caller's role must equal the case's `owner_role`; the assignee must be an active user in that role | Work management. `OPEN → IN_REVIEW`. Audited (`CASE_ASSIGN`); a refused attempt is audited as `DENIED` in its own transaction | No |
| `GET /v1/audit/log?actor&action&outcome&object_id&before_id&limit` | `audit:read` (AUDITOR, COMPLIANCE) | Audit rows with hashes, plus a chain verification result | No |
| `GET /v1/admin/access` | `access:read` (AUDITOR, SYSADMIN, COMPLIANCE) | Permission matrix and users (names and roles only) | No |
| `GET /v1/ops/staff?role` | `cases:read` | Names of active staff in a role (assignment picker) | No |
| `POST /v1/assistant/messages` `{text, conversation_ref?}` | `assistant:use` (CUSTOMER) | Theme 3: the Paya Assistant replies from the customer's own data; returns reply, cards, suggestions, handoff, redaction kinds | **No** (source-checked) |
| `GET /v1/assistant/conversations/{ref}` | `assistant:use` (owner only) | The customer's own transcript (redacted) | No |
| `GET /v1/ops/assistant/conversations/{ref}` | `cases:read` | Staff transcript for a handoff; **each read audited** | No |
| `GET /v1/ops/assistant/metrics` | `backoffice:read` | Conversations, intents, handoff, unknown and redaction counts | No |

## Changed responses (additive fields)

| Endpoint | Added | Why |
|---|---|---|
| `GET /v1/me` | `permissions: string[]` | The console hides actions the operator cannot take. **The server still enforces every permission**; this is only for clarity |
| `GET /v1/transactions/{ref}` | `money_trail[]` (customer-safe descriptions of `AUTH_POST`, `SETTLE`, `REVERSAL` journals, with journal reference and time) and `rail_status` (`network: "Raast (simulated)"`, `e2e_id`, `sent`, `attempts`, `confirmed_at`) | The customer can see what happened to their money from the ledger itself, without internal account names |

## Data model change

`cases.assigned_to varchar(64)` and `cases.assigned_at timestamptz`, both nullable. Theme 3 adds two new tables, `conversations` and `chat_messages` (created by `create_all`; existing tables untouched). `POST /v1/cases/{ref}/resolve` now also closes `SUPPORT_HANDOFF` cases, with their own resolutions (`CUSTOMER_CONTACTED`, `NO_ACTION_NEEDED`). They are added by idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements at startup (`db.py: INTEGRITY_DDL`), so existing databases upgrade in place with no data loss. Nothing is dropped or rewritten.

## New permissions (`security.py`)

| Permission | Roles | Rationale |
|---|---|---|
| `cases:assign` | OPS, COMPLIANCE, FINANCE | People who own cases can distribute them; still limited to cases their role owns |
| `access:read` | AUDITOR, SYSADMIN, COMPLIANCE | Seeing who can do what is an audit and administration need |

## Real-time

Unchanged: the existing WebSocket `/v1/stream`. On connect it replays the last 200 in-memory messages, then streams live; access to it is role-filtered. The console now **de-duplicates by `event_id`** (events are delivered at least once by design). It reconnects with exponential backoff (0.5 s → 8 s), shows "Reconnecting…", supports pause/resume (held messages are released in order), and backfills durable history from `GET /v1/events`. SSE was considered and not adopted: the WebSocket already exists, is tested, and carries both message kinds.
