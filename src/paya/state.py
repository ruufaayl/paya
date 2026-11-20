"""Transaction state machine (Week 9 vocabulary, mapped to the project brief).

Every transition is: optimistic-locked UPDATE + append to status history + outbox event, all in the
caller's database transaction. Anything not listed in TRANSITIONS is refused.
"""
from sqlalchemy import update
from sqlalchemy.orm import Session

from . import events
from .models import Transaction, TransactionStatusHistory, now

TRANSITIONS: dict[str, set[str]] = {
    "CREATED": {"VALIDATED", "REJECTED", "EXPIRED"},
    "VALIDATED": {"AUTHORISED", "UNDER_REVIEW", "REJECTED"},
    "AUTHORISED": {"POSTED", "FAILED"},
    "POSTED": {"PENDING"},
    "PENDING": {"SETTLED", "REVERSED", "UNDER_REVIEW"},
    "SETTLED": {"RECONCILED"},
    "UNDER_REVIEW": {"AUTHORISED", "SETTLED", "REVERSED", "REJECTED"},
    "RECONCILED": set(),
    "REVERSED": set(),
    "REJECTED": set(),
    "FAILED": set(),
    "EXPIRED": set(),
    "COMPLETED": set(),
}
TERMINAL = {k for k, v in TRANSITIONS.items() if not v}

# What a customer / cashier is allowed to see for each internal state (never "success" before settlement).
CUSTOMER_STATUS = {
    "CREATED": "Processing", "VALIDATED": "Processing", "AUTHORISED": "Processing",
    "POSTED": "Sent - awaiting confirmation", "PENDING": "Sent - awaiting confirmation",
    "SETTLED": "Paid", "RECONCILED": "Paid", "UNDER_REVIEW": "Under review",
    "REVERSED": "Returned to wallet", "REJECTED": "Declined", "FAILED": "Failed", "EXPIRED": "Expired",
    "COMPLETED": "Completed",
}


class IllegalTransition(Exception):
    pass


class ConcurrentUpdate(Exception):
    pass


def transition(s: Session, txn: Transaction, to: str, *, actor: str, reason: str, evidence: dict | None = None) -> None:
    frm = txn.status
    if to not in TRANSITIONS.get(frm, set()):
        raise IllegalTransition(f"{txn.txn_ref}: {frm} -> {to} is not permitted")
    res = s.execute(
        update(Transaction)
        .where(Transaction.id == txn.id, Transaction.status == frm, Transaction.version == txn.version)
        .values(status=to, version=txn.version + 1, updated_at=now())
        .execution_options(synchronize_session=False)
    )
    if res.rowcount != 1:
        raise ConcurrentUpdate(f"{txn.txn_ref} changed concurrently (expected {frm} v{txn.version})")
    txn.status, txn.version = to, txn.version + 1
    s.add(TransactionStatusHistory(txn_id=txn.id, from_status=frm, to_status=to, actor=actor, reason=reason,
                                   evidence=evidence or {}, correlation_id=txn.correlation_id))
    events.emit(
        s, f"payment.{to.lower()}", aggregate_id=txn.id, correlation_id=txn.correlation_id,
        payload={"txn_id": str(txn.id), "txn_ref": txn.txn_ref, "type": txn.type, "from": frm, "to": to,
                 "amount_minor": txn.amount_minor, "currency": txn.currency,
                 "merchant_id": str(txn.merchant_id) if txn.merchant_id else None,
                 "customer_id": str(txn.customer_id) if txn.customer_id else None,
                 "customer_status": CUSTOMER_STATUS[to], "reason": reason},
    )
    events.telemetry("transaction", "state_changed", txn_ref=txn.txn_ref, detail={"from": frm, "to": to, "reason": reason})
