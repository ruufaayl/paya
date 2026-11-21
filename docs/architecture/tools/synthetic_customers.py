"""Create synthetic, KYC-verified test customers directly in the Compose stack's database (tools only)."""
import os

PW = "paya-demo-2026"


def ensure(names: list[str], balance_minor: int = 50_000_00) -> list[str]:
    os.environ.setdefault("PAYA_DATABASE_URL", "postgresql+psycopg://paya:" + os.getenv("PAYA_DB_PASSWORD", "paya-local-only")
                          + "@localhost:5432/paya")
    from sqlalchemy import select

    from paya import ledger
    from paya.db import session_scope
    from paya.ledger import Line
    from paya.models import Customer, Transaction, User
    from paya.payments import new_ref
    from paya.security import hash_password

    with session_scope() as s:
        have = set(s.execute(select(User.username).where(User.username.in_(names))).scalars())
        pw = hash_password(PW)
        settle = ledger.house_account(s, "1010")
        for u in names:
            if u in have:
                continue
            c = Customer(full_name=f"Synthetic {u}", mobile_masked="+92 3xx xxx 0000", kyc_tier=2,
                         kyc_status="VERIFIED", risk_rating="LOW", idv_token=f"idv_synthetic_{u}")
            s.add(c)
            s.flush()
            s.add(User(username=u, password_hash=pw, display_name=c.full_name, role="CUSTOMER", customer_id=c.id))
            w = ledger.owned_account(s, "2100", "CUSTOMER", c.id)
            t = Transaction(txn_ref=new_ref("TOP"), type="TOPUP", status="COMPLETED", amount_minor=balance_minor,
                            customer_id=c.id, correlation_id="synthetic-seed")
            s.add(t)
            s.flush()
            ledger.post(s, txn_id=t.id, posting_type="TOPUP", reason_code="SYNTHETIC_TEST_BALANCE", actor="tools",
                        correlation_id="synthetic-seed", initiated_via="BATCH",
                        lines=[Line(settle.id, "D", balance_minor), Line(w.id, "C", balance_minor)])
    return names
