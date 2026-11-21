"""Theme 2: sustainable and green banking.

Three bounded features, all on the existing systems of record:

1. Footprint insights (read-only). An ESTIMATE of the carbon linked to a customer's spending, from
   settled payments only (the ledger decides what was spent) and a versioned table of spend-based
   factors. The factors are illustrative, not measured emissions: every answer says so and carries the
   factor-set version, so a figure can always be traced to the table that produced it.
2. Green pot (a savings product). Money ring-fenced inside the customer's own wallet, booked on chart
   account 2110. Moving money in or out is an internal double-entry journal (2100 <-> 2110) with an
   Idempotency-Key, a wallet row lock and the same balance checks as a payment. No money leaves Paya,
   no interest is promised, and nothing here issues money.
3. Offsets. A contribution to a SYNTHETIC offset project is an ordinary Raast P2M payment: the customer
   gets a payment request and goes through the normal review, screening, ledger and rail path. A
   certificate exists only once the ledger shows the payment SETTLED. It is a simulated record: no
   registry, no real carbon credit is retired.
"""
import math
import uuid
from datetime import timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from . import events, ledger, payments
from .db import session_scope
from .errors import InsufficientFunds, NotFound, ValidationFailed
from .ledger import Line
from .models import Account, Customer, Journal, Merchant, PaymentRequest, Transaction, now
from .state import CUSTOMER_STATUS

FACTOR_SET = "green.v1"
# kg CO2e per Rs 1,000 spent. Illustrative spend-based factors chosen for the demo; NOT measured, NOT audited.
# A real deployment would license an environmentally-extended input-output dataset and map it to the
# Pakistan Green Taxonomy categories. The uncertainty band is shown to the customer.
FACTORS: dict[str, dict] = {
    "FOOD_BEVERAGE": {"label": "Food and drink", "kg_per_1000": 2.4},
    "GROCERY": {"label": "Groceries", "kg_per_1000": 1.9},
    "PHARMACY": {"label": "Health and pharmacy", "kg_per_1000": 1.1},
    "FUEL": {"label": "Fuel", "kg_per_1000": 9.5},
    "TRANSPORT": {"label": "Transport", "kg_per_1000": 4.2},
    "CARBON_OFFSET": {"label": "Offsets", "kg_per_1000": 0.0},
}
DEFAULT_FACTOR = {"label": "Other spending", "kg_per_1000": 2.0}
UNCERTAINTY = 0.5  # +/- 50 %: spend-based factors are coarse
SPENT = ("SETTLED", "RECONCILED")

POT_IN, POT_OUT = "GREEN_POT_IN", "GREEN_POT_OUT"
POT_MAX_MINOR = 500_000_00      # Rs 500,000 per pot (synthetic product limit)
ROUND_TO_MINOR = 100_00         # round-ups to the next Rs 100

OFFSET_MERCHANT = ("MRC-0900", "Indus Delta Mangroves (synthetic project)", "CARBON_OFFSET",
                   "indusmangroves@paya", "PK** PAYA **** **** 0900")
OFFSET_KIND = "GREEN_OFFSET"
PRICE_PER_TONNE_MINOR = 3_000_00  # illustrative Rs 3,000 per tonne
OFFSET_MIN_MINOR, OFFSET_MAX_MINOR = 100_00, 10_000_00


def _kg(minor: int, category: str) -> float:
    f = FACTORS.get(category, DEFAULT_FACTOR)["kg_per_1000"]
    return minor / 100 / 1000 * f


