"""Paya API - gateway facade, commands, queries and the live stream for Mission Control.

Commands change state (POST), queries read it (GET), events report facts (WebSocket / outbox).
"""
import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Header, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import audit, events, ledger, notifications, payments, recon
from ..config import get_settings
from ..db import create_schema, session_scope
from ..errors import Forbidden, NotFound, PayaError, Unauthenticated, ValidationFailed
from ..idempotency import execute as idempotent
from ..models import (
    Account, Approval, AuditLog, Case, Customer, Journal, LedgerEntry, Merchant, Notification, PaymentRequest,
    ReconItem, ReconRun, ScreeningResult, Transaction, TransactionStatusHistory, User,
)
from ..rail import MODES, breaker, chaos, rail
from ..security import Principal, can, decode_token, issue_token, require, verify_password
from ..state import CUSTOMER_STATUS
from ..worker import Worker

_worker: Worker | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker
    create_schema()
    notifications.register()
    if get_settings().demo_mode:
        from ..seed import seed
        seed()
    if not getattr(app.state, "disable_worker", False):
        _worker = Worker(interval_s=1.0)
        _worker.start()
    yield
    if _worker:
        _worker.stop()


app = FastAPI(
    title="Paya API",
    version="0.1.0",
    description="Paya - Raast P2M payment assurance platform (academic prototype; synthetic data; no real money).",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Correlation-ID", "Idempotent-Replayed"])


# ------------------------------------------------------------------ cross-cutting
@app.middleware("http")
async def correlation(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID") or payments.new_correlation_id()
    request.state.correlation_id = cid
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = cid
    return response


@app.exception_handler(PayaError)
async def paya_error(request: Request, exc: PayaError):
    return JSONResponse(status_code=exc.http_status, content={
        "error": {"code": exc.code, "message": exc.message, **exc.details},
        "correlation_id": getattr(request.state, "correlation_id", None)})


def principal(authorization: Annotated[str | None, Header()] = None) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthenticated("missing bearer token")
    return decode_token(authorization.split(" ", 1)[1])


def authorised(permission: str):
    def dep(request: Request, p: Principal = Depends(principal)) -> Principal:
        if not can(p, permission):
            with session_scope() as s:
                audit.record(s, actor=p.username, actor_role=p.role, action=permission, object_type="endpoint",
                             object_id=request.url.path, outcome="DENIED", reason="role not permitted",
                             correlation_id=request.state.correlation_id)
            events.telemetry("security", "access_denied", detail={"user": p.username, "role": p.role,
                                                                   "permission": permission}, level="error")
            require(p, permission)
        return p
    return dep


def money(minor: int) -> dict:
    return {"minor": minor, "pkr": f"{minor / 100:,.2f}"}


# ------------------------------------------------------------------ auth
class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/v1/auth/login", tags=["auth"])
def login(body: LoginIn, request: Request):
    with session_scope() as s:
        u = s.execute(select(User).where(User.username == body.username, User.active.is_(True))).scalar_one_or_none()
        if u is None or not verify_password(body.password, u.password_hash):
            audit.record(s, actor=body.username, actor_role="UNKNOWN", action="LOGIN", object_type="session",
                         object_id=None, outcome="DENIED", reason="bad credentials",
                         correlation_id=request.state.correlation_id)
            raise Unauthenticated("invalid username or password")
        p = Principal(user_id=str(u.id), username=u.username, role=u.role,
                      customer_id=str(u.customer_id) if u.customer_id else None,
                      merchant_id=str(u.merchant_id) if u.merchant_id else None)
        audit.record(s, actor=u.username, actor_role=u.role, action="LOGIN", object_type="session", object_id=None,
                     correlation_id=request.state.correlation_id)
        return {"access_token": issue_token(p), "token_type": "bearer", "role": u.role, "display_name": u.display_name,
                "customer_id": p.customer_id, "merchant_id": p.merchant_id}


@app.get("/v1/me", tags=["auth"])
def me(p: Principal = Depends(principal)):
    return p.__dict__


# ------------------------------------------------------------------ merchant
class PaymentRequestIn(BaseModel):
    amount_minor: int = Field(gt=0, le=10_000_000_00, description="Amount in paisa (PKR x 100)")
    order_ref: str = Field(min_length=1, max_length=64)
    kind: str = Field(default="DYNAMIC_QR", pattern="^(DYNAMIC_QR|RTP_NOW|PAYMENT_LINK)$")


@app.post("/v1/payment-requests", status_code=201, tags=["merchant"])
def create_payment_request(body: PaymentRequestIn, p: Principal = Depends(authorised("payment_request:create"))):
    pr = payments.create_payment_request(uuid.UUID(p.merchant_id), body.amount_minor, body.order_ref, p.username,
                                         kind=body.kind)
    return _payment_request_view(pr.id)


def _payment_request_view(pr_id) -> dict:
    with session_scope() as s:
        pr = s.get(PaymentRequest, pr_id)
        if pr is None:
            raise NotFound("payment request not found")
        m = s.get(Merchant, pr.merchant_id)
        live = s.execute(select(Transaction).where(Transaction.payment_request_id == pr.id)
                         .order_by(Transaction.created_at.desc()).limit(1)).scalar_one_or_none()
        return {"id": str(pr.id), "order_ref": pr.order_ref, "amount": money(pr.amount_minor), "status": pr.status,
                "kind": pr.kind, "expires_at": pr.expires_at.isoformat(),
                "merchant": {"id": str(m.id), "name": m.trading_name, "category": m.category, "alias": m.raast_alias},
                "qr_payload": payments.qr_payload(pr, m),
                "latest_payment": None if live is None else {"txn_ref": live.txn_ref, "status": live.status,
                                                             "display_status": CUSTOMER_STATUS[live.status]}}


@app.get("/v1/payment-requests", tags=["merchant"])
def list_payment_requests(status: str = "OPEN", p: Principal = Depends(principal)):
    """Open tills near the customer (demo convenience when a camera scan is not possible)."""
    if p.role not in ("CUSTOMER", "CASHIER", "MERCHANT_ADMIN") or not get_settings().demo_mode:
        raise Forbidden("not available")
    with session_scope() as s:
        q = select(PaymentRequest.id).where(PaymentRequest.status == status,
                                            PaymentRequest.expires_at > datetime.now(timezone.utc))
        if p.merchant_id:
            q = q.where(PaymentRequest.merchant_id == uuid.UUID(p.merchant_id))
        ids = s.execute(q.order_by(PaymentRequest.created_at.desc()).limit(20)).scalars().all()
    return [v for v in (_payment_request_view(i) for i in ids) if v["latest_payment"] is None
            or v["latest_payment"]["status"] in ("REJECTED", "FAILED", "EXPIRED", "REVERSED")]


@app.get("/v1/payment-requests/{pr_id}", tags=["merchant"])
def get_payment_request(pr_id: uuid.UUID, p: Principal = Depends(principal)):
    view = _payment_request_view(pr_id)
    if p.role in ("CASHIER", "MERCHANT_ADMIN") and view["merchant"]["id"] != p.merchant_id:
        raise Forbidden("not your merchant")
    return view


@app.get("/v1/merchant/transactions", tags=["merchant"])
def merchant_transactions(p: Principal = Depends(authorised("merchant:read")), limit: int = 30):
    with session_scope() as s:
        rows = s.execute(select(Transaction, PaymentRequest.order_ref)
                         .join(PaymentRequest, PaymentRequest.id == Transaction.payment_request_id)
                         .where(Transaction.merchant_id == uuid.UUID(p.merchant_id))
                         .order_by(Transaction.created_at.desc()).limit(limit)).all()
        return [{"txn_ref": t.txn_ref, "order_ref": o, "amount": money(t.amount_minor), "status": t.status,
                 "display_status": CUSTOMER_STATUS[t.status], "paid": t.status in ("SETTLED", "RECONCILED"),
                 "created_at": t.created_at.isoformat()} for t, o in rows]


# ------------------------------------------------------------------ customer
class PayIn(BaseModel):
    payment_request_id: uuid.UUID


@app.post("/v1/payments", status_code=202, tags=["payments"])
def pay(body: PayIn, request: Request, background: BackgroundTasks,
        p: Principal = Depends(authorised("payment:pay")),
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None):
    cid = request.state.correlation_id

    def run():
        txn = payments.initiate_payment(customer_id=uuid.UUID(p.customer_id),
                                        payment_request_id=body.payment_request_id, actor=p.username,
                                        correlation_id=cid)
        return 202, {"txn_ref": txn.txn_ref, "txn_id": str(txn.id), "status": txn.status,
                     "display_status": CUSTOMER_STATUS[txn.status], "amount": money(txn.amount_minor),
                     "failure_reason": txn.failure_reason, "correlation_id": cid}

    code, resp, replayed = idempotent(principal=p.user_id, operation="POST /v1/payments", key=idempotency_key,
                                      body=body.model_dump(mode="json"), fn=run)
    if not replayed and resp.get("status") == "PENDING":
        background.add_task(_dispatch_and_relay, uuid.UUID(resp["txn_id"]))
    else:
        background.add_task(events.relay_once)
    return JSONResponse(status_code=code, content=resp, headers={"Idempotent-Replayed": str(replayed).lower()})


def _dispatch_and_relay(txn_id: uuid.UUID) -> None:
    events.relay_once()
    payments.dispatch(txn_id)
    events.relay_once()


@app.get("/v1/wallet", tags=["payments"])
def wallet(p: Principal = Depends(authorised("payment:read_own"))):
    with session_scope() as s:
        cust = s.get(Customer, uuid.UUID(p.customer_id))
        acc = ledger.owned_account(s, "2100", "CUSTOMER", cust.id)
        txns = s.execute(select(Transaction).where(Transaction.customer_id == cust.id)
                         .order_by(Transaction.created_at.desc()).limit(30)).scalars().all()
        merchants = {m.id: m.trading_name for m in s.execute(select(Merchant)).scalars()}
        return {"customer": {"name": cust.full_name, "kyc_tier": cust.kyc_tier, "kyc_status": cust.kyc_status},
                "ledger_balance": money(ledger.ledger_balance(s, acc)),
                "available_balance": money(ledger.available_balance(s, acc)),
                "transactions": [{"txn_ref": t.txn_ref, "type": t.type, "amount": money(t.amount_minor),
                                  "status": t.status, "display_status": CUSTOMER_STATUS[t.status],
                                  "merchant": merchants.get(t.merchant_id), "created_at": t.created_at.isoformat()}
                                 for t in txns]}


# ------------------------------------------------------------------ transaction detail (the showpiece)
@app.get("/v1/transactions/{txn_ref}", tags=["payments"])
def transaction_detail(txn_ref: str, p: Principal = Depends(principal)):
    with session_scope() as s:
        t = s.execute(select(Transaction).where(Transaction.txn_ref == txn_ref)).scalar_one_or_none()
        if t is None:
            raise NotFound("transaction not found")
        if p.role == "CUSTOMER" and str(t.customer_id) != p.customer_id:
            raise NotFound("transaction not found")  # do not reveal other customers' references
        if p.role in ("CASHIER", "MERCHANT_ADMIN") and str(t.merchant_id) != p.merchant_id:
            raise NotFound("transaction not found")
        backoffice = can(p, "backoffice:read")
        m = s.get(Merchant, t.merchant_id) if t.merchant_id else None
        related = s.execute(select(Transaction).where(
            (Transaction.original_txn_id == t.id) | (Transaction.id == t.original_txn_id))).scalars().all()
        ids = [t.id] + [r.id for r in related]
        history = s.execute(select(TransactionStatusHistory).where(TransactionStatusHistory.txn_id == t.id)
                            .order_by(TransactionStatusHistory.id)).scalars().all()
        detail = {
            "txn_ref": t.txn_ref, "type": t.type, "status": t.status, "display_status": CUSTOMER_STATUS[t.status],
            "amount": money(t.amount_minor), "currency": t.currency, "merchant": m.trading_name if m else None,
            "created_at": t.created_at.isoformat(), "updated_at": t.updated_at.isoformat(),
            "references": {"txn_id": str(t.id), "correlation_id": t.correlation_id, "rail": t.rail,
                           "rail_e2e_id": t.rail_e2e_id,
                           "payment_request_id": str(t.payment_request_id) if t.payment_request_id else None},
            "timeline": [{"from": h.from_status, "to": h.to_status, "actor": h.actor, "reason": h.reason,
                          "at": h.created_at.isoformat(), **({"evidence": h.evidence} if backoffice else {})}
                         for h in history],
            "related": [{"txn_ref": r.txn_ref, "type": r.type, "status": r.status} for r in related],
            "recon_result": t.recon_result, "failure_reason": t.failure_reason,
        }
        if backoffice or p.role == "AUDITOR":
            accounts = {a.id: a for a in s.execute(select(Account)).scalars()}
            journals = s.execute(select(Journal).where(Journal.txn_id.in_(ids)).order_by(Journal.created_at)).scalars().all()
            detail["ledger"] = [{
                "posting_type": j.posting_type, "reason_code": j.reason_code, "booking_date": j.booking_date.isoformat(),
                "value_date": j.value_date.isoformat(), "actor": j.actor, "approved_by": j.approved_by,
                "initiated_via": j.initiated_via, "rule_version": j.rule_version,
                "entries": [{"account": f"{accounts[e.account_id].code} {accounts[e.account_id].name}",
                             "direction": e.direction, "amount": money(e.amount_minor)}
                            for e in s.execute(select(LedgerEntry).where(LedgerEntry.journal_id == j.id)).scalars()]}
                for j in journals]
            detail["screening"] = [{"outcome": r.outcome, "rules_fired": r.rules_fired, "data_used": r.data_used,
                                    "rule_version": r.rule_version, "at": r.created_at.isoformat()}
                                   for r in s.execute(select(ScreeningResult).where(ScreeningResult.txn_id == t.id)).scalars()]
            detail["cases"] = [{"case_ref": c.case_ref, "kind": c.kind, "state": c.state, "owner_role": c.owner_role,
                                "summary": c.summary, "resolution": c.resolution, "resolved_by": c.resolved_by}
                               for c in s.execute(select(Case).where(Case.txn_id == t.id)).scalars()]
            detail["recon"] = [{"category": i.category, "run_id": str(i.run_id), "at": i.created_at.isoformat()}
                               for i in s.execute(select(ReconItem).where(ReconItem.txn_id == t.id)).scalars()]
            detail["approvals"] = [{"id": str(a.id), "action": a.action, "status": a.status, "maker": a.requested_by,
                                    "checker": a.approved_by, "reason": a.reason}
                                   for a in s.execute(select(Approval).where(Approval.txn_id == t.id)).scalars()]
            detail["audit"] = [{"actor": a.actor, "role": a.actor_role, "action": a.action, "outcome": a.outcome,
                                "reason": a.reason, "at": a.created_at.isoformat(), "row_hash": a.row_hash[:16]}
                               for a in s.execute(select(AuditLog).where(AuditLog.object_id == t.txn_ref)
                                                  .order_by(AuditLog.id)).scalars()]
        detail["notifications"] = [{"recipient": n.recipient, "body": n.body, "at": n.created_at.isoformat()}
                                   for n in s.execute(select(Notification).where(Notification.txn_id == t.id)
                                                      .order_by(Notification.created_at)).scalars()
                                   if backoffice or n.recipient == ("CUSTOMER" if p.role == "CUSTOMER" else "MERCHANT")]
        return detail


# ------------------------------------------------------------------ back office
@app.get("/v1/cases", tags=["backoffice"])
def list_cases(state: str = "OPEN", p: Principal = Depends(authorised("cases:read"))):
    with session_scope() as s:
        q = select(Case, Transaction.txn_ref).outerjoin(Transaction, Transaction.id == Case.txn_id).order_by(Case.created_at.desc())
        if state != "ALL":
            q = q.where(Case.state == state)
        out = []
        for c, ref in s.execute(q.limit(200)).all():
            out.append({"case_ref": c.case_ref, "kind": c.kind, "state": c.state, "owner_role": c.owner_role,
                        "summary": c.summary, "txn_ref": ref, "details": c.details, "resolution": c.resolution,
                        "sla_due_at": c.sla_due_at.isoformat(), "created_at": c.created_at.isoformat(),
                        "overdue": c.state != "RESOLVED" and c.sla_due_at < datetime.now(timezone.utc),
                        "mine": c.owner_role == p.role})
        return out


class DecisionIn(BaseModel):
    decision: str = Field(pattern="^(RELEASE|REJECT)$")
    reason: str = Field(min_length=3, max_length=500)


@app.post("/v1/compliance/holds/{txn_ref}/decision", tags=["backoffice"])
def compliance_decision(txn_ref: str, body: DecisionIn, background: BackgroundTasks,
                        p: Principal = Depends(authorised("compliance:decide"))):
    txn = payments.compliance_decide(txn_ref=txn_ref, decision=body.decision, actor=p.username, actor_role=p.role,
                                     reason=body.reason)
    if txn.status == "PENDING":
        background.add_task(_dispatch_and_relay, txn.id)
    else:
        background.add_task(events.relay_once)
    return {"txn_ref": txn.txn_ref, "status": txn.status}


@app.post("/v1/ops/transactions/{txn_ref}/enquiry", tags=["backoffice"])
def ops_enquiry(txn_ref: str, background: BackgroundTasks, p: Principal = Depends(authorised("ops:enquiry"))):
    stats = payments.run_status_enquiries(force=True)
    background.add_task(events.relay_once)
    return stats


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@app.post("/v1/ops/transactions/{txn_ref}/reversal-requests", status_code=201, tags=["backoffice"])
def reversal_request(txn_ref: str, body: ReasonIn, p: Principal = Depends(authorised("reversal:request"))):
    a = payments.request_reversal(txn_ref=txn_ref, actor=p.username, actor_role=p.role, reason=body.reason)
    return {"approval_id": str(a.id), "status": a.status, "maker": a.requested_by}


@app.get("/v1/finance/approvals", tags=["backoffice"])
def list_approvals(p: Principal = Depends(authorised("backoffice:read"))):
    with session_scope() as s:
        rows = s.execute(select(Approval, Transaction.txn_ref, Transaction.amount_minor)
                         .join(Transaction, Transaction.id == Approval.txn_id)
                         .order_by(Approval.created_at.desc()).limit(100)).all()
        return [{"id": str(a.id), "action": a.action, "status": a.status, "txn_ref": ref, "amount": money(amt),
                 "maker": a.requested_by, "checker": a.approved_by, "reason": a.reason,
                 "created_at": a.created_at.isoformat()} for a, ref, amt in rows]


@app.post("/v1/finance/approvals/{approval_id}/approve", tags=["backoffice"])
def approve(approval_id: uuid.UUID, background: BackgroundTasks, p: Principal = Depends(authorised("reversal:approve"))):
    txn = payments.approve_reversal(approval_id=approval_id, actor=p.username, actor_role=p.role)
    background.add_task(events.relay_once)
    return {"txn_ref": txn.txn_ref, "status": txn.status}


class ReconIn(BaseModel):
    business_date: date | None = None
    duplicate_line: bool = False


@app.post("/v1/finance/recon/run", tags=["finance"])
def run_recon(body: ReconIn, background: BackgroundTasks, p: Principal = Depends(authorised("recon:run"))):
    f = rail.settlement_file(body.business_date or datetime.now(timezone.utc).date(),
                             duplicate_first_line=body.duplicate_line)
    summary = recon.run(f, actor=p.username)
    background.add_task(events.relay_once)
    return summary


@app.get("/v1/finance/trial-balance", tags=["finance"])
def trial_balance(p: Principal = Depends(authorised("finance:read"))):
    with session_scope() as s:
        return ledger.trial_balance(s)


@app.get("/v1/finance/recon/runs", tags=["finance"])
def recon_runs(p: Principal = Depends(authorised("finance:read"))):
    with session_scope() as s:
        return [{"id": str(r.id), "file_id": r.file_id, "business_date": r.business_date.isoformat(),
                 "records": r.record_count, "value_total": money(r.value_total_minor), "summary": r.summary,
                 "run_by": r.run_by, "at": r.created_at.isoformat()}
                for r in s.execute(select(ReconRun).order_by(ReconRun.created_at.desc()).limit(50)).scalars()]


@app.get("/v1/audit/verify", tags=["audit"])
def audit_verify(p: Principal = Depends(authorised("audit:read"))):
    with session_scope() as s:
        ok, broken = audit.verify_chain(s)
        n = s.execute(select(func.count()).select_from(AuditLog)).scalar_one()
        return {"chain_intact": ok, "first_broken_row": broken, "rows": n}


@app.get("/v1/metrics/summary", tags=["observability"])
def metrics_summary(p: Principal = Depends(authorised("backoffice:read"))):
    with session_scope() as s:
        by_status = dict(s.execute(select(Transaction.status, func.count()).where(Transaction.type == "PAYMENT")
                                   .group_by(Transaction.status)).all())
        total = sum(by_status.values()) or 1
        in_transit = ledger.ledger_balance(s, ledger.house_account(s, "2150"))
        open_cases = dict(s.execute(select(Case.kind, func.count()).where(Case.state != "RESOLVED")
                                    .group_by(Case.kind)).all())
        paid = by_status.get("SETTLED", 0) + by_status.get("RECONCILED", 0)
        return {"payments_by_status": by_status, "success_rate": round(paid / total, 4),
                "pending": by_status.get("PENDING", 0) + by_status.get("UNDER_REVIEW", 0),
                "in_transit": money(in_transit), "open_cases": open_cases,
                "rail": {"breaker": breaker.state, **{k: v for k, v in chaos.state().items() if k != "modes"}},
                "ledger_balanced": ledger.trial_balance(s)["balanced"]}


# ------------------------------------------------------------------ chaos (demo mode only)
class ChaosIn(BaseModel):
    mode: str
    latency_ms: int = Field(default=0, ge=0, le=10_000)


@app.get("/v1/chaos/rail", tags=["chaos"])
def chaos_state(p: Principal = Depends(authorised("backoffice:read"))):
    return {**chaos.state(), "breaker": breaker.state}


@app.post("/v1/chaos/rail", tags=["chaos"])
def chaos_set(body: ChaosIn, request: Request, p: Principal = Depends(authorised("chaos:control"))):
    if not get_settings().demo_mode:
        raise Forbidden("chaos controls are disabled outside demo mode")
    if body.mode not in MODES:
        raise ValidationFailed(f"unknown mode; choose one of {list(MODES)}")
    chaos.set_mode(body.mode, body.latency_ms)
    if body.mode == "NORMAL":
        breaker.reset()
    with session_scope() as s:
        audit.record(s, actor=p.username, actor_role=p.role, action="CHAOS_RAIL_MODE", object_type="rail",
                     object_id="RAAST_MOCK", details=body.model_dump(), correlation_id=request.state.correlation_id)
    events.telemetry("chaos", "rail_mode_changed", detail={"mode": body.mode, "by": p.username},
                     level="warn" if body.mode != "NORMAL" else "info")
    return chaos_state(p)


@app.post("/v1/chaos/relay-duplicate", tags=["chaos"])
def chaos_duplicate(p: Principal = Depends(authorised("chaos:control"))):
    """Re-deliver the latest settled event to every consumer: proves duplicate-safe consumption."""
    from ..models import OutboxEvent
    with session_scope() as s:
        ev = s.execute(select(OutboxEvent).where(OutboxEvent.event_type == "payment.settled")
                       .order_by(OutboxEvent.seq.desc()).limit(1)).scalar_one_or_none()
        if ev is None:
            raise NotFound("no settled event to duplicate yet")
        env = events.envelope(ev)
    events.telemetry("chaos", "duplicate_event_injected", txn_ref=env["payload"].get("txn_ref"), level="warn")
    events._deliver(env)
    return {"redelivered": env["event_id"]}


# ------------------------------------------------------------------ live stream + health
@app.websocket("/v1/stream")
async def stream(ws: WebSocket, token: str = Query(...)):
    try:
        p = decode_token(token)
    except PayaError:
        await ws.close(code=4401)
        return
    await ws.accept()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    full_view = can(p, "backoffice:read")

    def visible(msg: dict) -> bool:
        if full_view:
            return True
        payload = msg.get("payload") or {}
        return (p.customer_id and payload.get("customer_id") == p.customer_id) or \
               (p.merchant_id and payload.get("merchant_id") == p.merchant_id)

    def listener(msg: dict) -> None:
        if visible(msg):
            loop.call_soon_threadsafe(lambda: queue.full() or queue.put_nowait(msg))

    events.add_live_listener(listener)
    try:
        for msg in events.recent()[-200:]:
            if visible(msg):
                await ws.send_text(json.dumps(msg, default=str))
        while True:
            msg = await queue.get()
            await ws.send_text(json.dumps(msg, default=str))
    except WebSocketDisconnect:
        pass
    finally:
        events.remove_live_listener(listener)


@app.get("/healthz", tags=["observability"])
def healthz():
    with session_scope() as s:
        s.execute(select(1))
    return {"status": "ok", "rail_breaker": breaker.state}


@app.get("/metrics", response_class=PlainTextResponse, tags=["observability"])
def prometheus():
    with session_scope() as s:
        rows = s.execute(select(Transaction.status, func.count()).where(Transaction.type == "PAYMENT")
                         .group_by(Transaction.status)).all()
        open_cases = s.execute(select(func.count()).select_from(Case).where(Case.state != "RESOLVED")).scalar_one()
        in_transit = ledger.ledger_balance(s, ledger.house_account(s, "2150"))
    lines = ["# TYPE paya_payments_total gauge"]
    lines += [f'paya_payments_total{{status="{st}"}} {n}' for st, n in rows]
    lines += ["# TYPE paya_open_cases gauge", f"paya_open_cases {open_cases}",
              "# TYPE paya_in_transit_minor gauge", f"paya_in_transit_minor {in_transit}",
              "# TYPE paya_rail_breaker_open gauge", f"paya_rail_breaker_open {int(breaker.state == 'OPEN')}"]
    return "\n".join(lines) + "\n"
