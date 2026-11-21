"""Digital onboarding and KYC (Theme 1): open a tier-1 wallet from a phone, with synthetic identities only.

Journey  start (consent + details) -> document photo -> liveness challenge -> verify -> decision
States   STARTED -> DOCUMENT_OK -> APPROVED | REFERRED
         REFERRED -> APPROVED | REJECTED | MORE_INFO ;  MORE_INFO -> DOCUMENT_OK ;  idle 72 h -> ABANDONED

Decision principles (rules kyc.v1)
  1. Machines may say yes to clear cases. Only people say no. Every non-pass goes to Compliance.
  2. An unknown answer (registry timeout, model missing) is a referral, never an approval or a rejection.
  3. Loosening needs two people: approving a possible watch-list match needs a second compliance officer.
  4. No tipping off: the applicant is never told that screening was the reason for a referral.
  5. Images and face templates live only in memory for the length of one request.
"""
import base64
import uuid
from datetime import date, datetime, timedelta

import cv2
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from . import audit, events, ledger
from . import kyc_engines as eng
from .config import get_settings
from .db import session_scope
from .errors import InvalidState, NotFound, SegregationOfDuties, ValidationFailed
from .ledger import Line
from .models import Case, Consent, Customer, KYCApplication, KYCCheck, Transaction, User, now
from .payments import new_correlation_id, new_ref, open_case
from .registry import parse_qr, qr_payload, registry
from .risk import WATCHLIST
from .security import Principal, hash_password, issue_token

CONSENT_VERSION = "kyc-consent.v1"
TRANSITIONS = {
    "STARTED": {"DOCUMENT_OK", "REFERRED", "ABANDONED"},
    "DOCUMENT_OK": {"DOCUMENT_OK", "APPROVED", "REFERRED", "ABANDONED"},
    "REFERRED": {"APPROVED", "REJECTED", "MORE_INFO"},
    "MORE_INFO": {"DOCUMENT_OK", "REFERRED", "ABANDONED"},
    "APPROVED": set(), "REJECTED": set(), "ABANDONED": set(),
}
OPEN_STATES = ("STARTED", "DOCUMENT_OK", "MORE_INFO")
# Rough bounding box of Pakistan for the device-location check (synthetic rule; a real one uses geofences).
PK_BOX = (23.5, 37.2, 60.8, 77.9)
APPLICANT_MESSAGES = {
    "APPROVED": "Your Paya wallet is open. Sign in with the username and password you chose.",
    "REFERRED": "Thanks. A member of our team needs to check a few details. We will update you here.",
    "REJECTED": "We could not open a wallet for you. You can contact support for more information.",
    "MORE_INFO": "We need a clearer photo of your ID card. Please take it again.",
}


# ------------------------------------------------------------------ helpers
def _move(s: Session, app: KYCApplication, to: str, *, actor: str, reason: str) -> None:
    frm = app.state
    if to not in TRANSITIONS[frm]:
        raise InvalidState(f"application {app.ref} cannot move from {frm} to {to}")
    app.state, app.version, app.updated_at = to, app.version + 1, now()
    events.emit(s, f"kyc.{to.lower()}", aggregate_id=app.id, correlation_id=app.correlation_id,
                payload={"ref": app.ref, "from": frm, "to": to, "reason": reason, "actor": actor})
    events.telemetry("kyc", "state_changed", detail={"ref": app.ref, "from": frm, "to": to, "reason": reason},
                     level="warn" if to in ("REFERRED", "REJECTED") else "info")


def _locked(s: Session, app_id: uuid.UUID | str) -> KYCApplication:
    app = s.execute(select(KYCApplication).where(KYCApplication.id == uuid.UUID(str(app_id)))
                    .with_for_update()).scalar_one_or_none()
    if app is None:
        raise NotFound("application not found")
    return app


def _check(s: Session, app: KYCApplication, check: str, outcome: str, *, engine: str, score: float | None = None,
           reason: str | None = None, evidence: dict | None = None, digest: str | None = None) -> KYCCheck:
    row = KYCCheck(application_id=app.id, check=check, outcome=outcome, score=score, engine=engine, reason=reason,
                   evidence=evidence or {}, input_digest=digest)
    s.add(row)
    s.flush()
    events.telemetry("kyc", "check", detail={"ref": app.ref, "check": check, "outcome": outcome, "reason": reason,
                                             "score": score}, level="info" if outcome == "PASS" else "warn")
    return row


