"""Theme 4: the super app. Partner services inside the wallet (bills, mobile top-up, a marketplace,
micro-insurance, lifestyle offers) on ONE money path.

Rules:
1. Prices, bills and discounts come from the server's catalogue, never from the client.
2. Checkout only creates a payment request to the partner's merchant record. The customer reviews and
   authorises it on the normal screen, so screening, ledger, Raast, recovery and reconciliation all apply.
3. An order has no money state of its own: "paid", "policy active", "bill paid" are read from the ledger-
   backed payment. The order cannot disagree with the ledger.
4. A partner gets customer data only for the scopes the customer consented to; what was shared is stored on
   the order as evidence. Consent is revocable.
5. Third-party risk: Compliance can suspend a partner (audited); its services disappear and checkout is
   refused, while payments already made are unaffected.
6. Investments are not offered: an EMI is not licensed for them.

Every partner, product and price here is synthetic.
"""
import hashlib
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from . import audit, events, payments
from .db import session_scope
from .errors import InvalidState, NotFound, ValidationFailed
from .models import (
    Customer, Merchant, Partner, PartnerConsent, PaymentRequest, ServiceOrder, Transaction, now,
)
from .state import CUSTOMER_STATUS

SERVICE_KIND = "SERVICE"
LIVE = ("CREATED", "VALIDATED", "AUTHORISED", "POSTED", "PENDING", "UNDER_REVIEW", "SETTLED", "RECONCILED")
PAID = ("SETTLED", "RECONCILED")

CATALOG: dict[str, dict] = {
    "INDUSPOWER": {"name": "Indus Power Co. (synthetic)", "kind": "BILLER", "category": "UTILITY", "scopes": [],
                   "tagline": "Electricity bill", "icon": "zap", "reg": "MRC-0910"},
    "RAVIGAS": {"name": "Ravi Gas (synthetic)", "kind": "BILLER", "category": "UTILITY", "scopes": [],
                "tagline": "Gas bill", "icon": "flame", "reg": "MRC-0911"},
    "RAABTA": {"name": "Raabta Mobile (synthetic)", "kind": "TOPUP", "category": "TELECOM", "scopes": ["mobile_masked"],
               "tagline": "Mobile top-up for your own number", "icon": "smartphone", "reg": "MRC-0920",
               "amounts": [100_00, 300_00, 500_00, 1_000_00]},
    "BAZAAR": {"name": "Bazaar Lane (synthetic marketplace)", "kind": "SHOP", "category": "ECOMMERCE", "scopes": ["name"],
               "tagline": "Everyday shopping", "icon": "shopping-bag", "reg": "MRC-0930",
               "offer": {"code": "FIRST10", "pct": 10, "max_minor": 500_00,
                         "text": "10% off your first Bazaar Lane order (up to Rs 500), funded by the merchant"},
               "items": {"TEA-900": ("Loose black tea, 900 g", 1_150_00), "RICE-5K": ("Basmati rice, 5 kg", 2_400_00),
                         "ATTA-10K": ("Chakki atta, 10 kg", 1_480_00), "SOAP-4": ("Bath soap, 4 bars", 520_00),
                         "BAG-JUTE": ("Reusable jute bag", 350_00)}},
    "HIFAZAT": {"name": "Hifazat Takaful (synthetic)", "kind": "INSURER", "category": "INSURANCE",
                "scopes": ["name", "mobile_masked"], "tagline": "Micro-takaful, monthly", "icon": "shield",
                "reg": "MRC-0940",
                "items": {"PHONE-M": ("Phone screen cover, 1 month", 149_00),
                          "HOSP-M": ("Hospital cash Rs 2,000/day, 1 month", 299_00)}},
}
NOT_OFFERED = [{"name": "Investments", "reason": "Paya is an e-money wallet and is not licensed to offer investment products."}]
MAX_QTY, MAX_LINES = 10, 10


# ------------------------------------------------------------------ partner registry
def ensure_partners(s: Session) -> dict[str, Partner]:
    s.execute(text("SELECT pg_advisory_xact_lock(hashtext('services:partners'))"))
    have = {p.code: p for p in s.execute(select(Partner)).scalars()}
    for code, c in CATALOG.items():
        if code in have:
            continue
        m = s.execute(select(Merchant).where(Merchant.registration_ref == c["reg"])).scalar_one_or_none()
        if m is None:
            m = Merchant(registration_ref=c["reg"], trading_name=c["name"], category=c["category"],
                         raast_alias=f"{code.lower()}@paya", settlement_iban_masked=f"PK** PAYA **** **** {c['reg'][-4:]}")
            s.add(m)
            s.flush()
        p = Partner(code=code, name=c["name"], kind=c["kind"], merchant_id=m.id, data_scopes=c["scopes"])
        s.add(p)
        s.flush()
        have[code] = p
    return have


