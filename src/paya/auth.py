"""Sessions, token revocation and staff MFA (ADR-017).

Sessions. Every access token carries a session id (`sid`). On every request the session must exist, be
unexpired and unrevoked, and belong to an active user, so signing out, "sign out everywhere", an admin
revocation, an MFA reset or deactivating a user takes effect on the very next request, not when the
token expires. (APPLICANT tokens from onboarding are the one exception: 30-minute, single-purpose.)

MFA. Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30 s, +/-1 step of clock drift) for
staff roles. Secrets are encrypted at rest with AES-GCM; a code can be used once (replay protection);
wrong codes are rate-limited per user. Enforcement:
  * a staff user who has enrolled ALWAYS needs a code;
  * with `mfa_enforced` (default: on outside demo mode) a staff user who has not enrolled must enrol
    before getting any access token: the password alone yields only a setup challenge.
Between password and code the user holds only a 5-minute challenge token that no API endpoint accepts.
"""
import base64
import hashlib
import hmac
import os
import struct
import time
import uuid
from datetime import timedelta
from urllib.parse import quote

import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select, update

from . import audit, events, ratelimit
from .config import get_settings
from .db import session_scope
from .errors import Forbidden, InvalidState, NotFound, RateLimited, Unauthenticated, ValidationFailed
from .models import AuthSession, User, now
from .security import Principal, issue_token

STAFF_ROLES = ("OPS", "COMPLIANCE", "FINANCE", "SYSADMIN", "AUDITOR")
ISSUER = "Rupay (synthetic)"
STEP, DIGITS, DRIFT = 30, 6, 1


# ------------------------------------------------------------------ TOTP (RFC 6238 / RFC 4226)
def new_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode().rstrip("=")


def _b32(secret: str) -> bytes:
    return base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)