# ------------------------------------------------------------------ 1. footprint
def footprint(customer_id: uuid.UUID, days: int = 30) -> dict:
    with session_scope() as s:
        since = now() - timedelta(days=days)
        rows = s.execute(select(Merchant.category, func.count(), func.coalesce(func.sum(Transaction.amount_minor), 0))
                         .join(Merchant, Merchant.id == Transaction.merchant_id)
                         .where(Transaction.customer_id == customer_id, Transaction.type == "PAYMENT",
                                Transaction.status.in_(SPENT), Transaction.created_at >= since)
                         .group_by(Merchant.category)).all()
        cats = []
        for cat, n, minor in rows:
            kg = _kg(int(minor), cat)
            cats.append({"category": cat, "label": FACTORS.get(cat, DEFAULT_FACTOR)["label"], "payments": n,
                         "spent_minor": int(minor), "kg": round(kg, 2),
                         "factor_kg_per_1000": FACTORS.get(cat, DEFAULT_FACTOR)["kg_per_1000"]})
        cats.sort(key=lambda c: -c["kg"])
        total = sum(c["kg"] for c in cats)
        offset_kg = sum(c["kg_offset"] for c in _offsets(s, customer_id) if c["status"] == "RECORDED"
                        and c["at"] >= since.isoformat())
        return {"days": days, "factor_set": FACTOR_SET, "estimate": True,
                "total_kg": round(total, 2),
                "range_kg": [round(total * (1 - UNCERTAINTY), 2), round(total * (1 + UNCERTAINTY), 2)],
                "offset_kg": round(offset_kg, 2), "categories": cats,
                "method": "Spend-based estimate: settled payments x an illustrative factor per merchant category. "
                          "Not a measurement of your emissions."}


def factor_table() -> dict:
    return {"factor_set": FACTOR_SET, "unit": "kg CO2e per Rs 1,000", "uncertainty": UNCERTAINTY,
            "status": "Illustrative, for demonstration; not measured or audited",
            "factors": [{"category": k, **v} for k, v in FACTORS.items()] + [{"category": "*", **DEFAULT_FACTOR}]}


# ------------------------------------------------------------------ 2. green pot
def _accounts(s: Session, cid: uuid.UUID) -> tuple[Account, Account]:
    return ledger.owned_account(s, "2100", "CUSTOMER", cid), ledger.owned_account(s, "2110", "CUSTOMER", cid)


def roundup_suggestion(s: Session, cid: uuid.UUID, days: int = 30) -> int:
    """Round-ups on settled payments in the window, less round-up deposits already made in it."""
    since = now() - timedelta(days=days)
    amounts = s.execute(select(Transaction.amount_minor).where(
        Transaction.customer_id == cid, Transaction.type == "PAYMENT", Transaction.status.in_(SPENT),
        Transaction.created_at >= since)).scalars().all()
    owed = sum((math.ceil(a / ROUND_TO_MINOR) * ROUND_TO_MINOR) - a for a in amounts)
    done = s.execute(select(func.coalesce(func.sum(Transaction.amount_minor), 0))
                     .join(Journal, Journal.txn_id == Transaction.id)
                     .where(Transaction.customer_id == cid, Transaction.type == POT_IN,
                            Journal.reason_code == "GREEN_POT_ROUND_UP", Transaction.created_at >= since)).scalar_one()
    return max(0, owed - int(done))


def pot_view(customer_id: uuid.UUID) -> dict:
    with session_scope() as s:
        cust = s.get(Customer, customer_id)
        wallet, pot = _accounts(s, customer_id)
        moves = s.execute(select(Transaction).where(Transaction.customer_id == customer_id,
                                                    Transaction.type.in_([POT_IN, POT_OUT]))
                          .order_by(Transaction.created_at.desc()).limit(20)).scalars().all()
        return {"balance": ledger.ledger_balance(s, pot), "wallet_available": ledger.available_balance(s, wallet),
                "limit": POT_MAX_MINOR, "roundup_suggested": roundup_suggestion(s, customer_id),
                "eligible": cust.kyc_status == "VERIFIED", "account": "2110 Customer green pots",
                "moves": [{"txn_ref": t.txn_ref, "direction": "IN" if t.type == POT_IN else "OUT",
                           "amount_minor": t.amount_minor, "at": t.created_at.isoformat()} for t in moves]}


