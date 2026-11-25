"""Theme 5: the stablecoin sandbox. DISABLED unless PAYA_STABLECOIN_SANDBOX=true.

What it is: a design and a working prototype of how Rupay would integrate a tokenised-money rail
(wallets, compliance, merchant acceptance, finality, reconciliation) if an SBP-approved instrument
existed. What it is not: a payment method, an asset, or money. Pakistan's virtual-asset rules
(PVARA/SBP) do not permit stablecoin payments for us, so:

* the only asset is a worthless TEST token on a SIMULATED chain (chain.py);
* tokens come only from a faucet; there is NO conversion to or from rupees, and nothing here posts to the
  rupee ledger (a test reads this module's source);
* customers must be fully verified (tier 2) and acknowledge "no value, not a payment method";
* every transfer is screened (synthetic blocked-address list), limited per transfer and per day, and an
  external transfer at or above the travel-rule threshold must carry beneficiary details;
* "Confirmed" is shown only at the configured confirmation depth, because a reorg can undo less;
* Rupay's records are reconciled against the chain continuously (integrity checks).
"""
import hashlib
import re
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import func, select, text

from . import audit, chain, events, payments
from .config import get_settings
from .db import session_scope
from .errors import FeatureDisabled, InsufficientFunds, InvalidState, NotFound, ValidationFailed
from .models import Customer, Merchant, TokenTransfer, TokenWallet, now

ADDR_RX = re.compile(r"^0x[0-9a-f]{40}$")
# Synthetic screening list: addresses a (fictional) sanctions/fraud feed has flagged.
BLOCKED_ADDRESSES = {"0x" + "bad" + "0" * 34 + "001", "0x" + "dead" + "0" * 32 + "beef"}
ACCEPTING_MERCHANTS = ("MRC-0001", "MRC-0003")   # Chai Junction, Green Leaf Grocers (synthetic)
DISCLAIMER = ("Sandbox only. tPKR-TEST tokens have no value, can't be bought, sold or exchanged for rupees, "
              "and are not a payment method. The chain is simulated.")


def enabled() -> bool:
    return get_settings().stablecoin_sandbox


def require_enabled() -> None:
    if not enabled():
        raise FeatureDisabled("the stablecoin sandbox is switched off on this server")


def address_for(kind: str, ident: uuid.UUID) -> str:
    return "0x" + hashlib.sha256(f"paya-sandbox:{kind}:{ident}".encode()).hexdigest()[:40]


def _ref() -> str:
    return f"TOK-{now():%Y%m%d}-{secrets.token_hex(3).upper()}"


def _wallet(s, cid: uuid.UUID) -> TokenWallet:
    w = s.get(TokenWallet, cid)
    if w is None:
        raise InvalidState("join the sandbox first", needs_enrolment=True)
    return w


# ------------------------------------------------------------------ enrolment
def enrol(customer_id: uuid.UUID, acknowledged: bool, actor: str, correlation_id: str) -> dict:
    require_enabled()
    if not acknowledged:
        raise ValidationFailed("you must acknowledge that test tokens have no value")
    with session_scope() as s:
        c = s.get(Customer, customer_id)
        if c is None or c.kyc_status != "VERIFIED" or c.kyc_tier < 2:
            raise InvalidState("the sandbox is open to fully verified (tier 2) wallets only")
        w = s.get(TokenWallet, customer_id)
        if w is None:
            w = TokenWallet(customer_id=customer_id, address=address_for("customer", customer_id))
            s.add(w)
            audit.record(s, actor=actor, actor_role="CUSTOMER", action="SANDBOX_ENROLLED", object_type="token_wallet",
                         object_id=w.address, correlation_id=correlation_id, details={"acknowledged": DISCLAIMER})
        return {"address": w.address}


# ------------------------------------------------------------------ views
def _merchants(s) -> list[dict]:
    rows = s.execute(select(Merchant).where(Merchant.registration_ref.in_(ACCEPTING_MERCHANTS))).scalars().all()
    return [{"id": str(m.id), "name": m.trading_name, "address": address_for("merchant", m.id)} for m in rows]


def view(customer_id: uuid.UUID) -> dict:
    require_enabled()
    cfg = get_settings()
    with session_scope() as s:
        c = s.get(Customer, customer_id)
        w = s.get(TokenWallet, customer_id)
        base = {"enabled": True, "disclaimer": DISCLAIMER, "token": chain.TOKEN, "chain": chain.CHAIN_NAME,
                "confirmations_required": cfg.token_confirmations,
                "eligible": bool(c and c.kyc_status == "VERIFIED" and c.kyc_tier >= 2),
                "limits": {"per_transfer_units": cfg.token_max_txn_units, "daily_units": cfg.token_daily_max_units,
                           "travel_rule_units": cfg.token_travel_rule_units},
                "merchants": _merchants(s)}
        if w is None:
            return {**base, "enrolled": False}
        transfers = s.execute(select(TokenTransfer).where(TokenTransfer.customer_id == customer_id)
                              .order_by(TokenTransfer.created_at.desc()).limit(20)).scalars().all()
        pending_out = sum(t.amount_units for t in transfers if t.status == "PENDING" and t.from_addr == w.address)
        pending_in = sum(t.amount_units for t in transfers if t.status == "PENDING" and t.to_addr == w.address)
        address = w.address
        faucet_ok = _faucet_available(s, customer_id)
        items = [_tv(t, address) for t in transfers]
    confirmed = chain.balance(address, min_confirmations=cfg.token_confirmations)
    return {**base, "enrolled": True, "address": address, "confirmed_units": confirmed,
            "spendable_units": max(0, confirmed - pending_out), "pending_in_units": pending_in,
            "pending_out_units": pending_out, "faucet_available": faucet_ok, "transfers": items}


