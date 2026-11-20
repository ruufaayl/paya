"""HTTP idempotency (layer 1). Layer 2 - one live payment per payment request - lives in the database.

Same key + same body  -> the stored response is replayed (no second debit).
Same key, still running -> 409 IDEMPOTENCY_IN_PROGRESS.
Same key + different body -> 422 IDEMPOTENCY_KEY_REUSED.
"""
import hashlib
import json
from typing import Callable

from sqlalchemy.exc import IntegrityError

from . import events
from .db import session_scope
from .errors import IdempotencyInProgress, IdempotencyKeyReused, PayaError, ValidationFailed
from .models import IdempotencyRecord


def request_hash(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


def execute(*, principal: str, operation: str, key: str | None, body: dict,
            fn: Callable[[], tuple[int, dict]]) -> tuple[int, dict, bool]:
    """Returns (status_code, response_body, replayed)."""
    if not key or len(key) < 8 or len(key) > 128:
        raise ValidationFailed("Idempotency-Key header (8-128 chars) is required for this operation")
    h = request_hash(body)
    try:
        with session_scope() as s:
            s.add(IdempotencyRecord(principal=principal, operation=operation, idem_key=key, request_hash=h,
                                    status="IN_PROGRESS"))
    except IntegrityError:
        with session_scope() as s:
            rec = s.get(IdempotencyRecord, (principal, operation, key))
            if rec.request_hash != h:
                raise IdempotencyKeyReused("this Idempotency-Key was used with a different request")
            if rec.status == "IN_PROGRESS":
                raise IdempotencyInProgress("the original request is still being processed")
            events.telemetry("gateway", "idempotent_replay", txn_ref=(rec.response_body or {}).get("txn_ref"),
                             detail={"key": key[:12] + "...", "operation": operation}, level="warn")
            return rec.response_code, rec.response_body, True
    try:
        code, resp = fn()
    except PayaError as exc:
        # Deterministic business outcomes are remembered too, so a retry gets the same answer.
        code, resp = exc.http_status, {"error": {"code": exc.code, "message": exc.message, **exc.details}}
        if exc.http_status >= 500:
            _forget(principal, operation, key)
            raise
        _complete(principal, operation, key, code, resp)
        raise
    except Exception:
        _forget(principal, operation, key)  # unexpected failure: allow a clean retry
        raise
    _complete(principal, operation, key, code, resp)
    return code, resp, False


def _complete(principal: str, operation: str, key: str, code: int, resp: dict) -> None:
    with session_scope() as s:
        rec = s.get(IdempotencyRecord, (principal, operation, key))
        rec.status, rec.response_code, rec.response_body = "COMPLETED", code, resp


def _forget(principal: str, operation: str, key: str) -> None:
    with session_scope() as s:
        rec = s.get(IdempotencyRecord, (principal, operation, key))
        if rec:
            s.delete(rec)
