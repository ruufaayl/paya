"""Payment orchestration: the single money path every Paya feature must use.

Journey: CREATED -> VALIDATED -> AUTHORISED -> POSTED -> PENDING -> SETTLED -> RECONCILED
with UNDER_REVIEW for holds / uncertainty and REVERSED via a compensating journal.

Ledger postings (integer paisa):
  AUTH_POST  Dr 2100 customer wallet      Cr 2150 payments in transit
  SETTLE     Dr 2150 payments in transit  Cr 1010 settlement account
  FEE        Dr 1300 merchant fee recv.   Cr 4100 fee income
  REVERSAL   Dr 2150 payments in transit  Cr 2100 customer wallet
"""
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import audit, events, ledger
from .config import get_settings
from .db import session_scope
from .errors import (
    InvalidState, NotFound, PaymentAlreadyInProgress, PaymentRequestClosed,
    RailUnavailableError, SegregationOfDuties,
)
from .ledger import Line
from .models import Approval, Case, Customer, Hold, Merchant, PaymentRequest, Transaction, now
from .rail import RailTimeout, RailUnavailable, breaker, rail
from .risk import screen
from .state import transition

SYSTEM = "system"


def new_ref(prefix: str = "PAYA") -> str:
    return f"{prefix}-{now():%Y%m%d}-{secrets.token_hex(3).upper()}"


def new_correlation_id() -> str:
    return "corr-" + uuid.uuid4().hex[:20]


def open_case(s: Session, *, kind: str, txn: Transaction | None, owner_role: str, summary: str,
              details: dict, sla_minutes: int) -> Case:
    c = Case(case_ref=new_ref("CASE"), kind=kind, txn_id=txn.id if txn else None, owner_role=owner_role,
             summary=summary, details=details, sla_due_at=now() + timedelta(minutes=sla_minutes))
    s.add(c)
    s.flush()
    events.emit(s, "case.opened", aggregate_id=c.id, correlation_id=txn.correlation_id if txn else "case",
                payload={"case_ref": c.case_ref, "kind": kind, "owner_role": owner_role, "summary": summary,
                         "txn_ref": txn.txn_ref if txn else None})
    events.telemetry("human_gate", "case_opened", txn_ref=txn.txn_ref if txn else None,
                     detail={"case_ref": c.case_ref, "kind": kind, "owner": owner_role}, level="warn")
    return c


# ------------------------------------------------------------------ merchant side
def create_payment_request(merchant_id: uuid.UUID, amount_minor: int, order_ref: str, actor: str,
                           kind: str = "DYNAMIC_QR") -> PaymentRequest:
    with session_scope() as s:
        m = s.get(Merchant, merchant_id)
        if m is None or m.status != "ACTIVE":
            raise NotFound("merchant not found or inactive")
        pr = PaymentRequest(merchant_id=merchant_id, amount_minor=amount_minor, order_ref=order_ref, kind=kind,
                            created_by=actor,
                            expires_at=now() + timedelta(seconds=get_settings().payment_request_ttl_seconds))
        s.add(pr)
        s.flush()
        events.telemetry("merchant", "payment_request_created",
                         detail={"order_ref": order_ref, "amount_minor": amount_minor, "merchant": m.trading_name})
        return pr


def qr_payload(pr: PaymentRequest, merchant: Merchant) -> str:
    """Synthetic QR content. Real Raast QR follows SBP specs shared only with regulated entities."""
    return f"paya://pay?pr={pr.id}&alias={merchant.raast_alias}&amt={pr.amount_minor}&ref={pr.order_ref}"


