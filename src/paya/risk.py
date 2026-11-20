"""Rule-based KYC / AML / fraud decision service. Deterministic, versioned and fully evidenced.

AI never makes these decisions. Every result stores the rules fired and the data used.
"""
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Customer, Merchant, ScreeningResult, Transaction, now

# Synthetic watch-list (stand-in for UNSC / ATA lists). Names are fictional.
WATCHLIST = {"zarak khanzada", "falcon trading fze", "noor-ul-habib exports"}


def _normalise(name: str) -> str:
    return " ".join(name.lower().replace(".", " ").split())


def screen(s: Session, txn: Transaction, customer: Customer, merchant: Merchant) -> ScreeningResult:
    cfg = get_settings()
    fired: list[dict] = []
    outcome = "PASS"

    if customer.kyc_status != "VERIFIED" or customer.kyc_tier == 0:
        fired.append({"rule": "KYC_NOT_VERIFIED", "action": "REJECT"})
        outcome = "REJECT"

    limit = cfg.tier2_max_txn_minor if customer.kyc_tier >= 2 else cfg.tier1_max_txn_minor
    if txn.amount_minor > limit:
        fired.append({"rule": "TIER_LIMIT_EXCEEDED", "limit_minor": limit, "action": "REJECT"})
        outcome = "REJECT"

    window_start = now() - timedelta(seconds=cfg.velocity_window_seconds)
    recent = s.execute(
        select(func.count()).select_from(Transaction).where(
            Transaction.customer_id == customer.id, Transaction.type == "PAYMENT",
            Transaction.created_at >= window_start, Transaction.id != txn.id,
        )
    ).scalar_one()
    if recent >= cfg.velocity_max_payments and outcome != "REJECT":
        fired.append({"rule": "VELOCITY", "count": int(recent), "window_s": cfg.velocity_window_seconds, "action": "HOLD"})
        outcome = "HOLD"

    if (_normalise(customer.full_name) in WATCHLIST or _normalise(merchant.trading_name) in WATCHLIST) and outcome != "REJECT":
        fired.append({"rule": "WATCHLIST_MATCH", "action": "HOLD"})
        outcome = "HOLD"

    if customer.risk_rating == "HIGH" and txn.amount_minor >= 10_000_00 and outcome == "PASS":
        fired.append({"rule": "HIGH_RISK_CUSTOMER_LARGE_PAYMENT", "action": "HOLD"})
        outcome = "HOLD"

    res = ScreeningResult(
        txn_id=txn.id, outcome=outcome, rules_fired=fired, rule_version=cfg.rules_version,
        data_used={"kyc_status": customer.kyc_status, "kyc_tier": customer.kyc_tier,
                   "risk_rating": customer.risk_rating, "amount_minor": txn.amount_minor,
                   "recent_payments": int(recent), "merchant_category": merchant.category},
    )
    s.add(res)
    s.flush()
    return res
