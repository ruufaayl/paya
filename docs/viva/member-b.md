# Member B (Taha Ali, 24i-5525): transaction state machine, idempotency, ledger

**Read:**
- `src/paya/state.py`: `TRANSITIONS`, `transition()`
- `src/paya/payments.py`: `initiate_payment`, `_authorise_and_post`, `dispatch`, `apply_rail_outcome`, `_settle`, `_reverse`, `run_status_enquiries`
- `src/paya/idempotency.py`
- `src/paya/ledger.py`: `post`, `available_balance`
- `src/paya/db.py`: `INTEGRITY_DDL`
- `docs/architecture/05-state-model.md`, `09-ledger-and-reconciliation.md`
- ADR-002, ADR-003, ADR-006, ADR-007

## 90-second explanation
> "Every state change is an optimistic-locked update, a history row and an outbox event, all in one database transaction. Anything not listed in TRANSITIONS raises an error. Validation, authorisation and posting happen in one ACID transaction. We hand off to Raast only after PENDING is committed, so a crash mid-call is recoverable. The ledger is double-entry in integer paisa. PostgreSQL itself refuses unbalanced journals, edits, deletes and repeated postings. Corrections are new linked journals."

## Questions you must handle

| Question | Answer and where to point |
|---|---|
| Show me where a double posting is impossible | `UNIQUE(txn_id, posting_type)` in `models.Journal` plus the row lock in `payments._locked`. Test: `test_concurrent_*` |
| What does `Idempotency-Key` store? | `(principal, operation, key)` → request hash and response. Same body → replay (`Idempotent-Replayed: true`); different body → 422; in progress → 409 |
| Why isn't the key enough? | A new app session sends a new key. The partial index `uq_one_live_payment_per_request` blocks a second live payment for the same QR (`test_s11_*`) |
| Available vs ledger balance? | Ledger = sum of entries. Available = ledger − active holds (Week 9). Holds are placed at AUTHORISED |
| Why are the money columns BIGINT? | Paisa as integers; floats cannot represent 0.10 exactly |
| Walk me through a rail REJECT | `apply_rail_outcome` → `_reverse`: a new REVERSAL transaction linked by `original_txn_id`, journal Dr 2150 / Cr 2100, original → REVERSED (`test_s5_*`) |
| What happens if the server dies between commit and the rail call? | The payment is PENDING with `rail_attempts = 0`. The worker's `dispatch_undispatched` claims and sends it (`test_s9_*`, drill D1) |
| What would break if you removed the deferred balance trigger? | The app also checks balance in `ledger.post`, but manual SQL or a future bug could then insert one-sided entries. The DB guard is defence in depth |

## Paya 2.0 additions (also yours)

- **Authoritative payment screens:** `web/src/wallet/Txn.tsx` and `Review.tsx`. The headline comes only from the server status; the idempotency key is kept per payment request in `sessionStorage`, so a reload or retry cannot charge twice.
- **Customer money trail:** the `money_trail` and `rail_status` fields added to `GET /v1/transactions/{ref}` (`api/main.py`). They are derived from journals, not computed in the browser.
- **Likely question:** "Can the animation show Paid early?" No: the success mark only mounts when the status is SETTLED; see acceptance checks 7–9 in `docs/revamp/TESTING_REPORT.md`.
