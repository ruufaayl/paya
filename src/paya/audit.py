"""Tamper-evident audit trail: every row carries the hash of the previous row."""
import hashlib
import json

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import AuditLog, now

GENESIS = "0" * 64
_AUDIT_LOCK = 774201  # advisory lock id that serialises appends to the hash chain


def _digest(prev_hash: str, payload: dict) -> str:
    body = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256((prev_hash + body).encode()).hexdigest()


def record(
    s: Session, *, actor: str, actor_role: str, action: str, object_type: str, object_id: str | None,
    outcome: str = "ALLOWED", reason: str | None = None, channel: str = "API",
    correlation_id: str | None = None, details: dict | None = None,
) -> AuditLog:
    s.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _AUDIT_LOCK})
    last = s.execute(select(AuditLog.row_hash).order_by(AuditLog.id.desc()).limit(1)).scalar()
    prev = last or GENESIS
    created = now()
    payload = dict(
        actor=actor, actor_role=actor_role, action=action, object_type=object_type, object_id=object_id,
        outcome=outcome, reason=reason, channel=channel, correlation_id=correlation_id,
        details=details or {}, created_at=created.isoformat(),
    )
    row = AuditLog(**{k: v for k, v in payload.items() if k != "created_at"},
                   created_at=created, prev_hash=prev, row_hash=_digest(prev, payload))
    s.add(row)
    s.flush()
    return row


def verify_chain(s: Session) -> tuple[bool, int | None]:
    """Recompute the chain. Returns (ok, first_broken_row_id)."""
    prev = GENESIS
    for row in s.execute(select(AuditLog).order_by(AuditLog.id)).scalars():
        payload = dict(
            actor=row.actor, actor_role=row.actor_role, action=row.action, object_type=row.object_type,
            object_id=row.object_id, outcome=row.outcome, reason=row.reason, channel=row.channel,
            correlation_id=row.correlation_id, details=row.details, created_at=row.created_at.isoformat(),
        )
        if row.prev_hash != prev or row.row_hash != _digest(prev, payload):
            return False, row.id
        prev = row.row_hash
    return True, None
