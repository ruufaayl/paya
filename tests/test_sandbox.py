"""Theme 5: the stablecoin sandbox (SC1-SC12). Off by default; test tokens only; no rupee conversion; screened,
limited and travel-rule-checked transfers; "confirmed" only at finality depth (reorg-safe); reconciled
against the simulated chain."""
import pathlib
import uuid

import pytest

from paya import chain, integrity, tokens
from paya.db import session_scope
from paya.ledger import trial_balance

BLOCKED = sorted(tokens.BLOCKED_ADDRESSES)[0]


@pytest.fixture()
def on(settings, monkeypatch):
    monkeypatch.setattr(settings, "stablecoin_sandbox", True)
    chain.chaos.reset()
    yield
    chain.chaos.reset()


def mine(n=1):
    for _ in range(n):
        chain.mine()
    tokens.refresh()


def enrol(client, as_, who="sara"):
    r = client.post("/v1/sandbox/enrol", headers=as_(who), json={"acknowledge_no_value": True})
    assert r.status_code == 200, r.text
    return r.json()["address"]


def wallet(client, as_, who="sara"):
    return client.get("/v1/sandbox/wallet", headers=as_(who)).json()


def funded(client, as_, who="sara"):
    addr = enrol(client, as_, who)
    assert client.post("/v1/sandbox/faucet", headers=as_(who)).status_code == 200
    mine(3)
    return addr


def send(client, as_, who="sara", key=None, **body):
    return client.post("/v1/sandbox/transfers", headers={**as_(who), "Idempotency-Key": key or uuid.uuid4().hex}, json=body)


def merchant_id(client, as_):
    return wallet(client, as_)["merchants"][0]["id"]


def test_sc1_switched_off_by_default(client, as_):
    assert client.get("/v1/sandbox/status", headers=as_("sara")).json() == {"enabled": False}
    for method, path in (("get", "/v1/sandbox/wallet"), ("post", "/v1/sandbox/faucet")):
        r = getattr(client, method)(path, headers=as_("sara"))
        assert r.status_code == 404 and r.json()["error"]["code"] == "FEATURE_DISABLED"
    assert client.post("/v1/sandbox/enrol", headers=as_("sara"), json={"acknowledge_no_value": True}).status_code == 404
    assert tokens.tick() == {}                                       # the worker does nothing either
    assert client.get("/v1/ops/sandbox", headers=as_("mudaser.ops")).json()["enabled"] is False


def test_sc2_enrolment_needs_tier2_and_acknowledgement(client, as_, on):
    assert client.post("/v1/sandbox/enrol", headers=as_("sara"), json={"acknowledge_no_value": False}).status_code == 422
    assert client.post("/v1/sandbox/enrol", headers=as_("omar"), json={"acknowledge_no_value": True}).status_code == 409
    assert client.post("/v1/sandbox/enrol", headers=as_("hina"), json={"acknowledge_no_value": True}).status_code == 409
    addr = enrol(client, as_)
    assert tokens.ADDR_RX.match(addr) and enrol(client, as_) == addr          # idempotent
    assert "no value" in wallet(client, as_)["disclaimer"]


def test_sc3_faucet_tokens_count_only_after_finality(client, as_, on, settings):
    enrol(client, as_)
    client.post("/v1/sandbox/faucet", headers=as_("sara"))
    w = wallet(client, as_)
    assert w["confirmed_units"] == 0 and w["pending_in_units"] == settings.token_faucet_units
    mine(2)
    assert wallet(client, as_)["confirmed_units"] == 0 and wallet(client, as_)["transfers"][0]["confirmations"] == 2
    mine(1)
    w = wallet(client, as_)
    assert w["confirmed_units"] == settings.token_faucet_units and w["transfers"][0]["status"] == "CONFIRMED"
    assert client.post("/v1/sandbox/faucet", headers=as_("sara")).status_code == 409      # once per 24 h


def test_sc4_tokens_never_touch_the_rupee_ledger(client, as_, on):
    with session_scope() as s:
        before = trial_balance(s)
    w0 = client.get("/v1/wallet", headers=as_("sara")).json()["ledger_balance"]["minor"]
    funded(client, as_)
    send(client, as_, merchant_id=merchant_id(client, as_), amount_units=250_00)
    mine(3)
    assert client.get("/v1/wallet", headers=as_("sara")).json()["ledger_balance"]["minor"] == w0
    with session_scope() as s:
        assert trial_balance(s)["total_debit_minor"] == before["total_debit_minor"]
        checks = {c["check"]: c["status"] for c in integrity.run(s)["checks"]}
    assert checks["sandbox_tokens_never_in_rupee_ledger"] == "PASS"


