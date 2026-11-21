"""The ten scenarios required by the project brief (S1-S10) plus three from the Week 9 lecture (S11-S13).

Each test states the evidence it proves. Amounts are integer paisa (PKR 2,450.00 = 245000).
"""
import uuid

import pytest
from sqlalchemy import func, select, text

from paya import events, ledger, payments, worker
from paya.db import reset_engine, session_scope
from paya.models import AuditLog, Case, Journal, Notification, Transaction
from paya.rail import RailPayment, breaker, chaos

from conftest import detail, new_request, pay, wallet_minor


def journals(ref: str) -> list[str]:
    with session_scope() as s:
        t = s.execute(select(Transaction).where(Transaction.txn_ref == ref)).scalar_one()
        ids = [t.id] + list(s.execute(select(Transaction.id).where(Transaction.original_txn_id == t.id)).scalars())
        return sorted(s.execute(select(Journal.posting_type).where(Journal.txn_id.in_(ids))).scalars())


def status(ref: str) -> str:
    with session_scope() as s:
        return s.execute(select(Transaction.status).where(Transaction.txn_ref == ref)).scalar_one()


def assert_ledger_invariants():
    with session_scope() as s:
        tb = ledger.trial_balance(s)
        assert tb["balanced"], tb
        in_transit = ledger.ledger_balance(s, ledger.house_account(s, "2150"))
        expected = s.execute(select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
            Transaction.type == "PAYMENT", Transaction.status.in_(["PENDING", "UNDER_REVIEW"]),
            Transaction.rail_e2e_id.is_not(None))).scalar_one()
        assert in_transit == expected, (in_transit, expected)


# ---------------------------------------------------------------- S1 normal success
def test_s1_normal_success_end_to_end(client, as_):
    before = wallet_minor(client, as_)
    pr = new_request(client, as_, 245_000)
    r = pay(client, as_, pr)
    assert r.status_code == 202 and r.json()["status"] == "PENDING"
    ref = r.json()["txn_ref"]
    assert status(ref) == "SETTLED"                       # rail acknowledged in the background dispatch
    assert wallet_minor(client, as_) == before - 245_000
    assert journals(ref) == ["AUTH_POST", "FEE", "SETTLE"]

    run = client.post("/v1/finance/recon/run", headers=as_("rabia.finance"), json={}).json()
    assert run["MATCHED"] >= 1
    d = detail(client, as_, ref)
    assert d["status"] == "RECONCILED" and d["display_status"] == "Paid"
    assert [h["to"] for h in d["timeline"]] == ["VALIDATED", "AUTHORISED", "POSTED", "PENDING", "SETTLED", "RECONCILED"]
    cashier_view = client.get("/v1/merchant/transactions", headers=as_("ayesha.cashier")).json()
    assert cashier_view[0]["paid"] is True
    assert_ledger_invariants()


# ---------------------------------------------------------------- S2 client retry after timeout
def test_s2_same_idempotency_key_returns_prior_result_without_double_debit(client, as_):
    before = wallet_minor(client, as_)
    pr = new_request(client, as_, 100_000)
    key = "retry-" + uuid.uuid4().hex
    first = pay(client, as_, pr, key=key)
    second = pay(client, as_, pr, key=key)               # client never saw the first response and retries
    assert second.status_code == first.status_code
    assert second.json()["txn_ref"] == first.json()["txn_ref"]
    assert second.headers["Idempotent-Replayed"] == "true"
    assert wallet_minor(client, as_) == before - 100_000  # exactly one debit

    # same key, different body -> refused
    other = new_request(client, as_, 5_000)
    r = pay(client, as_, other, key=key)
    assert r.status_code == 422 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


