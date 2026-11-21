# 09: Ledger posting rules and reconciliation logic

**Gate:** Week 12, ledger/reconciliation logic.
**Code:** `src/paya/ledger.py`, `payments.py`, `recon.py`, `integrity.py`.
**Evidence:** [`evidence/ledger/worked-examples.md`](../../evidence/ledger/worked-examples.md). The system produced these by running five real journeys on a fresh database; none of the entries are hand-typed.

## 1. Chart of accounts

These are the Partner EMI's books as Paya records them. All figures are synthetic.

| Code | Account | Type | Normal balance | Meaning |
|---|---|---|---|---|
| 1010 | Settlement account at sponsor bank | Asset | Debit | Pooled funds the EMI holds at its sponsor bank; Raast settles out of it |
| 1300 | Merchant fee receivable | Asset | Debit | Merchant discount fees owed to the EMI (one account per merchant) |
| 1400 | Claim receivable – rail/partner | Asset | Debit | Money that left 1010 without a matching payment; under investigation |
| 2100 | Customer wallet balances | Liability | Credit | What the EMI owes each customer (one account per customer) |
| 2110 | Customer green pots | Liability | Credit | Ring-fenced savings pots (theme 2, roadmap) |
| 2150 | Payments in transit | Liability | Credit | Debited from customers, not yet confirmed by Raast |
| 2190 | Suspense – unmatched rail items | Liability | Credit | Inbound items that cannot be identified yet |
| 3000 | Funding equity (synthetic seed) | Equity | Credit | Synthetic capital for the demo |
| 4100 | Merchant discount fee income | Income | Credit | Fee revenue (synthetic rate 0.50%) |

## 2. Posting rules

Each journal type appears at most once per transaction (`UNIQUE(txn_id, posting_type)`). Each journal balances (deferred trigger). Amounts are positive integer paisa.

| Event (state change) | Journal | Debit | Credit | Initiated by | Approval |
|---|---|---|---|---|---|
| Funds authorised and posted (→ POSTED) | `AUTH_POST` | 2100 customer wallet | 2150 in transit | API (customer) | Risk PASS, or a Compliance RELEASE |
| Raast confirms (→ SETTLED) | `SETTLE` | 2150 in transit | 1010 settlement account | Worker (ack, callback, enquiry or file) | none: external proof |
| Same event | `FEE` | 1300 merchant fee receivable | 4100 fee income | Worker | none: configured rate, `rule_version` stored |
| Raast rejects (→ REVERSED) | `REVERSAL` on a new linked REVERSAL transaction | 2150 in transit | 2100 customer wallet | Worker | none: external proof |
| Unknown too long (→ REVERSED) | `REVERSAL` | 2150 in transit | 2100 customer wallet | `MANUAL_APPROVED` | Ops maker **and** Finance checker; `approved_by` stored |
| Rail line we cannot match (recon) | `CLAIM` on an ADJUSTMENT holder transaction | 1400 claim receivable | 1010 settlement account | Batch (reconciliation) | Finance owns the case |
| Synthetic opening balance (seed only) | `TOPUP` | 1010 settlement account | 2100 customer wallet | Batch | n/a |

Worked example (system output, E1 in the evidence file), customer pays PKR 2,450:

| Journal | Account | Debit | Credit |
|---|---|---:|---:|
| AUTH_POST | 2100 Customer wallet (Sara) | 2,450.00 | |
| AUTH_POST | 2150 Payments in transit | | 2,450.00 |
| SETTLE | 2150 Payments in transit | 2,450.00 | |
| SETTLE | 1010 Settlement account | | 2,450.00 |
| FEE | 1300 Fee receivable (Chai Junction) | 12.25 | |
| FEE | 4100 Fee income | | 12.25 |

**Why money passes through 2150 (Payments in transit):** at POSTED the customer has been debited, but finality has not been reached. Keeping the money in a clearing liability makes the uncertainty visible. The balance of 2150 must always equal the sum of payments still awaiting the rail. That is an integrity check (`in_transit_equals_open_payments`).

### What the posting rules prevent

