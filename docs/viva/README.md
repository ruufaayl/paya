# Viva preparation

The brief (§10): *"Each member must explain design decisions, code ownership, transaction state, failures, controls and trade-offs."*

**Rule:** every member must know the **common core** below, plus their own module in depth. Examiners often ask someone about a part they did not present. Fill in real names and keep this table honest; `git log` and `AI_USE_LOG.md` show who did what.

| Member | Owns (be able to walk through the code) | Pack |
|---|---|---|
| A: **Rufayl Waseem** (24i-5660) | Product, journey, scope, assumptions, ethics; demo lead | [member-a.md](member-a.md) |
| B: **Taha Ali** (24i-5525) | Transaction state machine, idempotency, ledger (`state.py`, `idempotency.py`, `ledger.py`, `payments.py`) | [member-b.md](member-b.md) |
| C: **Harris Safi** (24i-5652) | Reconciliation, data model, integrity checks, AI triage (`recon.py`, `integrity.py`, `ai_*.py`) | [member-c.md](member-c.md) |
| D: **Kanz ur Rehman** (24i-5544) | Security, RBAC, SoD, KYC/AML rules, audit chain, threat model (`security.py`, `risk.py`, `audit.py`) | [member-d.md](member-d.md) |
| E: **Mudaser Waleed** (24i-5681) | Rail and resilience, events, observability, Mission Control, PWA (`rail.py`, `events.py`, `worker.py`, `observability.py`, `web/`) | [member-e.md](member-e.md) |
| F: **Ateeq Riaz** (roll no. to add) | Operations and bank transfers: send to any bank account, simulated title fetch, transfer screening and recovery (`banks.py`, `web/src/wallet/SendMoney.tsx`, ADR-018) | [member-f.md](member-f.md) |

## Common core: everyone, from memory

### 1. Trace one payment (2 minutes)

1. The cashier creates a payment request, i.e. a QR (`POST /v1/payment-requests`).
2. The customer pays (`POST /v1/payments`) with an **Idempotency-Key** and a correlation ID.
3. **In one database transaction:**
   - lock the payment request; refuse if a live payment already exists;
   - CREATED;
   - risk rules → VALIDATED, or HOLD / REJECT;
   - lock the wallet row; available = ledger − holds; place a hold → AUTHORISED;
   - journal **AUTH_POST**: Dr 2100 customer wallet / Cr 2150 payments in transit → POSTED;
   - assign an E2E id → PENDING.
   - Each step writes status history and an outbox event.
4. The response is **202**, "Sent – awaiting confirmation". It is never "Paid" at this point.
5. Send to the rail. **ACCEPTED** → journal **SETTLE** (Dr 2150 / Cr 1010 settlement account) plus **FEE** (Dr 1300 / Cr 4100) → SETTLED. The till shows PAID.
6. Next day, Finance imports the settlement file: check the control totals, refuse a duplicate file, match by E2E id → RECONCILED, or a break case with an owner.

### 2. Ten numbers to know

| Fact | Value | Source |
|---|---|---|
| Automated tests | 159, all passing as the data-only app role (CI green) | `evidence/tests/`, GitHub Actions |
| Crash recovery | healthy 1.3 s; in-flight payments settled exactly once in 6.0 s | `evidence/resilience/` |
| DB restart | API back in 0.7 s | same |
| Load test | 400 payments, 0 duplicate settlements; p95 792 ms at 10 concurrent; ~16 payments/s per process | `evidence/performance/` |
| Service time | ~70 ms per payment (p95 96 ms at c=1); 60 ms before the session check (ADR-017) | same |
| AI | 94.1% accuracy on acted cases; 0% unsafe autonomy; 20/20 injection safe | `evidence/ai/evaluation.md` |
| Fee | 0.50% synthetic merchant discount rate (PKR 2,450 → 12.25) | `config.py` |
| Abstain threshold | confidence < 0.75; amount > PKR 100,000; missing evidence; compliance link | `ai_triage.py` |
| Timeout handling | 8 s call timeout; enquiries 5 s / 15 s / 45 s / 2 min / 5 min; escalate at 15 min | `config.py` |
| Integrity checks | 12 across 4 layers | `integrity.py` |

### 3. Ten questions every member must answer

1. **Why is the response 202 and not 200?** The customer has been debited, but Raast has not confirmed. Showing "Paid" before settlement is the Week 9 mistake.
2. **What prevents a double debit if the customer taps twice?**
   - Same key: the stored response is replayed.
   - New key: the partial unique index allows one live payment per QR.
   - Retry inside the system: `UNIQUE(txn_id, posting_type)`.
   - Concurrent spends: the wallet row lock.
3. **What happens on a rail timeout?** The payment stays PENDING. We *ask* the rail and never blind-resend. We resend only after NOT_FOUND, with the **same** E2E id. After 15 min a human owns it, and any reversal is maker-checker.
4. **Why does money go through 2150 (in transit)?** It makes uncertainty visible. Its balance must equal the payments still awaiting the rail, and that is an integrity check.
5. **How do you correct a mistake in the ledger?** Never by editing; triggers block UPDATE and DELETE. A new reversing or adjusting journal with a reason and an approver.
6. **Who can reverse a payment?** Ops *requests*, Finance *approves*, and they must be different people (application and DB CHECK). The refused self-approval is still audited.
7. **What is the source of truth for "paid"?** The ledger plus transaction state. Notifications and screens are consumers. Raast is truth for what *it* did; reconciliation compares the two.
8. **What did load testing find?** A race between the background dispatch and the worker. The DB constraint prevented double posting, but an error dropped connections. Fixed with row locks and an atomic claim; regression test added.
9. **Can the AI move money?** No. Its modules import no posting, reversal or approval functions (a test reads the source), it writes only `ai_suggestions`, and only the case owner accepts or overrides.
10. **What would you do before a real pilot?** Partner sandbox; merchant interviews (assumption A1); evaluate any LLM on the same dataset. (Separate DB roles, rate limiting, and MFA with token revocation were conditions and are now done: ADR-015 to 017.)