# ------------------------------------------------------------------ customer side
def initiate_payment(*, customer_id: uuid.UUID, payment_request_id: uuid.UUID, actor: str,
                     correlation_id: str) -> Transaction:
    """Runs validation, authorisation and posting in ONE database transaction, then hands off to the rail."""
    if not breaker.allow():
        events.telemetry("rail", "circuit_open_refused", level="error")
        raise RailUnavailableError("Raast is unavailable right now; no money has been taken. Please try again shortly.")
    try:
        with session_scope() as s:
            pr = s.execute(select(PaymentRequest).where(PaymentRequest.id == payment_request_id).with_for_update()).scalar_one_or_none()
            if pr is None:
                raise NotFound("payment request not found")
            existing = s.execute(
                select(Transaction).where(Transaction.payment_request_id == pr.id, Transaction.type == "PAYMENT",
                                          Transaction.status.notin_(["REJECTED", "FAILED", "EXPIRED", "REVERSED"]))
            ).scalar_one_or_none()
            if existing is not None:
                raise PaymentAlreadyInProgress("this payment request already has a live payment",
                                               txn_ref=existing.txn_ref, status=existing.status)
            if pr.status != "OPEN" or pr.expires_at <= now():
                raise PaymentRequestClosed(f"payment request is {pr.status if pr.status != 'OPEN' else 'EXPIRED'}")
            customer = s.get(Customer, customer_id)
            merchant = s.get(Merchant, pr.merchant_id)
            if customer is None:
                raise NotFound("customer not found")

            txn = Transaction(txn_ref=new_ref(), type="PAYMENT", status="CREATED", amount_minor=pr.amount_minor,
                              customer_id=customer.id, merchant_id=merchant.id, payment_request_id=pr.id,
                              correlation_id=correlation_id)
            s.add(txn)
            s.flush()
            events.emit(s, "payment.created", aggregate_id=txn.id, correlation_id=correlation_id,
                        payload={"txn_id": str(txn.id), "txn_ref": txn.txn_ref, "amount_minor": txn.amount_minor,
                                 "merchant": merchant.trading_name, "order_ref": pr.order_ref,
                                 "customer_status": "Processing"})
            events.telemetry("gateway", "accepted", txn_ref=txn.txn_ref,
                             detail={"amount_minor": txn.amount_minor, "merchant": merchant.trading_name})

            # ---- validate (KYC / AML / fraud rules)
            events.telemetry("risk", "screening", txn_ref=txn.txn_ref)
            result = screen(s, txn, customer, merchant)
            if result.outcome == "REJECT":
                transition(s, txn, "REJECTED", actor=SYSTEM, reason="risk_reject",
                           evidence={"screening_id": str(result.id), "rules": result.rules_fired})
                txn.failure_reason = result.rules_fired[0]["rule"]
                events.telemetry("risk", "rejected", txn_ref=txn.txn_ref, detail={"rules": result.rules_fired}, level="error")
                return txn
            transition(s, txn, "VALIDATED", actor=SYSTEM, reason="risk_checks_complete",
                       evidence={"screening_id": str(result.id)})
            if result.outcome == "HOLD":
                transition(s, txn, "UNDER_REVIEW", actor=SYSTEM, reason="compliance_hold",
                           evidence={"screening_id": str(result.id), "rules": result.rules_fired})
                open_case(s, kind="COMPLIANCE_HOLD", txn=txn, owner_role="COMPLIANCE",
                          summary=f"Payment {txn.txn_ref} held: " + ", ".join(r["rule"] for r in result.rules_fired),
                          details={"rules": result.rules_fired, "data_used": result.data_used}, sla_minutes=240)
                events.telemetry("risk", "held", txn_ref=txn.txn_ref, detail={"rules": result.rules_fired}, level="warn")
                return txn
            events.telemetry("risk", "passed", txn_ref=txn.txn_ref)
            _authorise_and_post(s, txn, customer, actor=actor)
            return txn
    except IntegrityError as exc:
        if "uq_one_live_payment_per_request" in str(exc):
            raise PaymentAlreadyInProgress("this payment request already has a live payment") from exc
        raise


