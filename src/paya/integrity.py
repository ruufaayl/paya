"""Continuous integrity checks: the Week 9 reconciliation stack beyond the daily settlement file.

  Layer 1  internal technical recon   - do our own messages agree? (outbox relay, consumers)
  Layer 2  operational recon          - does what people were told match transaction state?
  Layer 3  financial recon            - does the ledger agree with itself and with transaction state?
           (the rail-file comparison lives in recon.py)
  Layer 4  exception management       - are breaks owned and inside their SLA?

Every check is read-only and returns PASS / WARN / FAIL with the evidence needed to act.
"""
from datetime import timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from . import ledger
from .config import get_settings
from .models import Account, Case, Hold, Notification, OutboxEvent, PaymentRequest, Transaction, now


def _check(layer: str, name: str, ok: bool, value, detail: str, warn: bool = False) -> dict:
    return {"layer": layer, "check": name, "status": "PASS" if ok else ("WARN" if warn else "FAIL"),
            "value": value, "detail": detail}


def run(s: Session) -> dict:
    cfg = get_settings()
    t = now()
    out: list[dict] = []

    # ---- Layer 1: internal technical
    stale = s.execute(select(func.count()).select_from(OutboxEvent).where(
        OutboxEvent.published_at.is_(None), OutboxEvent.occurred_at < t - timedelta(seconds=30))).scalar_one()
    out.append(_check("technical", "outbox_relay_lag", stale == 0, stale,
                      "events committed but not published for >30 s (relay stalled?)"))
    undispatched = s.execute(select(func.count()).select_from(Transaction).where(
        Transaction.status == "PENDING", Transaction.rail_attempts == 0,
        Transaction.pending_since < t - timedelta(seconds=30))).scalar_one()
    out.append(_check("technical", "pending_never_sent_to_rail", undispatched == 0, undispatched,
                      "PENDING payments the worker has not dispatched (worker down?)"))

    # ---- Layer 2: operational
    paid = select(Transaction.id).where(Transaction.type == "PAYMENT",
                                        Transaction.status.in_(["SETTLED", "RECONCILED"]),
                                        Transaction.updated_at < t - timedelta(seconds=30))
    notified = select(Notification.txn_id).where(Notification.template == "payment.settled",
                                                 Notification.recipient == "CUSTOMER")
    silent = s.execute(select(func.count()).select_from(paid.where(Transaction.id.notin_(notified)).subquery())).scalar_one()
    out.append(_check("operational", "settled_without_customer_notice", silent == 0, silent,
                      "customer was never told a settled payment succeeded"))
    pr_mismatch = s.execute(select(func.count()).select_from(PaymentRequest).where(
        PaymentRequest.status == "PAID",
        ~select(Transaction.id).where(and_(Transaction.payment_request_id == PaymentRequest.id,
                                           Transaction.status.in_(["SETTLED", "RECONCILED"]))).exists())).scalar_one()
    out.append(_check("operational", "till_paid_without_settlement", pr_mismatch == 0, pr_mismatch,
                      "cashier screen says PAID but no settled payment exists"))
    overdue_pending = s.execute(select(func.count()).select_from(Transaction).where(
        Transaction.status == "PENDING",
        Transaction.pending_since < t - timedelta(seconds=cfg.pending_review_after_seconds + 120))).scalar_one()
    out.append(_check("operational", "pending_beyond_review_window", overdue_pending == 0, overdue_pending,
                      "uncertain payments that should already be escalated to a human"))

    # Onboarding: no account may exist that the KYC rules did not allow.
    from .models import Customer, KYCApplication, KYCCheck
    auto_ids = select(KYCApplication.id).where(KYCApplication.decision == "AUTO_APPROVED")
    auto_bad = s.execute(select(func.count(func.distinct(KYCCheck.application_id))).where(
        KYCCheck.application_id.in_(auto_ids), KYCCheck.outcome != "PASS",
        # a liveness retry that later passed is allowed; any other non-pass is not
        KYCCheck.check.notin_(["LIVENESS", "DOCUMENT_QUALITY"]))).scalar_one()
    out.append(_check("operational", "kyc_auto_approval_only_when_all_checks_pass", auto_bad == 0, auto_bad,
                      "an application was approved automatically although a check did not pass"))
    unverified = s.execute(select(func.count()).select_from(KYCApplication).join(
        Customer, Customer.id == KYCApplication.customer_id).where(
        KYCApplication.state == "APPROVED", Customer.kyc_status != "VERIFIED")).scalar_one()
    orphan = s.execute(select(func.count()).select_from(KYCApplication).where(
        KYCApplication.state == "APPROVED", KYCApplication.customer_id.is_(None))).scalar_one()
    out.append(_check("operational", "kyc_approved_has_verified_customer", unverified + orphan == 0,
                      {"unverified": unverified, "missing": orphan},
                      "every approved application opened exactly one verified customer"))

    # ---- Layer 3: financial (internal)
    tb = ledger.trial_balance(s)
    out.append(_check("financial", "trial_balance_balanced", tb["balanced"],
                      {"debit": tb["total_debit_minor"], "credit": tb["total_credit_minor"]},
                      "sum of all debits equals sum of all credits"))
    in_transit = ledger.ledger_balance(s, ledger.house_account(s, "2150"))
    expected = s.execute(select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
        Transaction.type == "PAYMENT", Transaction.status.in_(["PENDING", "UNDER_REVIEW"]),
        Transaction.rail_e2e_id.is_not(None))).scalar_one()
    out.append(_check("financial", "in_transit_equals_open_payments", in_transit == expected,
                      {"ledger_2150": in_transit, "open_payments": int(expected)},
                      "money in transit must equal payments still awaiting the rail"))
    negative = [a.owner_id for a in s.execute(select(Account).where(Account.code == "2100")).scalars()
                if ledger.ledger_balance(s, a) < 0]
    out.append(_check("financial", "no_negative_wallets", not negative, len(negative),
                      "a customer wallet liability below zero means money was spent twice"))
    # Green banking (Theme 2): pots are customer money too, and each pot movement is exactly one journal.
    neg_pots = sum(1 for a in s.execute(select(Account).where(Account.code == "2110")).scalars()
                   if ledger.ledger_balance(s, a) < 0)
    out.append(_check("financial", "no_negative_green_pots", neg_pots == 0, neg_pots,
                      "a green pot below zero means money left it that was never in it"))
    from .models import Journal
    pot_txns = select(Transaction.id).where(Transaction.type.in_(["GREEN_POT_IN", "GREEN_POT_OUT"]))
    bad_moves = s.execute(select(func.count()).select_from(
        select(Transaction.id).where(Transaction.id.in_(pot_txns)).outerjoin(Journal, Journal.txn_id == Transaction.id)
        .group_by(Transaction.id).having(func.count(Journal.id) != 1).subquery())).scalar_one()
    out.append(_check("financial", "green_pot_move_has_one_journal", bad_moves == 0, bad_moves,
                      "every green pot movement is booked as exactly one balanced journal"))
    # Super app (Theme 4): an order's amount is the amount its payment request asks for, and a partner only
    # ever received fields the customer had consented to when the order was made.
    from .models import PartnerConsent, PaymentRequest as PR, ServiceOrder
    drift = s.execute(select(func.count()).select_from(ServiceOrder).join(PR, PR.id == ServiceOrder.payment_request_id)
                      .where(PR.amount_minor != ServiceOrder.amount_minor)).scalar_one()
    out.append(_check("financial", "service_order_matches_payment_request", drift == 0, drift,
                      "an order's price differs from what the customer was asked to pay"))
    overshared = 0
    for o, c in s.execute(select(ServiceOrder, PartnerConsent).outerjoin(
            PartnerConsent, PartnerConsent.id == ServiceOrder.consent_id)).all():
        if not o.shared:
            continue
        if c is None or not set(o.shared) <= set(c.scopes) or c.granted_at > o.created_at \
                or (c.revoked_at is not None and c.revoked_at < o.created_at):
            overshared += 1
    out.append(_check("operational", "partner_data_shared_only_with_consent", overshared == 0, overshared,
                      "a partner received customer data without a matching, live consent"))
    # Stablecoin sandbox (Theme 5): Paya's confirmed transfers must agree with the chain, and no sandbox
    # token movement may ever appear in the rupee ledger.
    from . import tokens
    from .models import Journal, TokenTransfer
    rec = tokens.reconcile()
    out.append(_check("financial", "token_transfers_match_chain", not rec["breaks"], len(rec["breaks"]),
                      "a transfer Paya shows as confirmed is missing, different or not final on the sandbox chain"))
    leaked = s.execute(select(func.count()).select_from(Journal).where(
        Journal.txn_id.in_(select(TokenTransfer.id)) | Journal.reason_code.ilike("%TOKEN%"))).scalar_one()
    out.append(_check("financial", "sandbox_tokens_never_in_rupee_ledger", leaked == 0, leaked,
                      "test tokens must never be booked as rupees"))
    unreconciled = s.execute(select(func.count()).select_from(Transaction).where(
        Transaction.type == "PAYMENT", Transaction.status == "SETTLED", Transaction.recon_result.is_(None),
        Transaction.updated_at < t - timedelta(hours=36))).scalar_one()
    out.append(_check("financial", "settled_but_unreconciled_after_d1", unreconciled == 0, unreconciled,
                      "settled payments no settlement file has covered after D+1 (a file may be missing or identical "
                      "to one already processed)", warn=True))
    stale_holds = s.execute(select(func.count()).select_from(Hold).where(
        Hold.status == "ACTIVE", Hold.expires_at < t)).scalar_one()
    out.append(_check("financial", "expired_holds_released", stale_holds == 0, stale_holds,
                      "expired reservations still reducing available balance", warn=True))

    # ---- Layer 4: exception management
    overdue = dict(s.execute(select(Case.owner_role, func.count()).where(
        Case.state != "RESOLVED", Case.sla_due_at < t).group_by(Case.owner_role)).all())
    out.append(_check("exceptions", "cases_within_sla", not overdue, overdue,
                      "open human work items past their SLA, by owner", warn=True))
    unowned = s.execute(select(func.count()).select_from(Case).where(Case.owner_role.is_(None))).scalar_one()
    out.append(_check("exceptions", "every_case_has_owner", unowned == 0, unowned, "breaks without an owner"))

    worst = "FAIL" if any(c["status"] == "FAIL" for c in out) else ("WARN" if any(c["status"] == "WARN" for c in out) else "PASS")
    return {"overall": worst, "checked_at": t.isoformat(), "checks": out}