def _tv(t: TokenTransfer, own: str | None = None) -> dict:
    return {"ref": t.ref, "kind": t.kind, "direction": "IN" if own and t.to_addr == own else "OUT",
            "to": t.to_addr, "beneficiary": t.beneficiary_name, "amount_units": t.amount_units, "status": t.status,
            "confirmations": t.confirmations, "reason": t.reason, "chain_tx": t.chain_tx_hash,
            "at": t.created_at.isoformat()}


def _faucet_available(s, cid) -> bool:
    last = s.execute(select(func.max(TokenTransfer.created_at)).where(
        TokenTransfer.customer_id == cid, TokenTransfer.kind == "FAUCET",
        TokenTransfer.status.in_(["PENDING", "CONFIRMED"]))).scalar_one()
    return last is None or last < now() - timedelta(hours=24)


# ------------------------------------------------------------------ movements
def faucet(customer_id: uuid.UUID, actor: str, correlation_id: str) -> dict:
    require_enabled()
    cfg = get_settings()
    with session_scope() as s:
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"tokens:{customer_id}"})
        w = _wallet(s, customer_id)
        if not _faucet_available(s, customer_id):
            raise InvalidState("the faucet gives test tokens once every 24 hours")
        t = TokenTransfer(ref=_ref(), customer_id=customer_id, kind="FAUCET", from_addr=chain.FAUCET, to_addr=w.address,
                          amount_units=cfg.token_faucet_units, status="PENDING")
        try:
            t.chain_tx_hash = chain.submit(chain.FAUCET, w.address, t.amount_units, t.ref)
        except chain.ChainUnavailable:
            raise InvalidState("the sandbox chain is unavailable; nothing was sent")
        s.add(t)
        s.flush()
        events.telemetry("chain", "faucet", detail={"ref": t.ref, "amount_units": t.amount_units})
        return _tv(t, w.address)


def send(customer_id: uuid.UUID, *, amount_units: int, actor: str, correlation_id: str,
         merchant_id: uuid.UUID | None = None, to_address: str | None = None, beneficiary_name: str | None = None) -> dict:
    """Screen, limit and submit one transfer. Blocked or failed transfers are recorded too (evidence)."""
    require_enabled()
    cfg = get_settings()
    if (merchant_id is None) == (to_address is None):
        raise ValidationFailed("pay a merchant or an address, not both")
    if amount_units <= 0 or amount_units > cfg.token_max_txn_units:
        raise ValidationFailed(f"between 0.01 and {cfg.token_max_txn_units / 100:,.0f} test tokens per transfer")
    with session_scope() as s:
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"tokens:{customer_id}"})
        w = _wallet(s, customer_id)
        kind, dest = "ADDRESS", (to_address or "").lower()
        if merchant_id is not None:
            m = s.get(Merchant, merchant_id)
            if m is None or m.registration_ref not in ACCEPTING_MERCHANTS:
                raise NotFound("this merchant doesn't accept sandbox tokens")
            kind, dest, beneficiary_name = "MERCHANT", address_for("merchant", m.id), m.trading_name
        if not ADDR_RX.match(dest):
            raise ValidationFailed("not a valid address (0x followed by 40 hex characters)")
        if dest == w.address:
            raise ValidationFailed("that is your own address")
        internal = kind == "MERCHANT" or s.execute(select(TokenWallet).where(TokenWallet.address == dest)).scalar_one_or_none()
        if not internal and amount_units >= cfg.token_travel_rule_units and not (beneficiary_name or "").strip():
            raise ValidationFailed("beneficiary name required for this transfer (travel rule)", travel_rule=True)
        since = now() - timedelta(hours=24)
        today = int(s.execute(select(func.coalesce(func.sum(TokenTransfer.amount_units), 0)).where(
            TokenTransfer.customer_id == customer_id, TokenTransfer.from_addr == w.address,
            TokenTransfer.status.in_(["PENDING", "CONFIRMED"]), TokenTransfer.created_at >= since)).scalar_one())
        if today + amount_units > cfg.token_daily_max_units:
            raise ValidationFailed("daily sandbox limit reached", used_units=today)
        pending_out = int(s.execute(select(func.coalesce(func.sum(TokenTransfer.amount_units), 0)).where(
            TokenTransfer.from_addr == w.address, TokenTransfer.status == "PENDING")).scalar_one())
        spendable = chain.balance(w.address, min_confirmations=cfg.token_confirmations) - pending_out
        if amount_units > spendable:
            raise InsufficientFunds("not enough confirmed test tokens", spendable_units=max(0, spendable))
        t = TokenTransfer(ref=_ref(), customer_id=customer_id, kind=kind, from_addr=w.address, to_addr=dest,
                          merchant_id=merchant_id, beneficiary_name=(beneficiary_name or "").strip()[:128] or None,
                          amount_units=amount_units, status="PENDING")
        if dest in BLOCKED_ADDRESSES:
            t.status, t.reason = "BLOCKED", "destination on the screening list"
            s.add(t)
            s.flush()
            payments.open_case(s, kind="TOKEN_SCREENING", txn=None, owner_role="COMPLIANCE",
                               summary=f"Sandbox transfer {t.ref} to a screened address was blocked",
                               details={"ref": t.ref, "to": dest, "amount_units": amount_units, "sandbox": True},
                               sla_minutes=240)
            audit.record(s, actor=actor, actor_role="CUSTOMER", action="TOKEN_TRANSFER_BLOCKED", object_type="token_transfer",
                         object_id=t.ref, outcome="DENIED", reason="screening hit", correlation_id=correlation_id)
            return _tv(t, w.address)
        try:
            t.chain_tx_hash = chain.submit(w.address, dest, amount_units, t.ref)
        except chain.ChainUnavailable:
            t.status, t.reason = "FAILED", "sandbox chain unavailable; nothing was sent"
        except chain.ChainRejected as exc:
            t.status, t.reason = "FAILED", f"rejected by the chain: {exc}"[:128]
        s.add(t)
        s.flush()
        audit.record(s, actor=actor, actor_role="CUSTOMER", action="TOKEN_TRANSFER", object_type="token_transfer",
                     object_id=t.ref, outcome="ALLOWED" if t.status == "PENDING" else "DENIED", reason=t.reason,
                     correlation_id=correlation_id, details={"kind": kind, "amount_units": amount_units})
        events.telemetry("chain", "transfer_submitted" if t.status == "PENDING" else "transfer_failed",
                         detail={"ref": t.ref, "kind": kind, "amount_units": amount_units},
                         level="info" if t.status == "PENDING" else "warn")
        return _tv(t, w.address)