def test_sc5_merchant_payment_confirms_at_depth_and_moves_tokens(client, as_, on):
    funded(client, as_)
    w = wallet(client, as_)
    m = w["merchants"][0]
    r = send(client, as_, merchant_id=m["id"], amount_units=300_00)
    assert r.status_code == 200 and r.json()["status"] == "PENDING"
    assert wallet(client, as_)["spendable_units"] == w["confirmed_units"] - 300_00     # reserved while pending
    mine(3)
    assert wallet(client, as_)["transfers"][0]["status"] == "CONFIRMED"
    assert chain.balance(m["address"], min_confirmations=3) == 300_00


def test_sc6_a_reorg_never_shows_confirmed_too_early(client, as_, on):
    funded(client, as_)
    send(client, as_, merchant_id=merchant_id(client, as_), amount_units=100_00)
    mine(2)                                                          # included, 2 confirmations
    assert wallet(client, as_)["transfers"][0]["confirmations"] == 2
    chain.chaos.set_mode("REORG")
    mine(1)                                                          # the tip is orphaned
    t = wallet(client, as_)["transfers"][0]
    assert t["status"] == "PENDING" and t["confirmations"] == 1
    mine(3)                                                          # re-included and buried
    assert wallet(client, as_)["transfers"][0]["status"] == "CONFIRMED"
    assert tokens.reconcile()["breaks"] == []


def test_sc7_screened_address_is_blocked_with_a_compliance_case(client, as_, on):
    funded(client, as_)
    r = send(client, as_, to_address=BLOCKED, amount_units=50_00)
    assert r.json()["status"] == "BLOCKED" and r.json()["chain_tx"] is None
    cases = client.get("/v1/cases", headers=as_("kanz.compliance")).json()
    assert any(c["kind"] == "TOKEN_SCREENING" for c in cases)
    log = client.get("/v1/audit/log?action=TOKEN_TRANSFER_BLOCKED", headers=as_("taha.audit")).json()
    assert log["items"] and log["chain_intact"]


def test_sc8_limits_and_travel_rule(client, as_, on, settings):
    funded(client, as_)
    external = "0x" + "1" * 40
    r = send(client, as_, to_address=external, amount_units=settings.token_travel_rule_units)
    assert r.status_code == 422 and r.json()["error"]["travel_rule"] is True
    assert send(client, as_, to_address=external, amount_units=settings.token_travel_rule_units - 1).status_code == 200
    assert send(client, as_, to_address=external, amount_units=settings.token_max_txn_units + 1).status_code == 422
    assert send(client, as_, to_address="0xnot-an-address", amount_units=1_00).status_code == 422
    r = send(client, as_, to_address=external, amount_units=999_00, beneficiary_name="Test Beneficiary")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INSUFFICIENT_FUNDS"   # only 1 token left spendable


def test_sc9_retry_with_the_same_key_sends_once(client, as_, on):
    funded(client, as_)
    mid, key = merchant_id(client, as_), uuid.uuid4().hex
    a = send(client, as_, key=key, merchant_id=mid, amount_units=10_00)
    b = send(client, as_, key=key, merchant_id=mid, amount_units=10_00)
    assert a.json()["ref"] == b.json()["ref"] and b.headers["Idempotent-Replayed"] == "true"
    assert len([t for t in wallet(client, as_)["transfers"] if t["kind"] == "MERCHANT"]) == 1


def test_sc10_chain_down_means_nothing_sent(client, as_, on):
    funded(client, as_)
    chain.chaos.set_mode("DOWN")
    r = send(client, as_, merchant_id=merchant_id(client, as_), amount_units=10_00)
    assert r.json()["status"] == "FAILED" and r.json()["chain_tx"] is None
    chain.chaos.reset()
    assert wallet(client, as_)["spendable_units"] == wallet(client, as_)["confirmed_units"]


def test_sc11_reconciliation_catches_a_record_that_disagrees_with_the_chain(client, as_, on):
    funded(client, as_)
    assert tokens.reconcile()["breaks"] == []
    with session_scope() as s:                                       # simulate a corrupted mirror record
        from paya.models import TokenTransfer
        t = s.query(TokenTransfer).filter_by(kind="FAUCET").one()
        t.amount_units += 1
    with session_scope() as s:
        checks = {c["check"]: c["status"] for c in integrity.run(s)["checks"]}
    assert checks["token_transfers_match_chain"] == "FAIL"


def test_sc12_sandbox_code_cannot_create_or_convert_money():
    src = pathlib.Path(tokens.__file__).read_text() + pathlib.Path(chain.__file__).read_text()
    for forbidden in ("ledger.post(", "from .ledger", "Line(", "house_account", "initiate_payment", "PaymentRequest("):
        assert forbidden not in src, forbidden
    assert pathlib.Path(tokens.__file__).read_text().count("chain.FAUCET, w.address") == 1   # the only issuance
