"""Synthetic seed data. Every person, business, alias and IBAN here is fictional.

No real CNIC, account, card, biometric or credential data is ever stored in Paya.
"""
from sqlalchemy import select, text, update

from . import ledger
from .db import session_scope
from .ledger import Line
from .models import Consent, Customer, Merchant, Transaction, User
from .payments import new_ref
from .security import hash_password

DEMO_PASSWORD = "paya-demo-2026"

CUSTOMERS = [
    # name, mobile (masked), tier, kyc, risk, opening balance (PKR)
    ("Sara Ahmed", "+92 3xx xxx 4512", 2, "VERIFIED", "LOW", 150_000),
    ("Omar Farooq", "+92 3xx xxx 0091", 1, "VERIFIED", "LOW", 20_000),
    ("Zarak Khanzada", "+92 3xx xxx 7720", 2, "VERIFIED", "MEDIUM", 80_000),  # synthetic watch-list hit
    ("Hina Baig", "+92 3xx xxx 3388", 0, "PENDING", "LOW", 5_000),            # not yet verified
]
MERCHANTS = [
    ("MRC-0001", "Chai Junction", "FOOD_BEVERAGE", "chaijunction@paya", "PK** PAYA **** **** 0001"),
    ("MRC-0002", "Shifa Pharmacy", "PHARMACY", "shifapharmacy@paya", "PK** PAYA **** **** 0002"),
    ("MRC-0003", "Green Leaf Grocers", "GROCERY", "greenleaf@paya", "PK** PAYA **** **** 0003"),
]
STAFF = [
    ("ayesha.cashier", "Ayesha (Cashier, Chai Junction)", "CASHIER", None, "MRC-0001"),
    ("bilal.admin", "Bilal (Merchant admin, Chai Junction)", "MERCHANT_ADMIN", None, "MRC-0001"),
    ("kamran.cashier", "Kamran (Cashier, Shifa Pharmacy)", "CASHIER", None, "MRC-0002"),
    ("mudaser.ops", "Mudaser Waleed (Operations)", "OPS", None, None),
    ("faisal.ops", "Faisal (Operations)", "OPS", None, None),
    ("kanz.compliance", "Kanz ur Rehman (Compliance)", "COMPLIANCE", None, None),
    ("harris.compliance", "Harris Safi (Compliance, second officer)", "COMPLIANCE", None, None),
    ("rufayl.finance", "Rufayl Waseem (Finance & reconciliation)", "FINANCE", None, None),
    ("admin", "System administrator", "SYSADMIN", None, None),
    ("taha.audit", "Taha Ali (Internal audit, read-only)", "AUDITOR", None, None),
]
CUSTOMER_LOGINS = {"Sara Ahmed": "sara", "Omar Farooq": "omar", "Zarak Khanzada": "zarak", "Hina Baig": "hina"}


def seed() -> dict:
    with session_scope() as s:
        if s.execute(select(User).limit(1)).scalar_one_or_none():
            return {"seeded": False, "reason": "already seeded"}
        pw = hash_password(DEMO_PASSWORD)
        merchants = {}
        for reg, name, cat, alias, iban in MERCHANTS:
            m = Merchant(registration_ref=reg, trading_name=name, category=cat, raast_alias=alias,
                         settlement_iban_masked=iban)
            s.add(m)
            s.flush()
            merchants[reg] = m
        settlement = ledger.house_account(s, "1010")
        equity = ledger.house_account(s, "3000")
        for code in ("1300", "1400", "2150", "2190", "4100"):
            ledger.house_account(s, code)
        for name, mobile, tier, kyc, risk, opening in CUSTOMERS:
            c = Customer(full_name=name, mobile_masked=mobile, kyc_tier=tier, kyc_status=kyc, risk_rating=risk,
                         idv_token=f"idv_synthetic_{CUSTOMER_LOGINS[name]}")
            s.add(c)
            s.flush()
            s.add(Consent(customer_id=c.id, purpose="SERVICE", channel="PUSH"))
            s.add(User(username=CUSTOMER_LOGINS[name], password_hash=pw, display_name=name, role="CUSTOMER",
                       customer_id=c.id))
            wallet = ledger.owned_account(s, "2100", "CUSTOMER", c.id)
            if opening:
                top = Transaction(txn_ref=new_ref("TOP"), type="TOPUP", status="COMPLETED", amount_minor=opening * 100,
                                  customer_id=c.id, correlation_id="seed")
                s.add(top)
                s.flush()
                # Synthetic funding: the sponsor-bank settlement account receives the money, the wallet owes it.
                ledger.post(s, txn_id=top.id, posting_type="TOPUP", reason_code="SYNTHETIC_OPENING_BALANCE",
                            actor="seed", correlation_id="seed", initiated_via="BATCH",
                            lines=[Line(settlement.id, "D", opening * 100), Line(wallet.id, "C", opening * 100)])
        # Seed equity so the settlement account can absorb fees/claims in demos (synthetic).
        seed_txn = Transaction(txn_ref=new_ref("TOP"), type="TOPUP", status="COMPLETED", amount_minor=1_000_000_00,
                               correlation_id="seed")
        s.add(seed_txn)
        s.flush()
        ledger.post(s, txn_id=seed_txn.id, posting_type="TOPUP", reason_code="SYNTHETIC_CAPITAL", actor="seed",
                    correlation_id="seed", initiated_via="BATCH",
                    lines=[Line(settlement.id, "D", 1_000_000_00), Line(equity.id, "C", 1_000_000_00)])
        for username, display, role, _, mreg in STAFF:
            s.add(User(username=username, password_hash=pw, display_name=display, role=role,
                       merchant_id=merchants[mreg].id if mreg else None))
        return {"seeded": True, "customers": len(CUSTOMERS), "merchants": len(MERCHANTS), "staff": len(STAFF)}