# ------------------------------------------------------------------ finality tracking (worker)
def refresh() -> dict:
    """Move PENDING transfers to CONFIRMED only at the required depth. A reorg sends confirmations back to 0."""
    if not enabled():
        return {"confirmed": 0}
    need = get_settings().token_confirmations
    confirmed = 0
    with session_scope() as s:
        rows = s.execute(select(TokenTransfer).where(TokenTransfer.status == "PENDING").with_for_update(skip_locked=True)).scalars().all()
        for t in rows:
            st = chain.tx_status(t.chain_tx_hash)
            t.confirmations, t.updated_at = st["confirmations"], now()
            if st["status"] == "INCLUDED" and st["confirmations"] >= need:
                t.status = "CONFIRMED"
                confirmed += 1
                events.telemetry("chain", "transfer_confirmed", detail={"ref": t.ref, "confirmations": st["confirmations"]})
    return {"confirmed": confirmed}


def tick() -> dict:
    """Worker step: produce a block on the block interval, then track finality."""
    if not enabled():
        return {}
    last = chain.last_mined_at()
    out = {}
    if last is None or (now() - last).total_seconds() >= get_settings().token_block_seconds:
        out["mined"] = chain.mine()
    out.update(refresh())
    return out


# ------------------------------------------------------------------ reconciliation and Mission Control
def reconcile() -> dict:
    """Rupay's records against the chain (on-chain/off-chain reconciliation)."""
    need = get_settings().token_confirmations
    breaks = []
    with session_scope() as s:
        rows = s.execute(select(TokenTransfer).where(TokenTransfer.status == "CONFIRMED")).scalars().all()
    for t in rows:
        st = chain.tx_status(t.chain_tx_hash)
        if st["status"] != "INCLUDED" or st["confirmations"] < need or st["amount_units"] != t.amount_units \
                or st["from"] != t.from_addr or st["to"] != t.to_addr:
            breaks.append({"ref": t.ref, "chain": st})
    return {"confirmed_checked": len(rows), "breaks": breaks}


def overview() -> dict:
    cfg = get_settings()
    base = {"enabled": enabled(), "flag": "PAYA_STABLECOIN_SANDBOX", "disclaimer": DISCLAIMER,
            "confirmations_required": cfg.token_confirmations}
    if not enabled():
        return base
    with session_scope() as s:
        rows = s.execute(select(TokenTransfer).order_by(TokenTransfer.created_at.desc()).limit(25)).scalars().all()
        wallets = s.execute(select(func.count()).select_from(TokenWallet)).scalar_one()
        by_status = dict(s.execute(select(TokenTransfer.status, func.count()).group_by(TokenTransfer.status)).all())
        items = [_tv(t) for t in rows]
    return {**base, "chain": chain.overview(), "wallets": wallets, "by_status": by_status, "transfers": items,
            "reconciliation": reconcile()}