def _id_hash(specimen_id: str) -> str:
    return eng.digest(("ID:" + specimen_id.upper()).encode())


def _age(dob: date, today: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _mask_mobile(mobile: str) -> str:
    digits = "".join(c for c in mobile if c.isdigit())
    if len(digits) < 10:
        raise ValidationFailed("enter a mobile number with at least 10 digits")
    return f"+92 3xx xxx {digits[-4:]}"


def _username_taken(s: Session, username: str) -> bool:
    if s.execute(select(User.id).where(User.username == username)).first():
        return True
    return s.execute(select(KYCApplication.id).where(
        KYCApplication.username == username,
        KYCApplication.state.notin_(["REJECTED", "ABANDONED"]))).first() is not None


# ------------------------------------------------------------------ 1. start
def start(*, full_name: str, date_of_birth: date, mobile: str, username: str, password: str,
          accept_terms: bool, biometric_consent: bool, correlation_id: str | None = None) -> dict:
    if not (accept_terms and biometric_consent):
        raise ValidationFailed("onboarding needs your agreement to the terms and to processing your photos "
                               "for identity checks", field="consent")
    name = " ".join(full_name.split())
    if not (3 <= len(name) <= 128) or not all(c.isalpha() or c in " .'-" for c in name):
        raise ValidationFailed("enter your full name as it appears on your ID card", field="full_name")
    today = now().date()
    if date_of_birth > today or _age(date_of_birth, today) < 18:
        raise ValidationFailed("you must be 18 or older to open a Paya wallet", field="date_of_birth")
    if _age(date_of_birth, today) > 120:
        raise ValidationFailed("check your date of birth", field="date_of_birth")
    uname = username.strip().lower()
    if not (3 <= len(uname) <= 32) or not all(c.isalnum() or c in "._" for c in uname):
        raise ValidationFailed("usernames are 3-32 letters, numbers, dots or underscores", field="username")
    if len(password) < 10:
        raise ValidationFailed("choose a password of at least 10 characters", field="password")
    masked = _mask_mobile(mobile)  # only the last four digits are ever kept
    with session_scope() as s:
        if _username_taken(s, uname):
            raise ValidationFailed("that username is taken", field="username")
        app = KYCApplication(
            ref=new_ref("KYC"), state="STARTED", full_name=name, date_of_birth=date_of_birth, mobile_masked=masked,
            username=uname, password_hash=hash_password(password), consent_version=CONSENT_VERSION,
            biometric_consent_at=now(), rule_version=get_settings().kyc_rules_version,
            correlation_id=correlation_id or new_correlation_id())
        s.add(app)
        s.flush()
        audit.record(s, actor=f"applicant:{app.ref}", actor_role="APPLICANT", action="KYC_START",
                     object_type="kyc_application", object_id=app.ref, correlation_id=app.correlation_id,
                     details={"consent_version": CONSENT_VERSION, "biometric_consent": True})
        events.emit(s, "kyc.started", aggregate_id=app.id, correlation_id=app.correlation_id,
                    payload={"ref": app.ref})
        ref, app_id = app.ref, app.id
    events.telemetry("kyc", "started", detail={"ref": ref})
    token = issue_token(Principal(user_id=str(app_id), username=f"applicant:{ref}", role="APPLICANT"),
                        ttl_minutes=get_settings().kyc_session_minutes)
    return {"ref": ref, "state": "STARTED", "onboarding_token": token,
            "expires_in_minutes": get_settings().kyc_session_minutes}


# ------------------------------------------------------------------ specimen identity (synthetic ID card)
def issue_specimen(app_id: str) -> dict:
    """Issue a SYNTHETIC identity in the simulated registry and return the signed code for the card."""
    with session_scope() as s:
        app = _locked(s, app_id)
        if app.state not in OPEN_STATES:
            raise InvalidState(f"application is {app.state}")
        name, dob = app.full_name, app.date_of_birth
    ident = registry.issue_specimen(name, dob)
    payload = qr_payload(ident.specimen_id, ident.full_name, ident.date_of_birth, ident.expires_on)
    qr = cv2.QRCodeEncoder.create().encode(payload)
    qr = cv2.resize(qr, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)
    qr = cv2.copyMakeBorder(qr, 32, 32, 32, 32, cv2.BORDER_CONSTANT, value=255)
    png = base64.b64encode(cv2.imencode(".png", qr)[1].tobytes()).decode()
    return {"specimen_id": ident.specimen_id, "full_name": ident.full_name,
            "date_of_birth": ident.date_of_birth.isoformat(), "expires_on": ident.expires_on.isoformat(),
            "qr_payload": payload, "qr_png": f"data:image/png;base64,{png}",
            "notice": "SPECIMEN - synthetic test identity for the Paya prototype. Not an identity document."}


# ------------------------------------------------------------------ 2. document
def submit_document(app_id: str, image: str) -> dict:
    cfg = get_settings()
    try:
        img, digest = eng.decode_image(image)
    except eng.ImageRejected as exc:
        return {"accepted": False, "problems": [exc.reason]}
    q = eng.document_quality(img)
    text = eng.read_qr(img)
    face = eng.face_engine()
    faces = face.detect(img) if face else []
    with session_scope() as s:
        app = _locked(s, app_id)
        if app.state not in OPEN_STATES:
            raise InvalidState(f"application is {app.state}")
        app.document_attempts += 1
        problems = list(q["problems"])
        data = parse_qr(text) if text else None
        if text is None:
            problems.append("CODE_NOT_FOUND")
        elif data is None:
            problems.append("NOT_A_PAYA_SPECIMEN")
        if data and not data["signature_valid"]:
            # A code that parses but fails its signature is a forgery attempt: a person must look at it.
            _check(s, app, "DOCUMENT_DATA", "FAIL", engine="qr+hmac", reason="SIGNATURE_INVALID", digest=digest,
                   evidence={"specimen_id_hash": _id_hash(data["specimen_id"])[:16]})
            _refer(s, app, ["DOCUMENT_TAMPERED"], screening_hit=False)
            return {"accepted": False, "state": app.state, "problems": ["DOCUMENT_REFERRED"],
                    "message": APPLICANT_MESSAGES["REFERRED"]}
        if data:
            if eng.name_similarity(data["full_name"], app.full_name) < 0.9:
                problems.append("NAME_DOES_NOT_MATCH")
            if data["date_of_birth"] != app.date_of_birth:
                problems.append("DATE_OF_BIRTH_DOES_NOT_MATCH")
            if data["expires_on"] < now().date():
                problems.append("DOCUMENT_EXPIRED")
        if face and not faces:
            problems.append("NO_FACE_ON_DOCUMENT")
        evidence = {**{k: q[k] for k in ("sharpness", "brightness", "glare")}, "faces_found": len(faces),
                    "face_engine": face.name if face else None, "attempt": app.document_attempts}
        if problems:
            _check(s, app, "DOCUMENT_QUALITY", "FAIL", engine="opencv-quality+qr", reason=problems[0],
                   evidence={**evidence, "problems": problems}, digest=digest)
            if app.document_attempts >= cfg.kyc_max_document_attempts:
                _refer(s, app, ["TOO_MANY_DOCUMENT_ATTEMPTS"], screening_hit=False)
                return {"accepted": False, "state": app.state, "problems": problems,
                        "message": APPLICANT_MESSAGES["REFERRED"]}
            return {"accepted": False, "state": app.state, "problems": problems,
                    "attempts_left": cfg.kyc_max_document_attempts - app.document_attempts}
        _check(s, app, "DOCUMENT_QUALITY", "PASS", engine="opencv-quality+qr", evidence=evidence, digest=digest)
        app.document_digest = digest
        app.id_number_hash = _id_hash(data["specimen_id"])
        app.document_data = {"name_on_document": data["full_name"], "date_of_birth": data["date_of_birth"].isoformat(),
                             "expires_on": data["expires_on"].isoformat(), "kind": "PAYA_SPECIMEN",
                             "_specimen_id": data["specimen_id"]}
        _move(s, app, "DOCUMENT_OK", actor="system", reason="document readable and consistent")
        return {"accepted": True, "state": app.state, "problems": []}


# ------------------------------------------------------------------ 3. liveness challenge
def new_challenge(app_id: str) -> dict:
    import secrets
    cfg = get_settings()
    with session_scope() as s:
        app = _locked(s, app_id)
        if app.state != "DOCUMENT_OK":
            raise InvalidState("take a photo of your ID card first")
        turns = ["LEFT", "RIGHT"] if secrets.randbelow(2) else ["RIGHT", "LEFT"]
        app.challenge = {"nonce": secrets.token_urlsafe(16), "steps": ["CENTER", *turns],
                         "expires_at": (now() + timedelta(seconds=cfg.kyc_challenge_ttl_seconds)).isoformat(),
                         "used": False}
        return {"nonce": app.challenge["nonce"], "steps": app.challenge["steps"],
                "expires_in_seconds": cfg.kyc_challenge_ttl_seconds}


# ------------------------------------------------------------------ 4. verify
def _liveness(face, frames: list, steps: list[str], cfg) -> tuple[str, str | None, dict, object]:
    """Returns (outcome, reason, evidence, centre_template)."""
    if [f["step"] for f in frames] != steps:
        return "FAIL", "STEPS_OUT_OF_ORDER", {"expected": steps}, None
    if len({f["digest"] for f in frames}) != len(frames):
        return "FAIL", "REPEATED_FRAME", {}, None
    ratios, templates = [], []
    for f in frames:
        found = face.detect(f["img"])
        if not found:
            return "FAIL", f"NO_FACE_{f['step']}", {"ratios": ratios}, None
        if len(found) > 1 and found[1].box[2] * found[1].box[3] > 0.25 * found[0].box[2] * found[0].box[3]:
            return "REFER", "MULTIPLE_FACES", {"step": f["step"]}, None
        r = eng.yaw_ratio(found[0])
        ratios.append(round(r, 3))
        templates.append(face.embed(f["img"], found[0]))
        step = f["step"]
        if step == "CENTER" and abs(r) > cfg.kyc_liveness_centre_ratio:
            return "FAIL", "LOOK_STRAIGHT", {"ratios": ratios}, None
        if step == "LEFT" and r < cfg.kyc_liveness_turn_ratio:
            return "FAIL", "TURN_FURTHER_LEFT", {"ratios": ratios}, None
        if step == "RIGHT" and r > -cfg.kyc_liveness_turn_ratio:
            return "FAIL", "TURN_FURTHER_RIGHT", {"ratios": ratios}, None
    same = [round(face.similarity(templates[0], t), 3) for t in templates[1:]]
    if min(same) < cfg.kyc_face_grey_zone:
        return "REFER", "DIFFERENT_PERSON_BETWEEN_FRAMES", {"ratios": ratios, "same_person": same}, None
    return "PASS", None, {"ratios": ratios, "same_person": same}, templates[0]


def verify(app_id: str, *, nonce: str, document_image: str, frames: list[dict], geolocation: dict | None) -> dict:
    cfg = get_settings()
    face = eng.face_engine()
    # Decode everything before taking the lock: images stay in this function's memory only.
    try:
        doc_img, doc_digest = eng.decode_image(document_image)
        decoded = []
        for f in frames[:6]:
            img, d = eng.decode_image(f.get("image", ""))
            decoded.append({"step": str(f.get("step", "")).upper(), "img": img, "digest": d})
    except eng.ImageRejected as exc:
        raise ValidationFailed(f"image rejected: {exc.reason}") from exc

    with session_scope() as s:
        app = _locked(s, app_id)
        if app.state != "DOCUMENT_OK":
            raise InvalidState(f"application is {app.state}; verification needs a checked document")
        ch = app.challenge or {}
        if not ch or ch.get("used") or ch.get("nonce") != nonce:
            raise InvalidState("this liveness challenge is not valid; request a new one")
        if datetime.fromisoformat(ch["expires_at"]) < now():
            raise InvalidState("this liveness challenge has expired; request a new one")
        app.challenge = {**ch, "used": True}  # single use, even if verification fails
        if doc_digest != app.document_digest:
            raise InvalidState("the ID card photo differs from the one checked; take it again")
        app.liveness_attempts += 1

        reasons: list[str] = []
        screening_hit = False

        # --- liveness + face match (biometric; skipped safely without an engine)
        if face is None:
            _check(s, app, "LIVENESS", "ERROR", engine="none", reason="FACE_ENGINE_UNAVAILABLE")
            _check(s, app, "FACE_MATCH", "ERROR", engine="none", reason="FACE_ENGINE_UNAVAILABLE")
            reasons.append("FACE_ENGINE_UNAVAILABLE")
        else:
            outcome, reason, evidence, centre = _liveness(face, decoded, ch["steps"], cfg)
            _check(s, app, "LIVENESS", outcome, engine=f"{face.name}+challenge", reason=reason,
                   evidence={**evidence, "attempt": app.liveness_attempts, "steps": ch["steps"]},
                   digest=decoded[0]["digest"] if decoded else None)
            if outcome == "FAIL" and app.liveness_attempts < cfg.kyc_max_liveness_attempts:
                return {"outcome": "RETRY", "state": app.state, "reason": reason,
                        "attempts_left": cfg.kyc_max_liveness_attempts - app.liveness_attempts}
            if outcome != "PASS":
                reasons.append(f"LIVENESS_{reason}")
            else:
                doc_faces = face.detect(doc_img)
                if not doc_faces:
                    _check(s, app, "FACE_MATCH", "REFER", engine=face.name, reason="NO_FACE_ON_DOCUMENT")
                    reasons.append("FACE_MATCH_NO_FACE_ON_DOCUMENT")
                else:
                    score = round(face.similarity(face.embed(doc_img, doc_faces[0]), centre), 3)
                    if score >= cfg.kyc_face_match_threshold:
                        _check(s, app, "FACE_MATCH", "PASS", engine=face.name, score=score,
                               evidence={"threshold": cfg.kyc_face_match_threshold})
                    else:
                        why = "GREY_ZONE" if score >= cfg.kyc_face_grey_zone else "NO_MATCH"
                        _check(s, app, "FACE_MATCH", "REFER", engine=face.name, score=score, reason=why,
                               evidence={"threshold": cfg.kyc_face_match_threshold})
                        reasons.append(f"FACE_{why}")
        # templates and images go out of scope here; nothing biometric was written

        # --- identity registry (simulated)
        doc = app.document_data
        ans = registry.verify(doc["_specimen_id"], app.full_name, app.date_of_birth)
        if ans.result == "MATCH":
            _check(s, app, "REGISTRY", "PASS", engine="mock-registry", evidence=ans.fields)
        else:
            _check(s, app, "REGISTRY", "ERROR" if ans.result in ("TIMEOUT", "UNAVAILABLE") else "REFER",
                   engine="mock-registry", reason=ans.result, evidence=ans.fields)
            reasons.append(f"REGISTRY_{ans.result}")

        # --- sanctions / watch-list screening (synthetic list)
        best = max(((w, eng.name_similarity(app.full_name, w)) for w in WATCHLIST), key=lambda x: x[1])
        if best[1] >= cfg.kyc_screening_threshold:
            screening_hit = True
            _check(s, app, "SCREENING", "REFER", engine="difflib-fuzzy", score=best[1], reason="POTENTIAL_MATCH",
                   evidence={"list_entry": best[0], "threshold": cfg.kyc_screening_threshold})
            reasons.append("SCREENING_POTENTIAL_MATCH")
        else:
            _check(s, app, "SCREENING", "PASS", engine="difflib-fuzzy", score=best[1],
                   evidence={"threshold": cfg.kyc_screening_threshold})

        # --- one identity, one wallet
        dup = s.execute(select(KYCApplication.ref).where(
            KYCApplication.id_number_hash == app.id_number_hash, KYCApplication.id != app.id,
            KYCApplication.state.in_(["APPROVED", "REFERRED", "DOCUMENT_OK", "MORE_INFO"]))).scalars().first()
        idv = "idv_" + app.id_number_hash[:40]
        dup_customer = s.execute(select(Customer.id).where(Customer.idv_token == idv)).first()
        if dup or dup_customer:
            _check(s, app, "DUPLICATE", "REFER", engine="keyed-hash", reason="IDENTITY_ALREADY_USED",
                   evidence={"other_application": dup})
            reasons.append("DUPLICATE_IDENTITY")
        else:
            _check(s, app, "DUPLICATE", "PASS", engine="keyed-hash")

        # --- device location (recorded, rounded to about 1 km)
        geo = None
        if geolocation and isinstance(geolocation.get("lat"), (int, float)) and isinstance(geolocation.get("lon"), (int, float)):
            geo = {"lat": round(float(geolocation["lat"]), 2), "lon": round(float(geolocation["lon"]), 2),
                   "accuracy_m": int(geolocation.get("accuracy") or 0)}
            app.geolocation = geo
        if geo is None:
            if cfg.kyc_require_geolocation:
                _check(s, app, "GEOLOCATION", "REFER", engine="device", reason="NOT_SHARED")
                reasons.append("GEOLOCATION_NOT_SHARED")
            else:
                _check(s, app, "GEOLOCATION", "PASS", engine="device", reason="NOT_REQUIRED")
        elif PK_BOX[0] <= geo["lat"] <= PK_BOX[1] and PK_BOX[2] <= geo["lon"] <= PK_BOX[3]:
            _check(s, app, "GEOLOCATION", "PASS", engine="device", evidence=geo)
        else:
            _check(s, app, "GEOLOCATION", "REFER", engine="device", reason="OUTSIDE_PAKISTAN", evidence=geo)
            reasons.append("GEOLOCATION_OUTSIDE_PAKISTAN")

        if reasons:
            _refer(s, app, reasons, screening_hit=screening_hit)
            return {"outcome": "REFERRED", "state": app.state, "message": APPLICANT_MESSAGES["REFERRED"]}
        _approve(s, app, actor=f"system:{app.rule_version}", tier=1, auto=True,
                 reasons=["ALL_CHECKS_PASSED"])
        return {"outcome": "APPROVED", "state": app.state, "username": app.username, "tier": 1,
                "message": APPLICANT_MESSAGES["APPROVED"]}


# ------------------------------------------------------------------ decisions
def _refer(s: Session, app: KYCApplication, reasons: list[str], *, screening_hit: bool) -> None:
    _move(s, app, "REFERRED", actor="system", reason=", ".join(reasons))
    app.decision_reasons = reasons
    summary = f"KYC referral {app.ref}: " + ", ".join(r.replace("_", " ").lower() for r in reasons)
    case = open_case(s, kind="KYC_REVIEW", txn=None, owner_role="COMPLIANCE", summary=summary[:400],
                     details={"application_ref": app.ref, "reasons": reasons, "two_person_rule": screening_hit},
                     sla_minutes=240)
    app.case_id = case.id


def _approve(s: Session, app: KYCApplication, *, actor: str, tier: int, auto: bool, reasons: list[str]) -> None:
    cfg = get_settings()
    idv = "idv_" + app.id_number_hash[:40]
    risk = "MEDIUM" if "SCREENING_POTENTIAL_MATCH" in (app.decision_reasons or []) else "LOW"
    c = Customer(full_name=app.full_name, mobile_masked=app.mobile_masked, idv_token=idv, kyc_tier=tier,
                 kyc_status="VERIFIED", risk_rating=risk)
    s.add(c)
    s.flush()
    s.add(Consent(customer_id=c.id, purpose="SERVICE", channel="PUSH"))
    s.add(Consent(customer_id=c.id, purpose="BIOMETRIC_KYC", channel="APP", granted_at=app.biometric_consent_at))
    s.add(User(username=app.username, password_hash=app.password_hash, display_name=app.full_name,
               role="CUSTOMER", customer_id=c.id))
    wallet = ledger.owned_account(s, "2100", "CUSTOMER", c.id)
    if cfg.demo_mode and cfg.kyc_welcome_credit_minor:
        # Synthetic only, demo mode only: lets a brand-new wallet make a payment in the live demo.
        top = Transaction(txn_ref=new_ref("TOP"), type="TOPUP", status="COMPLETED",
                          amount_minor=cfg.kyc_welcome_credit_minor, customer_id=c.id,
                          correlation_id=app.correlation_id)
        s.add(top)
        s.flush()
        ledger.post(s, txn_id=top.id, posting_type="TOPUP", reason_code="SYNTHETIC_WELCOME_CREDIT", actor=actor,
                    correlation_id=app.correlation_id, initiated_via="BATCH",
                    lines=[Line(ledger.house_account(s, "1010").id, "D", cfg.kyc_welcome_credit_minor),
                           Line(wallet.id, "C", cfg.kyc_welcome_credit_minor)])
    _move(s, app, "APPROVED", actor=actor, reason=", ".join(reasons))
    app.customer_id, app.tier_granted, app.password_hash = c.id, tier, None
    app.decision, app.decided_by, app.decided_at = ("AUTO_APPROVED" if auto else "APPROVED"), actor, now()
    if not auto:
        app.decision_reasons = [*(app.decision_reasons or []), *reasons]
    audit.record(s, actor=actor, actor_role="SYSTEM" if auto else "COMPLIANCE", action="KYC_APPROVE",
                 object_type="kyc_application", object_id=app.ref, correlation_id=app.correlation_id,
                 details={"tier": tier, "auto": auto, "reasons": reasons})


def decide(ref: str, *, decision: str, reason: str, tier: int, actor: str, actor_role: str) -> dict:
    """Compliance decision on a referred application. APPROVE after a screening hit needs two officers."""
    decision = decision.upper()
    if decision not in ("APPROVE", "REJECT", "MORE_INFO"):
        raise ValidationFailed("decision must be APPROVE, REJECT or MORE_INFO")
    if len(reason.strip()) < 5:
        raise ValidationFailed("give a reason for the decision")
    if tier not in (1, 2):
        raise ValidationFailed("tier must be 1 or 2")
    with session_scope() as s:
        app = s.execute(select(KYCApplication).where(KYCApplication.ref == ref).with_for_update()).scalar_one_or_none()
        if app is None:
            raise NotFound("application not found")
        if app.state != "REFERRED":
            raise InvalidState(f"application is {app.state}, not REFERRED")
        case = s.get(Case, app.case_id) if app.case_id else None
        two_person = bool(case and case.details.get("two_person_rule"))
        self_second = two_person and decision == "APPROVE" and app.recommended_by == actor
    if self_second:
        with session_scope() as s:
            audit.record(s, actor=actor, actor_role=actor_role, action="KYC_APPROVE", object_type="kyc_application",
                         object_id=ref, outcome="DENIED", reason="two-person rule: same officer")
        events.telemetry("security", "access_denied", detail={"user": actor, "role": actor_role,
                                                               "permission": "second approval of own KYC recommendation"},
                         level="error")
        raise SegregationOfDuties("a second compliance officer must confirm this approval")

    with session_scope() as s:
        app = s.execute(select(KYCApplication).where(KYCApplication.ref == ref).with_for_update()).scalar_one()
        if app.state != "REFERRED":
            raise InvalidState(f"application is {app.state}, not REFERRED")
        case = s.get(Case, app.case_id) if app.case_id else None
        two_person = bool(case and case.details.get("two_person_rule"))
        if decision == "APPROVE" and two_person and app.recommended_by is None:
            app.recommended_by, app.recommendation, app.updated_at = actor, "APPROVE", now()
            audit.record(s, actor=actor, actor_role=actor_role, action="KYC_RECOMMEND_APPROVE",
                         object_type="kyc_application", object_id=ref, reason=reason,
                         correlation_id=app.correlation_id)
            events.telemetry("human_gate", "kyc_recommended", detail={"ref": ref, "by": actor}, level="warn")
            return {"ref": ref, "state": app.state, "status": "AWAITING_SECOND_OFFICER",
                    "message": "Recommendation recorded. A second compliance officer must confirm the approval."}
        if decision == "APPROVE":
            _approve(s, app, actor=actor, tier=tier, auto=False, reasons=[f"MANUAL: {reason.strip()[:120]}"])
        elif decision == "REJECT":
            _move(s, app, "REJECTED", actor=actor, reason=reason)
            app.decision, app.decided_by, app.decided_at, app.password_hash = "REJECTED", actor, now(), None
            audit.record(s, actor=actor, actor_role=actor_role, action="KYC_REJECT", object_type="kyc_application",
                         object_id=ref, reason=reason, correlation_id=app.correlation_id)
        else:
            _move(s, app, "MORE_INFO", actor=actor, reason=reason)
            app.decision, app.challenge, app.document_digest = "MORE_INFO", {}, None
            app.document_attempts = app.liveness_attempts = 0
            audit.record(s, actor=actor, actor_role=actor_role, action="KYC_MORE_INFO", object_type="kyc_application",
                         object_id=ref, reason=reason, correlation_id=app.correlation_id)
        if case and case.state != "RESOLVED":
            case.state, case.resolution, case.resolved_by, case.resolved_at = "RESOLVED", f"KYC_{decision}", actor, now()
        events.telemetry("human_gate", "kyc_decided", detail={"ref": ref, "decision": decision, "by": actor})
        return {"ref": ref, "state": app.state, "status": "DECIDED", "decision": decision}


# ------------------------------------------------------------------ queries
def applicant_status(app_id: str) -> dict:
    with session_scope() as s:
        app = s.get(KYCApplication, uuid.UUID(app_id))
        if app is None:
            raise NotFound("application not found")
        out = {"ref": app.ref, "state": app.state, "message": APPLICANT_MESSAGES.get(app.state),
               "document_checked": app.document_digest is not None}
        if app.state == "APPROVED":
            out.update(username=app.username, tier=app.tier_granted)
        return out  # never the check details: no tipping off about screening


def backoffice_view(s: Session, app: KYCApplication) -> dict:
    checks = s.execute(select(KYCCheck).where(KYCCheck.application_id == app.id)
                       .order_by(KYCCheck.created_at)).scalars().all()
    case = s.get(Case, app.case_id) if app.case_id else None
    return {
        "ref": app.ref, "state": app.state, "full_name": app.full_name,
        "date_of_birth": app.date_of_birth.isoformat() if app.date_of_birth else None,
        "mobile": app.mobile_masked, "document": {k: v for k, v in app.document_data.items() if not k.startswith("_")},
        "geolocation": app.geolocation, "reasons": app.decision_reasons, "decision": app.decision,
        "decided_by": app.decided_by, "recommended_by": app.recommended_by, "tier_granted": app.tier_granted,
        "case_ref": case.case_ref if case else None,
        "two_person_rule": bool(case and case.details.get("two_person_rule")),
        "rule_version": app.rule_version, "created_at": app.created_at.isoformat(),
        "checks": [{"check": c.check, "outcome": c.outcome, "score": c.score, "reason": c.reason,
                    "engine": c.engine, "evidence": c.evidence, "at": c.created_at.isoformat()} for c in checks],
    }


def list_applications(state: str | None = None, limit: int = 50) -> list[dict]:
    with session_scope() as s:
        q = select(KYCApplication).order_by(KYCApplication.created_at.desc()).limit(limit)
        if state:
            q = q.where(KYCApplication.state == state)
        return [backoffice_view(s, a) for a in s.execute(q).scalars().all()]


def get_application(ref: str) -> dict:
    with session_scope() as s:
        app = s.execute(select(KYCApplication).where(KYCApplication.ref == ref)).scalar_one_or_none()
        if app is None:
            raise NotFound("application not found")
        return backoffice_view(s, app)


# ------------------------------------------------------------------ housekeeping
def abandon_stale() -> int:
    """Applications idle for 72 h are closed and their personal data purged (data minimisation)."""
    cutoff = now() - timedelta(hours=get_settings().kyc_abandon_after_hours)
    with session_scope() as s:
        apps = s.execute(select(KYCApplication).where(KYCApplication.state.in_(OPEN_STATES),
                                                      KYCApplication.updated_at < cutoff)
                         .with_for_update(skip_locked=True)).scalars().all()
        for app in apps:
            _move(s, app, "ABANDONED", actor="worker", reason=f"idle for {get_settings().kyc_abandon_after_hours} h")
            app.full_name, app.username, app.mobile_masked = "[purged]", f"purged:{app.ref}", "[purged]"
            app.date_of_birth, app.password_hash, app.id_number_hash, app.document_digest = None, None, None, None
            app.document_data, app.geolocation, app.challenge = {}, {}, {}
        return len(apps)
