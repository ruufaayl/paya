"""Background recovery loop: outbox relay, rail dispatch, callbacks, status enquiries, expiry.

Everything it does is idempotent, so it is safe to run after a crash or restart: it simply picks up
whatever the database says is unfinished. That is how transaction truth survives a restart.
"""
import threading
import time

from sqlalchemy import select

from . import assistant, events, kyc, payments, ratelimit, tokens
from .db import session_scope
from .models import Transaction


def dispatch_undispatched() -> int:
    """PENDING payments that were never sent (e.g. crash between commit and rail call)."""
    with session_scope() as s:
        ids = s.execute(select(Transaction.id).where(Transaction.status == "PENDING",
                                                      Transaction.rail_attempts == 0)).scalars().all()
    for tid in ids:
        payments.dispatch(tid, only_first_send=True)
    return len(ids)


def tick() -> dict:
    out = {
        "dispatched": dispatch_undispatched(),
        "callbacks": payments.process_rail_callbacks(),
        "enquiries": payments.run_status_enquiries(),
        "expired": payments.expire_stale(),
        "kyc_abandoned": kyc.abandon_stale(),
        "chats_purged": assistant.purge_expired(),
        "sandbox": tokens.tick(),
        "rate_windows_purged": ratelimit.purge_expired(),   # no-op unless PAYA_STABLECOIN_SANDBOX=true
    }
    out["relayed"] = events.relay_once()
    return out


class Worker:
    def __init__(self, interval_s: float = 1.0) -> None:
        self.interval_s = interval_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="paya-worker", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                tick()
            except Exception as exc:  # keep the loop alive; surface the error on Mission Control
                events.telemetry("worker", "error", detail={"error": str(exc)[:300]}, level="error")
            self._stop.wait(self.interval_s)

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
