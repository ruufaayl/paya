"""Theme 2: green banking (G1-G10). Footprints are estimates from settled payments only; the green pot is
customer money on ledger account 2110 moved by balanced, idempotent journals; an offset is a normal Raast
payment and its certificate exists only after settlement. Staff see aggregates, never one customer."""
import pathlib
import uuid

from sqlalchemy import select

from conftest import new_request, pay, wallet_minor
from paya import green, integrity, payments
from paya.db import session_scope
from paya.ledger import trial_balance
from paya.models import Account, Journal, LedgerEntry, Transaction
from paya.rail import chaos


def move(client, as_, direction, amount_minor, who="sara", source="MANUAL", key=None):
    return client.post("/v1/green/pot/moves", headers={**as_(who), "Idempotency-Key": key or uuid.uuid4().hex},
                       json={"direction": direction, "amount_minor": amount_minor, "source": source})


def pot(client, as_, who="sara"):
    r = client.get("/v1/green/pot", headers=as_(who))
    assert r.status_code == 200, r.text
    return r.json()


def test_g1_footprint_is_an_estimate_from_settled_payments_only(client, as_):
    assert pay(client, as_, new_request(client, as_, 245_000)).json()["status"] in ("PENDING", "SETTLED")
    chaos.queue("REJECT")                                     # reversed: money came back, so it was not spent
    assert pay(client, as_, new_request(client, as_, 99_900)).status_code == 202
    f = client.get("/v1/green/footprint", headers=as_("sara")).json()
    food = next(c for c in f["categories"] if c["category"] == "FOOD_BEVERAGE")
    assert food["payments"] == 1 and food["spent_minor"] == 245_000
    assert food["kg"] == round(2450 / 1000 * 2.4, 2) == f["total_kg"]
    assert f["range_kg"] == [round(f["total_kg"] * 0.5, 2), round(f["total_kg"] * 1.5, 2)]
    assert f["estimate"] is True and f["factor_set"] == green.FACTOR_SET and "Not a measurement" in f["method"]


def test_g2_pot_deposit_is_one_balanced_journal_between_2100_and_2110(client, as_):
    w0 = wallet_minor(client, as_)
    r = move(client, as_, "IN", 10_000_00)
    assert r.status_code == 200, r.text
    assert r.json()["pot_balance"] == 10_000_00 and wallet_minor(client, as_) == w0 - 10_000_00
    with session_scope() as s:
        t = s.execute(select(Transaction).where(Transaction.txn_ref == r.json()["txn_ref"])).scalar_one()
        j = s.execute(select(Journal).where(Journal.txn_id == t.id)).scalar_one()
        lines = {(s.get(Account, e.account_id).code, e.direction, e.amount_minor)
                 for e in s.execute(select(LedgerEntry).where(LedgerEntry.journal_id == j.id)).scalars()}
        assert lines == {("2100", "D", 10_000_00), ("2110", "C", 10_000_00)}
        assert trial_balance(s)["balanced"]
    out = move(client, as_, "OUT", 4_000_00)
    assert out.status_code == 200 and out.json()["pot_balance"] == 6_000_00
    assert wallet_minor(client, as_) == w0 - 6_000_00


def test_g3_retry_with_the_same_key_moves_money_once(client, as_):
    key = uuid.uuid4().hex
    a, b = move(client, as_, "IN", 2_500_00, key=key), move(client, as_, "IN", 2_500_00, key=key)
    assert a.json()["txn_ref"] == b.json()["txn_ref"] and b.headers["Idempotent-Replayed"] == "true"
    assert pot(client, as_)["balance"] == 2_500_00
    assert move(client, as_, "IN", 3_000_00, key=key).status_code == 422      # same key, different body


def test_g4_no_overdraw_of_wallet_or_pot(client, as_):
    r = move(client, as_, "OUT", 100_00)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INSUFFICIENT_FUNDS"
    omar_available = client.get("/v1/wallet", headers=as_("omar")).json()["available_balance"]["minor"]
    r = move(client, as_, "IN", omar_available + 100_00, who="omar")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INSUFFICIENT_FUNDS"
    assert move(client, as_, "IN", 150_50).status_code == 422                 # whole rupees only
    assert pot(client, as_, "omar")["balance"] == 0


def test_g5_unverified_wallet_cannot_open_a_pot(client, as_):
    assert pot(client, as_, "hina")["eligible"] is False
    r = move(client, as_, "IN", 500_00, who="hina")
    assert r.status_code == 422 and "verified" in r.json()["error"]["message"]