def _authorise_and_post(s: Session, txn: Transaction, customer: Customer, *, actor: str) -> None:
    cfg = get_settings()
    wallet = ledger.owned_account(s, "2100", "CUSTOMER", customer.id)
    ledger.lock_account(s, wallet.id)  # serialise concurrent spends from this wallet
    available = ledger.available_balance(s, wallet)
    if available < txn.amount_minor:
        txn.failure_reason = "INSUFFICIENT_FUNDS"
        transition(s, txn, "REJECTED", actor=SYSTEM, reason="insufficient_funds",
                   evidence={"available_minor": available})
        events.telemetry("ledger", "insufficient_funds", txn_ref=txn.txn_ref, level="error")
        return
    hold = Hold(account_id=wallet.id, txn_id=txn.id, amount_minor=txn.amount_minor,
                expires_at=now() + timedelta(seconds=cfg.hold_ttl_seconds))
    s.add(hold)
    s.flush()
    transition(s, txn, "AUTHORISED", actor=SYSTEM, reason="funds_reserved",
               evidence={"hold_id": str(hold.id), "available_before_minor": available})
    events.telemetry("ledger", "hold_placed", txn_ref=txn.txn_ref, detail={"amount_minor": txn.amount_minor})

    in_transit = ledger.house_account(s, "2150")
    j = ledger.post(s, txn_id=txn.id, posting_type="AUTH_POST", reason_code="CUSTOMER_PAYMENT_DEBIT",
                    actor=actor, correlation_id=txn.correlation_id,
                    lines=[Line(wallet.id, "D", txn.amount_minor), Line(in_transit.id, "C", txn.amount_minor)])
    hold.status = "CONSUMED"
    transition(s, txn, "POSTED", actor=SYSTEM, reason="ledger_posted", evidence={"journal_id": str(j.id)})
    events.telemetry("ledger", "posted", txn_ref=txn.txn_ref,
                     detail={"journal": "AUTH_POST", "dr": "2100 wallet", "cr": "2150 in transit",
                             "amount_minor": txn.amount_minor})

    # Hand-off to clearing. PENDING + e2e id are committed BEFORE the rail call, so a crash
    # mid-call leaves a recoverable PENDING transaction with a scheduled status enquiry.
    txn.rail_e2e_id = "E2E" + uuid.uuid4().hex[:24].upper()
    txn.pending_since = now()
    txn.next_enquiry_at = now() + timedelta(seconds=cfg.enquiry_backoff_seconds[0])
    transition(s, txn, "PENDING", actor=SYSTEM, reason="sent_to_clearing", evidence={"rail_e2e_id": txn.rail_e2e_id})


def dispatch(txn_id: uuid.UUID) -> str:
    """Send a PENDING payment to the rail. Safe to call repeatedly (rail is idempotent on e2e id)."""
    with session_scope() as s:
        txn = s.get(Transaction, txn_id)
        if txn is None or txn.status != "PENDING":
            return "SKIPPED"
        merchant = s.get(Merchant, txn.merchant_id)
        e2e, amount, alias, ref = txn.rail_e2e_id, txn.amount_minor, merchant.raast_alias, txn.txn_ref
        txn.rail_attempts += 1
    events.telemetry("rail", "sending", txn_ref=ref, detail={"e2e_id": e2e, "attempt": "send"})
    try:
        ack = rail.send_credit(e2e_id=e2e, amount_minor=amount, creditor_alias=alias, txn_ref=ref)
        breaker.success()
    except RailTimeout as exc:
        breaker.failure()
        events.telemetry("rail", "timeout_unknown_outcome", txn_ref=ref, detail={"error": str(exc)}, level="warn")
        return "UNKNOWN"
    except RailUnavailable as exc:
        breaker.failure()
        events.telemetry("rail", "unavailable", txn_ref=ref, detail={"error": str(exc), "breaker": breaker.state}, level="error")
        return "UNAVAILABLE"
    with session_scope() as s:
        txn = s.get(Transaction, txn_id)
        apply_rail_outcome(s, txn, ack.status, source="sync_ack", evidence={"rail_ref": ack.rail_ref, "reason": ack.reason})
    return ack.status


def apply_rail_outcome(s: Session, txn: Transaction, status: str, *, source: str, evidence: dict) -> str:
    """Single place where an external rail answer changes internal state. Duplicate answers are no-ops."""
    events.telemetry("rail", f"answer_{status.lower()}", txn_ref=txn.txn_ref, detail={"source": source, **evidence},
                     level="info" if status == "ACCEPTED" else "warn")
    if status == "ACCEPTED":
        if txn.status in ("PENDING", "UNDER_REVIEW"):
            _settle(s, txn, actor=SYSTEM, evidence={"source": source, **evidence})
            return "SETTLED"
        if txn.status in ("SETTLED", "RECONCILED"):
            events.telemetry("rail", "duplicate_ack_ignored", txn_ref=txn.txn_ref, level="warn")
            return "DUPLICATE"
        if txn.status == "REVERSED":  # rail says paid, we already returned the money: needs a human
            open_case(s, kind="RECON_BREAK", txn=txn, owner_role="FINANCE",
                      summary=f"{txn.txn_ref}: rail reports ACCEPTED after internal reversal (STATUS_MISMATCH)",
                      details={"category": "STATUS_MISMATCH", "source": source, **evidence}, sla_minutes=480)
            return "MISMATCH"
    if status == "REJECTED":
        if txn.status in ("PENDING", "UNDER_REVIEW"):
            _reverse(s, txn, actor=SYSTEM, reason="rail_rejected", initiated_via="WORKER")
            return "REVERSED"
        if txn.status == "REVERSED":
            return "DUPLICATE"
        if txn.status in ("SETTLED", "RECONCILED"):
            open_case(s, kind="RECON_BREAK", txn=txn, owner_role="FINANCE",
                      summary=f"{txn.txn_ref}: rail reports REJECTED after settlement (STATUS_MISMATCH)",
                      details={"category": "STATUS_MISMATCH", "source": source, **evidence}, sla_minutes=480)
            return "MISMATCH"
    return "IGNORED"