# ---------------------------------------------------------------- S3 duplicate event / message
def test_s3_duplicate_ack_and_duplicate_event_have_no_second_effect(client, as_):
    chaos.queue("DUPLICATE_ACK")
    ref = pay(client, as_, new_request(client, as_, 50_000)).json()["txn_ref"]
    assert status(ref) == "SETTLED"
    assert payments.process_rail_callbacks() == 2          # both callbacks consumed ...
    assert journals(ref) == ["AUTH_POST", "FEE", "SETTLE"]  # ... but settlement posted once

    with session_scope() as s:  # redeliver the settled event: the notification consumer must ignore it
        from paya.models import OutboxEvent
        ev = s.execute(select(OutboxEvent).where(OutboxEvent.event_type == "payment.settled",
                                                 OutboxEvent.payload["txn_ref"].astext == ref)).scalar_one()
        env = events.envelope(ev)
    events._deliver(env)
    events._deliver(env)
    with session_scope() as s:
        n = s.execute(select(func.count()).select_from(Notification).where(
            Notification.template == "payment.settled", Notification.recipient == "CUSTOMER",
            Notification.source_event_id == env["event_id"])).scalar_one()
    assert n == 1


# ---------------------------------------------------------------- S4 downstream timeout
def test_s4_timeout_goes_pending_then_status_enquiry_resolves_without_blind_replay(client, as_):
    chaos.queue("TIMEOUT_AFTER_ACCEPT")                    # rail processed it but our call timed out
    ref = pay(client, as_, new_request(client, as_, 80_000)).json()["txn_ref"]
    assert status(ref) == "PENDING"
    assert detail(client, as_, ref, who="sara")["display_status"] == "Sent - awaiting confirmation"
    stats = payments.run_status_enquiries(force=True)
    assert stats["settled"] == 1 and status(ref) == "SETTLED"

    chaos.queue("TIMEOUT_NO_RECORD")                       # rail never received it
    ref2 = pay(client, as_, new_request(client, as_, 30_000)).json()["txn_ref"]
    assert status(ref2) == "PENDING"
    payments.run_status_enquiries(force=True)               # NOT_FOUND -> resend SAME e2e id
    assert status(ref2) == "SETTLED"
    with session_scope() as s:
        e2e = s.execute(select(Transaction.rail_e2e_id).where(Transaction.txn_ref == ref2)).scalar_one()
        assert s.execute(select(func.count()).select_from(RailPayment).where(RailPayment.e2e_id == e2e)).scalar_one() == 1
    assert_ledger_invariants()


# ---------------------------------------------------------------- S5 partial failure
def test_s5_customer_debited_then_rail_rejects_compensating_reversal(client, as_):
    before = wallet_minor(client, as_)
    chaos.queue("REJECT")
    ref = pay(client, as_, new_request(client, as_, 99_900)).json()["txn_ref"]
    d = detail(client, as_, ref)
    assert d["status"] == "REVERSED" and d["display_status"] == "Returned to wallet"
    assert journals(ref) == ["AUTH_POST", "REVERSAL"]     # debit kept as evidence, reversed by a new journal
    assert d["related"][0]["type"] == "REVERSAL"
    assert wallet_minor(client, as_) == before
    assert_ledger_invariants()


# ---------------------------------------------------------------- S6 reversal with maker-checker
def test_s6_ops_requests_finance_approves_reversal_with_linked_reference(client, as_):
    chaos.set_mode("TIMEOUT_NO_RECORD")
    before = wallet_minor(client, as_)
    ref = pay(client, as_, new_request(client, as_, 40_000)).json()["txn_ref"]
    chaos.set_mode("DOWN")                                 # rail stays unreachable: a human must decide
    r = client.post(f"/v1/ops/transactions/{ref}/reversal-requests", headers=as_("sana.ops"),
                    json={"reason": "Rail down 20 min, customer waiting at counter"})
    assert r.status_code == 201
    approval = r.json()["approval_id"]
    # OPS cannot approve (RBAC), and FINANCE is a different person (SoD)
    assert client.post(f"/v1/finance/approvals/{approval}/approve", headers=as_("faisal.ops")).status_code == 403
    r = client.post(f"/v1/finance/approvals/{approval}/approve", headers=as_("rabia.finance"))
    assert r.status_code == 200 and r.json()["status"] == "REVERSED"
    d = detail(client, as_, ref)
    rev = [j for j in d["ledger"] if j["posting_type"] == "REVERSAL"][0]
    assert rev["approved_by"] == "rabia.finance" and rev["initiated_via"] == "MANUAL_APPROVED"
    assert d["approvals"][0]["maker"] == "sana.ops" and d["approvals"][0]["checker"] == "rabia.finance"
    assert wallet_minor(client, as_) == before
    chaos.reset()


