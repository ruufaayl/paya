import os
import uuid

import pytest

# Two roles, as in production (ADR-015): migrations run as the owner; the app (and so every test) runs as
# paya_app, which has data privileges only. CI sets these to its own service credentials.
os.environ.setdefault("PAYA_MIGRATION_DATABASE_URL", "postgresql+psycopg://paya@localhost:5433/paya_test")
os.environ.setdefault("PAYA_DATABASE_URL", "postgresql+psycopg://paya_app:paya-app-test-only@localhost:5433/paya_test")
os.environ.setdefault("PAYA_APP_DB_PASSWORD", "paya-app-test-only")
os.environ.setdefault("PAYA_JWT_SECRET", "test-secret-at-least-32-bytes-long!!")

from fastapi.testclient import TestClient  # noqa: E402

from paya import db, events  # noqa: E402
from paya.config import get_settings  # noqa: E402
from paya.rail import breaker, chaos  # noqa: E402
from paya.seed import DEMO_PASSWORD  # noqa: E402


@pytest.fixture()
def client():
    db.reset_engine(os.environ["PAYA_DATABASE_URL"])
    db.drop_schema()
    events.reset_for_tests()
    chaos.reset()
    breaker.reset()
    from paya.observability import login_guard, metrics
    login_guard.reset()
    metrics.reset()
    from paya.api.main import app

    app.state.disable_worker = True
    with TestClient(app) as c:
        yield c
    chaos.reset()
    breaker.reset()


def login(client, username: str) -> dict:
    r = client.post("/v1/auth/login", json={"username": username, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def as_(client):
    cache = {}

    def _h(username: str) -> dict:
        if username not in cache:
            cache[username] = login(client, username)
        return cache[username]
    return _h


def new_request(client, as_, amount_minor: int = 245_000, cashier: str = "ayesha.cashier") -> str:
    r = client.post("/v1/payment-requests", headers=as_(cashier),
                    json={"amount_minor": amount_minor, "order_ref": f"ORD-{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def pay(client, as_, pr_id: str, key: str | None = None, customer: str = "sara"):
    return client.post("/v1/payments", headers={**as_(customer), "Idempotency-Key": key or uuid.uuid4().hex},
                       json={"payment_request_id": pr_id})


def detail(client, as_, ref: str, who: str = "auditor") -> dict:
    r = client.get(f"/v1/transactions/{ref}", headers=as_(who))
    assert r.status_code == 200, r.text
    return r.json()


def wallet_minor(client, as_, customer: str = "sara") -> int:
    return client.get("/v1/wallet", headers=as_(customer)).json()["ledger_balance"]["minor"]


@pytest.fixture()
def settings():
    return get_settings()
