"""Send money to a bank account in Pakistan (simulated).

The customer picks a bank, enters an account number or IBAN, and the app fetches the account holder's name
("title fetch") before they confirm. In a real wallet that lookup goes to 1LINK / Raast; here it goes to a
SIMULATED BANK DIRECTORY of synthetic people. No real bank is contacted, no real account is looked up, and a
real account number typed in is simply "not found": it is never stored. Only the masked number and a keyed hash
of the number are kept for transfers to synthetic accounts.

The money path is the same one QR payments use: risk screening, a hold, one balanced AUTH_POST journal into
"in transit", the simulated Raast rail, then SETTLE. A transfer carries no merchant fee.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import events
from .config import get_settings
from .db import session_scope
from .errors import NotFound, ValidationFailed
from .models import BankTransfer, Customer, Transaction
from .errors import RailUnavailableError
from .payments import SYSTEM, _authorise_and_post, new_ref, open_case
from .rail import breaker
from .risk import screen
from .state import transition

# Banks and wallets that take Raast / IBFT transfers. Names are public; every lookup below is simulated.
BANKS: list[dict] = [
    {"code": "HABB", "name": "HBL Habib Bank", "short": "HBL", "kind": "BANK"},
    {"code": "MEZN", "name": "Meezan Bank", "short": "Meezan", "kind": "BANK"},
    {"code": "UNIL", "name": "United Bank (UBL)", "short": "UBL", "kind": "BANK"},
    {"code": "MUCB", "name": "MCB Bank", "short": "MCB", "kind": "BANK"},
    {"code": "ABPA", "name": "Allied Bank", "short": "ABL", "kind": "BANK"},
    {"code": "ALFH", "name": "Bank Alfalah", "short": "Alfalah", "kind": "BANK"},
    {"code": "BAHL", "name": "Bank AL Habib", "short": "BAHL", "kind": "BANK"},
    {"code": "NBPA", "name": "National Bank of Pakistan", "short": "NBP", "kind": "BANK"},
    {"code": "ASCM", "name": "Askari Bank", "short": "Askari", "kind": "BANK"},
    {"code": "FAYS", "name": "Faysal Bank", "short": "Faysal", "kind": "BANK"},
    {"code": "MPBL", "name": "Habib Metropolitan Bank", "short": "HabibMetro", "kind": "BANK"},
    {"code": "JSBL", "name": "JS Bank", "short": "JS Bank", "kind": "BANK"},
    {"code": "SCBL", "name": "Standard Chartered Pakistan", "short": "SCB", "kind": "BANK"},
    {"code": "BPUN", "name": "The Bank of Punjab", "short": "BOP", "kind": "BANK"},
    {"code": "SONE", "name": "Soneri Bank", "short": "Soneri", "kind": "BANK"},
    {"code": "DUIB", "name": "Dubai Islamic Bank Pakistan", "short": "DIB", "kind": "BANK"},
    {"code": "BKIP", "name": "BankIslami", "short": "BankIslami", "kind": "BANK"},
    {"code": "JCMA", "name": "JazzCash", "short": "JazzCash", "kind": "WALLET"},
    {"code": "TMFB", "name": "Easypaisa", "short": "Easypaisa", "kind": "WALLET"},
    {"code": "SADA", "name": "SadaPay", "short": "SadaPay", "kind": "WALLET"},
    {"code": "NAYA", "name": "NayaPay", "short": "NayaPay", "kind": "WALLET"},
]
BY_CODE = {b["code"]: b for b in BANKS}
PURPOSES = ["Family support", "Rent", "Bill sharing", "Business", "Gift", "Other"]

# Ready-made synthetic accounts for demos (shown as tap-to-use chips). Any number that starts with 99 is also in
# the simulated directory and gets a deterministic synthetic name, so presenters can type their own.
DEMO_ACCOUNTS: list[dict] = [
    {"bank": "MEZN", "account": "99010012345678", "title": "AHMED RAZA"},
    {"bank": "HABB", "account": "99020045678912", "title": "FATIMA NOOR"},
    {"bank": "UNIL", "account": "99030078912345", "title": "USMAN TARIQ"},
    {"bank": "MUCB", "account": "99040011223344", "title": "AYESHA SIDDIQUI"},
    {"bank": "ALFH", "account": "99050055667788", "title": "HAMID ALI KHAN"},
    {"bank": "JCMA", "account": "99060099887766", "title": "SANA IQBAL"},
    {"bank": "TMFB", "account": "99070033445566", "title": "BILAL MEHMOOD"},
    {"bank": "NAYA", "account": "99080077665544", "title": "MARIAM YOUSAF"},
]
_DEMO = {(a["bank"], a["account"]): a["title"] for a in DEMO_ACCOUNTS}
_FIRST = ["MUHAMMAD", "AYESHA", "ALI", "FATIMA", "HASSAN", "ZAINAB", "OMAR", "HIRA", "SAAD", "AMNA", "KASHIF", "NIDA",
          "FAHAD", "RABIA", "ASAD", "MEHWISH", "IMRAN", "SAMINA", "DANIYAL", "KHADIJA"]
_LAST = ["KHAN", "AHMED", "RAZA", "SHEIKH", "BUTT", "QURESHI", "MALIK", "CHAUDHRY", "HUSSAIN", "SIDDIQUI", "IQBAL",
         "MIRZA", "JAVED", "ANSARI", "AWAN", "BALOCH"]


@dataclass(frozen=True)
class Lookup:
    bank: dict
    account: str          # the full account digits: used for this request only, never stored
    masked: str
    title: str
    fetch_ref: str


def _account_digits(bank_code: str, raw: str) -> str:
    v = re.sub(r"[\s-]", "", raw or "").upper()
    if v.startswith("PK"):
        # IBAN: PK + 2 check digits + 4-letter bank code + 16 account characters (24 in all), mod-97 checked.
        if not re.fullmatch(r"PK\d{2}[A-Z]{4}\d{16}", v):
            raise ValidationFailed("an IBAN is PK, 2 digits, the 4-letter bank code and 16 digits (24 characters)")
        num = "".join(str(int(c, 36)) for c in v[4:] + v[:4])
        if int(num) % 97 != 1:
            raise ValidationFailed("that IBAN's check digits are wrong; please check it")
        if v[4:8] != bank_code:
            raise ValidationFailed(f"that IBAN belongs to another bank ({v[4:8]}), not {BY_CODE[bank_code]['short']}")
        return v[8:].lstrip("0") or "0"
    if not re.fullmatch(r"\d{10,16}", v):
        raise ValidationFailed("an account number has 10 to 16 digits (or enter the 24-character IBAN)")
    return v


def _hash(bank_code: str, account: str) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"{bank_code}:{account}".encode(), hashlib.sha256).hexdigest()


def lookup(bank_code: str, raw_account: str) -> Lookup:
    """Simulated title fetch. Only synthetic accounts are 'found'; anything else is not found and not kept."""
    bank = BY_CODE.get((bank_code or "").upper())
    if bank is None:
        raise ValidationFailed("choose a bank from the list")
    acct = _account_digits(bank["code"], raw_account)
    title = _DEMO.get((bank["code"], acct))
    if title is None and acct.startswith("99"):
        h = int(hashlib.sha256(f"{bank['code']}:{acct}".encode()).hexdigest(), 16)
        title = f"{_FIRST[h % len(_FIRST)]} {_LAST[(h // 97) % len(_LAST)]}"
    if title is None:
        raise NotFound("no account with this number in the simulated bank directory. In this demo, use a test "
                       "account: one from the list, or any number starting with 99")
    return Lookup(bank=bank, account=acct, masked=f"•••• {acct[-4:]}", title=title,
                  fetch_ref="TF" + hashlib.sha256(f"{bank['code']}:{acct}".encode()).hexdigest()[:10].upper())


def initiate_transfer(*, customer_id: uuid.UUID, bank_code: str, account: str, amount_minor: int, purpose: str,
                      actor: str, correlation_id: str) -> Transaction:
    """Validate, screen, hold and post in ONE database transaction, then hand off to the rail (like a payment)."""
    if purpose not in PURPOSES:
        raise ValidationFailed("choose a purpose from the list")
    if amount_minor < 100:
        raise ValidationFailed("the smallest transfer is Rs 1")
    found = lookup(bank_code, account)
    if not breaker.allow():
        events.telemetry("rail", "circuit_open_refused", level="error")
        raise RailUnavailableError("Raast is unavailable right now; no money has been taken. Please try again shortly.")
    with session_scope() as s:
        customer = s.get(Customer, customer_id)
        if customer is None:
            raise NotFound("customer not found")
        txn = Transaction(txn_ref=new_ref(), type="TRANSFER", status="CREATED", amount_minor=amount_minor,
                          customer_id=customer.id, correlation_id=correlation_id)
        s.add(txn)
        s.flush()
        s.add(BankTransfer(txn_id=txn.id, bank_code=found.bank["code"], bank_name=found.bank["name"],
                           account_masked=found.masked, account_hash=_hash(found.bank["code"], found.account),
                           title=found.title, purpose=purpose, title_fetch_ref=found.fetch_ref))
        to = f"{found.title} · {found.bank['short']} {found.masked}"
        events.emit(s, "payment.created", aggregate_id=txn.id, correlation_id=correlation_id,
                    payload={"txn_id": str(txn.id), "txn_ref": txn.txn_ref, "amount_minor": amount_minor,
                             "merchant": to, "kind": "TRANSFER", "customer_id": str(customer.id),
                             "customer_status": "Processing"})
        events.telemetry("gateway", "accepted", txn_ref=txn.txn_ref, detail={"amount_minor": amount_minor, "merchant": to})
        events.telemetry("risk", "screening", txn_ref=txn.txn_ref)
        result = screen(s, txn, customer, None, counterparty=found.title, category="BANK_TRANSFER")
        if result.outcome == "REJECT":
            transition(s, txn, "REJECTED", actor=SYSTEM, reason="risk_reject",
                       evidence={"screening_id": str(result.id), "rules": result.rules_fired})
            txn.failure_reason = result.rules_fired[0]["rule"]
            events.telemetry("risk", "rejected", txn_ref=txn.txn_ref, detail={"rules": result.rules_fired}, level="error")
            return txn
        transition(s, txn, "VALIDATED", actor=SYSTEM, reason="risk_checks_complete", evidence={"screening_id": str(result.id)})
        if result.outcome == "HOLD":
            transition(s, txn, "UNDER_REVIEW", actor=SYSTEM, reason="compliance_hold",
                       evidence={"screening_id": str(result.id), "rules": result.rules_fired})
            open_case(s, kind="COMPLIANCE_HOLD", txn=txn, owner_role="COMPLIANCE",
                      summary=f"Transfer {txn.txn_ref} held: " + ", ".join(r["rule"] for r in result.rules_fired),
                      details={"rules": result.rules_fired, "data_used": result.data_used}, sla_minutes=240)
            events.telemetry("risk", "held", txn_ref=txn.txn_ref, detail={"rules": result.rules_fired}, level="warn")
            return txn
        events.telemetry("risk", "passed", txn_ref=txn.txn_ref)
        _authorise_and_post(s, txn, customer, actor=actor)
        return txn


def creditor_alias(s: Session, txn_id: uuid.UUID) -> str:
    """What the simulated rail is told: the bank and the last 4 digits (never the full account number)."""
    bt = s.get(BankTransfer, txn_id)
    return f"{bt.bank_code}:****{bt.account_masked[-4:]}" if bt else "UNKNOWN"


def counterparties(s: Session, txns) -> dict:
    """txn id -> 'NAME · BANK •••• 1234' for transfers (screens show it where a payment shows the shop)."""
    ids = [t.id for t in txns if t.type == "TRANSFER"]
    if not ids:
        return {}
    rows = s.execute(select(BankTransfer).where(BankTransfer.txn_id.in_(ids))).scalars()
    return {b.txn_id: f"{b.title} · {BY_CODE.get(b.bank_code, {}).get('short', b.bank_code)} {b.account_masked}" for b in rows}


def beneficiary(s: Session, txn_id: uuid.UUID) -> dict | None:
    b = s.get(BankTransfer, txn_id)
    if b is None:
        return None
    return {"title": b.title, "bank_code": b.bank_code, "bank_name": b.bank_name, "account_masked": b.account_masked,
            "purpose": b.purpose, "title_fetch_ref": b.title_fetch_ref, "directory": "simulated"}