def test_s6c_self_approval_is_refused_and_the_denial_is_kept_in_the_audit_chain(client, as_):
    from paya.errors import SegregationOfDuties
    chaos.set_mode("TIMEOUT_NO_RECORD")
    ref = pay(client, as_, new_request(client, as_, 20_000)).json()["txn_ref"]
    a = payments.request_reversal(txn_ref=ref, actor="sana.ops", actor_role="OPS", reason="test")
    with pytest.raises(SegregationOfDuties):
        payments.approve_reversal(approval_id=a.id, actor="sana.ops", actor_role="FINANCE")  # same person
    with session_scope() as s:
        denied = s.execute(select(AuditLog).where(AuditLog.action == "REVERSAL_APPROVE",
                                                  AuditLog.outcome == "DENIED")).scalars().all()
    assert len(denied) == 1 and denied[0].actor == "sana.ops"
    assert status(ref) == "PENDING"
    chaos.reset()


def test_s6b_database_refuses_maker_as_checker(client, as_):
    from paya.models import Approval
    with pytest.raises(Exception):
        with session_scope() as s:
            t = s.execute(select(Transaction).limit(1)).scalar_one()
            s.add(Approval(action="REVERSAL", txn_id=t.id, requested_by="x", approved_by="x", reason="r"))


# ---------------------------------------------------------------- S7 KYC / AML / fraud hold
def test_s7_watchlist_hold_blocks_without_moving_money_then_compliance_releases(client, as_):
    before = wallet_minor(client, as_, "zarak")
    ref = pay(client, as_, new_request(client, as_, 60_000), customer="zarak").json()["txn_ref"]
    d = detail(client, as_, ref)
    assert d["status"] == "UNDER_REVIEW"
    assert d["screening"][0]["outcome"] == "HOLD"
    assert d["screening"][0]["rules_fired"][0]["rule"] == "WATCHLIST_MATCH"
    assert d["cases"][0]["kind"] == "COMPLIANCE_HOLD" and d["cases"][0]["owner_role"] == "COMPLIANCE"
    assert journals(ref) == [] and wallet_minor(client, as_, "zarak") == before  # no money moved, evidence kept

    # Ops cannot release a compliance hold
    assert client.post(f"/v1/compliance/holds/{ref}/decision", headers=as_("sana.ops"),
                       json={"decision": "RELEASE", "reason": "looks fine"}).status_code == 403
    r = client.post(f"/v1/compliance/holds/{ref}/decision", headers=as_("hamza.compliance"),
                    json={"decision": "RELEASE", "reason": "False positive: different DOB and city on file"})
    assert r.status_code == 200
    assert status(ref) == "SETTLED"
    assert detail(client, as_, ref)["cases"][0]["resolution"] == "RELEASE"


def test_s7b_unverified_customer_is_rejected(client, as_):
    r = pay(client, as_, new_request(client, as_, 1_000), customer="hina")
    assert r.json()["status"] == "REJECTED" and r.json()["failure_reason"] == "KYC_NOT_VERIFIED"


# ---------------------------------------------------------------- S8 unauthorised role attempt
def test_s8_unauthorised_attempts_are_denied_and_logged(client, as_):
    r = client.post("/v1/finance/recon/run", headers=as_("ayesha.cashier"), json={})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    ref = pay(client, as_, new_request(client, as_, 1_000)).json()["txn_ref"]
    assert client.get(f"/v1/transactions/{ref}", headers=as_("omar")).status_code == 404  # no cross-customer leak
    with session_scope() as s:
        denied = s.execute(select(AuditLog).where(AuditLog.outcome == "DENIED", AuditLog.actor == "ayesha.cashier")).scalars().all()
    assert denied and denied[0].action == "recon:run"
    v = client.get("/v1/audit/verify", headers=as_("auditor")).json()
    assert v["chain_intact"] is True


