# 14: Operational runbooks

Week 9: runbooks define who does what during an outage, a duplicate spike or a settlement delay. Each runbook has a trigger, an owner and steps. Every step uses a real endpoint or command from this repository.

---

## RB-1: Raast rail outage (circuit breaker open)

**Trigger:** `paya_rail_breaker_open == 1`, Mission Control shows *Rail: OPEN*, or customers receive `503 RAIL_UNAVAILABLE`.
**Owner:** Ops on duty. **Escalate to:** partner EMI operations contact.

1. Confirm the scope: `GET /v1/metrics/summary` shows `rail.breaker` and the number of pending payments.
2. **Do nothing to pending payments yet.** They are safe: the debit is in *payments in transit* and the worker keeps asking the rail.
3. Tell merchants (template): "Raast is temporarily unavailable. No customer has been charged for refused payments. Please accept another method."
4. When the rail recovers, the breaker half-opens after 30 s and closes on the first success. Run `POST /v1/ops/transactions/ALL/enquiry` to resolve pending payments at once.
5. If any payment is still uncertain after 15 min, it becomes `UNDER_REVIEW` with a `PENDING_REVIEW` case. Follow RB-2.
6. After the incident, run the integrity checks (`GET /v1/finance/integrity`) and attach the result to the incident note.

## RB-2: Stuck or uncertain payments

**Trigger:** `PENDING_REVIEW` case, or the integrity check `pending_beyond_review_window` > 0.
**Owner:** Ops (maker); Finance (checker).

1. Open the transaction (Mission Control inspector or `GET /v1/transactions/{ref}`). Check `rail_e2e_id`, the attempt count and the last enquiry answer.
2. Ask the rail operator for the status of that **E2E id**. **Never resend with a new id.**
3. The rail confirms it settled → wait for the next enquiry or file, which settles it automatically.
4. The rail confirms it never received it, or rejected it → Ops raises `POST /v1/ops/transactions/{ref}/reversal-requests` with the rail's reference in the reason.
5. Finance, a different person, approves: `POST /v1/finance/approvals/{id}/approve`. The money returns to the wallet through a REVERSAL journal.
6. The customer is notified automatically (`payment.reversed`).

## RB-3: Worker or outbox relay stalled

**Trigger:** `paya_outbox_unpublished` > 0 for 2 min, or the integrity check `outbox_relay_lag` / `pending_never_sent_to_rail` FAIL.
**Owner:** Engineering on call.

1. Check the logs: `docker logs paya-api-1 | grep '"level":"error"'`. Look for `worker.error`.
2. Restart the API: `docker restart paya-api-1`. This is safe because all work is idempotent and resumes from the database (drill D1: healthy in 1.3 s).
3. Confirm `paya_outbox_unpublished` returns to 0 and the integrity checks PASS.

## RB-4: Ledger integrity breach (P1)

**Trigger:** integrity check `trial_balance_balanced`, `in_transit_equals_open_payments` or `no_negative_wallets` returns FAIL, or `GET /v1/audit/verify` returns `chain_intact: false`.
**Owner:** Head of Finance and Engineering lead together.

1. **Stop new payments.** Set the rail to an outage state (demo: Mission Control *Outage*; production: a gateway kill switch).
2. Preserve evidence: `docker exec paya-db-1 pg_dump -U paya -Fc paya > incident-<time>.dump`.
3. Identify the first broken item. `audit/verify` returns `first_broken_row`; the integrity values show which accounts disagree.
4. **Never edit rows.** Corrections are new ADJUSTMENT journals with an approver, after root cause is known.
5. Write a post-incident review: timeline (from correlation IDs), cause, control that failed, control added.

## RB-5: Reconciliation breaks

**Trigger:** `recon.completed` with match rate below 100%, or the integrity check `cases_within_sla` WARN.
**Owner:** by category (see `09-ledger-and-reconciliation.md`). MISSING_EXTERNAL and DUPLICATE_EXTERNAL go to Ops; the money categories go to Finance.

1. `GET /v1/cases` (filter `RECON_BREAK`). Read the category, internal amount and external amount.
2. MISSING_EXTERNAL: wait for the next file (auto-closes as `MATCHED_IN_LATER_FILE`). If it is still missing at D+2, raise with the rail and attach `rail_e2e_id` and our SETTLE journal.
3. MISSING_INTERNAL: a CLAIM journal is already posted (Dr 1400 / Cr 1010). Investigate the origin with the rail. Close with recovery evidence.
4. STATUS_MISMATCH: the customer was refunded but the rail paid the merchant. Raise a claim with the partner. Never re-debit the customer without consent.
5. Never re-import a file to "fix" it; the system refuses duplicates (`409`).

## RB-6: Suspicious access or brute force

**Trigger:** repeated `security.login_locked` or `security.access_denied` events.
**Owner:** Security (with Compliance).

1. `GET /v1/audit/verify` (chain intact?). Then review the `audit_log` rows for the actor, filtered by `outcome = DENIED`.
2. If a staff account may be compromised: set `users.active = false` (admin task) and rotate `PAYA_JWT_SECRET` to invalidate every token.
3. Review all actions by that user since the first suspicious event (journals `actor` / `approved_by`, cases `resolved_by`).
4. Record the incident and the controls changed.

## RB-7: Restore from backup (database lost)

**Trigger:** database volume lost or corrupted.
**Owner:** Engineering, with Finance verifying.

1. Provision PostgreSQL 16 and create database `paya`.
2. `pg_restore -U paya -d paya <latest dump>` (drill D3: 0.6 s for 3.1 MB).
3. Start the API. It recreates the integrity triggers if any are missing (`create_schema` is idempotent).
4. Finance compares account balances with the last known trial balance. Expected loss = transactions after the dump (RPO ≤ 24 h in the prototype).
5. Reconcile with the rail files for the gap period; MISSING_INTERNAL items reveal postings lost after the dump.