def _active_consent(s: Session, cid: uuid.UUID, code: str) -> PartnerConsent | None:
    return s.execute(select(PartnerConsent).where(PartnerConsent.customer_id == cid, PartnerConsent.partner_code == code,
                                                  PartnerConsent.revoked_at.is_(None))
                     .order_by(PartnerConsent.granted_at.desc()).limit(1)).scalar_one_or_none()


def _first_order_offer_used(s: Session, cid: uuid.UUID, code: str) -> bool:
    """The first-order offer counts as used once an order with it has a live or completed payment."""
    rows = s.execute(select(ServiceOrder).where(ServiceOrder.customer_id == cid, ServiceOrder.partner_code == code,
                                                ServiceOrder.discount_minor > 0)).scalars().all()
    return any(_order_status(s, o)[0] in ("COMPLETED", "PROCESSING", "AWAITING_PAYMENT") for o in rows)


def hub(customer_id: uuid.UUID) -> dict:
    with session_scope() as s:
        partners = ensure_partners(s)
        out = []
        for code, c in CATALOG.items():
            p = partners[code]
            consent = _active_consent(s, customer_id, code) if c["scopes"] else None
            entry = {"code": code, "name": c["name"], "kind": c["kind"], "tagline": c["tagline"], "icon": c["icon"],
                     "available": p.status == "ACTIVE", "scopes": c["scopes"],
                     "consented": (not c["scopes"]) or consent is not None}
            if c.get("offer") and not _first_order_offer_used(s, customer_id, code):
                entry["offer"] = c["offer"]["text"]
            if c.get("items"):
                entry["items"] = [{"sku": k, "name": n, "price_minor": v} for k, (n, v) in c["items"].items()]
            if c.get("amounts"):
                entry["amounts"] = c["amounts"]
            out.append(entry)
        return {"services": out, "not_offered": NOT_OFFERED,
                "note": "Partner services are synthetic. You pay each one through the normal review screen."}


def _partner(s: Session, code: str) -> tuple[Partner, dict]:
    partners = ensure_partners(s)
    if code not in partners:
        raise NotFound("service not found")
    return partners[code], CATALOG[code]


# ------------------------------------------------------------------ bills (synthetic biller registry)
def _bill(code: str, consumer_no: str) -> dict:
    if not consumer_no.isdigit() or len(consumer_no) != 10:
        raise ValidationFailed("a consumer number has 10 digits")
    h = int(hashlib.sha256(f"{code}:{consumer_no}".encode()).hexdigest(), 16)
    period = f"{now():%Y-%m}"
    return {"consumer_no": consumer_no, "period": period, "amount_minor": (1_500 + h % 7_500) * 100,
            "due": f"{period}-20", "holder": f"Synthetic account …{consumer_no[-4:]}"}


def bill_lookup(customer_id: uuid.UUID, code: str, consumer_no: str) -> dict:
    with session_scope() as s:
        p, c = _partner(s, code)
        if c["kind"] != "BILLER":
            raise NotFound("not a biller")
        b = _bill(code, consumer_no)
        existing = _bill_order(s, code, consumer_no, b["period"])
        b["status"] = "UNPAID"
        if existing is not None:
            st = _order_status(s, existing)[0]
            if st == "COMPLETED":
                b["status"], b["paid_by_order"] = "PAID", existing.ref
            elif st in ("PROCESSING", "AWAITING_PAYMENT"):
                b["status"], b["paid_by_order"] = "IN_PROGRESS", existing.ref
        return b


def _bill_order(s: Session, code: str, consumer_no: str, period: str) -> ServiceOrder | None:
    """The live (or completed) order for this bill, whoever started it. One bill is paid once."""
    orders = s.execute(select(ServiceOrder).where(ServiceOrder.partner_code == code, ServiceOrder.reference == consumer_no,
                                                  ServiceOrder.period == period)
                       .order_by(ServiceOrder.created_at.desc())).scalars().all()
    for o in orders:
        if _order_status(s, o)[0] in ("COMPLETED", "PROCESSING", "AWAITING_PAYMENT"):
            return o
    return None