# ---------------------------------------------------------------- S9 service restart
def test_s9_restart_preserves_truth_and_worker_resumes_unfinished_work(client, as_):
    pr = new_request(client, as_, 70_000)
    with session_scope() as s:
        cust = s.execute(text("select customer_id from users where username='sara'")).scalar_one()
    # Crash between commit and rail call: initiate directly, never dispatch.
    txn = payments.initiate_payment(customer_id=cust, payment_request_id=uuid.UUID(pr), actor="sara",
                                    correlation_id="corr-restart-test")
    assert status(txn.txn_ref) == "PENDING"
    reset_engine()                                         # "restart": drop every pooled connection
    out = worker.tick()
    assert out["dispatched"] == 1
    assert status(txn.txn_ref) == "SETTLED"
    assert journals(txn.txn_ref) == ["AUTH_POST", "FEE", "SETTLE"]


# ---------------------------------------------------------------- S10 reconciliation break
def test_s10_recon_break_lands_in_exception_queue_with_owner(client, as_, settings, monkeypatch):
    monkeypatch.setattr(settings, "settlement_cutoff_utc_hour", 24)  # settled before cut-off: must be in today's file
    chaos.queue("PARTIAL")                                 # accepted at the rail, missing from its file
    ref = pay(client, as_, new_request(client, as_, 33_000)).json()["txn_ref"]
    ok = pay(client, as_, new_request(client, as_, 12_000)).json()["txn_ref"]
    run = client.post("/v1/finance/recon/run", headers=as_("rabia.finance"), json={}).json()
    assert run["MATCHED"] == 1 and run["MISSING_EXTERNAL"] == 1
    cases = client.get("/v1/cases", headers=as_("sana.ops")).json()
    brk = [c for c in cases if c["kind"] == "RECON_BREAK" and c["txn_ref"] == ref]
    assert brk and brk[0]["state"] == "OPEN" and brk[0]["owner_role"] in ("OPS", "FINANCE")
    assert status(ok) == "RECONCILED" and status(ref) == "SETTLED"


def test_s10b_settled_after_cutoff_is_a_timing_difference_not_a_break(client, as_, settings, monkeypatch):
    monkeypatch.setattr(settings, "settlement_cutoff_utc_hour", 0)
    chaos.queue("LATE_SETTLE")
    ref = pay(client, as_, new_request(client, as_, 21_000)).json()["txn_ref"]
    run = client.post("/v1/finance/recon/run", headers=as_("rabia.finance"), json={}).json()
    assert run["TIMING_DIFFERENCE"] == 1
    assert not [c for c in client.get("/v1/cases", headers=as_("sana.ops")).json() if c["txn_ref"] == ref]


# ---------------------------------------------------------------- S11 Week 9 workshop (PKR 6,800, retry with NEW key)
def test_s11_retry_with_new_key_is_blocked_by_business_idempotency(client, as_):
    before = wallet_minor(client, as_)
    pr = new_request(client, as_, 680_000)
    chaos.queue("TIMEOUT_AFTER_ACCEPT")
    first = pay(client, as_, pr, key="tap-1-" + uuid.uuid4().hex)
    assert first.json()["status"] == "PENDING"
    second = pay(client, as_, pr, key="tap-2-" + uuid.uuid4().hex)  # fresh app session, new key
    assert second.status_code == 409 and second.json()["error"]["code"] == "PAYMENT_ALREADY_IN_PROGRESS"
    payments.run_status_enquiries(force=True)
    assert status(first.json()["txn_ref"]) == "SETTLED"
    assert wallet_minor(client, as_) == before - 680_000


