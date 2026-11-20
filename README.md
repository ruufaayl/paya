# Paya

**Payment pakka hai.** Paya is a Raast person-to-merchant (P2M) payment assurance platform. When a customer pays a shop by scanning a QR code, the cashier sees **PAID** only once the money has actually moved and been recorded in a double-entry ledger. Customer screens, screenshots and notifications are never treated as proof of payment.

> **Academic prototype – CS3017 Enterprise Systems & Applications, Fall 2026.**
> All people, merchants, aliases and IBANs are synthetic. **No real money moves.** The Raast rail is a local simulator. Paya does not claim to describe the internal systems of SBP, any bank, EMI or PSP. Its architecture is a *proposed reference architecture*.

## The problem

Pakistani merchants increasingly take Raast QR payments, but a cashier usually confirms a payment by looking at the customer's phone screen or an SMS. Settlement credits then arrive with no link back to orders, and reconciliation is done by hand. Paya makes the **ledger the only source of payment truth**, reconciles it against the rail's settlement file, and puts every exception into a queue with a named owner.

## Architecture in one picture

```
Wallet / Cashier / Back office  ──►  API gateway façade (auth, idempotency, correlation ID)
                                          │
                                   Transaction state machine ──► KYC/AML/fraud rules
                                          │
                              Double-entry ledger (PostgreSQL, append-only, balanced)
                                          │
                     Transactional outbox ──► consumers (notifications, live stream)
                                          │
                               RailPort ──► Mock Raast rail (separate schema, chaos modes)
                                          │
                     Reconciliation (settlement file vs ledger) ──► owned exception cases
```

Lifecycle: `CREATED → VALIDATED → AUTHORISED → POSTED → PENDING → SETTLED → RECONCILED`, with `UNDER_REVIEW` (holds and uncertainty) and `REVERSED` (compensating journal). See `src/paya/state.py`.

## Run it

**Option A: one command (Docker).**
```bash
cp .env.example .env   # then set PAYA_JWT_SECRET to 32+ random characters
make up                # Postgres + API on http://localhost:8000  (docs at /docs)
```

**Option B: local Python.** Needs PostgreSQL. Set `PAYA_DATABASE_URL` to point at it.
```bash
make setup && make run
```

Demo logins all use the password `paya-demo-2026` (synthetic, demo mode only):

| User | Role |
|---|---|
| `sara`, `omar` | Customers (verified) |
| `zarak` | Customer who triggers the synthetic watch-list hold |
| `hina` | Customer who is not KYC-verified |
| `ayesha.cashier`, `bilal.admin` | Chai Junction cashier / merchant admin |
| `sana.ops`, `faisal.ops` | Operations (request reversals, status enquiries) |
| `hamza.compliance` | Compliance (release or reject holds) |
| `rabia.finance` | Finance (approve reversals, run reconciliation) |
| `admin` | System administrator (chaos controls only, no financial actions) |
| `auditor` | Read-only, verifies the audit hash chain |

## Test

```bash
make test
```

The suite covers the 10 scenarios the brief requires plus 3 from the Week 9 lecture:

| # | Scenario | Test |
|---|---|---|
| S1 | Normal success → settled → reconciled | `test_s1_*` |
| S2 | Client retry with the same idempotency key → no double debit | `test_s2_*` |
| S3 | Duplicate rail ack and duplicate event → single effect | `test_s3_*` |
| S4 | Downstream timeout → PENDING → status enquiry (no blind replay) | `test_s4_*` |
| S5 | Partial failure: debited, rail rejects → compensating reversal | `test_s5_*` |
| S6 | Reversal with maker-checker (OPS requests, FINANCE approves) | `test_s6_*` |
| S7 | KYC/AML hold without moving money; compliance release | `test_s7_*` |
| S8 | Unauthorised role → denied and written to a tamper-evident log | `test_s8_*` |
| S9 | Restart mid-flight → worker resumes, truth preserved | `test_s9_*` |
| S10 | Reconciliation break → owned exception case | `test_s10_*` |
| S11 | Week 9 workshop: retry with a *new* key blocked by business idempotency | `test_s11_*` |
| S12 | Rail outage → circuit breaker refuses before taking money | `test_s12_*` |
| S13 | Same settlement file imported twice → refused | `test_s13_*` |

## Repository map

| Path | Contents |
|---|---|
| `src/paya` | Ledger, state machine, payments, risk, rail, recon, events, security, API |
| `tests` | Automated normal and failure scenarios |
| `api` | `openapi.json` (sync contract) and `events/*.schema.json` (async contract) |
| `docs/architecture` | ADRs, C4, BPMN, sequence diagrams, ERD, threat model |
| `data` | Synthetic seed data only |
| `infra` | Dockerfile and Compose |
| `evidence` | Test results, screenshots, recon output |
| `AI_USE_LOG.md` | How generative AI was used, and how its output was verified |

## Integrity guarantees enforced by the database

- Journals must balance (a deferred constraint trigger), and amounts are positive integer paisa.
- `ledger_entries`, `journals`, `audit_log` and `transaction_status_history` are append-only. Triggers reject `UPDATE` and `DELETE`.
- `UNIQUE(txn_id, posting_type)` means a posting can never be repeated.
- A partial unique index allows only one live payment per payment request (business idempotency).
- A maker cannot be the checker on the same approval (`CHECK approved_by <> requested_by`).
- Each audit-log row stores the hash of the previous row (`GET /v1/audit/verify`).