def _settle(s: Session, txn: Transaction, *, actor: str, evidence: dict) -> None:
    in_transit = ledger.house_account(s, "2150")
    settlement = ledger.house_account(s, "1010")
    j = ledger.post(s, txn_id=txn.id, posting_type="SETTLE", reason_code="RAIL_SETTLEMENT_CONFIRMED", actor=actor,
                    correlation_id=txn.correlation_id, initiated_via="WORKER",
                    lines=[Line(in_transit.id, "D", txn.amount_minor), Line(settlement.id, "C", txn.amount_minor)])
    fee = txn.amount_minor * get_settings().fee_bps // 10_000
    if fee > 0:
        recv = ledger.owned_account(s, "1300", "MERCHANT", txn.merchant_id)
        income = ledger.house_account(s, "4100")
        ledger.post(s, txn_id=txn.id, posting_type="FEE", reason_code="MERCHANT_DISCOUNT_FEE", actor=actor,
                    correlation_id=txn.correlation_id, initiated_via="WORKER",
                    lines=[Line(recv.id, "D", fee), Line(income.id, "C", fee)])
    txn.next_enquiry_at = None
    transition(s, txn, "SETTLED", actor=actor, reason="rail_confirmed", evidence={"journal_id": str(j.id), **evidence})
    if txn.payment_request_id:
        pr = s.get(PaymentRequest, txn.payment_request_id)
        pr.status = "PAID"
    events.telemetry("ledger", "settled", txn_ref=txn.txn_ref,
                     detail={"journal": "SETTLE", "dr": "2150 in transit", "cr": "1010 settlement", "fee_minor": fee})


def _reverse(s: Session, txn: Transaction, *, actor: str, reason: str, initiated_via: str,
             approved_by: str | None = None) -> Transaction:
    rev = Transaction(txn_ref=new_ref("REV"), type="REVERSAL", status="COMPLETED", amount_minor=txn.amount_minor,
                      customer_id=txn.customer_id, merchant_id=txn.merchant_id, original_txn_id=txn.id,
                      rail=txn.rail, correlation_id=txn.correlation_id)
    s.add(rev)
    s.flush()
    wallet = ledger.owned_account(s, "2100", "CUSTOMER", txn.customer_id)
    in_transit = ledger.house_account(s, "2150")
    ledger.post(s, txn_id=rev.id, posting_type="REVERSAL", reason_code=reason.upper(), actor=actor,
                correlation_id=txn.correlation_id, initiated_via=initiated_via, approved_by=approved_by,
                lines=[Line(in_transit.id, "D", txn.amount_minor), Line(wallet.id, "C", txn.amount_minor)])
    txn.next_enquiry_at = None
    txn.failure_reason = reason
    transition(s, txn, "REVERSED", actor=actor, reason=reason,
               evidence={"reversal_txn_ref": rev.txn_ref, "approved_by": approved_by})
    events.telemetry("ledger", "reversed", txn_ref=txn.txn_ref,
                     detail={"journal": "REVERSAL", "dr": "2150 in transit", "cr": "2100 wallet", "reason": reason},
                     level="warn")
    return rev