# ---------------------------------------------------------------- S12 gateway outage + circuit breaker
def test_s12_circuit_breaker_refuses_new_payments_before_taking_money(client, as_):
    chaos.set_mode("DOWN")
    for _ in range(3):
        pay(client, as_, new_request(client, as_, 1_000))
    assert breaker.state == "OPEN"
    before = wallet_minor(client, as_)
    r = pay(client, as_, new_request(client, as_, 1_000))
    assert r.status_code == 503 and r.json()["error"]["code"] == "RAIL_UNAVAILABLE"
    assert wallet_minor(client, as_) == before
    chaos.reset(); breaker.reset()
    payments.run_status_enquiries(force=True)            # recovery: stuck payments resend and settle
    with session_scope() as s:
        assert s.execute(select(func.count()).select_from(Transaction).where(Transaction.status == "PENDING")).scalar_one() == 0
    assert_ledger_invariants()


# ---------------------------------------------------------------- S13 duplicate settlement file
def test_s13_same_settlement_file_twice_is_refused(client, as_):
    pay(client, as_, new_request(client, as_, 5_000))
    assert client.post("/v1/finance/recon/run", headers=as_("rabia.finance"), json={}).status_code == 200
    r = client.post("/v1/finance/recon/run", headers=as_("rabia.finance"), json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "DUPLICATE_SETTLEMENT_FILE"


# ---------------------------------------------------------------- ledger guards enforced by PostgreSQL
def test_ledger_is_append_only_and_unbalanced_journals_are_refused(client, as_):
    pay(client, as_, new_request(client, as_, 5_000))
    with pytest.raises(Exception, match="permission denied"):          # the app role: refused by privilege
        with session_scope() as s:
            s.execute(text("UPDATE ledger_entries SET amount_minor = 1"))
    from sqlalchemy import create_engine
    from paya.migrate import owner_url
    with pytest.raises(Exception, match="APPEND_ONLY"):                # even the owner: refused by the trigger
        with create_engine(owner_url()).begin() as c:
            c.execute(text("UPDATE ledger_entries SET amount_minor = 1"))
    with pytest.raises(Exception, match="LEDGER_UNBALANCED"):
        with session_scope() as s:
            t = s.execute(select(Transaction).limit(1)).scalar_one()
            j = Journal(txn_id=t.id, posting_type="ADJUSTMENT", booking_date=t.created_at.date(),
                        value_date=t.created_at.date(), reason_code="TEST", initiated_via="API", actor="t",
                        rule_version="v", correlation_id="c")
            s.add(j); s.flush()
            s.execute(text("INSERT INTO ledger_entries (journal_id, account_id, direction, amount_minor, created_at) "
                           "SELECT :j, id, 'D', 100, now() FROM accounts LIMIT 1"), {"j": j.id})


# ---------------------------------------------------------------- Week 2 conformance check on the event log
def test_conformance_no_settlement_without_authorisation_and_posting(client, as_):
    """Replays the event log (case=txn, activity=to_status) and checks the designed order is never violated."""
    pay(client, as_, new_request(client, as_, 10_000))
    chaos.queue("TIMEOUT_AFTER_ACCEPT")
    pay(client, as_, new_request(client, as_, 11_000))
    payments.run_status_enquiries(force=True)
    pay(client, as_, new_request(client, as_, 12_000), customer="zarak")
    client.post("/v1/compliance/holds/" + detail_ref_of_open_hold() + "/decision", headers=as_("hamza.compliance"),
                json={"decision": "RELEASE", "reason": "False positive after review"})
    with session_scope() as s:
        rows = s.execute(text("SELECT txn_id, to_status FROM transaction_status_history ORDER BY id")).all()
    traces: dict = {}
    for tid, to in rows:
        traces.setdefault(tid, []).append(to)
    settled = [t for t in traces.values() if "SETTLED" in t]
    assert len(settled) == 3
    for t in settled:
        i = t.index("SETTLED")
        assert "AUTHORISED" in t[:i] and "POSTED" in t[:i] and "PENDING" in t[:i], t


def detail_ref_of_open_hold() -> str:
    with session_scope() as s:
        return s.execute(select(Transaction.txn_ref).join(Case, Case.txn_id == Transaction.id)
                         .where(Case.kind == "COMPLIANCE_HOLD", Case.state == "OPEN")).scalar_one()


# ---------------------------------------------------------------- Week 9 reconciliation stack (integrity checks)
def test_integrity_checks_pass_on_healthy_system_and_catch_a_silent_customer(client, as_):
    ref = pay(client, as_, new_request(client, as_, 15_000)).json()["txn_ref"]
    events.relay_once()
    r = client.get("/v1/finance/integrity", headers=as_("rabia.finance")).json()
    assert r["overall"] == "PASS", [c for c in r["checks"] if c["status"] != "PASS"]
    assert {c["layer"] for c in r["checks"]} == {"technical", "operational", "financial", "exceptions"}

    # Simulate an operational break: the notification was lost and 60 s have passed.
    with session_scope() as s:
        s.execute(text("DELETE FROM notifications"))
        s.execute(text("UPDATE transactions SET updated_at = now() - interval '60 seconds' WHERE txn_ref = :r"), {"r": ref})
    r = client.get("/v1/finance/integrity", headers=as_("rabia.finance")).json()
    failed = {c["check"]: c for c in r["checks"] if c["status"] == "FAIL"}
    assert r["overall"] == "FAIL" and failed["settled_without_customer_notice"]["value"] == 1
    assert client.get("/v1/finance/integrity", headers=as_("ayesha.cashier")).status_code == 403


# ---------------------------------------------------------------- concurrency regression (found by the load test)
def test_concurrent_dispatch_callbacks_and_enquiries_settle_exactly_once(client, as_):
    from concurrent.futures import ThreadPoolExecutor
    chaos.set_mode("DUPLICATE_ACK")
    with session_scope() as s:
        cust = s.execute(text("select customer_id from users where username='sara'")).scalar_one()
    txns = [payments.initiate_payment(customer_id=cust, payment_request_id=uuid.UUID(new_request(client, as_, 2_000 + i)),
                                      actor="sara", correlation_id=f"corr-race-{i}") for i in range(4)]
    jobs = []
    for t in txns:  # the API background task, the worker and repeat calls all race for the same payment
        jobs += [lambda t=t: payments.dispatch(t.id), lambda t=t: payments.dispatch(t.id, only_first_send=True),
                 lambda t=t: payments.dispatch(t.id), lambda: worker.dispatch_undispatched(),
                 lambda: payments.process_rail_callbacks(), lambda: payments.run_status_enquiries(force=True)]
    with ThreadPoolExecutor(12) as ex:
        results = [f.result() for f in [ex.submit(j) for j in jobs]]   # .result() re-raises any exception
    payments.process_rail_callbacks()
    chaos.reset()
    for t in txns:
        assert status(t.txn_ref) == "SETTLED"
        assert journals(t.txn_ref) == ["AUTH_POST", "FEE", "SETTLE"]
    with session_scope() as s:
        e2es = [s.execute(select(Transaction.rail_e2e_id).where(Transaction.id == t.id)).scalar_one() for t in txns]
        assert s.execute(select(func.count()).select_from(RailPayment).where(RailPayment.e2e_id.in_(e2es))).scalar_one() == 4
    assert_ledger_invariants()
    assert results  # every job completed without raising


def test_integrity_flags_settled_payments_no_file_ever_covered(client, as_):
    """Safety net: if the rail never sends a file containing a settled payment, it must not stay silent."""
    ref = pay(client, as_, new_request(client, as_, 7_000)).json()["txn_ref"]
    with session_scope() as s:
        s.execute(text("UPDATE transactions SET updated_at = now() - interval '2 days' WHERE txn_ref = :r"), {"r": ref})
    r = client.get("/v1/finance/integrity", headers=as_("auditor")).json()
    chk = [c for c in r["checks"] if c["check"] == "settled_but_unreconciled_after_d1"][0]
    assert chk["status"] == "WARN" and chk["value"] == 1
