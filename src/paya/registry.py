"""Identity-registry port and a SIMULATED registry (stand-in for a NADRA-style verification service).

Rupay cannot call a real identity registry, so the prototype uses a local simulator with its own storage
(schema "registry") that only ever contains synthetic SPECIMEN identities. A licensed verification
service could replace it later by implementing RegistryPort.

As with the payment rail, a timeout is an UNKNOWN answer: onboarding refers the application to a person.
It never approves and never rejects because the registry did not answer.
"""
import hashlib
import hmac
import secrets
import threading
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Protocol

from sqlalchemy import Date, DateTime, String, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import get_settings
from .db import session_scope

QR_PREFIX = "PAYA-SPECIMEN"
QR_VERSION = "1"
MODES = ("NORMAL", "TIMEOUT", "DOWN")


class RegistryBase(DeclarativeBase):
    pass


class RegistryIdentity(RegistryBase):
    __tablename__ = "identities"
    __table_args__ = {"schema": "registry"}
    specimen_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(128), nullable=False)
    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)
    expires_on: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="ACTIVE")  # ACTIVE | CANCELLED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


@dataclass(frozen=True)
class RegistryAnswer:
    result: str  # MATCH | MISMATCH | NOT_FOUND | CANCELLED | TIMEOUT | UNAVAILABLE
    fields: dict


class RegistryPort(Protocol):
    def verify(self, specimen_id: str, full_name: str, date_of_birth: date) -> RegistryAnswer: ...


def _norm(name: str) -> str:
    return " ".join(name.lower().replace(".", " ").split())


def _sign(body: str) -> str:
    return hmac.new(get_settings().kyc_pepper.encode(), body.encode(), hashlib.sha256).hexdigest()[:16]


def qr_payload(specimen_id: str, full_name: str, dob: date, expires_on: date) -> str:
    body = "|".join([QR_PREFIX, QR_VERSION, specimen_id, full_name, dob.isoformat(), expires_on.isoformat()])
    return f"{body}|{_sign(body)}"


def parse_qr(text: str) -> dict | None:
    """Parse and verify a specimen QR. Returns None if it is not ours or the signature is wrong."""
    parts = text.split("|")
    if len(parts) != 7 or parts[0] != QR_PREFIX or parts[1] != QR_VERSION:
        return None
    body, sig = "|".join(parts[:6]), parts[6]
    try:
        dob, exp = date.fromisoformat(parts[4]), date.fromisoformat(parts[5])
    except ValueError:
        return None
    return {"specimen_id": parts[2], "full_name": parts[3], "date_of_birth": dob, "expires_on": exp,
            "signature_valid": hmac.compare_digest(sig, _sign(body))}


class MockRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.mode = "NORMAL"

    def set_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown registry mode {mode}")
        with self._lock:
            self.mode = mode

    def reset(self) -> None:
        self.set_mode("NORMAL")

    def issue_specimen(self, full_name: str, dob: date) -> RegistryIdentity:
        """Create a synthetic identity. Numbers use a 'SPX-' format that cannot be confused with a CNIC."""
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        sid = "SPX-" + "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + \
              "".join(secrets.choice(alphabet) for _ in range(4))
        today = datetime.now(timezone.utc).date()
        ident = RegistryIdentity(specimen_id=sid, full_name=full_name.strip(), date_of_birth=dob,
                                 expires_on=today.replace(year=today.year + 5), status="ACTIVE",
                                 created_at=datetime.now(timezone.utc))
        with session_scope() as s:
            s.add(ident)
        return ident

    def verify(self, specimen_id: str, full_name: str, date_of_birth: date) -> RegistryAnswer:
        if self.mode == "TIMEOUT":
            return RegistryAnswer("TIMEOUT", {})
        if self.mode == "DOWN":
            return RegistryAnswer("UNAVAILABLE", {})
        with session_scope() as s:
            row = s.execute(select(RegistryIdentity).where(RegistryIdentity.specimen_id == specimen_id)).scalar_one_or_none()
            if row is None:
                return RegistryAnswer("NOT_FOUND", {})
            if row.status != "ACTIVE":
                return RegistryAnswer("CANCELLED", {"status": row.status})
            fields = {"name_match": _norm(row.full_name) == _norm(full_name),
                      "dob_match": row.date_of_birth == date_of_birth}
            return RegistryAnswer("MATCH" if all(fields.values()) else "MISMATCH", fields)


registry = MockRegistry()
