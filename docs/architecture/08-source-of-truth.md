# 08: Source-of-truth rules and data lineage

**Gate:** Week 12, source-of-truth rules.
**Principle P1** (Week 1 template):

| Field | Content |
|---|---|
| **Rule** | The Rupay ledger is the only source of internal financial truth. No UI, notification, customer screenshot or external message is truth until it has been posted, or matched, against the ledger. |
| **Rationale** | A payment can look "successful" before settlement finality (Week 9). Duplicates and timeouts are normal. |
| **Implication** | Screens read state from the server. The rail's claims live in their own schema and enter the ledger only through a governed posting. |
| **Trade-off** | The cashier waits a few seconds for settlement instead of trusting the customer's screen. |
| **Evidence** | `test_s1_*`, `test_s4_*`, the cashier PAID screen appears only at SETTLED. |
| **Owner** | Finance (ledger) with Engineering (posting service). |

## Attribute-level ownership

Week 5: "own attributes, not only tables".

| Business object | Attribute(s) | Authoritative source | Producer / writer | Consumers | Rule when sources disagree |
|---|---|---|---|---|---|
| Customer | identity token, KYC tier, KYC status, risk rating | Customer master (`customers`) | KYC onboarding (roadmap: registry adapter) | Risk engine, wallet screen | Customer master wins; the risk engine reads it at decision time and stores the value in `data_used` |
| Customer | consent per purpose and channel | `consents` | Customer (app) | Notifier, future marketing | Latest record wins; `revoked_at` takes effect immediately |
| Merchant | Raast alias, settlement IBAN (masked), category | Merchant master (`merchants`) | Merchant onboarding | QR payload, fees, reports | Master wins; IBAN change needs dual control (roadmap) |
| Payment request | amount, order ref, expiry, status | `payment_requests` | Cashier (create); system (PAID/EXPIRED) | Customer app, till | The till shows PAID **only** if a SETTLED transaction exists (checked by integrity check `till_paid_without_settlement`) |
| Transaction | status, version | `transactions` + `transaction_status_history` | State machine (`state.py`) only | Every screen, notifier, recon | Server state wins over client state, always. Clients never send a status |
| Money | balances, postings | `journals` + `ledger_entries` | Posting service (`ledger.post`) only | Finance reports, wallet balance | **Ledger wins.** Balances are derived, never stored |
| Funds reservation | available balance | `holds` | Authorisation step | Wallet screen | Available = ledger − active holds |
| External settlement | rail status, rail reference, file lines | Raast (simulated `rail.*`, settlement file) | The rail | Reconciliation | **The rail is authoritative for what it did. The ledger is authoritative for what we recorded.** A disagreement is never silently overwritten; it becomes a reconciliation break with an owner |
| Risk decision | outcome, rules fired, data used | `screening_results` | Rules engine (versioned) | Compliance, auditors | Immutable record; a human decision is a separate case record |
| Human decision | reviewer, reason, outcome | `cases`, `approvals`, `audit_log` | Compliance, Ops, Finance | Auditors | Immutable; reversals happen by new journals, never edits |
| Notifications | message body | `notifications` | Notifier (consumer) | Customer, merchant | **Never a source of truth.** Regenerated from events if lost |

## Conflict rules between ledger and rail (applied by reconciliation)

| Ledger says | Rail says | Category | Owner | Resolution |
|---|---|---|---|---|
| SETTLED, amount X | Settled, amount X | MATCHED | none | Transaction → RECONCILED |
| PENDING / UNDER_REVIEW | Settled in file | MATCHED (file is the settlement proof) | none | Post SETTLE, then RECONCILED |
| SETTLED before cut-off | Missing from today's file | MISSING_EXTERNAL | Ops | Case opened; closes automatically if a later file matches it (`MATCHED_IN_LATER_FILE`) |
| SETTLED after 21:00 cut-off | Missing from today's file | TIMING_DIFFERENCE | none | Expected in the next file |
| Nothing | Settled line we do not know | MISSING_INTERNAL | Finance | Post CLAIM (Dr 1400 claim receivable / Cr 1010) and investigate |
| SETTLED, amount X | Amount Y | AMOUNT_MISMATCH | Finance | Case; adjustment only with approval |
| REVERSED (money returned) | Settled | STATUS_MISMATCH | Finance | Case; claim on the rail or partner |
| One line | Same line twice | DUPLICATE_EXTERNAL | Ops | Case with the rail; no double posting |

## Lineage: from a tap to a finance report

| Step | Evidence row | Links to the next step by |
|---|---|---|
| Customer taps Pay | `idempotency_keys` (request hash, stored response) | `txn_ref` in the stored response |
| Transaction created | `transactions`, `transaction_status_history`, `outbox` | `txn_id`, `correlation_id` |
| Risk decision | `screening_results` | `txn_id` |
| Postings | `journals` (reason, actor, approver, rule version), `ledger_entries` | `journal_id` → `account_id` |
| Rail exchange | `rail.payments` (external), `transactions.rail_e2e_id` | `rail_e2e_id` |
| Notification | `notifications.source_event_id` | `event_id` in the outbox |
| Reconciliation | `recon_runs` (file hash), `recon_items` | `rail_e2e_id`, `txn_id` |
| Finance report | `/v1/finance/trial-balance`, `/v1/finance/integrity` | Aggregates of `ledger_entries` |
| Audit | `audit_log` (hash chain) | `object_id` = `txn_ref`; `correlation_id` |

`GET /v1/transactions/{txn_ref}` returns this whole chain for one payment. Mission Control's inspector shows it.
