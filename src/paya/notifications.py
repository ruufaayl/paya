"""Notification service. It only CONSUMES authoritative status events - it never creates financial truth.

Duplicate-safe: each (consumer, event_id) is processed once (inbox pattern).
Consent-aware: transaction notices are SERVICE messages; nothing marketing-like is sent here.
"""
from sqlalchemy.orm import Session

from . import events
from .models import Merchant, Notification, Transaction

CONSUMER = "notification-service"
TEMPLATES = {
    "payment.settled": ("CUSTOMER", "Paid PKR {amt} to {merchant}. Ref {ref}."),
    "payment.reversed": ("CUSTOMER", "PKR {amt} returned to your wallet. Ref {ref}."),
    "payment.under_review": ("CUSTOMER", "Your payment {ref} is under review. No action needed yet."),
    "payment.rejected": ("CUSTOMER", "Payment {ref} was declined. No money was taken."),
}
MERCHANT_TEMPLATES = {"payment.settled": "PKR {amt} received. Order paid. Ref {ref}."}


def _fmt(minor: int) -> str:
    return f"{minor / 100:,.2f}"


def handle(s: Session, env: dict) -> None:
    p = env["payload"]
    txn = s.get(Transaction, p["txn_id"]) if p.get("txn_id") else None
    if txn is None or txn.type != "PAYMENT":
        return
    merchant = s.get(Merchant, txn.merchant_id)
    ctx = {"amt": _fmt(txn.amount_minor), "ref": txn.txn_ref, "merchant": merchant.trading_name if merchant else ""}
    if env["type"] in TEMPLATES:
        rcpt, tpl = TEMPLATES[env["type"]]
        s.add(Notification(txn_id=txn.id, recipient=rcpt, template=env["type"], body=tpl.format(**ctx),
                           source_event_id=env["event_id"]))
    if env["type"] in MERCHANT_TEMPLATES:
        s.add(Notification(txn_id=txn.id, recipient="MERCHANT", template=env["type"],
                           body=MERCHANT_TEMPLATES[env["type"]].format(**ctx), source_event_id=env["event_id"]))
    events.telemetry("notification", "sent", txn_ref=txn.txn_ref, detail={"event": env["type"]})


def on_event(env: dict) -> None:
    if env["type"] in TEMPLATES or env["type"] in MERCHANT_TEMPLATES:
        events.consume_once(CONSUMER, env, handle)


def register() -> None:
    events.subscribe(on_event)
