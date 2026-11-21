"""Paya Assistant: conversational banking (Theme 3), bounded by design.

What it is: a customer-facing assistant that answers questions about the customer's OWN wallet from the ledger
(balance, recent payments, a payment's status and why, limits, verification), in English and Roman Urdu, and
hands off to a person by opening a case.

What it cannot do, by construction:
  * move money: no payment, ledger-posting, state-transition or reversal function is imported here
    (source-checked by tests/test_assistant.py). For actions it returns a link into the normal, confirmed flows;
  * see anyone else's data: every tool takes the authenticated customer id and filters on it;
  * keep secrets: card numbers, CNIC-like numbers, IBANs, OTPs, PINs and passwords are redacted BEFORE the
    text is classified or stored; only the kinds removed are kept, never the values;
  * be talked out of its rules: there is no model to prompt. Intents are deterministic (versioned rules), and
    merchant names / references from the database are treated as data, never as instructions.

An LLM could later be used only to phrase replies from these same tool results, behind the AI guardrails (ADR-008).
"""
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, events
from .db import session_scope
from .errors import NotFound, ValidationFailed
from .ledger import available_balance, ledger_balance
from .models import Account, Case, ChatMessage, Conversation, Customer, Merchant, Transaction, now
from .state import CUSTOMER_STATUS

RULES_VERSION = "assistant.v1"
RETENTION_DAYS = 30
MAX_TEXT = 500
_rate: dict[str, deque] = defaultdict(deque)  # per-customer message timestamps (in-process)

# ------------------------------------------------------------------ redaction (DLP) - runs before anything else
REDACTORS: list[tuple[str, re.Pattern, str]] = [
    # secrets: "password is X" / "pin: 1234" / "otp 482913" (a value with a digit, or after an explicit separator)
    ("PASSWORD", re.compile(r"\b(password|passcode|pin|mpin|otp|code)\b(\s*(?:is|:|=|hai)\s*)(\S+)", re.I), r"\1\2[redacted]"),
    ("PASSWORD", re.compile(r"\b(pin|mpin|otp|code)\b(\s+)(\S*\d\S*)", re.I), r"\1\2[redacted]"),
    ("CNIC", re.compile(r"\b\d{5}[- ]?\d{7}[- ]?\d\b"), "[redacted CNIC]"),
    ("IBAN", re.compile(r"\bPK\d{2}[A-Z]{4}\d{16}\b", re.I), "[redacted IBAN]"),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[redacted card]"),
    ("MOBILE", re.compile(r"(?:\+92|0)3\d{2}[- ]?\d{7}\b"), "[redacted mobile]"),
]


def _luhn(digits: str) -> bool:
    d = [int(c) for c in digits][::-1]
    return sum(x if i % 2 == 0 else (x * 2 - 9 if x * 2 > 9 else x * 2) for i, x in enumerate(d)) % 10 == 0


def redact(text: str) -> tuple[str, list[str]]:
    kinds: list[str] = []
    out = text
    for kind, rx, repl in REDACTORS:
        if kind == "CARD":
            def card(m: re.Match) -> str:
                digits = re.sub(r"\D", "", m.group(0))
                if 13 <= len(digits) <= 19 and _luhn(digits):
                    kinds.append("CARD")
                    return repl
                return m.group(0)
            out = rx.sub(card, out)
        else:
            new = rx.sub(repl, out)
            if new != out:
                kinds.append(kind)
            out = new
    return out, sorted(set(kinds))


