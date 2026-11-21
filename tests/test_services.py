"""Theme 4: the super app (P1-P12). Partner services share one money path: prices from the server, payment on
the normal screen, order state read from the ledger-backed payment, data shared only with consent, and
Compliance can switch a partner off."""
import pathlib
import uuid

from sqlalchemy import select

from conftest import pay
from paya import integrity, payments, services
from paya.db import session_scope
from paya.models import ServiceOrder
from paya.rail import chaos


def order(client, as_, code, who="sara", **body):
    return client.post(f"/v1/services/{code}/orders", headers=as_(who), json=body)


def orders(client, as_, who="sara"):
    return {o["ref"]: o for o in client.get("/v1/services/orders", headers=as_(who)).json()}


def consent(client, as_, code, grant=True, who="sara"):
    r = client.post(f"/v1/services/{code}/consent", headers=as_(who), json={"grant": grant})
    assert r.status_code == 200, r.text


def test_p1_hub_lists_services_and_says_what_is_not_offered(client, as_):
    h = client.get("/v1/services", headers=as_("sara")).json()
    kinds = {s["kind"] for s in h["services"]}
    assert kinds == {"BILLER", "TOPUP", "SHOP", "INSURER"}
    assert h["not_offered"][0]["name"] == "Investments"
    assert client.get("/v1/services", headers=as_("sana.ops")).status_code == 403


def test_p2_bill_paid_through_the_normal_path_and_only_once(client, as_):
    b = client.post("/v1/services/INDUSPOWER/bill-lookup", headers=as_("sara"), json={"consumer_no": "0412345678"}).json()
    assert b["status"] == "UNPAID" and b["amount_minor"] > 0
    o = order(client, as_, "INDUSPOWER", consumer_no="0412345678").json()
    assert o["amount_minor"] == b["amount_minor"] and o["status"] == "AWAITING_PAYMENT" and o["fulfilment"] is None
    again = order(client, as_, "INDUSPOWER", consumer_no="0412345678", who="omar")   # someone else, same bill
    assert again.status_code == 409 and again.json()["error"]["order_ref"] == o["ref"]
    r = pay(client, as_, o["payment_request_id"])
    assert r.status_code == 202
    done = orders(client, as_)[o["ref"]]
    assert done["status"] == "COMPLETED" and done["fulfilment"] == "Bill paid to the biller"
    assert done["payment"]["txn_ref"] == r.json()["txn_ref"]
    assert client.post("/v1/services/INDUSPOWER/bill-lookup", headers=as_("omar"),
                       json={"consumer_no": "0412345678"}).json()["status"] == "PAID"


def test_p3_order_status_never_runs_ahead_of_the_ledger(client, as_):
    consent(client, as_, "BAZAAR")
    o = order(client, as_, "BAZAAR", items=[{"sku": "TEA-900", "qty": 1}]).json()
    chaos.queue("TIMEOUT_NO_RECORD")                        # Raast has not confirmed
    pay(client, as_, o["payment_request_id"])
    assert orders(client, as_)[o["ref"]]["status"] == "PROCESSING"
    payments.run_status_enquiries(force=True)
    assert orders(client, as_)[o["ref"]]["status"] == "COMPLETED"


def test_p4_a_failed_payment_does_not_fulfil(client, as_):
    consent(client, as_, "HIFAZAT")
    o = order(client, as_, "HIFAZAT", items=[{"sku": "PHONE-M", "qty": 1}]).json()
    chaos.queue("REJECT")                                    # rail rejects: money returns to the wallet
    pay(client, as_, o["payment_request_id"])
    v = orders(client, as_)[o["ref"]]
    assert v["status"] in ("AWAITING_PAYMENT", "NOT_PAID") and v["fulfilment"] is None
    assert v["payment"]["status"] == "REVERSED"


def test_p5_prices_come_from_the_server_catalogue(client, as_):
    consent(client, as_, "BAZAAR")
    r = order(client, as_, "BAZAAR", items=[{"sku": "RICE-5K", "qty": 2}, {"sku": "BAG-JUTE", "qty": 1}])
    assert r.json()["amount_minor"] == 2 * 2_400_00 + 350_00
    assert order(client, as_, "BAZAAR", items=[{"sku": "FREE-TV", "qty": 1}]).status_code == 422
    assert order(client, as_, "BAZAAR", items=[{"sku": "TEA-900", "qty": 50}]).status_code == 422
    assert order(client, as_, "RAABTA", amount_minor=123_00).status_code in (409, 422)   # not a listed amount
    with session_scope() as s:
        o = s.execute(select(ServiceOrder).where(ServiceOrder.ref == r.json()["ref"])).scalar_one()
        assert o.lines[0]["price_minor"] == services.CATALOG["BAZAAR"]["items"]["RICE-5K"][1]


def test_p6_first_order_offer_is_merchant_funded_and_used_once(client, as_):
    consent(client, as_, "BAZAAR")
    hub = {s["code"]: s for s in client.get("/v1/services", headers=as_("sara")).json()["services"]}
    assert "offer" in hub["BAZAAR"]
    o = order(client, as_, "BAZAAR", items=[{"sku": "RICE-5K", "qty": 1}], use_offer=True).json()
    assert o["discount_minor"] == 240_00 and o["amount_minor"] == 2_160_00     # 10%, under the Rs 500 cap
    pay(client, as_, o["payment_request_id"])
    assert order(client, as_, "BAZAAR", items=[{"sku": "TEA-900", "qty": 1}], use_offer=True).status_code == 422
    hub = {s["code"]: s for s in client.get("/v1/services", headers=as_("sara")).json()["services"]}
    assert "offer" not in hub["BAZAAR"]


