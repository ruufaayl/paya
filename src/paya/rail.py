"""Payment-rail port and a SIMULATED Raast rail.

THE PROTOTYPE NEVER MOVES REAL MONEY. MockRaastRail is a local simulator with its own storage
(schema "rail") so its records stay separate from our ledger and can be reconciled against it.
A licensed sandbox adapter can replace it later by implementing RailPort.

Chaos modes reproduce the behaviours the project brief requires: success, rejection, timeout,
duplicate acknowledgement, delayed acknowledgement, partial failure and status uncertainty.
"""
import hashlib
import json
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Protocol

from sqlalchemy import BigInteger, Boolean, Date, DateTime, String, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .db import session_scope


class RailBase(DeclarativeBase):
    pass


class RailPayment(RailBase):
    __tablename__ = "payments"
    __table_args__ = {"schema": "rail"}
    e2e_id: Mapped[str] = mapped_column(String(40), primary_key=True)  # rail is idempotent on e2e id
    rail_ref: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    creditor_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)  # ACCEPTED | REJECTED
    reject_reason: Mapped[str | None] = mapped_column(String(48))
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    omit_from_file: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RailCallback(RailBase):
    """Asynchronous acknowledgements the rail pushes to us (may be duplicated or delayed)."""
    __tablename__ = "callbacks"
    __table_args__ = {"schema": "rail"}
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    e2e_id: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    deliver_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class RailTimeout(Exception):
    """No answer in time: the outcome is UNKNOWN. Never treat this as failure."""


class RailUnavailable(Exception):
    """Connection refused / circuit open: the request was definitely not received."""


@dataclass
class RailAck:
    status: str  # ACCEPTED | REJECTED
    rail_ref: str
    reason: str | None = None


class RailPort(Protocol):
    name: str
    def send_credit(self, *, e2e_id: str, amount_minor: int, creditor_alias: str, txn_ref: str) -> RailAck: ...
    def enquire(self, e2e_id: str) -> str: ...  # ACCEPTED | REJECTED | NOT_FOUND
    def settlement_file(self, business_date: date) -> dict: ...


MODES = {
    "NORMAL": "Accept and acknowledge",
    "REJECT": "Rail rejects the credit (business reject)",
    "TIMEOUT_AFTER_ACCEPT": "Rail processes it but our call times out (status uncertainty)",
    "TIMEOUT_NO_RECORD": "Call times out and the rail never received it",
    "DOWN": "Rail unreachable (connection refused)",
    "DUPLICATE_ACK": "Accept, then send the acknowledgement callback twice",
    "DELAYED_ACK": "Accept; callback arrives late",
    "PARTIAL": "Accepted at the rail but missing from the settlement file",
    "LATE_SETTLE": "Settles in the next business day's file (timing difference)",
}