def test_g6_round_ups_are_capped_at_what_settled_payments_earned(client, as_):
    pay(client, as_, new_request(client, as_, 245_000))      # Rs 2,450 -> rounds to Rs 2,500: Rs 50
    pay(client, as_, new_request(client, as_, 30_000))       # Rs 300 is already round: Rs 0
    assert pot(client, as_)["roundup_suggested"] == 50_00
    assert move(client, as_, "IN", 100_00, source="ROUND_UP").status_code == 422
    assert move(client, as_, "IN", 50_00, source="ROUND_UP").status_code == 200
    assert pot(client, as_)["roundup_suggested"] == 0
    assert move(client, as_, "OUT", 50_00, source="ROUND_UP").status_code == 422   # round-ups only go in


def test_g7_offset_is_a_normal_payment_and_certified_only_after_settlement(client, as_):
    r = client.post("/v1/green/offsets", headers=as_("sara"), json={"amount_minor": 1_500_00})
    assert r.status_code == 201, r.text
    pr = r.json()
    assert pr["kind"] == "GREEN_OFFSET" and pr["merchant"]["category"] == "CARBON_OFFSET"
    tills = client.get("/v1/payment-requests", headers=as_("omar")).json()
    assert all(t["id"] != pr["id"] for t in tills)                            # not offered to other customers
    assert client.get(f"/v1/payment-requests/{pr['id']}", headers=as_("omar")).status_code == 404

    chaos.queue("TIMEOUT_NO_RECORD")                                          # Raast hasn't confirmed yet
    ref = pay(client, as_, pr["id"]).json()["txn_ref"]
    item = client.get("/v1/green/offsets", headers=as_("sara")).json()["items"][0]
    assert item["txn_ref"] == ref and item["certificate_ref"] is None and item["kg_offset"] == 0
    payments.run_status_enquiries(force=True)                                 # settles exactly once
    item = client.get("/v1/green/offsets", headers=as_("sara")).json()["items"][0]
    assert item["status"] == "RECORDED" and item["certificate_ref"].startswith("OFS-")
    assert item["kg_offset"] == 500.0                                         # Rs 1,500 at Rs 3,000 per tonne
    assert client.get("/v1/green/footprint", headers=as_("sara")).json()["offset_kg"] == 500.0


def test_g8_staff_see_aggregates_and_customers_see_only_their_own(client, as_):
    move(client, as_, "IN", 1_000_00)
    assert client.get("/v1/green/pot", headers=as_("sana.ops")).status_code == 403
    assert client.get("/v1/ops/green/portfolio", headers=as_("sara")).status_code == 403
    port = client.get("/v1/ops/green/portfolio", headers=as_("sana.ops")).json()
    assert port["pots"] == {**port["pots"], "count": 1, "total_minor": 1_000_00, "ledger_account": "2110"}
    assert "Sara" not in str(port) and "customer" not in str(port).lower()
    assert pot(client, as_, "omar")["balance"] == 0 and pot(client, as_, "omar")["moves"] == []


def test_g9_integrity_checks_cover_green_pots(client, as_):
    move(client, as_, "IN", 2_000_00)
    move(client, as_, "OUT", 500_00)
    with session_scope() as s:
        checks = {c["check"]: c["status"] for c in integrity.run(s)["checks"]}
    assert checks["no_negative_green_pots"] == "PASS" and checks["green_pot_move_has_one_journal"] == "PASS"
    assert checks["trial_balance_balanced"] == "PASS" and checks["in_transit_equals_open_payments"] == "PASS"


def test_g10_green_module_cannot_reach_the_rail_or_house_accounts():
    src = pathlib.Path(green.__file__).read_text()
    assert "from .rail" not in src and "dispatch(" not in src and "house_account" not in src
    # the only ledger postings are between the customer's own wallet and pot
    assert src.count("ledger.post(") == 1 and '"2100", "CUSTOMER"' in src and '"2110", "CUSTOMER"' in src


def test_g11_assistant_answers_green_questions_without_moving_money(client, as_):
    move(client, as_, "IN", 1_200_00)
    w0 = wallet_minor(client, as_)
    for text in ("what's my carbon footprint?", "mera green pot", "offset my footprint and move 500 to green pot"):
        r = client.post("/v1/assistant/messages", headers=as_("sara"), json={"text": text}).json()
        assert r["intent"] == "GREEN" and "estimate" in r["reply"] and "Rs 1,200" in r["reply"]
    assert wallet_minor(client, as_) == w0 and pot(client, as_)["balance"] == 1_200_00