def test_p7_partner_data_needs_consent_and_shares_only_consented_fields(client, as_):
    r = order(client, as_, "HIFAZAT", items=[{"sku": "HOSP-M", "qty": 1}])
    assert r.status_code == 409 and r.json()["error"]["needs_consent"] is True
    consent(client, as_, "HIFAZAT")
    o = order(client, as_, "HIFAZAT", items=[{"sku": "HOSP-M", "qty": 1}]).json()
    assert o["shared_with_partner"] == ["mobile_masked", "name"]
    with session_scope() as s:
        shared = s.execute(select(ServiceOrder.shared).where(ServiceOrder.ref == o["ref"])).scalar_one()
    assert set(shared) == {"name", "mobile_masked"} and "+92 3xx" in shared["mobile_masked"]
    consent(client, as_, "HIFAZAT", grant=False)                 # revoke: the next order is refused
    assert order(client, as_, "HIFAZAT", items=[{"sku": "PHONE-M", "qty": 1}]).status_code == 409
    o2 = order(client, as_, "INDUSPOWER", consumer_no="0499999999").json()   # billers receive no personal data
    assert o2["shared_with_partner"] == []


def test_p8_compliance_suspends_a_partner_and_it_is_audited(client, as_):
    consent(client, as_, "BAZAAR")
    o = order(client, as_, "BAZAAR", items=[{"sku": "SOAP-4", "qty": 1}]).json()
    assert client.post("/v1/ops/partners/BAZAAR/status", headers=as_("sana.ops"),
                       json={"status": "SUSPENDED", "reason": "complaints spike"}).status_code == 403
    r = client.post("/v1/ops/partners/BAZAAR/status", headers=as_("hamza.compliance"),
                    json={"status": "SUSPENDED", "reason": "complaints spike under review"})
    assert r.status_code == 200
    hub = {s["code"]: s for s in client.get("/v1/services", headers=as_("sara")).json()["services"]}
    assert hub["BAZAAR"]["available"] is False
    assert order(client, as_, "BAZAAR", items=[{"sku": "SOAP-4", "qty": 1}]).status_code == 409
    pay(client, as_, o["payment_request_id"])           # an order made before the suspension can still be paid
    assert orders(client, as_)[o["ref"]]["status"] == "COMPLETED"
    log = client.get("/v1/audit/log?action=PARTNER_SUSPENDED", headers=as_("auditor")).json()
    assert log["items"][0]["actor"] == "hamza.compliance" and log["chain_intact"]


def test_p9_orders_and_requests_are_private_to_the_customer(client, as_):
    consent(client, as_, "BAZAAR")
    o = order(client, as_, "BAZAAR", items=[{"sku": "TEA-900", "qty": 1}]).json()
    assert o["ref"] not in orders(client, as_, "omar")
    assert all(t["id"] != o["payment_request_id"] for t in client.get("/v1/payment-requests", headers=as_("omar")).json())
    assert client.get(f"/v1/payment-requests/{o['payment_request_id']}", headers=as_("omar")).status_code == 404


def test_p10_mission_control_sees_partners_and_volumes(client, as_):
    o = order(client, as_, "RAVIGAS", consumer_no="0312340000").json()
    pay(client, as_, o["payment_request_id"])
    rows = {p["code"]: p for p in client.get("/v1/ops/partners", headers=as_("sana.ops")).json()}
    assert rows["RAVIGAS"]["completed"] == 1 and rows["RAVIGAS"]["completed_minor"] == o["amount_minor"]
    assert client.get("/v1/ops/partners", headers=as_("sara")).status_code == 403


def test_p11_integrity_checks_cover_orders_and_consent(client, as_):
    consent(client, as_, "HIFAZAT")
    o = order(client, as_, "HIFAZAT", items=[{"sku": "PHONE-M", "qty": 1}]).json()
    pay(client, as_, o["payment_request_id"])
    with session_scope() as s:
        checks = {c["check"]: c["status"] for c in integrity.run(s)["checks"]}
    assert checks["service_order_matches_payment_request"] == "PASS"
    assert checks["partner_data_shared_only_with_consent"] == "PASS"
    assert checks["till_paid_without_settlement"] == "PASS" and checks["trial_balance_balanced"] == "PASS"


def test_p12_services_module_has_no_money_path_of_its_own():
    src = pathlib.Path(services.__file__).read_text()
    for forbidden in ("ledger.post(", "from .rail", "dispatch(", "initiate_payment(", "house_account", "Line("):
        assert forbidden not in src, forbidden
    assert "PaymentRequest(" in src                 # it can only ASK for a payment


def test_p13_assistant_reports_orders_but_cannot_pay_a_bill(client, as_):
    o = order(client, as_, "INDUSPOWER", consumer_no="0455555555").json()
    pay(client, as_, o["payment_request_id"])
    o2 = order(client, as_, "RAVIGAS", consumer_no="0466666666").json()
    for text in ("did my bijli bill get paid?", "pay my gas bill"):
        r = client.post("/v1/assistant/messages", headers=as_("sara"), json={"text": text}).json()
        assert r["intent"] == "ORDERS" and o["ref"] in r["reply"] and "done" in r["reply"]
        assert "waiting for you to pay" in r["reply"] and "can't pay" in r["reply"]
    assert orders(client, as_)[o2["ref"]]["status"] == "AWAITING_PAYMENT"