# ------------------------------------------------------------------ recovery workers
def run_status_enquiries(force: bool = False) -> dict:
    """Resolve uncertain payments by ASKING the rail - never by blind resend."""
    cfg = get_settings()
    stats = {"checked": 0, "settled": 0, "reversed": 0, "resent": 0, "escalated": 0, "still_unknown": 0}
    with session_scope() as s:
        q = select(Transaction.id).where(Transaction.status == "PENDING")
        if not force:
            q = q.where(Transaction.next_enquiry_at <= now())
        ids = s.execute(q.limit(200)).scalars().all()
    for tid in ids:
        stats["checked"] += 1
        with session_scope() as s:
            txn = s.get(Transaction, tid)
            if txn.status != "PENDING":
                continue
            e2e, ref = txn.rail_e2e_id, txn.txn_ref
        events.telemetry("rail", "status_enquiry", txn_ref=ref, detail={"e2e_id": e2e})
        try:
            answer = rail.enquire(e2e)
        except RailUnavailable:
            answer = "UNAVAILABLE"
        with session_scope() as s:
            txn = s.get(Transaction, tid)
            if txn.status != "PENDING":
                continue
            if answer in ("ACCEPTED", "REJECTED"):
                r = apply_rail_outcome(s, txn, answer, source="status_enquiry", evidence={"e2e_id": e2e})
                stats["settled" if r == "SETTLED" else "reversed"] += 1
                continue
            age = (now() - txn.pending_since).total_seconds() if txn.pending_since else 0
            if age >= cfg.pending_review_after_seconds:
                transition(s, txn, "UNDER_REVIEW", actor=SYSTEM, reason="pending_timeout_escalated",
                           evidence={"last_enquiry": answer, "age_s": int(age)})
                open_case(s, kind="PENDING_REVIEW", txn=txn, owner_role="OPS",
                          summary=f"{ref} still uncertain after {int(age)}s (last enquiry: {answer})",
                          details={"last_enquiry": answer, "e2e_id": e2e}, sla_minutes=60)
                stats["escalated"] += 1
                continue
            step = min(txn.rail_attempts, len(cfg.enquiry_backoff_seconds) - 1)
            txn.next_enquiry_at = now() + timedelta(seconds=cfg.enquiry_backoff_seconds[step])
            needs_resend = answer == "NOT_FOUND"
        if needs_resend:  # the rail confirms it never received it: resending the SAME e2e id is safe
            events.telemetry("rail", "resend_same_e2e", txn_ref=ref, detail={"e2e_id": e2e}, level="warn")
            stats["resent"] += 1
            dispatch(tid)
        else:
            stats["still_unknown"] += 1
    return stats


def process_rail_callbacks() -> int:
    """Consume asynchronous rail acknowledgements with duplicate-safe (inbox) handling."""
    n = 0
    for cb in getattr(rail, "due_callbacks", lambda: [])():
        def handler(s: Session, env: dict) -> None:
            txn = s.execute(select(Transaction).where(Transaction.rail_e2e_id == env["e2e_id"]).with_for_update()).scalar_one_or_none()
            if txn is not None:
                apply_rail_outcome(s, txn, env["status"], source="async_callback", evidence={"callback_id": env["event_id"]})
        if events.consume_once("rail-ack-consumer", cb, handler):
            n += 1
    return n


def expire_stale() -> int:
    with session_scope() as s:
        holds = s.execute(select(Hold).where(Hold.status == "ACTIVE", Hold.expires_at <= now())).scalars().all()
        for h in holds:
            h.status = "RELEASED"
        prs = s.execute(select(PaymentRequest).where(PaymentRequest.status == "OPEN", PaymentRequest.expires_at <= now())).scalars().all()
        for p in prs:
            p.status = "EXPIRED"
        return len(holds) + len(prs)


# ------------------------------------------------------------------ human decisions
def compliance_decide(*, txn_ref: str, decision: str, actor: str, actor_role: str, reason: str) -> Transaction:
    """Release or reject a compliance hold. Money has not moved yet for a held payment."""
    with session_scope() as s:
        txn = s.execute(select(Transaction).where(Transaction.txn_ref == txn_ref).with_for_update()).scalar_one_or_none()
        if txn is None:
            raise NotFound("transaction not found")
        case = s.execute(select(Case).where(Case.txn_id == txn.id, Case.kind == "COMPLIANCE_HOLD", Case.state == "OPEN")).scalar_one_or_none()
        if txn.status != "UNDER_REVIEW" or case is None:
            raise InvalidState("transaction has no open compliance hold")
        case.state, case.resolution, case.resolved_by, case.resolved_at = "RESOLVED", decision, actor, now()
        audit.record(s, actor=actor, actor_role=actor_role, action=f"COMPLIANCE_{decision}", object_type="transaction",
                     object_id=txn.txn_ref, reason=reason, correlation_id=txn.correlation_id, details={"case": case.case_ref})
        events.telemetry("human_gate", f"compliance_{decision.lower()}", txn_ref=txn.txn_ref, detail={"by": actor})
        if decision == "REJECT":
            transition(s, txn, "REJECTED", actor=actor, reason=f"compliance_rejected: {reason}")
            return txn
        # A released hold re-enters the normal path: reserve funds, post, hand off to clearing.
        _release_into_authorisation(s, txn, s.get(Customer, txn.customer_id), actor)
        return txn