# More synthetic tills for live demos (QR wall). Added idempotently at startup in demo mode, so an already-seeded
# database gains them too. Fictional businesses; aliases and IBANs are synthetic.
EXTRA_MERCHANTS = [
    ("MRC-0004", "Lahore Tikka House", "FOOD_BEVERAGE", "tikkahouse@paya", "PK** PAYA **** **** 0004"),
    ("MRC-0005", "Clifton Fuel Stop", "FUEL", "cliftonfuel@paya", "PK** PAYA **** **** 0005"),
    ("MRC-0006", "Saddar Book Corner", "RETAIL", "saddarbooks@paya", "PK** PAYA **** **** 0006"),
]
EXTRA_CASHIERS = [
    ("noor.cashier", "Noor (Cashier, Green Leaf Grocers)", "MRC-0003"),
    ("danish.cashier", "Danish (Cashier, Lahore Tikka House)", "MRC-0004"),
    ("sadia.cashier", "Sadia (Cashier, Clifton Fuel Stop)", "MRC-0005"),
    ("imran.cashier", "Imran (Cashier, Saddar Book Corner)", "MRC-0006"),
]


# Staff accounts renamed after the team (Fall 2026). Databases seeded earlier are renamed in place, idempotently.
STAFF_RENAMES = {"sana.ops": "mudaser.ops", "hamza.compliance": "kanz.compliance", "nadia.compliance": "harris.compliance",
                 "rabia.finance": "rufayl.finance", "auditor": "taha.audit"}


def ensure_demo_extras() -> dict:
    added = 0
    with session_scope() as s:
        if not s.execute(select(User).limit(1)).scalar_one_or_none():
            return {"added": 0}
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext('seed:extras'))"))
        merchants = {m.registration_ref: m for m in s.execute(select(Merchant)).scalars()}
        for reg, name, cat, alias, iban in EXTRA_MERCHANTS:
            if reg not in merchants:
                m = Merchant(registration_ref=reg, trading_name=name, category=cat, raast_alias=alias,
                             settlement_iban_masked=iban)
                s.add(m)
                s.flush()
                merchants[reg] = m
                added += 1
        have = set(s.execute(select(User.username)).scalars())
        display = {u: d for u, d, *_ in STAFF}
        for old, new in STAFF_RENAMES.items():
            if old in have and new not in have:
                s.execute(update(User).where(User.username == old).values(username=new, display_name=display[new]))
                have.discard(old); have.add(new)
                added += 1
        pw = None
        for username, display, reg in EXTRA_CASHIERS:
            if username not in have:
                pw = pw or hash_password(DEMO_PASSWORD)
                s.add(User(username=username, password_hash=pw, display_name=display, role="CASHIER",
                           merchant_id=merchants[reg].id))
                added += 1
    return {"added": added}


if __name__ == "__main__":
    from .db import create_schema

    create_schema()
    print(seed())
