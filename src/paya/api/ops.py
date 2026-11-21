"""Paya 2.0 operations API: read models for Mission Control, plus one control (case assignment).

Everything here is either READ-ONLY over existing systems of record, or (assignment) a work-management
change that moves no money. Every endpoint is behind an existing or newly added permission, and the
financial domain modules (ledger, payments, recon, kyc) are not modified.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select

from .. import audit, events, integrity, ledger
from ..db import session_scope
from ..errors import Forbidden, InvalidState, NotFound, ValidationFailed
from ..models import (
    AISuggestion, Approval, AuditLog, Case, Customer, KYCApplication, Merchant, OutboxEvent, ReconItem, ReconRun,
    ScreeningResult, Transaction, TransactionStatusHistory, User, now,
)
from ..security import PERMISSIONS, Principal
from ..state import CUSTOMER_STATUS
from .main import authorised, money

router = APIRouter()
FLAG_SCREENING = "SCREENING"
FAILED = ("REJECTED", "FAILED", "REVERSED", "EXPIRED")


# ------------------------------------------------------------------ transaction explorer
@router.get("/v1/ops/transactions", tags=["operations"])
def search_transactions(
    q: str | None = Query(None, max_length=64, description="Reference, rail E2E id or correlation id (contains)"),
    status: str | None = Query(None, description="Comma-separated statuses"),
    type: str | None = Query(None, pattern="^(PAYMENT|REVERSAL|REFUND|TOPUP|ADJUSTMENT)$"),
    merchant: str | None = Query(None, max_length=64), customer: str | None = Query(None, max_length=64),
    min_amount_minor: int | None = Query(None, ge=0), max_amount_minor: int | None = Query(None, ge=0),
    date_from: datetime | None = None, date_to: datetime | None = None,
    recon: str | None = Query(None, pattern="^(RECONCILED|UNRECONCILED|BREAK)$"),
    rail: str | None = Query(None, pattern="^(NOT_SENT|SENT|RETRIED)$"),
    flagged: bool | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    p: Principal = Depends(authorised("backoffice:read")),
):
    with session_scope() as s:
        flagged_ids = select(ScreeningResult.txn_id).where(ScreeningResult.outcome != "PASS")
        case_ids = select(Case.txn_id).where(Case.txn_id.is_not(None))
        cond = []
        if q:
            like = f"%{q.strip()}%"
            cond.append(or_(Transaction.txn_ref.ilike(like), Transaction.rail_e2e_id.ilike(like),
                            Transaction.correlation_id.ilike(like)))
        if status:
            cond.append(Transaction.status.in_([x.strip().upper() for x in status.split(",") if x.strip()]))
        if type:
            cond.append(Transaction.type == type)
        if merchant:
            cond.append(Transaction.merchant_id.in_(select(Merchant.id).where(Merchant.trading_name.ilike(f"%{merchant}%"))))
        if customer:
            cond.append(Transaction.customer_id.in_(select(Customer.id).where(Customer.full_name.ilike(f"%{customer}%"))))
        if min_amount_minor is not None:
            cond.append(Transaction.amount_minor >= min_amount_minor)
        if max_amount_minor is not None:
            cond.append(Transaction.amount_minor <= max_amount_minor)
        if date_from:
            cond.append(Transaction.created_at >= date_from)
        if date_to:
            cond.append(Transaction.created_at <= date_to)
        if recon == "RECONCILED":
            cond.append(Transaction.status == "RECONCILED")
        elif recon == "UNRECONCILED":
            cond.append(and_(Transaction.status == "SETTLED", Transaction.recon_result.is_(None)))
        elif recon == "BREAK":
            cond.append(and_(Transaction.recon_result.is_not(None), Transaction.recon_result != "MATCHED"))
        if rail == "NOT_SENT":
            cond.append(Transaction.rail_attempts == 0)
        elif rail == "SENT":
            cond.append(Transaction.rail_attempts >= 1)
        elif rail == "RETRIED":
            cond.append(Transaction.rail_attempts >= 2)
        if flagged is True:
            cond.append(or_(Transaction.id.in_(flagged_ids), Transaction.id.in_(case_ids)))
        elif flagged is False:
            cond.append(and_(Transaction.id.notin_(flagged_ids), Transaction.id.notin_(case_ids)))
        base = select(Transaction).where(*cond)
        total = s.execute(select(func.count()).select_from(base.subquery())).scalar_one()
        rows = s.execute(base.order_by(Transaction.created_at.desc()).offset((page - 1) * page_size)
                         .limit(page_size)).scalars().all()
        ids = [t.id for t in rows]
        merchants = {m.id: m.trading_name for m in s.execute(select(Merchant)).scalars()}
        cust = {c.id: c.full_name for c in s.execute(select(Customer).where(
            Customer.id.in_([t.customer_id for t in rows if t.customer_id]))).scalars()}
        screened = set(s.execute(flagged_ids.where(ScreeningResult.txn_id.in_(ids))).scalars())
        cased = set(s.execute(select(Case.txn_id).where(Case.txn_id.in_(ids))).scalars())
        items = [{
            "txn_ref": t.txn_ref, "type": t.type, "status": t.status, "display_status": CUSTOMER_STATUS[t.status],
            "amount": money(t.amount_minor), "merchant": merchants.get(t.merchant_id), "customer": cust.get(t.customer_id),
            "rail_e2e_id": t.rail_e2e_id, "rail_attempts": t.rail_attempts, "recon_result": t.recon_result,
            "correlation_id": t.correlation_id, "failure_reason": t.failure_reason,
            "flags": ([FLAG_SCREENING] if t.id in screened else []) + (["CASE"] if t.id in cased else []),
            "created_at": t.created_at.isoformat(), "updated_at": t.updated_at.isoformat(),
        } for t in rows]
        return {"items": items, "total": total, "page": page, "page_size": page_size}


# ------------------------------------------------------------------ overview + time series
def _percentile(xs: list[float], pct: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(pct * (len(xs) - 1) + 0.5))], 2)


@router.get("/v1/ops/timeseries", tags=["operations"])
def timeseries(window_minutes: int = Query(60, ge=5, le=24 * 60), buckets: int = Query(30, ge=6, le=120),
               p: Principal = Depends(authorised("backoffice:read"))):
    """Payments created per time bucket, by outcome, plus time-to-settle. Computed from the database."""
    end = now()
    start = end - timedelta(minutes=window_minutes)
    width = (end - start) / buckets
    with session_scope() as s:
        txns = s.execute(select(Transaction.id, Transaction.status, Transaction.amount_minor, Transaction.created_at)
                         .where(Transaction.type == "PAYMENT", Transaction.created_at >= start)).all()
        settled_at = dict(s.execute(select(TransactionStatusHistory.txn_id, func.min(TransactionStatusHistory.created_at))
                                    .where(TransactionStatusHistory.to_status == "SETTLED",
                                           TransactionStatusHistory.txn_id.in_([t.id for t in txns]))
                                    .group_by(TransactionStatusHistory.txn_id)).all())
    series = [{"start": (start + i * width).isoformat(), "settled": 0, "in_flight": 0, "review": 0, "failed": 0,
               "value_settled_minor": 0, "settle_seconds": []} for i in range(buckets)]
    latencies = []
    for t in txns:
        i = min(buckets - 1, int((t.created_at - start) / width))
        b = series[i]
        if t.status in ("SETTLED", "RECONCILED"):
            b["settled"] += 1
            b["value_settled_minor"] += t.amount_minor
        elif t.status == "UNDER_REVIEW":
            b["review"] += 1
        elif t.status in FAILED:
            b["failed"] += 1
        else:
            b["in_flight"] += 1
        if t.id in settled_at:
            secs = (settled_at[t.id] - t.created_at).total_seconds()
            latencies.append(secs)
            b["settle_seconds"].append(secs)
    for b in series:
        sec = b.pop("settle_seconds")
        b["settle_p50_s"] = _percentile(sec, 0.5)
    return {"window_minutes": window_minutes, "bucket_seconds": int(width.total_seconds()), "series": series,
            "totals": {"payments": len(txns), "settle_p50_s": _percentile(latencies, 0.5),
                       "settle_p95_s": _percentile(latencies, 0.95)}}


@router.get("/v1/ops/overview", tags=["operations"])
def overview(p: Principal = Depends(authorised("backoffice:read"))):
    """One call for the Overview page. Every number comes from a system of record."""
    from ..rail import breaker, chaos
    from ..registry import registry
    with session_scope() as s:
        by_status = dict(s.execute(select(Transaction.status, func.count()).where(Transaction.type == "PAYMENT")
                                   .group_by(Transaction.status)).all())
        open_cases = dict(s.execute(select(Case.kind, func.count()).where(Case.state != "RESOLVED")
                                    .group_by(Case.kind)).all())
        overdue = s.execute(select(func.count()).select_from(Case).where(Case.state != "RESOLVED",
                                                                          Case.sla_due_at < now())).scalar_one()
        unassigned = s.execute(select(func.count()).select_from(Case).where(Case.state != "RESOLVED",
                                                                             Case.assigned_to.is_(None))).scalar_one()
        approvals = s.execute(select(func.count()).select_from(Approval).where(Approval.status == "REQUESTED")).scalar_one()
        kyc_referred = s.execute(select(func.count()).select_from(KYCApplication)
                                 .where(KYCApplication.state == "REFERRED")).scalar_one()
        last_run = s.execute(select(ReconRun).order_by(ReconRun.created_at.desc()).limit(1)).scalar_one_or_none()
        unacked = s.execute(select(func.count()).select_from(Transaction).where(
            Transaction.type == "PAYMENT", Transaction.status == "PENDING")).scalar_one()
        in_transit = ledger.ledger_balance(s, ledger.house_account(s, "2150"))
        checks = integrity.run(s)
    total = sum(by_status.values())
    paid = by_status.get("SETTLED", 0) + by_status.get("RECONCILED", 0)
    decided = paid + sum(by_status.get(k, 0) for k in FAILED)
    recon = None
    if last_run:
        sm = last_run.summary or {}
        recon = {"run_id": str(last_run.id), "file_id": last_run.file_id, "at": last_run.created_at.isoformat(),
                 "records": last_run.record_count, "match_rate": sm.get("match_rate"),
                 "breaks": sum(v for k, v in sm.items() if k not in ("MATCHED", "match_rate", "TIMING_DIFFERENCE")
                               and isinstance(v, int)), "summary": sm}
    return {
        "payments": {"total": total, "by_status": by_status, "settled": paid,
                     "success_rate": round(paid / decided, 4) if decided else None,
                     "in_flight": sum(by_status.get(k, 0) for k in ("CREATED", "VALIDATED", "AUTHORISED", "POSTED", "PENDING")),
                     "awaiting_rail_ack": unacked, "under_review": by_status.get("UNDER_REVIEW", 0)},
        "value_in_transit": money(in_transit),
        "human_work": {"open_cases": open_cases, "overdue": overdue, "unassigned": unassigned,
                       "approvals_waiting": approvals, "kyc_referred": kyc_referred},
        "rail": {"mode": chaos.state()["mode"], "breaker": breaker.state, "simulated": True},
        "registry": {"mode": registry.mode, "simulated": True},
        "integrity": {"overall": checks["overall"], "failing": [c for c in checks["checks"] if c["status"] != "PASS"],
                      "checked": len(checks["checks"])},
        "recon": recon, "generated_at": now().isoformat(),
    }


# ------------------------------------------------------------------ durable event history (outbox)
@router.get("/v1/events", tags=["operations"])
def event_history(type_prefix: str | None = Query(None, max_length=48), correlation_id: str | None = Query(None, max_length=64),
                  txn_ref: str | None = Query(None, max_length=32), before_seq: int | None = None,
                  limit: int = Query(100, ge=1, le=500), p: Principal = Depends(authorised("backoffice:read"))):
    with session_scope() as s:
        q = select(OutboxEvent)
        if type_prefix:
            q = q.where(OutboxEvent.event_type.startswith(type_prefix))
        if correlation_id:
            q = q.where(OutboxEvent.correlation_id == correlation_id)
        if txn_ref:
            q = q.where(OutboxEvent.payload["txn_ref"].astext == txn_ref)
        if before_seq:
            q = q.where(OutboxEvent.seq < before_seq)
        rows = s.execute(q.order_by(OutboxEvent.seq.desc()).limit(limit)).scalars().all()
        return [{"kind": "event", "event_id": str(e.event_id), "seq": e.seq, "type": e.event_type,
                 "occurred_at": e.occurred_at.isoformat(), "published_at": e.published_at.isoformat() if e.published_at else None,
                 "correlation_id": e.correlation_id, "payload": e.payload, "txn_ref": (e.payload or {}).get("txn_ref")}
                for e in rows]


# ------------------------------------------------------------------ reconciliation workspace
@router.get("/v1/finance/recon/runs/{run_id}/items", tags=["finance"])
def recon_items(run_id: uuid.UUID, category: str | None = None, p: Principal = Depends(authorised("backoffice:read"))):
    with session_scope() as s:
        run = s.get(ReconRun, run_id)
        if run is None:
            raise NotFound("reconciliation run not found")
        q = select(ReconItem, Transaction.txn_ref, Case).outerjoin(Transaction, Transaction.id == ReconItem.txn_id) \
            .outerjoin(Case, Case.id == ReconItem.case_id).where(ReconItem.run_id == run_id)
        if category:
            q = q.where(ReconItem.category == category)
        items = [{"id": str(i.id), "category": i.category, "txn_ref": ref, "rail_e2e_id": i.rail_e2e_id,
                  "internal": money(i.internal_amount_minor) if i.internal_amount_minor is not None else None,
                  "external": money(i.external_amount_minor) if i.external_amount_minor is not None else None,
                  "difference_minor": (i.external_amount_minor or 0) - (i.internal_amount_minor or 0),
                  "case": None if c is None else {"case_ref": c.case_ref, "state": c.state, "owner_role": c.owner_role,
                                                  "assigned_to": c.assigned_to, "resolution": c.resolution}}
                 for i, ref, c in s.execute(q.order_by(ReconItem.category)).all()]
        return {"run": {"id": str(run.id), "file_id": run.file_id, "business_date": run.business_date.isoformat(),
                        "records": run.record_count, "value_total": money(run.value_total_minor),
                        "file_sha256": run.file_sha256, "summary": run.summary, "run_by": run.run_by,
                        "at": run.created_at.isoformat()}, "items": items}


# ------------------------------------------------------------------ case management
def _case_audit(s, refs: list[str]) -> list[dict]:
    rows = s.execute(select(AuditLog).where(AuditLog.object_id.in_([r for r in refs if r]))
                     .order_by(AuditLog.id)).scalars().all()
    return [{"id": a.id, "actor": a.actor, "role": a.actor_role, "action": a.action, "outcome": a.outcome,
             "reason": a.reason, "at": a.created_at.isoformat(), "row_hash": a.row_hash[:16]} for a in rows]


@router.get("/v1/cases/{case_ref}", tags=["backoffice"])
def case_detail(case_ref: str, p: Principal = Depends(authorised("cases:read"))):
    with session_scope() as s:
        c = s.execute(select(Case).where(Case.case_ref == case_ref)).scalar_one_or_none()
        if c is None:
            raise NotFound("case not found")
        t = s.get(Transaction, c.txn_id) if c.txn_id else None
        app_ref = (c.details or {}).get("application_ref")
        sugg = s.execute(select(AISuggestion).where(AISuggestion.case_id == c.id)
                         .order_by(AISuggestion.created_at)).scalars().all()
        appr = s.execute(select(Approval).where(Approval.txn_id == c.txn_id)).scalars().all() if c.txn_id else []
        return {
            "case_ref": c.case_ref, "kind": c.kind, "state": c.state, "owner_role": c.owner_role, "summary": c.summary,
            "details": c.details, "resolution": c.resolution, "resolved_by": c.resolved_by,
            "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
            "assigned_to": c.assigned_to, "assigned_at": c.assigned_at.isoformat() if c.assigned_at else None,
            "sla_due_at": c.sla_due_at.isoformat(), "created_at": c.created_at.isoformat(),
            "overdue": c.state != "RESOLVED" and c.sla_due_at < now(),
            "txn": None if t is None else {"txn_ref": t.txn_ref, "status": t.status, "amount": money(t.amount_minor)},
            "application_ref": app_ref,
            "ai": [{"id": str(x.id), "engine": x.engine, "output": x.output, "abstained": x.abstained,
                    "reviewer_decision": x.reviewer_decision, "reviewer": x.reviewer, "at": x.created_at.isoformat()}
                   for x in sugg],
            "approvals": [{"id": str(a.id), "action": a.action, "status": a.status, "maker": a.requested_by,
                           "checker": a.approved_by, "reason": a.reason} for a in appr],
            "audit": _case_audit(s, [c.case_ref, t.txn_ref if t else None, app_ref]),
        }


class AssignIn(BaseModel):
    assignee: str = Field(min_length=2, max_length=64)


@router.post("/v1/cases/{case_ref}/assign", tags=["backoffice"])
def assign_case(case_ref: str, body: AssignIn, request: Request, p: Principal = Depends(authorised("cases:assign"))):
    """Give an open case to a named person in the owning role. Moves no money; fully audited."""
    with session_scope() as s:
        c = s.execute(select(Case).where(Case.case_ref == case_ref).with_for_update()).scalar_one_or_none()
        if c is None:
            raise NotFound("case not found")
        if p.role != c.owner_role:
            denied = True
        else:
            denied = False
            if c.state == "RESOLVED":
                raise InvalidState("case is already resolved")
            u = s.execute(select(User).where(User.username == body.assignee, User.active.is_(True))).scalar_one_or_none()
            if u is None or u.role != c.owner_role:
                raise ValidationFailed(f"assignee must be an active {c.owner_role} user")
            prev = c.assigned_to
            c.assigned_to, c.assigned_at = u.username, now()
            if c.state == "OPEN":
                c.state = "IN_REVIEW"
            audit.record(s, actor=p.username, actor_role=p.role, action="CASE_ASSIGN", object_type="case",
                         object_id=case_ref, details={"from": prev, "to": u.username},
                         correlation_id=request.state.correlation_id)
    if denied:
        with session_scope() as s:
            audit.record(s, actor=p.username, actor_role=p.role, action="CASE_ASSIGN", object_type="case",
                         object_id=case_ref, outcome="DENIED", reason="not the owning role",
                         correlation_id=request.state.correlation_id)
        raise Forbidden(f"only {c.owner_role} can assign this case")
    events.telemetry("human_gate", "case_assigned", detail={"case_ref": case_ref, "to": body.assignee, "by": p.username})
    return case_detail(case_ref, p)


# ------------------------------------------------------------------ audit and access
@router.get("/v1/audit/log", tags=["audit"])
def audit_log(actor: str | None = Query(None, max_length=64), action: str | None = Query(None, max_length=64),
              outcome: str | None = Query(None, pattern="^(ALLOWED|DENIED|ERROR)$"),
              object_id: str | None = Query(None, max_length=160), before_id: int | None = None,
              limit: int = Query(100, ge=1, le=500), p: Principal = Depends(authorised("audit:read"))):
    with session_scope() as s:
        q = select(AuditLog)
        if actor:
            q = q.where(AuditLog.actor.ilike(f"%{actor}%"))
        if action:
            q = q.where(AuditLog.action.ilike(f"%{action}%"))
        if outcome:
            q = q.where(AuditLog.outcome == outcome)
        if object_id:
            q = q.where(AuditLog.object_id == object_id)
        if before_id:
            q = q.where(AuditLog.id < before_id)
        ok, broken = audit.verify_chain(s)
        rows = s.execute(q.order_by(AuditLog.id.desc()).limit(limit)).scalars().all()
        return {"chain_intact": ok, "first_broken_row": broken,
                "items": [{"id": a.id, "actor": a.actor, "role": a.actor_role, "action": a.action,
                           "object_type": a.object_type, "object_id": a.object_id, "outcome": a.outcome,
                           "reason": a.reason, "channel": a.channel, "correlation_id": a.correlation_id,
                           "at": a.created_at.isoformat(), "row_hash": a.row_hash, "prev_hash": a.prev_hash}
                          for a in rows]}


@router.get("/v1/admin/access", tags=["audit"])
def access_matrix(p: Principal = Depends(authorised("access:read"))):
    with session_scope() as s:
        users = s.execute(select(User).order_by(User.role, User.username)).scalars().all()
        return {"roles": sorted({r for roles in PERMISSIONS.values() for r in roles}),
                "permissions": {k: sorted(v) for k, v in sorted(PERMISSIONS.items())},
                "users": [{"username": u.username, "display_name": u.display_name, "role": u.role, "active": u.active}
                          for u in users]}


@router.get("/v1/ops/staff", tags=["operations"])
def staff(role: str = Query(..., pattern="^(OPS|COMPLIANCE|FINANCE)$"), p: Principal = Depends(authorised("cases:read"))):
    """Who a case can be assigned to (names only)."""
    with session_scope() as s:
        return [{"username": u.username, "display_name": u.display_name}
                for u in s.execute(select(User).where(User.role == role, User.active.is_(True))
                                   .order_by(User.username)).scalars()]