def _release_into_authorisation(s: Session, txn: Transaction, customer: Customer, actor: str) -> None:
    """UNDER_REVIEW -> AUTHORISED -> POSTED -> PENDING, or REJECTED if funds are no longer available."""
    _authorise_and_post(s, txn, customer, actor=actor)


def request_reversal(*, txn_ref: str, actor: str, actor_role: str, reason: str) -> Approval:
    """Maker step (OPS). Money does not move until a different person in FINANCE approves."""
    with session_scope() as s:
        txn = s.execute(select(Transaction).where(Transaction.txn_ref == txn_ref)).scalar_one_or_none()
        if txn is None:
            raise NotFound("transaction not found")
        if txn.status not in ("PENDING", "UNDER_REVIEW"):
            raise InvalidState(f"cannot reverse a {txn.status} payment; settled payments are refunded instead")
        a = Approval(action="REVERSAL", txn_id=txn.id, requested_by=actor, reason=reason)
        s.add(a)
        s.flush()
        audit.record(s, actor=actor, actor_role=actor_role, action="REVERSAL_REQUESTED", object_type="transaction",
                     object_id=txn_ref, reason=reason, correlation_id=txn.correlation_id, details={"approval_id": str(a.id)})
        events.telemetry("human_gate", "reversal_requested", txn_ref=txn_ref, detail={"maker": actor}, level="warn")
        return a


def approve_reversal(*, approval_id: uuid.UUID, actor: str, actor_role: str) -> Transaction:
    """Checker step (FINANCE). The maker can never approve their own request (app + DB check)."""
    with session_scope() as s:
        a = s.execute(select(Approval).where(Approval.id == approval_id)).scalar_one_or_none()
        if a is None or a.status != "REQUESTED":
            raise NotFound("open approval not found")
        self_approval = a.requested_by == actor
    if self_approval:
        # Recorded in its own transaction so the denial survives the rollback of the refused action.
        with session_scope() as s:
            audit.record(s, actor=actor, actor_role=actor_role, action="REVERSAL_APPROVE", object_type="approval",
                         object_id=str(approval_id), outcome="DENIED", reason="maker cannot be checker")
        events.telemetry("security", "access_denied", detail={"user": actor, "role": actor_role,
                                                               "permission": "approve own reversal (SoD)"}, level="error")
        raise SegregationOfDuties("the person who requested a reversal cannot approve it")
    with session_scope() as s:
        a = s.execute(select(Approval).where(Approval.id == approval_id).with_for_update()).scalar_one_or_none()
        if a is None or a.status != "REQUESTED":
            raise NotFound("open approval not found")
        txn = s.execute(select(Transaction).where(Transaction.id == a.txn_id).with_for_update()).scalar_one()
        if txn.status not in ("PENDING", "UNDER_REVIEW"):
            raise InvalidState(f"transaction is now {txn.status}")
        a.approved_by, a.status, a.decided_at = actor, "APPROVED", now()
        _reverse(s, txn, actor=actor, reason="ops_reversal_approved", initiated_via="MANUAL_APPROVED", approved_by=actor)
        for c in s.execute(select(Case).where(Case.txn_id == txn.id, Case.state == "OPEN")).scalars():
            c.state, c.resolution, c.resolved_by, c.resolved_at = "RESOLVED", "REVERSED", actor, now()
        audit.record(s, actor=actor, actor_role=actor_role, action="REVERSAL_APPROVED", object_type="transaction",
                     object_id=txn.txn_ref, reason=a.reason, correlation_id=txn.correlation_id,
                     details={"approval_id": str(a.id), "maker": a.requested_by})
        events.telemetry("human_gate", "reversal_approved", txn_ref=txn.txn_ref, detail={"checker": actor, "maker": a.requested_by})
        return txn
