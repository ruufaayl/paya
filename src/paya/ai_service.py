"""Runs the triage agent on human work cases and records everything. Reads only; writes only ai_suggestions,
the audit chain and telemetry. Money-moving functions are deliberately NOT imported here."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, events
from .ai_triage import ACTIONS, triage
from .config import get_settings
from .db import session_scope
from .errors import Forbidden, InvalidState, NotFound
from .models import AISuggestion, Case, Journal, ReconItem, Transaction, now
from .rail import RailPayment, chaos

AGENT = "ai-triage-agent"
TRIAGED_KINDS = {"RECON_BREAK", "PENDING_REVIEW"}
OVERRIDE_REASONS = {"WRONG_CAUSE", "WRONG_ACTION", "WRONG_OWNER", "MORE_EVIDENCE", "POLICY", "OTHER"}


def build_context(s: Session, case: Case) -> dict:
    """Minimum necessary data (Week 7 data minimisation). Every fact carries an evidence reference."""
    txn = s.get(Transaction, case.txn_id) if case.txn_id else None
    d = case.details or {}
    e2e = d.get("e2e_id") or (txn.rail_e2e_id if txn else None)
    rail = s.get(RailPayment, e2e) if e2e else None
    settle = s.execute(select(Journal).where(Journal.txn_id == txn.id, Journal.posting_type == "SETTLE")).scalar_one_or_none() if txn else None
    compliance = s.execute(select(Case.id).where(Case.txn_id == case.txn_id, Case.kind == "COMPLIANCE_HOLD")).first() if case.txn_id else None
    recon = s.execute(select(ReconItem).where(ReconItem.case_id == case.id)).scalar_one_or_none()
    evidence = {f"case:{case.case_ref}": case.summary}
    if txn:
        evidence[f"txn:{txn.txn_ref}"] = f"status {txn.status}, amount {txn.amount_minor}"
    if settle:
        evidence[f"journal:SETTLE:{txn.txn_ref}"] = f"settled at {settle.created_at.isoformat()}"
    if rail:
        evidence[f"rail:{e2e}"] = f"rail status {rail.status}, business date {rail.business_date}, in file {not rail.omit_from_file}"
    if recon:
        evidence[f"recon_item:{recon.id}"] = f"category {recon.category}"
    category = d.get("category") or ("PENDING_REVIEW" if case.kind == "PENDING_REVIEW" else case.kind)
    return {
        "category": category,
        "internal_status": txn.status if txn else None,
        "internal_amount_minor": d.get("internal_minor", txn.amount_minor if txn else None),
        "external_amount_minor": d.get("external_minor"),
        # Mock stand-in for a live status enquiry; an unreachable rail means the AI lacks evidence.
        "rail_enquiry": "UNAVAILABLE" if chaos.mode == "DOWN" else (rail.status if rail else ("NOT_FOUND" if e2e else None)),
        "settled_hour_utc": settle.created_at.hour if settle else None,
        "cutoff_hour_utc": get_settings().settlement_cutoff_utc_hour,
        "linked_compliance_case": bool(compliance),
        "creditor_alias": rail.creditor_alias if rail else None,  # untrusted text: data, never instructions
        "evidence": evidence,
    }


def triage_case(case_ref: str, actor: str = AGENT) -> dict:
    with session_scope() as s:
        case = s.execute(select(Case).where(Case.case_ref == case_ref)).scalar_one_or_none()
        if case is None:
            raise NotFound("case not found")
        if case.kind not in TRIAGED_KINDS:
            raise InvalidState("the AI agent only triages reconciliation breaks and pending reviews")
        ctx = build_context(s, case)
        sug, meta = triage(ctx)
        row = AISuggestion(case_id=case.id, engine=sug.engine, prompt_hash=meta["prompt_hash"],
                           input_refs={"evidence_refs": list(ctx["evidence"].keys())}, output=sug.to_dict(),
                           next_action=sug.next_action, confidence=sug.confidence, abstained=sug.abstained,
                           latency_ms=meta["latency_ms"], fallback_reason=meta["fallback_reason"])
        s.add(row)
        s.flush()
        audit.record(s, actor=actor, actor_role="AI_AGENT", action="AI_SUGGESTION", object_type="case",
                     object_id=case.case_ref, channel="WORKER",
                     details={"suggestion_id": str(row.id), "engine": sug.engine, "action": sug.next_action,
                              "confidence": sug.confidence, "abstained": sug.abstained, "prompt_hash": meta["prompt_hash"]})
        txn_ref = s.execute(select(Transaction.txn_ref).where(Transaction.id == case.txn_id)).scalar() if case.txn_id else None
        out = {"suggestion_id": str(row.id), "case_ref": case.case_ref, **sug.to_dict(), **meta}
    events.telemetry("ai", "abstained" if sug.abstained else "suggested", txn_ref=txn_ref,
                     detail={"case": case_ref, "action": sug.next_action, "confidence": sug.confidence,
                             "reasons": sug.abstain_reasons}, level="warn" if sug.abstained else "info")
    return out


def on_event(env: dict) -> None:
    """Auto-triage every new break or pending review (inbox de-duplicated)."""
    if env["type"] == "case.opened" and env["payload"].get("kind") in TRIAGED_KINDS:
        def handler(s: Session, e: dict) -> None:
            pass
        if events.consume_once(AGENT, env, handler):
            try:
                triage_case(env["payload"]["case_ref"])
            except Exception as exc:  # the agent failing must never affect payments
                events.telemetry("ai", "error", detail={"case": env["payload"].get("case_ref"), "error": str(exc)[:200]},
                                 level="error")


def register() -> None:
    events.subscribe(on_event)


def review(suggestion_id: uuid.UUID, *, decision: str, reviewer: str, reviewer_role: str,
           reason_code: str | None, note: str | None) -> dict:
    """Human decision on a suggestion. Accepting records agreement only - it moves no money."""
    with session_scope() as s:
        row = s.execute(select(AISuggestion).where(AISuggestion.id == suggestion_id).with_for_update()).scalar_one_or_none()
        if row is None:
            raise NotFound("suggestion not found")
        case = s.get(Case, row.case_id)
        if reviewer_role != case.owner_role:
            raise Forbidden(f"only the case owner ({case.owner_role}) may review this suggestion")
        if row.reviewer_decision:
            raise InvalidState("already reviewed")
        if decision == "OVERRIDDEN" and reason_code not in OVERRIDE_REASONS:
            raise InvalidState(f"an override needs a reason code: {sorted(OVERRIDE_REASONS)}")
        row.reviewer_decision, row.reviewer, row.override_reason, row.review_note, row.decided_at = (
            decision, reviewer, reason_code, note, now())
        audit.record(s, actor=reviewer, actor_role=reviewer_role, action=f"AI_SUGGESTION_{decision}", object_type="case",
                     object_id=case.case_ref, reason=reason_code, details={"suggestion_id": str(row.id), "note": note})
        return {"suggestion_id": str(row.id), "decision": decision, "case_ref": case.case_ref}


HANDOFF_RESOLUTIONS = {"CUSTOMER_CONTACTED", "NO_ACTION_NEEDED"}
RESOLUTIONS = {"MATCHED_IN_LATER_FILE", "RAIL_CONFIRMED_AND_REISSUED", "CLAIM_RAISED_WITH_PARTNER",
               "FEE_CONFIG_CORRECTED", "NO_ACTION_FALSE_BREAK", "WRITTEN_OFF_APPROVED"}


def resolve_case(case_ref: str, *, resolution: str, actor: str, actor_role: str, note: str) -> dict:
    """The case owner closes a reconciliation break with evidence. No money moves here: any correcting
    journal is a separate, approved posting."""
    if resolution not in RESOLUTIONS | HANDOFF_RESOLUTIONS:
        raise InvalidState(f"resolution must be one of {sorted(RESOLUTIONS | HANDOFF_RESOLUTIONS)}")
    with session_scope() as s:
        case = s.execute(select(Case).where(Case.case_ref == case_ref).with_for_update()).scalar_one_or_none()
        if case is None:
            raise NotFound("case not found")
        if case.kind not in ("RECON_BREAK", "SUPPORT_HANDOFF"):
            raise InvalidState("only reconciliation breaks and chat handoffs are closed here")
        allowed = HANDOFF_RESOLUTIONS if case.kind == "SUPPORT_HANDOFF" else RESOLUTIONS
        if resolution not in allowed:
            raise InvalidState(f"resolution must be one of {sorted(allowed)}")
        if actor_role != case.owner_role:
            raise Forbidden(f"only the case owner ({case.owner_role}) may resolve it")
        if case.state == "RESOLVED":
            raise InvalidState("already resolved")
        case.state, case.resolution, case.resolved_by, case.resolved_at = "RESOLVED", resolution, actor, now()
        audit.record(s, actor=actor, actor_role=actor_role, action="CASE_RESOLVED", object_type="case",
                     object_id=case_ref, reason=resolution, details={"note": note})
    events.telemetry("human_gate", "case_resolved", detail={"case_ref": case_ref, "resolution": resolution, "by": actor})
    return {"case_ref": case_ref, "state": "RESOLVED", "resolution": resolution}


assert "HUMAN_REVIEW" in ACTIONS
