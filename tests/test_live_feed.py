"""Live feed by polling (/v1/live, F1-F4): works across server instances because it reads the database."""
from conftest import new_request, pay


def live(client, h, cur=None):
    q = "" if cur is None else f"?after_event={cur['event']}&after_tel={cur['tel']}"
    r = client.get(f"/v1/live{q}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_f1_cursor_starts_at_now_then_returns_only_new_committed_events(client, as_):
    start = live(client, as_("mudaser.ops"))
    assert start["messages"] == []
    ref = pay(client, as_, new_request(client, as_, 31_000)).json()["txn_ref"]
    got = live(client, as_("mudaser.ops"), start["cursor"])
    types = [m["type"] for m in got["messages"] if m["kind"] == "event" and m["payload"].get("txn_ref") == ref]
    assert "payment.posted" in types and "payment.settled" in types
    assert live(client, as_("mudaser.ops"), got["cursor"])["messages"] == []          # nothing twice


def test_f2_customers_and_merchants_see_only_their_own_payments(client, as_):
    c_sara, c_omar, c_till = live(client, as_("sara")), live(client, as_("omar")), live(client, as_("kamran.cashier"))
    pay(client, as_, new_request(client, as_, 12_000))                             # Sara at Chai Junction
    assert any(m["payload"].get("txn_ref") for m in live(client, as_("sara"), c_sara["cursor"])["messages"])
    assert live(client, as_("omar"), c_omar["cursor"])["messages"] == []
    assert live(client, as_("kamran.cashier"), c_till["cursor"])["messages"] == []   # another merchant's till


def test_f3_telemetry_is_persisted_for_back_office_when_enabled(client, as_, settings, monkeypatch):
    monkeypatch.setattr(settings, "live_feed_persist", True)
    cur = live(client, as_("mudaser.ops"))["cursor"]
    pay(client, as_, new_request(client, as_, 9_000))
    msgs = live(client, as_("mudaser.ops"), cur)["messages"]
    tel = [m for m in msgs if m["kind"] == "telemetry"]
    assert tel and all("tseq" in m for m in tel) and any(m["node"] == "ledger" for m in tel)
    assert all(m["kind"] == "event" for m in live(client, as_("sara"), cur)["messages"])   # customers: no telemetry


def test_f4_demo_tills_exist_for_the_qr_wall(client, as_):
    for u in ("noor.cashier", "danish.cashier", "sadia.cashier", "imran.cashier"):
        r = client.post("/v1/payment-requests", headers=as_(u), json={"amount_minor": 50_000, "order_ref": f"WALL-{u}"})
        assert r.status_code == 201, r.text


def test_f5_staff_seeded_earlier_are_renamed_after_the_team(client):
    """Databases seeded with the old synthetic staff names get the team's names, once, keeping the same user rows."""
    from sqlalchemy import select, update

    from paya.db import session_scope
    from paya.models import User
    from paya.seed import ensure_demo_extras
    with session_scope() as s:
        uid = s.execute(select(User.id).where(User.username == "kanz.compliance")).scalar_one()
        s.execute(update(User).where(User.username == "kanz.compliance").values(username="hamza.compliance"))
    ensure_demo_extras()
    ensure_demo_extras()                                                   # idempotent
    with session_scope() as s:
        u = s.execute(select(User).where(User.id == uid)).scalar_one()
        assert u.username == "kanz.compliance" and u.display_name.startswith("Kanz ur Rehman")
        assert not s.execute(select(User).where(User.username == "hamza.compliance")).scalar_one_or_none()
    r = client.post("/v1/auth/login", json={"username": "kanz.compliance", "password": "paya-demo-2026"})
    assert r.status_code == 200