# ------------------------------------------------------------------ intents (deterministic, EN + Roman Urdu)
REF_RX = re.compile(r"\b(PAYA|TOP|REV)-\d{8}-[0-9A-F]{6}\b", re.I)
INTENTS: list[tuple[str, list[str]]] = [
    ("HUMAN", [r"\b(human|agent|person|representative|complain|complaint|shikayat|insaan|banda|call me)\b", r"talk to (a|some)"]),
    ("SECURITY", [r"\b(otp|pin|password|scam|fraud|hack(ed)?|stolen|chori|dhoka|suspicious|someone asked)\b"]),
    ("OUT_OF_SCOPE", [r"\b(invest|investment|stock|shares|crypto|bitcoin|loan|qarz|interest rate|forex|lottery)\b"]),
    ("PAY", [r"\b(pay|send|transfer|bhej|bhejna|bhejo|payment karo|kar do)\b"]),
    ("REFUND", [r"\b(refund|reverse|reversal|wapas|return my|money back|paise wapas|cancel)\b"]),
    ("WHY_DECLINED", [r"\b(declin\w*|reject\w*|fail\w*|why|kyun|kyon|nahi hua|ruk gaya|blocked)\b"]),
    ("TXN_STATUS", [r"\b(status|go through|went through|did my|reached|pohanch|pohnch|kahan|where is|confirm\w*|paid\?)\b"]),
    ("BALANCE", [r"\b(balance|how much (money|do i)|kitna|kitne|paisay|paise|bakaya|available)\b"]),
    ("RECENT", [r"\b(recent|history|last (payment|transaction)s?|transactions|statement|activity|pichl\w*)\b"]),
    ("LIMITS", [r"\b(limit|maximum|max|kitna bhej sakta|tier)\b"]),
    ("KYC", [r"\b(kyc|verif\w*|upgrade|tasdeeq|identity|cnic)\b"]),
    ("GREETING", [r"^\s*(hi|hello|hey|salam|aoa|assalam\w*|asalam\w*|good (morning|evening))\b"]),
    ("THANKS", [r"\b(thanks|thank you|shukriya|jazak)\b"]),
]


_BY_NAME = dict(INTENTS)


def classify(text: str) -> str:
    t = text.lower()
    if REF_RX.search(text):  # a quoted reference is always about that payment
        return "WHY_DECLINED" if any(re.search(p, t) for p in _BY_NAME["WHY_DECLINED"]) else "TXN_STATUS"
    for intent, pats in INTENTS:
        if any(re.search(p, t) for p in pats):
            return intent
    return "UNKNOWN"


# ------------------------------------------------------------------ read-only tools (scoped to one customer)
def _wallet(s: Session, customer_id: uuid.UUID):
    return s.execute(select(Account).where(Account.code == "2100", Account.owner_type == "CUSTOMER",
                                           Account.owner_id == customer_id)).scalar_one_or_none()


def tool_balance(s: Session, cid: uuid.UUID) -> dict:
    acc = _wallet(s, cid)
    led = ledger_balance(s, acc) if acc else 0
    av = available_balance(s, acc) if acc else 0
    return {"available_minor": av, "ledger_minor": led, "reserved_minor": led - av}


def _txn_card(t: Transaction, merchants: dict) -> dict:
    return {"type": "txn", "txn_ref": t.txn_ref, "merchant": merchants.get(t.merchant_id), "kind": t.type,
            "amount_minor": t.amount_minor, "status": t.status, "display_status": CUSTOMER_STATUS[t.status],
            "created_at": t.created_at.isoformat()}


def tool_recent(s: Session, cid: uuid.UUID, n: int = 5) -> list[Transaction]:
    return s.execute(select(Transaction).where(Transaction.customer_id == cid).order_by(Transaction.created_at.desc())
                     .limit(n)).scalars().all()


def tool_find_payment(s: Session, cid: uuid.UUID, text: str, merchants: dict) -> Transaction | None:
    """By reference if one is quoted, else by a merchant the customer named, else the latest payment."""
    m = REF_RX.search(text)
    q = select(Transaction).where(Transaction.customer_id == cid, Transaction.type == "PAYMENT")
    if m:
        return s.execute(q.where(Transaction.txn_ref == m.group(0).upper())).scalar_one_or_none()
    t = text.lower()
    named = [mid for mid, name in merchants.items() if name and any(w in t for w in name.lower().split() if len(w) > 3)]
    if named:
        q = q.where(Transaction.merchant_id.in_(named))
    return s.execute(q.order_by(Transaction.created_at.desc()).limit(1)).scalar_one_or_none()