def move(customer_id: uuid.UUID, *, direction: str, amount_minor: int, source: str, actor: str,
         correlation_id: str) -> dict:
    """Move money between the customer's wallet (2100) and green pot (2110). One balanced journal."""
    if direction not in ("IN", "OUT") or source not in ("MANUAL", "ROUND_UP") or (direction == "OUT" and source != "MANUAL"):
        raise ValidationFailed("unsupported pot movement")
    if amount_minor <= 0 or amount_minor % 100:
        raise ValidationFailed("amount must be whole rupees and above zero")
    with session_scope() as s:
        cust = s.get(Customer, customer_id)
        if cust is None:
            raise NotFound("customer not found")
        if cust.kyc_status != "VERIFIED":
            raise ValidationFailed("a green pot needs a verified wallet")
        wallet, pot = _accounts(s, customer_id)
        ledger.lock_account(s, wallet.id)  # the same lock a payment takes, so a pot move and a payment serialise
        ledger.lock_account(s, pot.id)
        if direction == "IN":
            available = ledger.available_balance(s, wallet)
            if amount_minor > available:
                raise InsufficientFunds("not enough available balance in your wallet", available_minor=available)
            if ledger.ledger_balance(s, pot) + amount_minor > POT_MAX_MINOR:
                raise ValidationFailed("this would take your green pot above its Rs 500,000 limit")
            if source == "ROUND_UP" and amount_minor > roundup_suggestion(s, customer_id):
                raise ValidationFailed("that is more than your round-ups")
            lines = [Line(wallet.id, "D", amount_minor), Line(pot.id, "C", amount_minor)]
        else:
            in_pot = ledger.ledger_balance(s, pot)
            if amount_minor > in_pot:
                raise InsufficientFunds("not enough in your green pot", available_minor=in_pot)
            lines = [Line(pot.id, "D", amount_minor), Line(wallet.id, "C", amount_minor)]
        t = Transaction(txn_ref=payments.new_ref("GRN"), type=POT_IN if direction == "IN" else POT_OUT,
                        status="COMPLETED", amount_minor=amount_minor, customer_id=customer_id, rail="INTERNAL",
                        correlation_id=correlation_id)
        s.add(t)
        s.flush()
        reason = "GREEN_POT_ROUND_UP" if source == "ROUND_UP" else ("GREEN_POT_DEPOSIT" if direction == "IN"
                                                                     else "GREEN_POT_WITHDRAWAL")
        ledger.post(s, txn_id=t.id, posting_type=t.type, reason_code=reason, actor=actor,
                    correlation_id=correlation_id, lines=lines)
        events.emit(s, "green.pot_moved", aggregate_id=t.id, correlation_id=correlation_id,
                    payload={"txn_ref": t.txn_ref, "direction": direction, "amount_minor": amount_minor})
        events.telemetry("ledger", "green_pot_moved", txn_ref=t.txn_ref,
                         detail={"direction": direction, "amount_minor": amount_minor,
                                 "dr": "2100 wallet" if direction == "IN" else "2110 green pot",
                                 "cr": "2110 green pot" if direction == "IN" else "2100 wallet"})
        return {"txn_ref": t.txn_ref, "direction": direction, "amount_minor": amount_minor,
                "pot_balance": ledger.ledger_balance(s, pot), "wallet_available": ledger.available_balance(s, wallet)}


# ------------------------------------------------------------------ 3. offsets
def offset_merchant(s: Session) -> Merchant:
    reg, name, cat, alias, iban = OFFSET_MERCHANT
    s.execute(text("SELECT pg_advisory_xact_lock(hashtext('green:offset_merchant'))"))
    m = s.execute(select(Merchant).where(Merchant.registration_ref == reg)).scalar_one_or_none()
    if m is None:
        m = Merchant(registration_ref=reg, trading_name=name, category=cat, raast_alias=alias,
                     settlement_iban_masked=iban)
        s.add(m)
        s.flush()
    return m


def create_offset_request(customer_id: uuid.UUID, amount_minor: int, actor: str) -> uuid.UUID:
    """An offset is paid like any purchase: this only creates the payment request the customer then reviews."""
    if not OFFSET_MIN_MINOR <= amount_minor <= OFFSET_MAX_MINOR or amount_minor % 100:
        raise ValidationFailed("offsets are between Rs 100 and Rs 10,000, in whole rupees")
    with session_scope() as s:
        m = offset_merchant(s)
    pr = payments.create_payment_request(m.id, amount_minor, f"OFFSET-{uuid.uuid4().hex[:8].upper()}", actor,
                                         kind=OFFSET_KIND)
    return pr.id


