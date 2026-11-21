"""Authentication (JWT) and role-based authorisation with least privilege.

Permission matrix - one role can never perform every sensitive action:
  CUSTOMER        pay from own wallet, read own transactions
  CASHIER         create payment requests, read own merchant's statuses
  MERCHANT_ADMIN  cashier rights + merchant reports
  OPS             status enquiry, REQUEST reversals (maker), work pending-review cases
  COMPLIANCE      release / reject compliance holds (cannot post or reverse)
  FINANCE         APPROVE reversals (checker), run reconciliation, finance reports
  SYSADMIN        chaos/config in demo mode only; no financial actions
  AUDITOR         read-only everything incl. audit chain verification
"""
from dataclasses import dataclass
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from .config import get_settings
from .errors import Forbidden, Unauthenticated
from .models import now

_ph = PasswordHasher()

PERMISSIONS: dict[str, set[str]] = {
    "payment:pay": {"CUSTOMER"},
    "payment:read_own": {"CUSTOMER"},
    "payment_request:create": {"CASHIER", "MERCHANT_ADMIN"},
    "merchant:read": {"CASHIER", "MERCHANT_ADMIN"},
    "ops:enquiry": {"OPS"},
    "reversal:request": {"OPS"},
    "reversal:approve": {"FINANCE"},
    "compliance:decide": {"COMPLIANCE"},
    "recon:run": {"FINANCE"},
    "cases:read": {"OPS", "COMPLIANCE", "FINANCE", "AUDITOR"},
    "backoffice:read": {"OPS", "COMPLIANCE", "FINANCE", "AUDITOR", "SYSADMIN"},
    "finance:read": {"FINANCE", "AUDITOR"},
    "audit:read": {"AUDITOR", "COMPLIANCE"},
    "chaos:control": {"SYSADMIN", "OPS"},
    "ai:triage": {"OPS", "FINANCE"},
    "ai:review": {"OPS", "FINANCE"},
    "cases:resolve": {"OPS", "FINANCE"},
}


@dataclass(frozen=True)
class Principal:
    user_id: str
    username: str
    role: str
    customer_id: str | None = None
    merchant_id: str | None = None


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except VerifyMismatchError:
        return False


def issue_token(p: Principal) -> str:
    cfg = get_settings()
    claims = {"sub": p.user_id, "usr": p.username, "role": p.role, "cid": p.customer_id, "mid": p.merchant_id,
              "iat": now(), "exp": now() + timedelta(minutes=cfg.jwt_ttl_minutes)}
    return jwt.encode(claims, cfg.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> Principal:
    try:
        c = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise Unauthenticated("invalid or expired token") from exc
    return Principal(user_id=c["sub"], username=c["usr"], role=c["role"], customer_id=c.get("cid"),
                     merchant_id=c.get("mid"))


def can(p: Principal, permission: str) -> bool:
    return p.role in PERMISSIONS.get(permission, set())


def require(p: Principal, permission: str) -> None:
    if not can(p, permission):
        raise Forbidden(f"role {p.role} is not permitted to {permission}")
