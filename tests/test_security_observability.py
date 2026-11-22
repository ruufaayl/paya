"""Week 13 security/observability gate: brute-force lockout, headers, metrics, structured logs, scrubbing."""
import json

from sqlalchemy import select

from paya.db import session_scope
from paya.models import AuditLog
from paya.observability import JsonFormatter, scrub

from conftest import new_request, pay


def test_login_locks_after_five_failures_and_denials_are_audited(client):
    for _ in range(5):
        assert client.post("/v1/auth/login", json={"username": "rufayl.finance", "password": "wrong"}).status_code == 401
    r = client.post("/v1/auth/login", json={"username": "rufayl.finance", "password": "paya-demo-2026"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "LOGIN_LOCKED"   # even the right password
    with session_scope() as s:
        rows = s.execute(select(AuditLog).where(AuditLog.actor == "rufayl.finance", AuditLog.outcome == "DENIED")).scalars().all()
    assert len(rows) == 6 and rows[-1].reason.startswith("locked")
    # other users are unaffected
    assert client.post("/v1/auth/login", json={"username": "mudaser.ops", "password": "paya-demo-2026"}).status_code == 200


def test_security_headers_and_correlation_id(client, as_):
    r = client.get("/v1/wallet", headers={**as_("sara"), "X-Correlation-ID": "corr-test-123"})
    assert r.headers["X-Correlation-ID"] == "corr-test-123"
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["Cache-Control"] == "no-store"
    assert r.headers["X-Frame-Options"] == "DENY"
    bad = client.get("/v1/wallet", headers={**as_("sara"), "X-Correlation-ID": "<script>alert(1)</script>"})
    assert bad.headers["X-Correlation-ID"].startswith("corr-")   # malformed ids are replaced, not echoed


def test_prometheus_metrics_expose_business_and_http_signals(client, as_):
    pay(client, as_, new_request(client, as_, 5_000))
    text = client.get("/metrics").text
    for needle in ("paya_payments_total{status=\"SETTLED\"}", "paya_in_transit_minor", "paya_rail_breaker_open",
                   "paya_outbox_unpublished", 'paya_http_requests_total{route="/v1/payments",method="POST",status="2xx"} 1',
                   'paya_http_request_duration_ms_bucket{route="/v1/payments",method="POST",le="+Inf"} 1'):
        assert needle in text, needle


def test_logs_are_json_with_correlation_and_secrets_are_scrubbed(client, as_, capsys):
    client.post("/v1/payments", headers={**as_("sara"), "Idempotency-Key": "k" * 20, "X-Correlation-ID": "corr-log-1"},
                json={"payment_request_id": new_request(client, as_, 1_000)})
    lines = [json.loads(l) for l in capsys.readouterr().out.splitlines() if l.startswith("{")]
    req = [l for l in lines if l["msg"] == "http_request" and l.get("correlation_id") == "corr-log-1"]
    assert req and req[0]["route"] == "/v1/payments" and "duration_ms" in req[0]
    risk = [l for l in lines if l["msg"].startswith("risk.")]       # business telemetry is logged too ...
    assert risk and risk[0]["correlation_id"] == "corr-log-1"     # ... under the same correlation id
    assert scrub({"password": "x", "nested": {"Authorization": "Bearer y", "amount": 5}}) == \
        {"password": "***", "nested": {"Authorization": "***", "amount": 5}}
    import logging
    rec = logging.LogRecord("paya", logging.INFO, "", 0, "m", None, None)
    rec.fields = {"token": "secret-value", "txn_ref": "PAYA-1"}
    out = json.loads(JsonFormatter().format(rec))
    assert out["token"] == "***" and out["txn_ref"] == "PAYA-1"