class Chaos:
    """Process-wide chaos switchboard driven by Mission Control and by tests."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.mode = "NORMAL"
        self.latency_ms = 0
        self._queue: list[str] = []

    def set_mode(self, mode: str, latency_ms: int = 0) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown rail mode {mode}")
        with self._lock:
            self.mode, self.latency_ms = mode, latency_ms

    def queue(self, *modes: str) -> None:
        with self._lock:
            self._queue.extend(modes)

    def next_mode(self) -> str:
        with self._lock:
            return self._queue.pop(0) if self._queue else self.mode

    def reset(self) -> None:
        with self._lock:
            self.mode, self.latency_ms, self._queue = "NORMAL", 0, []

    def state(self) -> dict:
        return {"mode": self.mode, "latency_ms": self.latency_ms, "queued": list(self._queue), "modes": MODES}


chaos = Chaos()


def _today() -> date:
    return datetime.now(timezone.utc).date()


class MockRaastRail:
    name = "RAAST_MOCK"

    def send_credit(self, *, e2e_id: str, amount_minor: int, creditor_alias: str, txn_ref: str) -> RailAck:
        mode = chaos.next_mode()
        if chaos.latency_ms:
            time.sleep(chaos.latency_ms / 1000)
        if mode == "DOWN":
            raise RailUnavailable("rail connection refused")
        if mode == "TIMEOUT_NO_RECORD":
            raise RailTimeout("no response within timeout")
        with session_scope() as s:
            existing = s.get(RailPayment, e2e_id)
            if existing is None:  # idempotent on e2e id: a resend never creates a second credit
                status = "REJECTED" if mode == "REJECT" else "ACCEPTED"
                existing = RailPayment(
                    e2e_id=e2e_id, rail_ref="RST" + uuid.uuid4().hex[:12].upper(), amount_minor=amount_minor,
                    creditor_alias=creditor_alias, status=status,
                    reject_reason="CREDITOR_ACCOUNT_BLOCKED" if status == "REJECTED" else None,
                    business_date=_today() + (timedelta(days=1) if mode == "LATE_SETTLE" else timedelta()),
                    omit_from_file=(mode == "PARTIAL"), created_at=datetime.now(timezone.utc),
                )
                s.add(existing)
                delay = timedelta(seconds=20) if mode == "DELAYED_ACK" else timedelta()
                copies = 2 if mode == "DUPLICATE_ACK" else 1
                for _ in range(copies):
                    s.add(RailCallback(id="CB" + uuid.uuid4().hex[:16].upper(), e2e_id=e2e_id, status=status,
                                       deliver_after=datetime.now(timezone.utc) + delay))
            ack = RailAck(status=existing.status, rail_ref=existing.rail_ref, reason=existing.reject_reason)
        if mode == "TIMEOUT_AFTER_ACCEPT":
            raise RailTimeout("rail processed the credit but the response was lost")
        return ack

    def enquire(self, e2e_id: str) -> str:
        if chaos.mode == "DOWN":
            raise RailUnavailable("rail connection refused")
        with session_scope() as s:
            p = s.get(RailPayment, e2e_id)
            return p.status if p else "NOT_FOUND"

    def due_callbacks(self, limit: int = 100) -> list[dict]:
        with session_scope() as s:
            rows = s.execute(
                select(RailCallback).where(RailCallback.delivered.is_(False),
                                           RailCallback.deliver_after <= datetime.now(timezone.utc))
                .limit(limit).with_for_update(skip_locked=True)
            ).scalars().all()
            out = [{"event_id": r.id, "e2e_id": r.e2e_id, "status": r.status, "type": "rail.ack"} for r in rows]
            for r in rows:
                r.delivered = True
        return out

    def settlement_file(self, business_date: date, duplicate_first_line: bool = False) -> dict:
        with session_scope() as s:
            rows = s.execute(
                select(RailPayment).where(RailPayment.business_date == business_date,
                                          RailPayment.status == "ACCEPTED", RailPayment.omit_from_file.is_(False))
                .order_by(RailPayment.created_at)
            ).scalars().all()
            lines = [{"e2e_id": r.e2e_id, "rail_ref": r.rail_ref, "amount_minor": r.amount_minor,
                      "creditor_alias": r.creditor_alias, "status": "SETTLED"} for r in rows]
        if duplicate_first_line and lines:
            lines.insert(1, dict(lines[0]))
        body = json.dumps(lines, sort_keys=True)
        return {
            "header": {"file_id": f"RAAST-SETTLE-{business_date.isoformat()}", "business_date": business_date.isoformat(),
                       "source": "RAAST_MOCK"},
            "lines": lines,
            "trailer": {"record_count": len(lines), "value_total_minor": sum(l["amount_minor"] for l in lines),
                        "sha256": hashlib.sha256(body.encode()).hexdigest(),
                        "generated_at": datetime.now(timezone.utc).isoformat()},
        }


class CircuitBreaker:
    """Stops hammering a failing rail. While open, new payments are refused - never approved blindly."""

    def __init__(self, threshold: int = 3, cooldown_s: float = 30.0) -> None:
        self.threshold, self.cooldown_s = threshold, cooldown_s
        self.failures, self.opened_at = 0, None
        self._lock = threading.Lock()

    def allow(self) -> bool:
        with self._lock:
            if self.opened_at is None:
                return True
            if time.monotonic() - self.opened_at >= self.cooldown_s:
                return True  # half-open: let one probe through
            return False

    def success(self) -> None:
        with self._lock:
            self.failures, self.opened_at = 0, None

    def failure(self) -> None:
        with self._lock:
            self.failures += 1
            if self.failures >= self.threshold:
                self.opened_at = time.monotonic()

    @property
    def state(self) -> str:
        if self.opened_at is None:
            return "CLOSED"
        return "HALF_OPEN" if time.monotonic() - self.opened_at >= self.cooldown_s else "OPEN"

    def reset(self) -> None:
        self.success()


rail: RailPort = MockRaastRail()
breaker = CircuitBreaker()