def hotp(key: bytes, counter: int, digits: int = DIGITS) -> str:
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    off = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[off:off + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def totp(secret: str, at: float | None = None) -> str:
    return hotp(_b32(secret), int((time.time() if at is None else at) // STEP))


def provisioning_uri(secret: str, username: str) -> str:
    return (f"otpauth://totp/{quote(ISSUER)}:{quote(username)}?secret={secret}&issuer={quote(ISSUER)}"
            f"&algorithm=SHA1&digits={DIGITS}&period={STEP}")


def _match(secret: str, code: str, last_step: int | None) -> int | None:
    """The time step the code belongs to, if valid and newer than the last one used; else None."""
    if not (code.isdigit() and len(code) == DIGITS):
        return None
    key, cur = _b32(secret), int(time.time() // STEP)
    for step in range(cur - DRIFT, cur + DRIFT + 1):
        if hmac.compare_digest(hotp(key, step), code) and (last_step is None or step > last_step):
            return step
    return None


# ------------------------------------------------------------------ secrets at rest
def _aes() -> AESGCM:
    cfg = get_settings()
    raw = cfg.mfa_encryption_key
    key = base64.b64decode(raw) if raw else hashlib.sha256(b"paya-mfa:" + cfg.jwt_secret.encode()).digest()
    return AESGCM(key)


def encrypt(secret: str, user_id: uuid.UUID) -> str:
    nonce = os.urandom(12)
    return base64.b64encode(nonce + _aes().encrypt(nonce, secret.encode(), str(user_id).encode())).decode()


def decrypt(blob: str, user_id: uuid.UUID) -> str:
    raw = base64.b64decode(blob)
    return _aes().decrypt(raw[:12], raw[12:], str(user_id).encode()).decode()   # bound to this user


# ------------------------------------------------------------------ policy
def mfa_enforced() -> bool:
    cfg = get_settings()
    return (not cfg.demo_mode) if cfg.mfa_enforced is None else cfg.mfa_enforced


def _principal(u: User) -> Principal:
    return Principal(user_id=str(u.id), username=u.username, role=u.role,
                     customer_id=str(u.customer_id) if u.customer_id else None,
                     merchant_id=str(u.merchant_id) if u.merchant_id else None)


def _challenge(u: User, scope: str) -> str:
    cfg = get_settings()
    claims = {"sub": str(u.id), "usr": u.username, "scope": scope, "iat": now(),
              "exp": now() + timedelta(minutes=cfg.mfa_challenge_minutes)}
    return jwt.encode(claims, cfg.jwt_secret, algorithm="HS256")


def _read_challenge(token: str, scopes: tuple[str, ...]) -> dict:
    try:
        c = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise Unauthenticated("challenge expired or invalid; sign in again") from exc
    if c.get("scope") not in scopes:
        raise Unauthenticated("not a sign-in challenge")
    return c


# ------------------------------------------------------------------ sessions
def _start_session(s, u: User, *, mfa: bool, user_agent: str | None) -> dict:
    cfg = get_settings()
    sess = AuthSession(user_id=u.id, mfa=mfa, user_agent=(user_agent or "")[:120] or None,
                       expires_at=now() + timedelta(minutes=cfg.jwt_ttl_minutes))
    s.add(sess)
    s.flush()
    token = issue_token(_principal(u), sid=str(sess.id))
    return {"access_token": token, "token_type": "bearer", "role": u.role, "display_name": u.display_name,
            "customer_id": str(u.customer_id) if u.customer_id else None,
            "merchant_id": str(u.merchant_id) if u.merchant_id else None, "mfa": mfa}


def after_password(u: User, *, user_agent: str | None, correlation_id: str) -> dict:
    """Called once the password is right. Returns tokens, or a challenge for the second factor."""
    with session_scope() as s:
        u = s.get(User, u.id)
        if u.role in STAFF_ROLES and u.mfa_secret_enc:
            return {"mfa_required": True, "challenge": _challenge(u, "mfa"), "username": u.username}
        if u.role in STAFF_ROLES and mfa_enforced():
            return {"mfa_setup_required": True, "challenge": _challenge(u, "mfa_setup"), "username": u.username}
        audit.record(s, actor=u.username, actor_role=u.role, action="LOGIN", object_type="session", object_id=None,
                     correlation_id=correlation_id)
        return _start_session(s, u, mfa=False, user_agent=user_agent)


def check(p: Principal, sid: str | None) -> None:
    """Every request: the token's session must be live and its user active."""
    if p.role == "APPLICANT":
        return
    if not sid:
        raise Unauthenticated("token has no session; sign in again")
    with session_scope() as s:
        row = s.execute(select(AuthSession, User.active).join(User, User.id == AuthSession.user_id)
                        .where(AuthSession.id == uuid.UUID(sid))).first()
        if row is None:
            raise Unauthenticated("session not found; sign in again")
        sess, active = row
        if sess.revoked_at is not None:
            raise Unauthenticated("this session was signed out", reason=sess.revoked_reason or "revoked")
        if sess.expires_at <= now() or not active or str(sess.user_id) != p.user_id:
            raise Unauthenticated("session expired; sign in again")
        if sess.last_seen_at < now() - timedelta(seconds=60):   # cheap: at most one write a minute
            s.execute(update(AuthSession).where(AuthSession.id == sess.id).values(last_seen_at=now()))


def revoke(session_id: uuid.UUID, *, by: str, reason: str, user_id: uuid.UUID | None = None) -> bool:
    with session_scope() as s:
        q = update(AuthSession).where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        if user_id is not None:
            q = q.where(AuthSession.user_id == user_id)    # a user can only revoke their own
        n = s.execute(q.values(revoked_at=now(), revoked_by=by, revoked_reason=reason[:128])).rowcount
    return n > 0


def revoke_all(user_id: uuid.UUID, *, by: str, reason: str, keep: uuid.UUID | None = None) -> int:
    with session_scope() as s:
        q = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        if keep is not None:
            q = q.where(AuthSession.id != keep)
        n = s.execute(q.values(revoked_at=now(), revoked_by=by, revoked_reason=reason[:128])).rowcount
    events.telemetry("security", "sessions_revoked", detail={"count": n, "by": by})
    return n


def list_sessions(user_id: uuid.UUID, current: str | None) -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(AuthSession).where(AuthSession.user_id == user_id)
                         .order_by(AuthSession.created_at.desc()).limit(20)).scalars().all()
        return [{"id": str(r.id), "current": str(r.id) == current, "mfa": r.mfa, "user_agent": r.user_agent,
                 "created_at": r.created_at.isoformat(), "last_seen_at": r.last_seen_at.isoformat(),
                 "expires_at": r.expires_at.isoformat(),
                 "status": "revoked" if r.revoked_at else ("expired" if r.expires_at <= now() else "active"),
                 "revoked_reason": r.revoked_reason} for r in rows]


# ------------------------------------------------------------------ MFA flows
def _user(s, user_id: str) -> User:
    u = s.get(User, uuid.UUID(user_id))
    if u is None or not u.active:
        raise Unauthenticated("account not available")
    return u


def start_enrolment(*, challenge: str | None = None, principal: Principal | None = None) -> dict:
    """Generate a secret for the user to add to an authenticator app. Not active until a code confirms it."""
    uid = _read_challenge(challenge, ("mfa_setup",))["sub"] if challenge else principal.user_id
    with session_scope() as s:
        u = _user(s, uid)
        if u.role not in STAFF_ROLES:
            raise Forbidden("MFA is for staff accounts")
        if u.mfa_secret_enc and challenge:
            raise InvalidState("already enrolled; sign in with your code")
        secret = new_secret()
        u.mfa_pending_enc = encrypt(secret, u.id)
        return {"secret": secret, "otpauth_uri": provisioning_uri(secret, u.username), "issuer": ISSUER,
                "digits": DIGITS, "period": STEP}


def _verify_code(s, u: User, code: str, *, pending: bool) -> None:
    if ratelimit.peek("mfa", str(u.id)):                     # 5 wrong codes in 5 minutes: stop guessing
        raise RateLimited("too many wrong codes; wait a few minutes", scope="mfa", retry_after_s=300)
    blob = u.mfa_pending_enc if pending else u.mfa_secret_enc
    if not blob:
        raise InvalidState("no authenticator to check against; start enrolment again")
    step = _match(decrypt(blob, u.id), code.strip().replace(" ", ""), u.mfa_last_step)
    if step is None:
        ratelimit.hit("mfa", str(u.id), raise_on_limit=False)   # only wrong codes count
        raise Unauthenticated("that code is not valid (or was already used)")
    u.mfa_last_step = step


def confirm_enrolment(code: str, *, challenge: str | None = None, principal: Principal | None = None,
                      user_agent: str | None, correlation_id: str, current_sid: str | None = None) -> dict:
    uid = _read_challenge(challenge, ("mfa_setup",))["sub"] if challenge else principal.user_id
    try:
        with session_scope() as s:
            u = _user(s, uid)
            _verify_code(s, u, code, pending=True)
            u.mfa_secret_enc, u.mfa_pending_enc, u.mfa_enrolled_at = u.mfa_pending_enc, None, now()
            audit.record(s, actor=u.username, actor_role=u.role, action="MFA_ENROLLED", object_type="user",
                         object_id=u.username, correlation_id=correlation_id)
            if challenge:
                audit.record(s, actor=u.username, actor_role=u.role, action="LOGIN", object_type="session",
                             object_id=None, correlation_id=correlation_id, details={"mfa": True})
                return {"enrolled": True, **_start_session(s, u, mfa=True, user_agent=user_agent)}
            user_id = u.id
    except Unauthenticated:
        _audit_failure(uid, "MFA_ENROL_FAILED", correlation_id)
        raise
    # enrolled from a signed-in session: every OTHER session was signed in without MFA, so end them
    revoke_all(user_id, by="system", reason="MFA enrolled", keep=uuid.UUID(current_sid) if current_sid else None)
    return {"enrolled": True}


def verify_login(challenge: str, code: str, *, user_agent: str | None, correlation_id: str) -> dict:
    uid = _read_challenge(challenge, ("mfa",))["sub"]
    try:
        with session_scope() as s:
            u = _user(s, uid)
            _verify_code(s, u, code, pending=False)
            audit.record(s, actor=u.username, actor_role=u.role, action="LOGIN", object_type="session",
                         object_id=None, correlation_id=correlation_id, details={"mfa": True})
            return _start_session(s, u, mfa=True, user_agent=user_agent)
    except Unauthenticated:
        _audit_failure(uid, "MFA_FAILED", correlation_id)
        raise


def _audit_failure(uid: str, action: str, correlation_id: str) -> None:
    with session_scope() as s:
        u = s.get(User, uuid.UUID(uid))
        if u:
            audit.record(s, actor=u.username, actor_role=u.role, action=action, object_type="user",
                         object_id=u.username, outcome="DENIED", reason="wrong or reused code",
                         correlation_id=correlation_id)
    events.telemetry("security", "mfa_failed", detail={"action": action}, level="warn")


# ------------------------------------------------------------------ administration
def admin_revoke(username: str, *, actor: Principal, reason: str, correlation_id: str, reset_mfa: bool = False) -> dict:
    if len(reason.strip()) < 5:
        raise ValidationFailed("give a reason")
    with session_scope() as s:
        u = s.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if u is None:
            raise NotFound("user not found")
        if reset_mfa and u.username == actor.username:
            raise Forbidden("you cannot reset your own MFA; ask another administrator")
        if reset_mfa:
            u.mfa_secret_enc = u.mfa_pending_enc = None
            u.mfa_enrolled_at = u.mfa_last_step = None
        audit.record(s, actor=actor.username, actor_role=actor.role,
                     action="MFA_RESET" if reset_mfa else "SESSIONS_REVOKED", object_type="user", object_id=username,
                     reason=reason.strip()[:200], correlation_id=correlation_id)
        uid = u.id
    n = revoke_all(uid, by=actor.username, reason=("MFA reset: " if reset_mfa else "admin: ") + reason.strip())
    return {"username": username, "sessions_revoked": n, "mfa_reset": reset_mfa}


def status(user_id: str, sid: str | None) -> dict:
    with session_scope() as s:
        u = s.get(User, uuid.UUID(user_id))
        sess = s.get(AuthSession, uuid.UUID(sid)) if sid else None
        return {"mfa_enrolled": bool(u and u.mfa_secret_enc), "mfa_required_for_role": bool(u and u.role in STAFF_ROLES),
                "mfa_enforced": mfa_enforced(), "session_mfa": bool(sess and sess.mfa), "session_id": sid}


def staff_overview() -> list[dict]:
    with session_scope() as s:
        users = s.execute(select(User).where(User.role.in_(STAFF_ROLES)).order_by(User.username)).scalars().all()
        out = []
        for u in users:
            active = s.execute(select(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None),
                                                         AuthSession.expires_at > now())).scalars().all()
            out.append({"username": u.username, "role": u.role, "mfa_enrolled": bool(u.mfa_secret_enc),
                        "active_sessions": len(active), "mfa_sessions": sum(1 for a in active if a.mfa)})
        return out