| Risk | Prevented by |
|---|---|
| Double debit on retry | HTTP idempotency key, plus one live payment per QR, plus `UNIQUE(txn_id,'AUTH_POST')` |
| Double credit or settlement on duplicate ack | `UNIQUE(txn_id,'SETTLE')`; `apply_rail_outcome` treats a repeat ACCEPTED as a no-op |
| Over-spending under concurrency | `SELECT … FOR UPDATE` on the wallet account row; available = ledger − holds |
| Unauthorised reversal | RBAC (OPS requests, FINANCE approves); DB CHECK maker ≠ checker; one reversal per original |
| Silent correction | Append-only triggers; corrections are new linked journals with reason, actor and approver |
| Wrong settlement report | Reports are computed from ledger entries only; the settlement file is compared, never imported as truth |

## 3. Reconciliation logic (financial layer)

**Input.** The rail's settlement file for a business date. Lines carry `e2e_id`, `rail_ref`, `amount_minor`, `creditor_alias` and `status`. The trailer carries `record_count`, `value_total_minor` and `sha256`.

**Procedure** (`recon.run`):
1. **Control totals (Week 5 batch control):** the record count, value total and SHA-256 must match the trailer. If not, the file is refused (`422`).
2. **Duplicate-file guard:** the file hash is unique, so a second import is refused (`409 DUPLICATE_SETTLEMENT_FILE`).
3. **Internal side:** every payment that reached the rail on or before the business date.
4. **Match by `e2e_id`, then compare amount and status:**
   - MATCHED → RECONCILED (if PENDING or UNDER_REVIEW, the file is the settlement proof, so post SETTLE first).
   - Amount differs → AMOUNT_MISMATCH.
   - Internal REVERSED but external settled → STATUS_MISMATCH.
   - Line appears twice → DUPLICATE_EXTERNAL.
   - Unknown line → MISSING_INTERNAL, plus a CLAIM journal.
   - SETTLED internally but absent from the file → TIMING_DIFFERENCE if settled after the 21:00 cut-off, otherwise MISSING_EXTERNAL.
5. Each break becomes a **case** with owner, SLA (24 h), category and amounts. A later file that matches closes it automatically with resolution `MATCHED_IN_LATER_FILE`.
6. A `recon.completed` event is emitted with counts and match rate (shown in Mission Control).

### Exception taxonomy

| Category | Typical cause | Owner | SLA | Resolution options | Test |
|---|---|---|---|---|---|
| MISSING_EXTERNAL | Rail omitted a line; partial failure at the rail | Ops | 24 h | Wait for the next file (auto-close), or raise with the rail with evidence | `test_s10_*` |
| MISSING_INTERNAL | Rail debited for a payment we never initiated (or lost) | Finance | 24 h | CLAIM posted; investigate; recover from the rail or partner | recon logic |
| DUPLICATE_EXTERNAL | Rail listed the same credit twice | Ops | 24 h | Raise with the rail; no double posting | recon logic |
| AMOUNT_MISMATCH | Amount altered in transit; fee netting error | Finance | 24 h | Adjustment journal **with approval** (roadmap) | recon logic |
| STATUS_MISMATCH | We reversed (rail said reject or unknown) but the rail settled | Finance | 8 h (callback) / 24 h (file) | Claim on the rail or partner; customer already refunded | `apply_rail_outcome` |
| TIMING_DIFFERENCE | Settled after cut-off | none | next file | Matches automatically next day | `test_s10b_*` |

## 4. The full reconciliation stack (Week 9)

| Layer | Compares | Implemented as | Checks |
|---|---|---|---|
| Internal technical | Outbox vs relay vs rail dispatch | `integrity.py` (technical) | `outbox_relay_lag`, `pending_never_sent_to_rail` |
| Operational | Transaction state vs what customer and cashier were told | `integrity.py` (operational) | `settled_without_customer_notice`, `till_paid_without_settlement`, `pending_beyond_review_window` |
| Financial | Ledger vs itself and vs transaction state; ledger vs rail file | `integrity.py` (financial) and `recon.py` | `trial_balance_balanced`, `in_transit_equals_open_payments`, `no_negative_wallets`, `expired_holds_released`, settlement-file recon |
| Exception management | Ageing, owner, SLA | `integrity.py` (exceptions) and `cases` | `cases_within_sla`, `every_case_has_owner` |

`GET /v1/finance/integrity` (Finance, Auditor) runs all four layers and returns PASS, WARN or FAIL with values. `test_integrity_checks_*` proves it passes on a healthy system and fails when a customer was never told about a settled payment.

**Not yet built (stated plainly):** a third source, the sponsor-bank statement against 1010; adjustment journals with approval workflow for AMOUNT_MISMATCH; posting the claim automatically for STATUS_MISMATCH.
