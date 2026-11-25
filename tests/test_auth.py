"""ADR-017: sessions, token revocation and staff MFA (A1-A13)."""
import base64
import time
import uuid

import pytest
from sqlalchemy import select, update

from conftest import login
from paya import auth
from paya.db import session_scope
from paya.models import AuditLog, User
from paya.seed import DEMO_PASSWORD


def raw_login(client, username):
    r = client.post("/v1/auth/login", json={"username": username, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def enrol(client, username="kanz.compliance"):
    tok = raw_login(client, username)["access_token"]
    secret = client.post("/v1/auth/mfa/enrol", headers=bearer(tok)).json()["secret"]
    r = client.post("/v1/auth/mfa/enrol/confirm", headers=bearer(tok), json={"code": auth.totp(secret)})
    assert r.status_code == 200, r.text
    return tok, secret


def next_code(secret):            # the code for the next 30-s step: valid (drift +1) and not yet used
    return auth.totp(secret, time.time() + 30)


def test_a1_totp_matches_the_rfc_6238_test_vectors():
    key = b"12345678901234567890"
    for t, want in ((59, "94287082"), (1111111109, "07081804"), (1234567890, "89005924"), (2000000000, "69279037")):
        assert auth.hotp(key, t // 30, digits=8) == want
    secret = base64.b32encode(key).decode()
    assert auth.totp(secret, 59) == "287082"


def test_a2_sign_out_revokes_the_token_immediately(client):
    tok = raw_login(client, "sara")["access_token"]
    assert client.get("/v1/me", headers=bearer(tok)).status_code == 200
    assert client.post("/v1/auth/logout", headers=bearer(tok)).status_code == 200
    r = client.get("/v1/wallet", headers=bearer(tok))
    assert r.status_code == 401 and r.json()["error"]["reason"] == "signed out"


def test_a3_sign_out_everywhere_else_keeps_only_this_session(client):
    old, new = raw_login(client, "sara")["access_token"], raw_login(client, "sara")["access_token"]
    assert client.post("/v1/auth/sessions/revoke-others", headers=bearer(new)).json()["revoked"] == 1
    assert client.get("/v1/me", headers=bearer(old)).status_code == 401
    assert client.get("/v1/me", headers=bearer(new)).status_code == 200
    rows = client.get("/v1/auth/sessions", headers=bearer(new)).json()
    assert [r["status"] for r in rows if r["current"]] == ["active"] and any(r["status"] == "revoked" for r in rows)


def test_a4_deactivating_a_user_ends_their_sessions_at_once(client):
    tok = raw_login(client, "ateeq.ops")["access_token"]
    with session_scope() as s:
        s.execute(update(User).where(User.username == "ateeq.ops").values(active=False))
    assert client.get("/v1/me", headers=bearer(tok)).status_code == 401


def test_a5_admin_revocation_is_sysadmin_only_and_audited(client, as_):
    victim = raw_login(client, "mudaser.ops")["access_token"]
    body = {"reason": "laptop reported stolen"}
    assert client.post("/v1/admin/users/mudaser.ops/sessions/revoke", headers=as_("kanz.compliance"), json=body).status_code == 403
    r = client.post("/v1/admin/users/mudaser.ops/sessions/revoke", headers=as_("admin"), json=body)
    assert r.status_code == 200 and r.json()["sessions_revoked"] >= 1
    assert client.get("/v1/me", headers=bearer(victim)).status_code == 401
    log = client.get("/v1/audit/log?action=SESSIONS_REVOKED", headers=as_("taha.audit")).json()
    assert log["items"][0]["actor"] == "admin" and log["chain_intact"]


def test_a6_enrolled_staff_need_a_code_and_the_challenge_is_not_an_access_token(client):
    _, secret = enrol(client)
    r = raw_login(client, "kanz.compliance")
    assert r["mfa_required"] is True and "access_token" not in r
    assert client.get("/v1/me", headers=bearer(r["challenge"])).status_code == 401      # password alone: no access
    v = client.post("/v1/auth/mfa/verify", json={"challenge": r["challenge"], "code": next_code(secret)})
    assert v.status_code == 200 and v.json()["mfa"] is True
    me = client.get("/v1/me", headers=bearer(v.json()["access_token"])).json()
    assert me["security"]["mfa_enrolled"] and me["security"]["session_mfa"]


def test_a7_a_code_works_once(client):
    _, secret = enrol(client)
    code = next_code(secret)
    c1, c2 = raw_login(client, "kanz.compliance")["challenge"], raw_login(client, "kanz.compliance")["challenge"]
    assert client.post("/v1/auth/mfa/verify", json={"challenge": c1, "code": code}).status_code == 200
    assert client.post("/v1/auth/mfa/verify", json={"challenge": c2, "code": code}).status_code == 401


def test_a8_wrong_codes_are_limited_and_audited(client, as_):
    _, secret = enrol(client)
    ch = raw_login(client, "kanz.compliance")["challenge"]
    codes = [client.post("/v1/auth/mfa/verify", json={"challenge": ch, "code": "000000"}).status_code for _ in range(5)]
    assert codes == [401] * 5
    r = client.post("/v1/auth/mfa/verify", json={"challenge": ch, "code": next_code(secret)})
    assert r.status_code == 429                                                         # even the right code now
    with session_scope() as s:
        n = len(s.execute(select(AuditLog).where(AuditLog.action == "MFA_FAILED")).scalars().all())
    assert n == 5


def test_a9_enforced_mode_staff_must_enrol_before_any_access(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "mfa_enforced", True)
    r = raw_login(client, "rufayl.finance")
    assert r["mfa_setup_required"] is True and "access_token" not in r
    setup = client.post("/v1/auth/mfa/setup", json={"challenge": r["challenge"]}).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/") and setup["secret"] in setup["otpauth_uri"]
    bad = client.post("/v1/auth/mfa/setup/confirm", json={"challenge": r["challenge"], "code": "123456"})
    assert bad.status_code == 401
    ok = client.post("/v1/auth/mfa/setup/confirm", json={"challenge": r["challenge"], "code": auth.totp(setup["secret"])})
    assert ok.status_code == 200 and ok.json()["enrolled"] and ok.json()["access_token"]
    assert "access_token" in raw_login(client, "sara")                                  # customers are not affected


def test_a10_secrets_are_encrypted_and_bound_to_their_user(client):
    _, secret = enrol(client)
    with session_scope() as s:
        u = s.execute(select(User).where(User.username == "kanz.compliance")).scalar_one()
        blob, uid = u.mfa_secret_enc, u.id
    assert secret not in blob and base64.b32decode(secret + "=" * (-len(secret) % 8)) not in base64.b64decode(blob)
    assert auth.decrypt(blob, uid) == secret
    with pytest.raises(Exception):
        auth.decrypt(blob, uuid.uuid4())                                                # copied to another user: fails


def test_a11_admin_mfa_reset_revokes_sessions_and_never_applies_to_yourself(client, as_):
    tok, _ = enrol(client)
    body = {"reason": "lost phone, identity checked"}
    assert client.post("/v1/admin/users/admin/mfa/reset", headers=as_("admin"), json=body).status_code == 403
    r = client.post("/v1/admin/users/kanz.compliance/mfa/reset", headers=as_("admin"), json=body)
    assert r.status_code == 200 and r.json()["mfa_reset"] is True
    assert client.get("/v1/me", headers=bearer(tok)).status_code == 401
    assert "access_token" in raw_login(client, "kanz.compliance")                      # demo mode: not enforced


def test_a12_enrolling_ends_your_other_sessions_that_had_no_second_factor(client):
    other = raw_login(client, "kanz.compliance")["access_token"]
    current, _ = enrol(client)
    assert client.get("/v1/me", headers=bearer(other)).status_code == 401
    assert client.get("/v1/me", headers=bearer(current)).status_code == 200


def test_a13_revoked_token_cannot_open_the_live_stream(client):
    tok = raw_login(client, "mudaser.ops")["access_token"]
    client.post("/v1/auth/logout", headers=bearer(tok))
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect(f"/v1/stream?token={tok}") as ws:
            ws.receive_text()
    assert e.value.code == 4401


def test_conftest_login_still_works(client):
    assert "Authorization" in login(client, "sara")
