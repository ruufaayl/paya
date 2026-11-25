"""Send money to a bank account (simulated directory, same money path): B1-B9."""
import uuid

from sqlalchemy import func, select

from paya.db import session_scope
from paya import integrity
from paya.models import BankTransfer, Journal, Notification, Transaction
from paya.rail import RailPayment, chaos

from conftest import wallet_minor

DEMO = {"bank_code": "MEZN", "account": "99010012345678"}            # AHMED RAZA, Meezan (synthetic)


def iban(bank: str, account16: str) -> str:
    """Build a valid Pakistani IBAN (mod-97 check digits) for a 16-digit account part."""
    base = f"{bank}{account16}PK00"
    num = int("".join(str(int(c, 36)) for c in base))
    return f"PK{98 - num % 97:02d}{bank}{account16}"


def send(client, as_, amount_minor=500_000, key=None, who="sara", **over):
    body = {**DEMO, "amount_minor": amount_minor, "purpose": "Family support", **over}
    return client.post("/v1/transfers", headers={**as_(who), "Idempotency-Key": key or uuid.uuid4().hex}, json=body)


def txn(ref):
    with session_scope() as s:
        t = s.execute(select(Transaction).where(Transaction.txn_ref == ref)).scalar_one()
        return t.status, t.type, [j.posting_type for j in s.execute(select(Journal).where(Journal.txn_id == t.id)
                                                                  .order_by(Journal.created_at)).scalars()]


def test_b1_bank_list_and_title_fetch_from_the_simulated_directory(client, as_):
    lst = client.get("/v1/banks", headers=as_("sara")).json()
    assert {"HABB", "MEZN", "JCMA", "TMFB"} <= {b["code"] for b in lst["banks"]} and "simulated" in lst["directory"]
    r = client.post("/v1/transfers/title-fetch", headers=as_("sara"), json=DEMO).json()
    assert r["title"] == "AHMED RAZA" and r["account_masked"].endswith("5678") and r["simulated"] is True
    any99 = client.post("/v1/transfers/title-fetch", headers=as_("sara"), json={"bank_code": "HABB", "account": "9912345678"}).json()
    again = client.post("/v1/transfers/title-fetch", headers=as_("sara"), json={"bank_code": "HABB", "account": "9912345678"}).json()
    assert any99["title"] == again["title"] and len(any99["title"].split()) == 2     # deterministic synthetic name


def test_b2_a_real_looking_account_is_not_found_and_nothing_is_kept(client, as_):
    r = client.post("/v1/transfers/title-fetch", headers=as_("sara"), json={"bank_code": "HABB", "account": "12345678901234"})
    assert r.status_code == 404 and "simulated bank directory" in r.json()["error"]["message"]
    bad = send(client, as_, bank_code="HABB", account="12345678901234")
    assert bad.status_code == 404
    with session_scope() as s:
        assert s.execute(select(func.count()).select_from(BankTransfer)).scalar_one() == 0
        assert s.execute(select(func.count()).select_from(Transaction).where(Transaction.type == "TRANSFER")).scalar_one() == 0


def test_b3_iban_is_checked_and_must_match_the_bank(client, as_):
    good = iban("MEZN", "0099010012345678")
    r = client.post("/v1/transfers/title-fetch", headers=as_("sara"), json={"bank_code": "MEZN", "account": good})
    assert r.status_code == 200 and r.json()["title"] == "AHMED RAZA"
    wrong_digits = good[:2] + ("00" if good[2:4] != "00" else "11") + good[4:]
    assert client.post("/v1/transfers/title-fetch", headers=as_("sara"), json={"bank_code": "MEZN", "account": wrong_digits}).status_code == 422
    other_bank = client.post("/v1/transfers/title-fetch", headers=as_("sara"), json={"bank_code": "HABB", "account": good})
    assert other_bank.status_code == 422 and "another bank" in other_bank.json()["error"]["message"]


def test_b4_transfer_settles_through_the_one_money_path_with_no_shop_fee(client, as_):
    before = wallet_minor(client, as_)
    r = send(client, as_, 500_000)
    assert r.status_code == 202, r.text
    ref = r.json()["txn_ref"]
    status, kind, posts = txn(ref)
    assert (status, kind) == ("SETTLED", "TRANSFER") and posts == ["AUTH_POST", "SETTLE"]    # no FEE
    assert wallet_minor(client, as_) == before - 500_000
    d = client.get(f"/v1/transactions/{ref}", headers=as_("sara")).json()
    assert d["beneficiary"]["title"] == "AHMED RAZA" and d["beneficiary"]["directory"] == "simulated"
    assert "AHMED RAZA" in d["merchant"] and d["display_status"] == "Paid"
    assert any("sent to the bank account" in m["description"] for m in d["money_trail"])
    w = client.get("/v1/wallet", headers=as_("sara")).json()["transactions"][0]
    assert w["type"] == "TRANSFER" and "AHMED RAZA" in w["merchant"]
    with session_scope() as s:
        n = s.execute(select(Notification).where(Notification.template == "payment.settled")).scalars().all()
        assert any("Sent PKR 5,000.00 to AHMED RAZA" in x.body for x in n) and all(x.recipient == "CUSTOMER" for x in n)


def test_b5_the_full_account_number_is_never_stored_or_sent_in_full(client, as_):
    ref = send(client, as_, 120_000).json()["txn_ref"]
    with session_scope() as s:
        t = s.execute(select(Transaction).where(Transaction.txn_ref == ref)).scalar_one()
        bt = s.get(BankTransfer, t.id)
        assert DEMO["account"] not in (bt.account_masked + bt.account_hash) and bt.account_masked == "•••• 5678"
        rp = s.get(RailPayment, t.rail_e2e_id)
        assert rp.creditor_alias == "MEZN:****5678"


def test_b6_same_key_twice_sends_once(client, as_):
    before = wallet_minor(client, as_)
    key = "t-" + uuid.uuid4().hex
    a, b = send(client, as_, 200_000, key=key), send(client, as_, 200_000, key=key)
    assert a.json()["txn_ref"] == b.json()["txn_ref"] and b.headers["Idempotent-Replayed"] == "true"
    assert wallet_minor(client, as_) == before - 200_000


def test_b7_not_enough_money_is_refused_with_nothing_taken(client, as_):
    before = wallet_minor(client, as_, "omar")
    r = send(client, as_, 90_000_00, who="omar")          # Omar has Rs 20,000; tier-1 limit applies too
    assert r.json()["status"] == "REJECTED"
    assert wallet_minor(client, as_, "omar") == before


def test_b8_lost_reply_stays_pending_then_recovers_once_and_integrity_holds(client, as_):
    chaos.queue("TIMEOUT_AFTER_ACCEPT")
    ref = send(client, as_, 300_000).json()["txn_ref"]
    assert txn(ref)[0] == "PENDING"                        # never FAILED on a timeout
    from paya import payments
    payments.run_status_enquiries(force=True)
    status, _, posts = txn(ref)
    assert status == "SETTLED" and posts.count("SETTLE") == 1
    with session_scope() as s:
        checks = {c["check"]: c["status"] for c in integrity.run(s)["checks"]}
    assert checks["in_transit_equals_open_payments"] == "PASS" and checks["trial_balance_balanced"] == "PASS"


def test_b9_title_fetch_is_rate_limited_and_staff_cannot_send(client, as_, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_title_fetch_per_customer_per_minute", 3)
    codes = [client.post("/v1/transfers/title-fetch", headers=as_("sara"), json=DEMO).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    assert send(client, as_, 10_000, who="mudaser.ops").status_code == 403
