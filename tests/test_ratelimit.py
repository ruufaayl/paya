"""ADR-016: rate limiting (L1-L9). Abuse-prone actions are limited in PostgreSQL (shared, durable, hashed
keys); every /v1 call has a per-client ceiling; every refusal is a 429 with Retry-After."""
import time

import pytest
from sqlalchemy import select

from paya import ratelimit
from paya.db import session_scope
from paya.models import RateLimitCounter

LOGIN = {"username": "nobody", "password": "x"}


@pytest.fixture()
def tight(settings, monkeypatch):
    for attr, v in {"rate_login_per_ip_per_minute": 3, "rate_onboarding_per_ip_per_hour": 2,
                    "rate_assistant_per_customer_per_minute": 3, "rate_general_per_client_per_minute": 8}.items():
        monkeypatch.setattr(settings, attr, v)


def onboarding(client, n):
    out = []
    for i in range(n):
        body = {"full_name": "Test Applicant", "date_of_birth": "1995-01-01", "mobile": "+923001234567",
                "username": f"rl_applicant_{i}", "password": "a-long-test-password", "accept_terms": True,
                "biometric_consent": True}
        out.append(client.post("/v1/onboarding/start", json=body))
    return out


def test_l1_login_attempts_per_address_are_limited(client, tight):
    codes = [client.post("/v1/auth/login", json=LOGIN).status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]
    r = client.post("/v1/auth/login", json={"username": "sana.ops", "password": "paya-demo-2026"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"     # the address, not the user
    assert 1 <= int(r.headers["Retry-After"]) <= 60


def test_l2_lockout_survives_a_restart_because_it_is_in_the_database(client):
    for _ in range(5):
        client.post("/v1/auth/login", json={"username": "rabia.finance", "password": "wrong"})
    ratelimit.ceiling.reset()                       # an API restart loses process memory...
    r = client.post("/v1/auth/login", json={"username": "rabia.finance", "password": "paya-demo-2026"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "LOGIN_LOCKED"   # ...but not the lockout
    assert r.headers["Retry-After"] == "900"


def test_l3_successful_login_clears_failures(client):
    for _ in range(4):
        client.post("/v1/auth/login", json={"username": "sana.ops", "password": "wrong"})
    assert client.post("/v1/auth/login", json={"username": "sana.ops", "password": "paya-demo-2026"}).status_code == 200
    for _ in range(4):
        client.post("/v1/auth/login", json={"username": "sana.ops", "password": "wrong"})
    assert client.post("/v1/auth/login", json={"username": "sana.ops", "password": "paya-demo-2026"}).status_code == 200


def test_l4_onboarding_applications_per_address_are_limited(client, tight):
    rs = onboarding(client, 3)
    assert [r.status_code for r in rs[:2]] == [201, 201]
    assert rs[2].status_code == 429 and rs[2].json()["error"]["scope"] == "onboard_ip"


def test_l5_assistant_messages_per_customer_are_limited(client, as_, tight):
    codes = [client.post("/v1/assistant/messages", headers=as_("sara"), json={"text": "hi"}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    assert client.post("/v1/assistant/messages", headers=as_("omar"), json={"text": "hi"}).status_code == 200


def test_l6_general_ceiling_per_signed_in_user(client, as_, tight):
    h = as_("sara")
    codes = [client.get("/v1/wallet", headers=h).status_code for _ in range(9)]
    assert codes.count(200) == 8 and codes[-1] == 429
    assert client.get("/v1/wallet", headers=as_("omar")).status_code == 200          # per user, not global
    assert client.get("/healthz").status_code == 200                                 # health is never limited


def test_l7_no_raw_address_or_username_is_stored(client):
    for _ in range(2):
        client.post("/v1/auth/login", json={"username": "rabia.finance", "password": "wrong"})
    with session_scope() as s:
        rows = s.execute(select(RateLimitCounter)).scalars().all()
    assert rows and all(len(r.key_hash) == 32 for r in rows)
    flat = " ".join(f"{r.scope} {r.key_hash}" for r in rows)
    assert "rabia" not in flat and "testclient" not in flat and "127.0.0.1" not in flat


def test_l8_sliding_window_weights_the_previous_window(client, tight, monkeypatch):
    t0 = (int(time.time()) // 60) * 60 + 59        # last second of a window
    monkeypatch.setattr(ratelimit.time, "time", lambda: t0)
    for _ in range(3):
        assert ratelimit.hit("chat", "cust-x")
    monkeypatch.setattr(ratelimit.time, "time", lambda: t0 + 1)   # first second of the next window: previous counts fully
    assert ratelimit.hit("chat", "cust-x", raise_on_limit=False) is False
    monkeypatch.setattr(ratelimit.time, "time", lambda: t0 + 2)   # 1 s in: previous weighted 59/60 -> 2.95 < 3
    assert ratelimit.hit("chat", "cust-x", raise_on_limit=False) is True
    monkeypatch.setattr(ratelimit.time, "time", lambda: t0 + 60)  # most of the previous window has passed
    assert ratelimit.hit("chat", "cust-x", raise_on_limit=False) is True


def test_l9_limits_can_be_raised_for_load_tests_and_old_windows_are_purged(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "rate_login_per_ip_per_minute", 1000)
    assert all(client.post("/v1/auth/login", json={"username": f"nobody{i}", "password": "x"}).status_code == 401
               for i in range(40))                  # different usernames, so no per-username lockout
    with session_scope() as s:
        s.add(RateLimitCounter(scope="chat", key_hash="0" * 32, window_start=0, count=1))
    assert ratelimit.purge_expired() >= 1
