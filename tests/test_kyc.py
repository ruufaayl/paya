"""Theme 1: digital onboarding and KYC (K1-K13).

The face engine is replaced by a deterministic mock: each test image carries a marker pixel at (0, 0)
saying which synthetic person is in it and where they are looking. No real face is used anywhere.
The real OpenCV models are exercised by K13 (skipped if they are not installed).
"""
import base64
import uuid
from datetime import date, timedelta

import cv2
import numpy as np
import pytest
from sqlalchemy import select, text, update

from conftest import login
from paya import kyc, kyc_engines
from paya.db import session_scope
from paya.kyc_engines import Face
from paya.models import AuditLog, Customer, KYCApplication, now
from paya.registry import parse_qr, qr_payload, registry
from paya.seed import DEMO_PASSWORD
from paya.specimen_card import render

LAHORE = {"lat": 31.5204, "lon": 74.3587, "accuracy": 30}
YAW = {"CENTER": 0, "LEFT": 1, "RIGHT": 2}


class MockFaceEngine:
    """Reads the marker pixel: R=255 means a face, B = identity, G = gaze (0 centre, 1 left, 2 right, 3 two faces)."""
    name = "mock-face-engine"

    def detect(self, img):
        b, g, r = (int(v) for v in img[0, 0])
        if r != 255:
            return []
        offset = {0: 0.0, 1: 12.0, 2: -12.0, 3: 0.0}[g]
        face = Face(box=(60, 60, 80, 80), landmarks=((80, 80), (120, 80), (100 + offset, 100), (85, 120), (115, 120)),
                    score=0.95)
        faces = [face]
        if g == 3:
            faces.append(Face(box=(10, 10, 70, 70), landmarks=face.landmarks, score=0.9))
        return faces

    def embed(self, img, face):
        return np.array([int(img[0, 0][0])], dtype=np.float32)

    def similarity(self, a, b):
        d = abs(int(a[0]) - int(b[0]))
        return 0.9 if d == 0 else (0.33 if d == 1 else 0.05)


@pytest.fixture(autouse=True)
def mock_faces():
    kyc_engines.set_face_engine(MockFaceEngine())
    registry.reset()
    yield
    kyc_engines.clear_face_engine()
    registry.reset()


def png(img) -> str:
    return "data:image/png;base64," + base64.b64encode(cv2.imencode(".png", img)[1].tobytes()).decode()


def mark(img, identity: int, gaze: int = 0, face: bool = True):
    img = img.copy()
    img[0, 0] = (identity, gaze, 255 if face else 0)
    return img


def card_for(spec: dict, identity: int = 7) -> str:
    c = render(full_name=spec["full_name"], date_of_birth=date.fromisoformat(spec["date_of_birth"]),
               specimen_id=spec["specimen_id"], expires_on=date.fromisoformat(spec["expires_on"]),
               qr_payload=spec["qr_payload"])
    return png(mark(c, identity))