EXPLAIN = {
    "CREATED": "We received it and are checking it.", "VALIDATED": "It passed checks and is being processed.",
    "AUTHORISED": "The money is reserved in your wallet while we send it.", "POSTED": "It is recorded in the ledger and about to go to Raast.",
    "PENDING": "It was sent over Raast and we are waiting for confirmation. It is NOT paid yet, and we never treat a slow answer as a failure. "
               "Our recovery agent asks Raast automatically; if there is still no answer after 15 minutes, a person reviews it.",
    "SETTLED": "Raast confirmed it. The shop has been paid.", "RECONCILED": "Raast confirmed it and it matched the Raast settlement file.",
    "UNDER_REVIEW": "A person is checking it. Your money is reserved, not sent, until they decide.",
    "REVERSED": "It did not complete, so the full amount was returned to your wallet with a correcting ledger entry.",
    "REJECTED": "It was declined before any money left your wallet.", "FAILED": "It failed and no money left your wallet.",
    "EXPIRED": "The payment request expired before it was paid.",
}
REASONS = {"KYC_NOT_VERIFIED": "your wallet isn't verified yet", "TIER_LIMIT_EXCEEDED": "it was above your wallet's per-payment limit",
           "INSUFFICIENT_FUNDS": "there wasn't enough available balance", "RAIL_REJECTED": "the Raast network rejected it",
           "COMPLIANCE_REJECTED": "it did not pass a compliance review"}


def _reason(code: str | None) -> str:
    if not code:
        return ""
    for k, v in REASONS.items():
        if k in code.upper():
            return v
    return "of a check on the payment"  # never reveal screening specifics (no tipping off)


def pkr(minor: int) -> str:
    return f"Rs {minor / 100:,.0f}" if minor % 100 == 0 else f"Rs {minor / 100:,.2f}"


# ------------------------------------------------------------------ conversation
def _limit(customer_id: str) -> None:
    q = _rate[customer_id]
    t = time.monotonic()
    while q and t - q[0] > 60:
        q.popleft()
    if len(q) >= 20:
        raise ValidationFailed("too many messages; please wait a minute")
    q.append(t)


def respond(customer_id: str, text: str, conversation_ref: str | None = None) -> dict:
    if not text or not text.strip():
        raise ValidationFailed("say something")
    if len(text) > MAX_TEXT:
        raise ValidationFailed(f"messages are limited to {MAX_TEXT} characters")
    _limit(customer_id)
    clean, kinds = redact(text.strip())  # redact FIRST: nothing below ever sees the raw secret
    intent = classify(clean)
    cid = uuid.UUID(customer_id)
    with session_scope() as s:
        cust = s.get(Customer, cid)
        if cust is None:
            raise NotFound("customer not found")
        conv = None
        if conversation_ref:
            conv = s.execute(select(Conversation).where(Conversation.ref == conversation_ref,
                                                        Conversation.customer_id == cid)).scalar_one_or_none()
        if conv is None:
            conv = Conversation(ref=f"CHAT-{now():%Y%m%d}-{secrets.token_hex(3).upper()}", customer_id=cid)
            s.add(conv)
            s.flush()
        merchants = {m.id: m.trading_name for m in s.execute(select(Merchant)).scalars()}
        reply, cards, suggestions, tools, handoff = _answer(s, cust, conv, intent, clean, merchants)
        if kinds:
            reply = ("I removed sensitive details from your message and did not store them. Paya will never ask for your "
                     "PIN, OTP, password or full card number. ") + reply
        s.add(ChatMessage(conversation_id=conv.id, role="USER", text=clean, intent=intent, redactions=kinds))
        s.add(ChatMessage(conversation_id=conv.id, role="ASSISTANT", text=reply, intent=intent, tools=tools))
        conv.message_count += 2
        conv.last_at = now()
        ref = conv.ref
    events.telemetry("assistant", "replied", detail={"intent": intent, "tools": tools, "redacted": kinds,
                                                     "handoff": bool(handoff)}, level="warn" if handoff or kinds else "info")
    return {"conversation_ref": ref, "intent": intent, "reply": reply, "cards": cards, "suggestions": suggestions,
            "handoff": handoff, "redacted": kinds, "rules_version": RULES_VERSION,
            "disclosure": "Paya Assistant answers from your wallet's ledger. It cannot move money."}


