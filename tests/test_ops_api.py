"""Paya 2.0 operations API (O1-O9): read models are correct, permissioned, and move no money."""
from conftest import detail, new_request, pay
from paya import payments
from paya.db import session_scope
from paya.ledger import trial_balance
from paya.rail import chaos


def _settle(client, as_, amount=245_000, customer="sara"):
    ref = pay(client, as_, new_request(client, as_, amount), customer=customer).json()["txn_ref"]
    return ref


def test_o1_me_lists_permissions(client, as_):
    me = client.get("/v1/me", headers=as_("rabia.finance")).json()
    assert "reversal:approve" in me["permissions"] and "kyc:decide" not in me["permissions"]


def test_o2_transaction_search_filters_and_pagination(client, as_):
    refs = [_settle(client, as_, a) for a in (100_00, 2_000_00, 3_000_00)]
    r = client.get("/v1/ops/transactions?type=PAYMENT&page_size=2", headers=as_("sana.ops")).json()
    assert r["total"] == 3 and len(r["items"]) == 2 and r["page"] == 1
    one = client.get(f"/v1/ops/transactions?q={refs[1][-6:]}", headers=as_("sana.ops")).json()
    assert [i["txn_ref"] for i in one["items"]] == [refs[1]]
    big = client.get("/v1/ops/transactions?min_amount_minor=150000&merchant=chai", headers=as_("auditor")).json()
    assert big["total"] == 2
    held = _settle(client, as_, 100_00, customer="zarak")  # watch-list: compliance hold
    flagged = client.get("/v1/ops/transactions?flagged=true", headers=as_("auditor")).json()
    assert [i["txn_ref"] for i in flagged["items"]] == [held] and "SCREENING" in flagged["items"][0]["flags"]
    assert client.get("/v1/ops/transactions", headers=as_("sara")).status_code == 403
    assert client.get("/v1/ops/transactions", headers=as_("ayesha.cashier")).status_code == 403


def test_o3_overview_and_timeseries_come_from_the_database(client, as_):
    _settle(client, as_)
    chaos.set_mode("REJECT")
    ref = _settle(client, as_)
    chaos.reset()
    ov = client.get("/v1/ops/overview", headers=as_("auditor")).json()
    assert ov["payments"]["total"] == 2 and ov["rail"]["simulated"] is True
    assert detail(client, as_, ref)["status"] in ("REVERSED", "PENDING", "SETTLED")
    ts = client.get("/v1/ops/timeseries?window_minutes=10&buckets=10", headers=as_("auditor")).json()
    assert len(ts["series"]) == 10 and ts["totals"]["payments"] == 2
    assert sum(b["settled"] + b["failed"] + b["in_flight"] + b["review"] for b in ts["series"]) == 2


def test_o4_event_history_is_durable_and_filterable(client, as_):
    ref = _settle(client, as_)
    evs = client.get(f"/v1/events?txn_ref={ref}", headers=as_("auditor")).json()
    types = {e["type"] for e in evs}
    assert "payment.posted" in types and all(e["txn_ref"] == ref for e in evs)
    seqs = [e["seq"] for e in evs]
    assert seqs == sorted(seqs, reverse=True)
    older = client.get(f"/v1/events?before_seq={seqs[0]}&limit=1", headers=as_("auditor")).json()
    assert older[0]["seq"] < seqs[0]


def test_o5_recon_items_show_each_break_with_its_case(client, as_):
    chaos.set_mode("PARTIAL")
    ref = _settle(client, as_)
    chaos.reset()
    run = client.post("/v1/finance/recon/run", headers=as_("rabia.finance"), json={}).json()
    out = client.get(f"/v1/finance/recon/runs/{run['run_id']}/items", headers=as_("sana.ops")).json()
    breaks = [i for i in out["items"] if i["category"] != "MATCHED"]
    assert breaks and breaks[0]["case"]["case_ref"].startswith("CASE")
    assert out["run"]["file_sha256"]


def test_o6_assignment_is_owner_only_audited_and_moves_no_money(client, as_):
    payments_tb = None
    with session_scope() as s:
        payments_tb = trial_balance(s)
    chaos.set_mode("PARTIAL")
    _settle(client, as_)
    chaos.reset()
    client.post("/v1/finance/recon/run", headers=as_("rabia.finance"), json={})
    case = client.get("/v1/cases", headers=as_("sana.ops")).json()[0]
    url = f"/v1/cases/{case['case_ref']}/assign"
    assert client.post(url, headers=as_(  # wrong role for this case
        "hamza.compliance"), json={"assignee": "hamza.compliance"}).status_code == 403
    assert client.post(url, headers=as_("sana.ops"), json={"assignee": "rabia.finance"}).status_code == 422
    r = client.post(url, headers=as_("sana.ops"), json={"assignee": "faisal.ops"}).json()
    assert r["assigned_to"] == "faisal.ops" and r["state"] == "IN_REVIEW"
    actions = [(a["action"], a["outcome"]) for a in r["audit"]]
    assert ("CASE_ASSIGN", "ALLOWED") in actions and ("CASE_ASSIGN", "DENIED") in actions
    with session_scope() as s:
        tb = trial_balance(s)
    assert tb["balanced"] and payments_tb["balanced"]
    assert client.post(url, headers=as_("sara"), json={"assignee": "faisal.ops"}).status_code == 403


def test_o7_audit_log_and_access_matrix_are_restricted(client, as_):
    _settle(client, as_)
    log = client.get("/v1/audit/log?limit=5", headers=as_("auditor")).json()
    assert log["chain_intact"] and len(log["items"]) <= 5
    assert client.get("/v1/audit/log", headers=as_("sana.ops")).status_code == 403
    acc = client.get("/v1/admin/access", headers=as_("auditor")).json()
    assert "reversal:approve" in acc["permissions"] and any(u["username"] == "nadia.compliance" for u in acc["users"])
    assert client.get("/v1/admin/access", headers=as_("rabia.finance")).status_code == 403


def test_o8_customer_sees_money_trail_from_the_ledger(client, as_):
    ref = _settle(client, as_)
    payments.run_status_enquiries()
    d = client.get(f"/v1/transactions/{ref}", headers=as_("sara")).json()
    assert d["rail_status"]["network"] == "Raast (simulated)"
    assert [m["posting_type"] for m in d["money_trail"]][:1] == ["AUTH_POST"]
    assert "ledger" not in d  # internal account names stay in the back office


def test_o9_case_detail_includes_trail(client, as_):
    held = _settle(client, as_, customer="zarak")
    client.post(f"/v1/compliance/holds/{held}/decision", headers=as_("hamza.compliance"),
                json={"decision": "RELEASE", "reason": "false positive after review"})
    cases = client.get("/v1/cases?state=ALL", headers=as_("auditor")).json()
    c = client.get(f"/v1/cases/{cases[0]['case_ref']}", headers=as_("auditor")).json()
    assert c["txn"]["txn_ref"] == held and any(a["actor"] == "hamza.compliance" for a in c["audit"])
