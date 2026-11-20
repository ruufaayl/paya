"""Double-entry ledger: the only authoritative source of internal financial truth.

Rules (also enforced in PostgreSQL, see db.INTEGRITY_DDL):
* every journal balances; entries are positive integers in paisa;
* ledger rows are append-only - corrections are new journals;
* a (transaction, posting type) pair can be posted at most once.
"""
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Account, Hold, Journal, LedgerEntry, now

# Chart of accounts (house accounts have no owner).
COA = {
    "1010": ("Settlement account at sponsor bank", "ASSET"),
    "1300": ("Merchant fee receivable", "ASSET"),
    "1400": ("Claim receivable - rail/partner", "ASSET"),
    "2100": ("Customer wallet balances", "LIABILITY"),
    "2110": ("Customer green pots", "LIABILITY"),
    "2150": ("Payments in transit", "LIABILITY"),
    "2190": ("Suspense - unmatched rail items", "LIABILITY"),
    "3000": ("Funding equity (synthetic seed)", "EQUITY"),
    "4100": ("Merchant discount fee income", "INCOME"),
}
DEBIT_NORMAL = {"ASSET", "EXPENSE"}


class LedgerError(Exception):
    pass


@dataclass(frozen=True)
class Line:
    account_id: uuid.UUID
    direction: str  # 'D' or 'C'
    amount_minor: int


def house_account(s: Session, code: str) -> Account:
    acc = s.execute(
        select(Account).where(Account.code == code, Account.owner_type.is_(None))
    ).scalar_one_or_none()
    if acc is None:
        name, typ = COA[code]
        acc = Account(code=code, name=name, type=typ)
        s.add(acc)
        s.flush()
    return acc


def owned_account(s: Session, code: str, owner_type: str, owner_id: uuid.UUID) -> Account:
    acc = s.execute(
        select(Account).where(Account.code == code, Account.owner_type == owner_type, Account.owner_id == owner_id)
    ).scalar_one_or_none()
    if acc is None:
        name, typ = COA[code]
        acc = Account(code=code, name=name, type=typ, owner_type=owner_type, owner_id=owner_id)
        s.add(acc)
        s.flush()
    return acc


def lock_account(s: Session, account_id: uuid.UUID) -> Account:
    """Row lock serialises concurrent spends from the same wallet (prevents over-spending races)."""
    return s.execute(select(Account).where(Account.id == account_id).with_for_update()).scalar_one()


def ledger_balance(s: Session, account: Account) -> int:
    debit = func.coalesce(func.sum(case((LedgerEntry.direction == "D", LedgerEntry.amount_minor), else_=0)), 0)
    credit = func.coalesce(func.sum(case((LedgerEntry.direction == "C", LedgerEntry.amount_minor), else_=0)), 0)
    d, c = s.execute(select(debit, credit).where(LedgerEntry.account_id == account.id)).one()
    return int(d - c) if account.type in DEBIT_NORMAL else int(c - d)


def active_holds(s: Session, account: Account) -> int:
    total = s.execute(
        select(func.coalesce(func.sum(Hold.amount_minor), 0)).where(
            Hold.account_id == account.id, Hold.status == "ACTIVE", Hold.expires_at > now()
        )
    ).scalar_one()
    return int(total)


def available_balance(s: Session, account: Account) -> int:
    return ledger_balance(s, account) - active_holds(s, account)


def post(
    s: Session, *, txn_id: uuid.UUID, posting_type: str, lines: list[Line], reason_code: str,
    actor: str, correlation_id: str, initiated_via: str = "API", approved_by: str | None = None,
    value_date: date | None = None,
) -> Journal:
    if len(lines) < 2:
        raise LedgerError("a journal needs at least two lines")
    if any(l.amount_minor <= 0 or l.direction not in ("D", "C") for l in lines):
        raise LedgerError("lines must be positive and D/C")
    debits = sum(l.amount_minor for l in lines if l.direction == "D")
    credits = sum(l.amount_minor for l in lines if l.direction == "C")
    if debits != credits:
        raise LedgerError(f"unbalanced journal: debits={debits} credits={credits}")
    today = now().date()
    j = Journal(
        txn_id=txn_id, posting_type=posting_type, booking_date=today, value_date=value_date or today,
        reason_code=reason_code, initiated_via=initiated_via, actor=actor, approved_by=approved_by,
        rule_version=get_settings().rules_version, correlation_id=correlation_id,
    )
    s.add(j)
    s.flush()  # UNIQUE(txn_id, posting_type) fires here on a repeated posting
    for l in lines:
        s.add(LedgerEntry(journal_id=j.id, account_id=l.account_id, direction=l.direction, amount_minor=l.amount_minor))
    s.flush()
    return j


def trial_balance(s: Session) -> dict:
    debit = func.coalesce(func.sum(case((LedgerEntry.direction == "D", LedgerEntry.amount_minor), else_=0)), 0)
    credit = func.coalesce(func.sum(case((LedgerEntry.direction == "C", LedgerEntry.amount_minor), else_=0)), 0)
    rows = s.execute(
        select(Account.code, Account.name, Account.type, debit, credit)
        .join(LedgerEntry, LedgerEntry.account_id == Account.id)
        .group_by(Account.code, Account.name, Account.type)
        .order_by(Account.code)
    ).all()
    out, td, tc = [], 0, 0
    for code, name, typ, d, c in rows:
        td, tc = td + d, tc + c
        bal = d - c if typ in DEBIT_NORMAL else c - d
        out.append({"code": code, "name": name, "type": typ, "debit_minor": int(d), "credit_minor": int(c),
                    "balance_minor": int(bal)})
    return {"accounts": out, "total_debit_minor": int(td), "total_credit_minor": int(tc), "balanced": td == tc}