def selfie(identity: int, step: str, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    img = rng.integers(60, 200, (240, 240, 3), dtype=np.uint8)
    gaze = YAW[step] if isinstance(step, str) else step
    return {"step": step if isinstance(step, str) else "CENTER", "image": png(mark(img, identity, gaze))}


def start(client, name="Hira Qureshi", dob="1999-05-02", username=None, **over):
    body = {"full_name": name, "date_of_birth": dob, "mobile": "0300 1234567",
            "username": username or name.split()[0].lower() + "." + str(abs(hash(name)) % 1000),
            "password": "correct-horse-battery", "accept_terms": True, "biometric_consent": True, **over}
    r = client.post("/v1/onboarding/start", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    out["h"] = {"Authorization": f"Bearer {out['onboarding_token']}"}
    out["username"] = body["username"]
    return out


def document(client, app, identity=7, spec=None):
    spec = spec or client.post("/v1/onboarding/specimen", headers=app["h"]).json()
    img = card_for(spec, identity)
    r = client.post("/v1/onboarding/document", headers=app["h"], json={"image": img})
    assert r.status_code == 200, r.text
    return spec, img, r.json()


def frames_for(challenge: dict, identity: int, swap: bool = False, seed: int = 1) -> list[dict]:
    steps = list(challenge["steps"])
    if swap:
        steps[1], steps[2] = steps[2], steps[1]
    out = []
    for i, st in enumerate(challenge["steps"]):
        f = selfie(identity, steps[i], seed + i)
        f["step"] = st
        out.append(f)
    return out


def verify(client, app, doc_img, identity=7, geo=LAHORE, swap=False, seed=1):
    ch = client.post("/v1/onboarding/liveness/challenge", headers=app["h"]).json()
    r = client.post("/v1/onboarding/verify", headers=app["h"], json={
        "nonce": ch["nonce"], "document_image": doc_img, "frames": frames_for(ch, identity, swap, seed),
        "geolocation": geo})
    return ch, r


def full(client, name="Hira Qureshi", identity_doc=7, identity_face=7, geo=LAHORE, **kw):
    app = start(client, name=name, **kw)
    spec, img, res = document(client, app, identity_doc)
    assert res["accepted"], res
    _, r = verify(client, app, img, identity_face, geo)
    assert r.status_code == 200, r.text
    return app, spec, r.json()


def app_row(ref: str) -> dict:
    with session_scope() as s:
        a = s.execute(select(KYCApplication).where(KYCApplication.ref == ref)).scalar_one()
        return {"state": a.state, "reasons": a.decision_reasons, "customer_id": a.customer_id,
                "password_hash": a.password_hash, "decision": a.decision}


# ------------------------------------------------------------------ K1
def test_k1_happy_path_opens_a_tier1_wallet_that_can_pay(client, as_):
    app, spec, out = full(client)
    assert out["outcome"] == "APPROVED" and out["tier"] == 1
    row = app_row(app["ref"])
    assert row["decision"] == "AUTO_APPROVED" and row["password_hash"] is None  # moved to users, not kept twice
    with session_scope() as s:
        c = s.get(Customer, row["customer_id"])
        assert (c.kyc_status, c.kyc_tier, c.risk_rating) == ("VERIFIED", 1, "LOW")
        assert c.idv_token.startswith("idv_") and spec["specimen_id"] not in c.idv_token
    r = client.post("/v1/auth/login", json={"username": app["username"], "password": "correct-horse-battery"})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/v1/wallet", headers=h).json()["ledger_balance"]["minor"] == 5_000_00
    pr = client.post("/v1/payment-requests", headers=as_("ayesha.cashier"),
                     json={"amount_minor": 450_00, "order_ref": "ORD-KYC-1"}).json()["id"]
    pay = client.post("/v1/payments", headers={**h, "Idempotency-Key": uuid.uuid4().hex}, json={"payment_request_id": pr})
    assert pay.status_code == 202, pay.text
    assert client.get("/v1/audit/verify", headers=as_("auditor")).json()["chain_intact"] is True


# ------------------------------------------------------------------ K2
def test_k2_consent_age_and_username_rules(client):
    base = {"full_name": "Ali Raza", "date_of_birth": "2000-01-01", "mobile": "03001234567", "username": "ali.r",
            "password": "correct-horse-battery", "accept_terms": True, "biometric_consent": True}
    assert client.post("/v1/onboarding/start", json={**base, "biometric_consent": False}).status_code == 422
    young = (now().date() - timedelta(days=17 * 365)).isoformat()
    assert client.post("/v1/onboarding/start", json={**base, "date_of_birth": young}).status_code == 422
    assert client.post("/v1/onboarding/start", json={**base, "username": "sara"}).status_code == 422  # seeded user
    r = client.post("/v1/onboarding/start", json=base)
    assert r.status_code == 201
    with session_scope() as s:
        a = s.execute(select(KYCApplication).where(KYCApplication.ref == r.json()["ref"])).scalar_one()
        assert a.mobile_masked == "+92 3xx xxx 4567"  # only the last four digits are kept


# ------------------------------------------------------------------ K3
def test_k3_document_problems_are_explained_and_forgery_is_referred(client):
    app = start(client)
    blank = png(np.full((400, 640, 3), 128, np.uint8))
    r = client.post("/v1/onboarding/document", headers=app["h"], json={"image": blank}).json()
    assert not r["accepted"] and "BLURRY" in r["problems"] and "CODE_NOT_FOUND" in r["problems"]
    r = client.post("/v1/onboarding/document", headers=app["h"], json={"image": "data:image/gif;base64,R0lGODlh"})
    assert r.json()["problems"] == ["IMAGE_TYPE_NOT_ALLOWED"]
    # someone else's specimen: names do not match
    other = registry.issue_specimen("Bilal Haider", date(1999, 5, 2))
    spec = {"full_name": other.full_name, "date_of_birth": "1999-05-02", "specimen_id": other.specimen_id,
            "expires_on": other.expires_on.isoformat(),
            "qr_payload": qr_payload(other.specimen_id, other.full_name, other.date_of_birth, other.expires_on)}
    _, _, res = document(client, app, spec=spec)
    assert "NAME_DOES_NOT_MATCH" in res["problems"]
    # a forged code (edited name, old signature) is referred to a person immediately
    good = client.post("/v1/onboarding/specimen", headers=app["h"]).json()
    forged = good["qr_payload"].replace("|1999-05-02|", "|1999-05-03|")
    _, _, res = document(client, app, spec={**good, "qr_payload": forged})
    assert res["problems"] == ["DOCUMENT_REFERRED"]
    assert app_row(app["ref"])["state"] == "REFERRED"
    assert parse_qr(forged)["signature_valid"] is False


# ------------------------------------------------------------------ K4
def test_k4_liveness_retries_single_use_nonce_then_referral(client):
    app = start(client)
    _, img, _ = document(client, app)
    ch, r = verify(client, app, img, swap=True)  # turns in the wrong order
    assert r.json()["outcome"] == "RETRY" and r.json()["reason"].startswith("TURN_FURTHER")
    replay = client.post("/v1/onboarding/verify", headers=app["h"], json={
        "nonce": ch["nonce"], "document_image": img, "frames": frames_for(ch, 7), "geolocation": LAHORE})
    assert replay.status_code == 409  # a challenge can be answered once
    # the same frame sent three times is a replay, not a live person
    ch = client.post("/v1/onboarding/liveness/challenge", headers=app["h"]).json()
    f = selfie(7, "CENTER", 9)
    same = [{**f, "step": st} for st in ch["steps"]]
    r = client.post("/v1/onboarding/verify", headers=app["h"], json={
        "nonce": ch["nonce"], "document_image": img, "frames": same, "geolocation": LAHORE})
    assert r.json()["outcome"] == "RETRY" and r.json()["reason"] == "REPEATED_FRAME"
    _, r = verify(client, app, img, swap=True, seed=20)  # third failure
    assert r.json()["outcome"] == "REFERRED"
    assert any(x.startswith("LIVENESS_") for x in app_row(app["ref"])["reasons"])


# ------------------------------------------------------------------ K5
def test_k5_face_mismatch_and_grey_zone_go_to_a_person(client):
    app, _, out = full(client, name="Imran Sheikh", identity_doc=7, identity_face=40)
    assert out["outcome"] == "REFERRED" and "FACE_NO_MATCH" in app_row(app["ref"])["reasons"]
    app, _, out = full(client, name="Maria Javed", identity_doc=7, identity_face=8)
    assert out["outcome"] == "REFERRED" and "FACE_GREY_ZONE" in app_row(app["ref"])["reasons"]
    with session_scope() as s:
        assert s.execute(select(Customer).where(Customer.full_name.in_(["Imran Sheikh", "Maria Javed"]))).first() is None


# ------------------------------------------------------------------ K6
def test_k6_unknown_answers_refer_never_decide(client, as_):
    r = client.post("/v1/chaos/registry", headers=as_("admin"), json={"mode": "TIMEOUT"})
    assert r.status_code == 200
    app, _, out = full(client, name="Usman Tariq")
    assert out["outcome"] == "REFERRED" and "REGISTRY_TIMEOUT" in app_row(app["ref"])["reasons"]
    registry.reset()
    kyc_engines.set_face_engine(None)  # models missing
    app, _, out = full(client, name="Sana Mir")
    assert out["outcome"] == "REFERRED" and "FACE_ENGINE_UNAVAILABLE" in app_row(app["ref"])["reasons"]
    kyc_engines.set_face_engine(MockFaceEngine())
    app, _, out = full(client, name="Adeel Khan", geo=None)
    assert "GEOLOCATION_NOT_SHARED" in app_row(app["ref"])["reasons"]
    app, _, out = full(client, name="Rubina Shah", geo={"lat": 25.2, "lon": 55.27})  # Dubai
    assert "GEOLOCATION_OUTSIDE_PAKISTAN" in app_row(app["ref"])["reasons"]


# ------------------------------------------------------------------ K7
def test_k7_watchlist_potential_match_needs_two_officers_and_no_tipping_off(client, as_):
    app, _, out = full(client, name="Zarak Khanzad")  # one letter from a synthetic watch-list entry
    assert out["outcome"] == "REFERRED"
    assert "screen" not in out["message"].lower() and "watch" not in out["message"].lower()
    status = client.get("/v1/onboarding/status", headers=app["h"]).json()
    assert "checks" not in status and "reasons" not in status
    detail = client.get(f"/v1/kyc/applications/{app['ref']}", headers=as_("hamza.compliance")).json()
    assert detail["two_person_rule"] and "SCREENING_POTENTIAL_MATCH" in detail["reasons"]
    url = f"/v1/compliance/kyc/{app['ref']}/decision"
    r = client.post(url, headers=as_("hamza.compliance"), json={"decision": "APPROVE", "reason": "different DOB on list"})
    assert r.json()["status"] == "AWAITING_SECOND_OFFICER"
    r = client.post(url, headers=as_("hamza.compliance"), json={"decision": "APPROVE", "reason": "approving again"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "SEGREGATION_OF_DUTIES"
    with session_scope() as s:
        denied = s.execute(select(AuditLog).where(AuditLog.action == "KYC_APPROVE", AuditLog.outcome == "DENIED")).scalars().all()
        assert len(denied) == 1  # the refusal is recorded even though the action rolled back
    r = client.post(url, headers=as_("nadia.compliance"), json={"decision": "APPROVE", "reason": "confirmed false positive"})
    assert r.json()["state"] == "APPROVED"
    with session_scope() as s:
        c = s.get(Customer, app_row(app["ref"])["customer_id"])
        assert c.risk_rating == "MEDIUM"
        # the database itself refuses one person in both roles
        a = s.execute(select(KYCApplication).where(KYCApplication.ref == app["ref"])).scalar_one()
        assert (a.recommended_by, a.decided_by) == ("hamza.compliance", "nadia.compliance")
    with pytest.raises(Exception):
        with session_scope() as s:
            s.execute(update(KYCApplication).where(KYCApplication.ref == app["ref"]).values(decided_by="hamza.compliance"))


# ------------------------------------------------------------------ K8
def test_k8_one_identity_one_wallet(client):
    app1, spec, out = full(client, name="Hira Qureshi", username="hira.one")
    assert out["outcome"] == "APPROVED"
    app2 = start(client, name="Hira Qureshi", username="hira.two")
    _, img, res = document(client, app2, spec=spec)  # same specimen card again
    assert res["accepted"]
    _, r = verify(client, app2, img)
    assert r.json()["outcome"] == "REFERRED" and "DUPLICATE_IDENTITY" in app_row(app2["ref"])["reasons"]


# ------------------------------------------------------------------ K9
def test_k9_no_image_or_template_is_ever_stored(client):
    full(client)
    full(client, name="Zarak Khanzad")
    with session_scope() as s:
        cols = s.execute(text("""SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
                                 WHERE table_schema IN ('public','rail','registry')""")).all()
        assert not [c for c in cols if c.data_type == "bytea"], "no binary columns anywhere"
        for schema, table, column, dtype in cols:
            if dtype not in ("text", "character varying", "jsonb"):
                continue
            hit = s.execute(text(f'SELECT count(*) FROM "{schema}"."{table}" WHERE "{column}"::text LIKE ANY '
                                 "(ARRAY['%/9j/%','%iVBORw0KGgo%','%data:image%'])")).scalar_one()
            assert hit == 0, f"image data found in {schema}.{table}.{column}"
            longest = s.execute(text(f'SELECT coalesce(max(length("{column}"::text)),0) FROM "{schema}"."{table}"')).scalar_one()
            if table in ("kyc_checks", "kyc_applications"):
                assert longest < 2000, f"{table}.{column} holds {longest} chars"


# ------------------------------------------------------------------ K10
def test_k10_abandoned_applications_are_purged(client):
    app = start(client, name="Nimra Aslam")
    document(client, app)
    with session_scope() as s:
        s.execute(update(KYCApplication).where(KYCApplication.ref == app["ref"])
                  .values(updated_at=now() - timedelta(hours=73)))
    assert kyc.abandon_stale() == 1
    with session_scope() as s:
        a = s.execute(select(KYCApplication).where(KYCApplication.ref == app["ref"])).scalar_one()
        assert a.state == "ABANDONED" and a.full_name == "[purged]" and a.date_of_birth is None
        assert a.id_number_hash is None and a.document_data == {} and a.password_hash is None


# ------------------------------------------------------------------ K11
def test_k11_applicant_token_is_narrow_and_staff_roles_are_separated(client, as_):
    app = start(client)
    assert client.get("/v1/wallet", headers=app["h"]).status_code == 403
    assert client.get("/v1/kyc/applications", headers=app["h"]).status_code == 403
    assert client.get("/v1/kyc/applications", headers=as_("sara")).status_code == 403
    _, _, out = full(client, name="Zarak Khanzad")
    ref = client.get("/v1/kyc/applications?state=REFERRED", headers=as_("auditor")).json()[0]["ref"]
    body = {"decision": "REJECT", "reason": "confirmed true match"}
    assert client.post(f"/v1/compliance/kyc/{ref}/decision", headers=as_("sana.ops"), json=body).status_code == 403
    assert client.post(f"/v1/compliance/kyc/{ref}/decision", headers=as_("hamza.compliance"), json=body).json()["state"] == "REJECTED"
    cases = client.get("/v1/cases?state=ALL", headers=as_("hamza.compliance")).json()
    assert any(c["kind"] == "KYC_REVIEW" and c["state"] == "RESOLVED" for c in cases)


# ------------------------------------------------------------------ K12
def test_k12_more_info_lets_the_applicant_retake_the_document(client, as_):
    app = start(client, name="Kashif Ali")
    spec = client.post("/v1/onboarding/specimen", headers=app["h"]).json()
    for _ in range(5):
        client.post("/v1/onboarding/document", headers=app["h"], json={"image": png(np.full((300, 480, 3), 128, np.uint8))})
    assert app_row(app["ref"])["state"] == "REFERRED"
    r = client.post(f"/v1/compliance/kyc/{app['ref']}/decision", headers=as_("hamza.compliance"),
                    json={"decision": "MORE_INFO", "reason": "photos were blank"})
    assert r.json()["state"] == "MORE_INFO"
    _, img, res = document(client, app, spec=spec)
    assert res["accepted"] and res["state"] == "DOCUMENT_OK"
    _, r = verify(client, app, img)
    assert r.json()["outcome"] == "APPROVED"


# ------------------------------------------------------------------ K13
@pytest.mark.skipif(not kyc_engines.models_present("models"), reason="face models not installed (make models)")
def test_k13_real_models_load_and_never_approve_without_a_face(client):
    real = kyc_engines.OpenCVFaceEngine("models")
    kyc_engines.set_face_engine(real)
    app = start(client, name="Real Engine")
    spec = client.post("/v1/onboarding/specimen", headers=app["h"]).json()
    c = render(full_name=spec["full_name"], date_of_birth=date.fromisoformat(spec["date_of_birth"]),
               specimen_id=spec["specimen_id"], expires_on=date.fromisoformat(spec["expires_on"]),
               qr_payload=spec["qr_payload"])
    res = client.post("/v1/onboarding/document", headers=app["h"], json={"image": png(c)}).json()
    assert not res["accepted"] and res["problems"] == ["NO_FACE_ON_DOCUMENT"]  # placeholder silhouette is not a face
    assert real.detect(np.full((240, 240, 3), 128, np.uint8)) == []


# ------------------------------------------------------------------ K14
@pytest.mark.skipif(not kyc_engines.models_present("models"), reason="face models not installed (make models)")
def test_k14_real_models_end_to_end_with_a_drawn_synthetic_face(client):
    """Real YuNet + SFace on a drawn face: document face found, head turns measured, match passes, wallet opens."""
    from synthetic_faces import drawn_face
    kyc_engines.set_face_engine(kyc_engines.OpenCVFaceEngine("models"))
    app = start(client, name="Drawn Person", username="drawn.person")
    spec = client.post("/v1/onboarding/specimen", headers=app["h"]).json()
    card = render(full_name=spec["full_name"], date_of_birth=date.fromisoformat(spec["date_of_birth"]),
                  specimen_id=spec["specimen_id"], expires_on=date.fromisoformat(spec["expires_on"]),
                  qr_payload=spec["qr_payload"], photo=drawn_face(0))
    doc = png(card)
    res = client.post("/v1/onboarding/document", headers=app["h"], json={"image": doc}).json()
    assert res["accepted"], res
    ch = client.post("/v1/onboarding/liveness/challenge", headers=app["h"]).json()
    turn = {"CENTER": 0.0, "LEFT": 1.0, "RIGHT": -1.0}
    wrong = [{"step": st, "image": png(drawn_face(0.0 if st == "CENTER" else 0.2))} for st in ch["steps"]]
    r = client.post("/v1/onboarding/verify", headers=app["h"], json={
        "nonce": ch["nonce"], "document_image": doc, "frames": wrong, "geolocation": LAHORE}).json()
    assert r["outcome"] == "RETRY"  # a small nod is not a head turn
    ch = client.post("/v1/onboarding/liveness/challenge", headers=app["h"]).json()
    frames = [{"step": st, "image": png(drawn_face(turn[st]))} for st in ch["steps"]]
    r = client.post("/v1/onboarding/verify", headers=app["h"], json={
        "nonce": ch["nonce"], "document_image": doc, "frames": frames, "geolocation": LAHORE}).json()
    assert r["outcome"] == "APPROVED", r
    with session_scope() as s:
        a = s.execute(select(KYCApplication).where(KYCApplication.ref == app["ref"])).scalar_one()
        checks = {c["check"]: c for c in kyc.backoffice_view(s, a)["checks"]}
    assert checks["FACE_MATCH"]["score"] >= 0.363 and checks["FACE_MATCH"]["engine"].startswith("opencv-yunet")
    ratios = checks["LIVENESS"]["evidence"]["ratios"]
    assert abs(ratios[0]) < 0.1 and all(abs(x) > 0.18 for x in ratios[1:])


# ------------------------------------------------------------------ K15
def test_k15_integrity_monitor_covers_onboarding(client, as_):
    full(client)
    full(client, name="Zarak Khanzad")
    checks = {c["check"]: c for c in client.get("/v1/finance/integrity", headers=as_("rabia.finance")).json()["checks"]}
    assert checks["kyc_auto_approval_only_when_all_checks_pass"]["status"] == "PASS"
    assert checks["kyc_approved_has_verified_customer"]["status"] == "PASS"
    with session_scope() as s:  # simulate a bug that auto-approves despite a referral
        s.execute(update(KYCApplication).where(KYCApplication.full_name == "Zarak Khanzad")
                  .values(decision="AUTO_APPROVED"))
    checks = {c["check"]: c for c in client.get("/v1/finance/integrity", headers=as_("rabia.finance")).json()["checks"]}
    assert checks["kyc_auto_approval_only_when_all_checks_pass"]["status"] == "FAIL"