def _answer(s: Session, cust: Customer, conv: Conversation, intent: str, text: str, merchants: dict):
    cid = cust.id
    first = cust.full_name.split()[0]
    cards: list[dict] = []
    tools: list[str] = []
    handoff = None
    sugg = ["What's my balance?", "Did my last payment go through?", "Show my recent payments", "Talk to a person"]

    if intent == "GREETING":
        return (f"Hi {first}! I can check your balance, your payments and their status, and explain your limits. "
                "I can't move money, but I can take you to the right screen."), cards, sugg, tools, handoff
    if intent == "THANKS":
        return "You're welcome. Anything else?", cards, sugg[:3], tools, handoff
    if intent == "BALANCE":
        b = tool_balance(s, cid)
        tools.append("balance")
        cards.append({"type": "balance", **b})
        extra = f" {pkr(b['reserved_minor'])} is reserved for payments still in progress." if b["reserved_minor"] else ""
        return f"You have {pkr(b['available_minor'])} available to spend.{extra}", cards, ["Show my recent payments", "What are my limits?"], tools, handoff
    if intent == "RECENT":
        rows = tool_recent(s, cid)
        tools.append("recent")
        cards += [_txn_card(t, merchants) for t in rows]
        if not rows:
            return "You don't have any activity yet.", cards, ["How do I pay a shop?"], tools, handoff
        return f"Here are your last {len(rows)} wallet movements, straight from the ledger.", cards, ["Did my last payment go through?"], tools, handoff
    if intent in ("TXN_STATUS", "WHY_DECLINED"):
        t = tool_find_payment(s, cid, text, merchants)
        tools.append("find_payment")
        if t is None:
            msg = "I couldn't find that payment in your wallet. Check the reference on your receipt (it looks like PAYA-20261121-ABC123)."
            return msg, cards, ["Show my recent payments"], tools, handoff
        cards.append(_txn_card(t, merchants))
        who = merchants.get(t.merchant_id) or "the shop"
        msg = f"Your {pkr(t.amount_minor)} payment to {who} ({t.txn_ref}) is \"{CUSTOMER_STATUS[t.status]}\". {EXPLAIN.get(t.status, '')}"
        if t.status in ("REJECTED", "FAILED") and t.failure_reason:
            msg += f" It was declined because {_reason(t.failure_reason)}."
        cards.append({"type": "action", "label": "Open payment details", "route": f"/app/txn/{t.txn_ref}"})
        return msg, cards, ["Talk to a person", "Show my recent payments"], tools, handoff
    if intent == "LIMITS":
        cap = {2: "Rs 500,000", 1: "Rs 25,000"}.get(cust.kyc_tier)
        tools.append("profile")
        msg = (f"Your wallet is tier {cust.kyc_tier}: you can pay up to {cap} in one payment. " if cap else "Your wallet isn't verified, so payments aren't available yet. ")
        msg += "After 5 payments in 10 minutes, the next one is checked by a person (a safety rule)."
        return msg, cards, ["Am I verified?"], tools, handoff
    if intent == "KYC":
        tools.append("profile")
        if cust.kyc_status == "VERIFIED":
            msg = f"Yes, your wallet is verified (tier {cust.kyc_tier})."
            if cust.kyc_tier < 2:
                msg += " Higher limits need enhanced checks by our compliance team; ask for a person if you'd like that."
        else:
            msg = "Your wallet isn't verified yet. You can open a verified wallet from the start screen with digital onboarding."
        return msg, cards, ["What are my limits?"], tools, handoff
    if intent == "PAY":
        cards.append({"type": "action", "label": "Scan a QR to pay", "route": "/app/scan"})
        return ("I can't send money from chat. That keeps your payments safe. Tap below to scan the shop's QR; "
                "you'll review the amount and authorise it yourself."), cards, ["What's my balance?"], tools, handoff
    if intent == "REFUND":
        return ("I can't reverse payments from chat. If a payment is stuck for more than 15 minutes, a person reviews it "
                "automatically, and any reversal needs two staff members. If you think something is wrong, I can pass this to a person."
                ), cards, ["Talk to a person", "Did my last payment go through?"], tools, handoff
    if intent == "SECURITY":
        msg = ("Paya will never ask for your PIN, OTP or password, in chat or on a call. Don't share them with anyone. "
               "If you think someone has your details, sign out and talk to a person now.")
        return msg, cards, ["Talk to a person"], tools, handoff
    if intent == "OUT_OF_SCOPE":
        return ("I can only help with your Paya wallet and payments. I can't give investment, loan or crypto advice."
                ), cards, sugg[:3], tools, handoff
    if intent == "HUMAN":
        handoff = _handoff(s, cust, conv)
        tools.append("handoff")
        return (f"I've passed this to our team (case {handoff['case_ref']}). A person from Operations will look at your "
                "conversation and recent payments. You don't need to repeat yourself."), cards, ["Show my recent payments"], tools, handoff
    return ("Sorry, I didn't get that. I can help with your balance, your payments and their status, your limits and "
            "verification, or pass you to a person."), cards, sugg, tools, handoff