def _offsets(s: Session, cid: uuid.UUID) -> list[dict]:
    m = s.execute(select(Merchant).where(Merchant.registration_ref == OFFSET_MERCHANT[0])).scalar_one_or_none()
    if m is None:
        return []
    txns = s.execute(select(Transaction).where(Transaction.customer_id == cid, Transaction.merchant_id == m.id,
                                               Transaction.type == "PAYMENT")
                     .order_by(Transaction.created_at.desc())).scalars().all()
    out = []
    for t in txns:
        settled = t.status in SPENT
        out.append({"txn_ref": t.txn_ref, "amount_minor": t.amount_minor, "status": "RECORDED" if settled else t.status,
                    "display_status": "Recorded" if settled else CUSTOMER_STATUS[t.status],
                    "kg_offset": round(t.amount_minor / PRICE_PER_TONNE_MINOR * 1000, 2) if settled else 0.0,
                    "certificate_ref": ("OFS-" + t.txn_ref.split("-", 1)[1]) if settled else None,
                    "project": m.trading_name, "at": t.created_at.isoformat()})
    return out


def offsets(customer_id: uuid.UUID) -> dict:
    with session_scope() as s:
        return {"price_per_tonne_minor": PRICE_PER_TONNE_MINOR, "min_minor": OFFSET_MIN_MINOR,
                "max_minor": OFFSET_MAX_MINOR, "project": OFFSET_MERCHANT[1],
                "disclaimer": "Simulated project. A certificate is recorded only after Raast settles your payment. "
                              "No real carbon credit is retired.",
                "items": _offsets(s, customer_id)}


# ------------------------------------------------------------------ Mission Control (aggregates only)
def portfolio() -> dict:
    """What the bank sees: totals, never one customer's footprint."""
    with session_scope() as s:
        pots = s.execute(select(Account).where(Account.code == "2110", Account.owner_type == "CUSTOMER")).scalars().all()
        balances = [ledger.ledger_balance(s, a) for a in pots]
        house_2110 = sum(balances)
        m = s.execute(select(Merchant).where(Merchant.registration_ref == OFFSET_MERCHANT[0])).scalar_one_or_none()
        off_n, off_minor = (0, 0)
        if m is not None:
            off_n, off_minor = s.execute(select(func.count(), func.coalesce(func.sum(Transaction.amount_minor), 0))
                                         .where(Transaction.merchant_id == m.id, Transaction.type == "PAYMENT",
                                                Transaction.status.in_(SPENT))).one()
        since = now() - timedelta(days=30)
        rows = s.execute(select(Merchant.category, func.coalesce(func.sum(Transaction.amount_minor), 0))
                         .join(Merchant, Merchant.id == Transaction.merchant_id)
                         .where(Transaction.type == "PAYMENT", Transaction.status.in_(SPENT),
                                Transaction.created_at >= since).group_by(Merchant.category)).all()
        cats = sorted(({"category": c, "label": FACTORS.get(c, DEFAULT_FACTOR)["label"], "spent_minor": int(v),
                        "kg": round(_kg(int(v), c), 2)} for c, v in rows), key=lambda r: -r["kg"])
        moves = dict(s.execute(select(Transaction.type, func.count()).where(Transaction.type.in_([POT_IN, POT_OUT]))
                               .group_by(Transaction.type)).all())
        return {"factor_set": FACTOR_SET,
                "pots": {"count": sum(1 for b in balances if b > 0), "total_minor": house_2110,
                         "ledger_account": "2110", "moves_in": moves.get(POT_IN, 0), "moves_out": moves.get(POT_OUT, 0)},
                "offsets": {"payments": off_n, "total_minor": int(off_minor),
                            "tonnes": round(int(off_minor) / PRICE_PER_TONNE_MINOR, 3), "project": OFFSET_MERCHANT[1]},
                "footprint_30d": {"total_kg": round(sum(c["kg"] for c in cats), 2), "categories": cats}}