# ------------------------------------------------------------------ consent
def set_consent(customer_id: uuid.UUID, code: str, grant: bool, actor: str, correlation_id: str) -> dict:
    with session_scope() as s:
        p, c = _partner(s, code)
        if not c["scopes"]:
            raise ValidationFailed("this service receives no personal data")
        current = _active_consent(s, customer_id, code)
        if grant and current is None:
            current = PartnerConsent(customer_id=customer_id, partner_code=code, scopes=list(c["scopes"]))
            s.add(current)
            s.flush()
        elif not grant and current is not None:
            current.revoked_at = now()
        audit.record(s, actor=actor, actor_role="CUSTOMER", action="PARTNER_CONSENT_GRANTED" if grant else "PARTNER_CONSENT_REVOKED",
                     object_type="partner", object_id=code, correlation_id=correlation_id,
                     details={"scopes": c["scopes"]})
        return {"partner": code, "consented": grant, "scopes": c["scopes"]}


# ------------------------------------------------------------------ checkout
def checkout(customer_id: uuid.UUID, code: str, *, actor: str, correlation_id: str, consumer_no: str | None = None,
             items: list[dict] | None = None, amount_minor: int | None = None, use_offer: bool = False) -> dict:
    with session_scope() as s:
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"services:checkout:{customer_id}"})
        p, c = _partner(s, code)
        if p.status != "ACTIVE":
            raise InvalidState("this service is temporarily unavailable", partner_status=p.status)
        cust = s.get(Customer, customer_id)
        if cust is None:
            raise NotFound("customer not found")
        consent = None
        if c["scopes"]:
            consent = _active_consent(s, customer_id, code)
            if consent is None:
                raise InvalidState("consent needed before this partner can receive your details",
                                   scopes=c["scopes"], needs_consent=True)
        reference, period, discount = None, None, 0
        if c["kind"] == "BILLER":
            if consumer_no is None:
                raise ValidationFailed("consumer number required")
            # the same bill can't be started twice, even by two customers at once
            s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"services:bill:{code}:{consumer_no}"})
            b = _bill(code, consumer_no)
            prior = _bill_order(s, code, consumer_no, b["period"])
            if prior is not None:
                raise InvalidState("this bill is already paid or being paid", order_ref=prior.ref)
            reference, period = consumer_no, b["period"]
            lines = [{"sku": "BILL", "name": f"{c['tagline']} {b['period']} · {b['holder']}", "qty": 1,
                      "price_minor": b["amount_minor"]}]
        elif c["kind"] == "TOPUP":
            if amount_minor not in c["amounts"]:
                raise ValidationFailed("choose one of the listed top-up amounts")
            reference = cust.mobile_masked
            lines = [{"sku": "TOPUP", "name": f"Top-up for {cust.mobile_masked}", "qty": 1, "price_minor": amount_minor}]
        else:
            if not items or len(items) > MAX_LINES:
                raise ValidationFailed("choose between 1 and 10 items")
            lines, seen = [], set()
            for it in items:
                sku, qty = str(it.get("sku")), int(it.get("qty", 0))
                if sku not in c["items"] or sku in seen or not 1 <= qty <= MAX_QTY:
                    raise ValidationFailed("unknown item, duplicate line or quantity outside 1-10")
                if c["kind"] == "INSURER" and qty != 1:
                    raise ValidationFailed("one policy per product")
                seen.add(sku)
                name, price = c["items"][sku]
                lines.append({"sku": sku, "name": name, "qty": qty, "price_minor": price})
            if c["kind"] == "INSURER":
                reference = ",".join(sorted(seen))
        gross = sum(l["price_minor"] * l["qty"] for l in lines)
        if use_offer and c.get("offer"):
            if _first_order_offer_used(s, customer_id, code):
                raise ValidationFailed("the first-order offer has already been used")
            discount = min(c["offer"]["max_minor"], gross * c["offer"]["pct"] // 100)
        amount = gross - discount
        shared = {}
        if consent is not None:
            fields = {"name": cust.full_name, "mobile_masked": cust.mobile_masked}
            shared = {k: fields[k] for k in consent.scopes}
        ref = f"ORD-{now():%Y%m%d}-{secrets.token_hex(3).upper()}"
        pr = PaymentRequest(merchant_id=p.merchant_id, amount_minor=amount, order_ref=ref, kind=SERVICE_KIND,
                            created_by=actor, expires_at=now() + timedelta(minutes=10))
        s.add(pr)
        s.flush()
        o = ServiceOrder(ref=ref, customer_id=customer_id, partner_code=code, reference=reference, period=period,
                         lines=lines, discount_minor=discount, amount_minor=amount, payment_request_id=pr.id,
                         consent_id=consent.id if consent else None, shared=shared)
        s.add(o)
        s.flush()
        events.emit(s, "service.order_created", aggregate_id=o.id, correlation_id=correlation_id,
                    payload={"order_ref": ref, "partner": code, "amount_minor": amount})
        events.telemetry("merchant", "service_order_created",
                         detail={"order_ref": ref, "partner": c["name"], "amount_minor": amount})
        return {**_view(s, o), "payment_request_id": str(pr.id)}


# ------------------------------------------------------------------ order state, read from the payment
FULFILMENT = {"BILLER": "Bill paid to the biller", "TOPUP": "Top-up sent (simulated)", "SHOP": "Order confirmed to the shop",
              "INSURER": "Cover active for one month"}


def _order_status(s: Session, o: ServiceOrder) -> tuple[str, Transaction | None]:
    t = s.execute(select(Transaction).where(Transaction.payment_request_id == o.payment_request_id,
                                            Transaction.type == "PAYMENT")
                  .order_by(Transaction.created_at.desc()).limit(1)).scalar_one_or_none()
    if t is None:
        pr = s.get(PaymentRequest, o.payment_request_id)
        return ("AWAITING_PAYMENT" if pr.status == "OPEN" and pr.expires_at > now() else "EXPIRED"), None
    if t.status in PAID:
        return "COMPLETED", t
    if t.status in ("REJECTED", "FAILED", "REVERSED", "EXPIRED"):
        # a declined attempt leaves the request open for another try until it expires
        pr = s.get(PaymentRequest, o.payment_request_id)
        if pr.status == "OPEN" and pr.expires_at > now():
            return "AWAITING_PAYMENT", t
        return "NOT_PAID", t
    return "PROCESSING", t


def _view(s: Session, o: ServiceOrder) -> dict:
    st, t = _order_status(s, o)
    kind = CATALOG[o.partner_code]["kind"]
    return {"ref": o.ref, "partner": o.partner_code, "partner_name": CATALOG[o.partner_code]["name"], "kind": kind,
            "lines": o.lines, "discount_minor": o.discount_minor, "amount_minor": o.amount_minor,
            "status": st, "fulfilment": FULFILMENT[kind] if st == "COMPLETED" else None,
            "payment": None if t is None else {"txn_ref": t.txn_ref, "status": t.status,
                                                "display_status": CUSTOMER_STATUS[t.status]},
            "payment_request_id": str(o.payment_request_id), "reference": o.reference, "period": o.period,
            "shared_with_partner": sorted(o.shared), "created_at": o.created_at.isoformat()}


def my_orders(customer_id: uuid.UUID) -> list[dict]:
    with session_scope() as s:
        orders = s.execute(select(ServiceOrder).where(ServiceOrder.customer_id == customer_id)
                           .order_by(ServiceOrder.created_at.desc()).limit(30)).scalars().all()
        return [_view(s, o) for o in orders]


# ------------------------------------------------------------------ Mission Control
def partners_overview() -> list[dict]:
    with session_scope() as s:
        partners = ensure_partners(s)
        out = []
        for code, p in partners.items():
            orders = s.execute(select(ServiceOrder).where(ServiceOrder.partner_code == code)).scalars().all()
            states = [_order_status(s, o)[0] for o in orders]
            done = [o for o, st in zip(orders, states) if st == "COMPLETED"]
            consents = s.execute(select(func.count()).select_from(PartnerConsent).where(
                PartnerConsent.partner_code == code, PartnerConsent.revoked_at.is_(None))).scalar_one()
            out.append({"code": code, "name": p.name, "kind": p.kind, "status": p.status, "status_reason": p.status_reason,
                        "status_by": p.status_by, "scopes": p.data_scopes, "active_consents": consents,
                        "orders": len(orders), "completed": len(done),
                        "completed_minor": sum(o.amount_minor for o in done),
                        "in_progress": sum(1 for st in states if st in ("PROCESSING", "AWAITING_PAYMENT"))})
        return out


def set_partner_status(code: str, status: str, reason: str, actor: str, role: str, correlation_id: str) -> dict:
    if status not in ("ACTIVE", "SUSPENDED"):
        raise ValidationFailed("status must be ACTIVE or SUSPENDED")
    if len(reason.strip()) < 5:
        raise ValidationFailed("give a reason")
    with session_scope() as s:
        p, _ = _partner(s, code)
        before = p.status
        p.status, p.status_reason, p.status_by, p.updated_at = status, reason.strip()[:500], actor, now()
        audit.record(s, actor=actor, actor_role=role, action=f"PARTNER_{status}", object_type="partner", object_id=code,
                     reason=reason.strip()[:200], correlation_id=correlation_id, details={"from": before, "to": status})
        events.telemetry("security", "partner_status_changed", detail={"partner": code, "status": status, "by": actor},
                         level="warn" if status == "SUSPENDED" else "info")
        return {"code": code, "status": status}