def _handoff(s: Session, cust: Customer, conv: Conversation) -> dict:
    from .payments import open_case  # case creation only; no money-moving function is imported
    if conv.handoff_case_id:
        c = s.get(Case, conv.handoff_case_id)
        return {"case_ref": c.case_ref, "existing": True}
    c = open_case(s, kind="SUPPORT_HANDOFF", txn=None, owner_role="OPS",
                  summary=f"Customer asked for a person in chat {conv.ref}",
                  details={"conversation_ref": conv.ref, "customer_ref": str(cust.id)[:8]}, sla_minutes=60)
    conv.handoff_case_id = c.id
    audit.record(s, actor=f"assistant:{RULES_VERSION}", actor_role="SYSTEM", action="CHAT_HANDOFF", object_type="conversation",
                 object_id=conv.ref, channel="CHAT", details={"case_ref": c.case_ref})
    return {"case_ref": c.case_ref, "existing": False}


# ------------------------------------------------------------------ reading transcripts
def transcript(ref: str, *, customer_id: str | None = None) -> dict:
    with session_scope() as s:
        q = select(Conversation).where(Conversation.ref == ref)
        if customer_id:
            q = q.where(Conversation.customer_id == uuid.UUID(customer_id))
        conv = s.execute(q).scalar_one_or_none()
        if conv is None:
            raise NotFound("conversation not found")
        msgs = s.execute(select(ChatMessage).where(ChatMessage.conversation_id == conv.id)
                         .order_by(ChatMessage.created_at, ChatMessage.role.desc())).scalars().all()
        case = s.get(Case, conv.handoff_case_id) if conv.handoff_case_id else None
        return {"conversation_ref": conv.ref, "started_at": conv.started_at.isoformat(), "last_at": conv.last_at.isoformat(),
                "handoff_case_ref": case.case_ref if case else None,
                "messages": [{"role": m.role, "text": m.text, "intent": m.intent, "tools": m.tools, "redactions": m.redactions,
                              "at": m.created_at.isoformat()} for m in msgs]}


def metrics() -> dict:
    with session_scope() as s:
        convs = s.execute(select(Conversation)).scalars().all()
        msgs = s.execute(select(ChatMessage.intent, ChatMessage.redactions).where(ChatMessage.role == "USER")).all()
    intents: dict[str, int] = {}
    for i, _ in msgs:
        intents[i or "UNKNOWN"] = intents.get(i or "UNKNOWN", 0) + 1
    n = len(msgs) or 1
    return {"conversations": len(convs), "messages": len(msgs), "intents": intents,
            "handoff_rate": round(sum(1 for c in convs if c.handoff_case_id) / (len(convs) or 1), 3),
            "unknown_rate": round(intents.get("UNKNOWN", 0) / n, 3),
            "redacted_messages": sum(1 for _, r in msgs if r), "rules_version": RULES_VERSION,
            "retention_days": RETENTION_DAYS}


def purge_expired() -> int:
    """Data minimisation: conversations idle beyond the retention period are deleted with their messages."""
    cutoff = now() - timedelta(days=RETENTION_DAYS)
    with session_scope() as s:
        old = s.execute(select(Conversation).where(Conversation.last_at < cutoff)).scalars().all()
        for c in old:
            s.query(ChatMessage).filter(ChatMessage.conversation_id == c.id).delete()
            s.delete(c)
        return len(old)

