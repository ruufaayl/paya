"""Transactional outbox, relay, duplicate-safe consumers and the live stream for Mission Control.

* `emit()` writes the event in the SAME database transaction as the state change (outbox pattern),
  so a committed state change can never lose its event.
* `relay_once()` publishes unpublished outbox rows to subscribers, in order. After a crash it simply
  republishes anything with published_at IS NULL - delivery is at-least-once.
* Consumers record (consumer, event_id) in processed_events inside their own transaction, so a
  duplicate delivery has no second effect (inbox pattern).
* `telemetry()` is a non-durable side channel used only to animate Mission Control.
"""
import threading
import uuid
from collections import deque
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import session_scope
from .models import OutboxEvent, ProcessedEvent, now

Subscriber = Callable[[dict], None]
_subscribers: list[Subscriber] = []
_live_listeners: list[Callable[[dict], None]] = []
_recent: deque = deque(maxlen=500)  # replay buffer for screens that connect late
_relay_lock = threading.Lock()


def emit(s: Session, event_type: str, *, aggregate_id: uuid.UUID | None, correlation_id: str, payload: dict,
         schema_version: int = 1) -> OutboxEvent:
    ev = OutboxEvent(event_type=event_type, schema_version=schema_version, aggregate_id=aggregate_id,
                     correlation_id=correlation_id, payload=payload)
    s.add(ev)
    s.flush()
    return ev


def envelope(ev: OutboxEvent) -> dict:
    return {
        "event_id": str(ev.event_id), "seq": ev.seq, "type": ev.event_type, "schema_version": ev.schema_version,
        "aggregate_id": str(ev.aggregate_id) if ev.aggregate_id else None, "correlation_id": ev.correlation_id,
        "occurred_at": ev.occurred_at.isoformat(), "payload": ev.payload,
    }


def subscribe(fn: Subscriber) -> None:
    _subscribers.append(fn)


def add_live_listener(fn: Callable[[dict], None]) -> None:
    _live_listeners.append(fn)


def remove_live_listener(fn: Callable[[dict], None]) -> None:
    if fn in _live_listeners:
        _live_listeners.remove(fn)


def recent() -> list[dict]:
    return list(_recent)


def _broadcast(msg: dict) -> None:
    _recent.append(msg)
    for fn in list(_live_listeners):
        try:
            fn(msg)
        except Exception:  # a broken screen must never break the money path
            pass


def telemetry(node: str, phase: str, *, txn_ref: str | None = None, detail: dict | None = None,
              level: str = "info") -> None:
    _broadcast({"kind": "telemetry", "node": node, "phase": phase, "txn_ref": txn_ref,
                "level": level, "detail": detail or {}, "at": now().isoformat()})
    from .observability import emit
    emit(f"{node}.{phase}", {"warn": "warning"}.get(level, level), txn_ref=txn_ref, **(detail or {}))


def relay_once(batch: int = 200, deliver_duplicate_of: set[str] | None = None) -> int:
    """Publish pending outbox events. `deliver_duplicate_of` lets chaos tests deliver an event twice."""
    with _relay_lock:
        with session_scope() as s:
            rows = s.execute(
                select(OutboxEvent).where(OutboxEvent.published_at.is_(None))
                .order_by(OutboxEvent.seq).limit(batch).with_for_update(skip_locked=True)
            ).scalars().all()
            envs = [envelope(r) for r in rows]
            for r in rows:
                r.published_at = now()
        for env in envs:
            _deliver(env)
            if deliver_duplicate_of and env["event_id"] in deliver_duplicate_of:
                _deliver(env)
        return len(envs)


def _deliver(env: dict) -> None:
    _broadcast({"kind": "event", **env})
    for fn in list(_subscribers):
        try:
            fn(env)
        except Exception as exc:  # recorded for the DLQ view; the event stays replayable from the outbox
            telemetry("dlq", "consumer_error", detail={"event_id": env["event_id"], "error": str(exc)[:200]},
                      level="error")


def consume_once(consumer: str, env: dict, handler: Callable[[Session, dict], Any]) -> bool:
    """Run `handler` at most once per (consumer, event). Returns False for a detected duplicate."""
    try:
        with session_scope() as s:
            s.add(ProcessedEvent(consumer=consumer, event_id=env["event_id"]))
            s.flush()
            handler(s, env)
        return True
    except IntegrityError:
        telemetry(consumer, "duplicate_ignored", detail={"event_id": env["event_id"], "type": env["type"]},
                  level="warn")
        return False


def reset_for_tests() -> None:
    _subscribers.clear()
    _live_listeners.clear()
    _recent.clear()
