"""Financial reconciliation: internal ledger/transactions vs the rail's settlement file.

Categories (brief + Week 9): MATCHED, MISSING_EXTERNAL, MISSING_INTERNAL, DUPLICATE_EXTERNAL,
AMOUNT_MISMATCH, STATUS_MISMATCH, TIMING_DIFFERENCE. Every break becomes an owned case.
"""
import hashlib
import json
from collections import Counter
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from . import events, ledger
from .db import session_scope
from .errors import ValidationFailed
from .ledger import Line
from .config import get_settings
from .models import Case, Journal, ReconItem, ReconRun, Transaction, now
from .payments import open_case
from .state import transition

OWNER = {"MISSING_EXTERNAL": "OPS", "MISSING_INTERNAL": "FINANCE", "DUPLICATE_EXTERNAL": "OPS",
         "AMOUNT_MISMATCH": "FINANCE", "STATUS_MISMATCH": "FINANCE"}


class DuplicateFile(ValidationFailed):
    code = "DUPLICATE_SETTLEMENT_FILE"
    http_status = 409


def verify_control_totals(f: dict) -> None:
    """Batch control-file checks (Week 5): record count, value total and hash must match the trailer."""
    lines, trailer = f["lines"], f["trailer"]
    if trailer["record_count"] != len(lines):
        raise ValidationFailed("record count does not match trailer")
    if trailer["value_total_minor"] != sum(l["amount_minor"] for l in lines):
        raise ValidationFailed("value total does not match trailer")
    if hashlib.sha256(json.dumps(lines, sort_keys=True).encode()).hexdigest() != trailer["sha256"]:
        raise ValidationFailed("file hash does not match trailer")


def run(settlement_file: dict, *, actor: str) -> dict:
    biz_date = date.fromisoformat(settlement_file["header"]["business_date"])
    verify_control_totals(settlement_file)
    raw = json.dumps(settlement_file["lines"], sort_keys=True) + settlement_file["header"]["file_id"]
    file_sha = hashlib.sha256(raw.encode()).hexdigest()
    events.telemetry("recon", "run_started", detail={"file_id": settlement_file["header"]["file_id"],
                                                     "records": len(settlement_file["lines"])})
    counts: Counter = Counter()
    try:
        with session_scope() as s:
            rr = ReconRun(business_date=biz_date, file_id=settlement_file["header"]["file_id"], file_sha256=file_sha,
                          record_count=len(settlement_file["lines"]),
                          value_total_minor=sum(l["amount_minor"] for l in settlement_file["lines"]), run_by=actor)
            s.add(rr)
            s.flush()

            ext_counts = Counter(l["e2e_id"] for l in settlement_file["lines"])
            external = {l["e2e_id"]: l for l in settlement_file["lines"]}

            # Internal side: every payment that reached the rail on or before this business date.
            internal = s.execute(
                select(Transaction).where(
                    Transaction.type == "PAYMENT", Transaction.rail_e2e_id.is_not(None),
                    Transaction.status.in_(["PENDING", "SETTLED", "UNDER_REVIEW", "REVERSED"]),
                    func.date(Transaction.pending_since) <= biz_date,
                ).with_for_update()
            ).scalars().all()
            by_e2e = {t.rail_e2e_id: t for t in internal}

            def item(category: str, txn: Transaction | None, e2e: str, ext_amt: int | None) -> None:
                counts[category] += 1
                it = ReconItem(run_id=rr.id, category=category, txn_id=txn.id if txn else None, rail_e2e_id=e2e,
                               internal_amount_minor=txn.amount_minor if txn else None, external_amount_minor=ext_amt)
                s.add(it)
                s.flush()
                if category in OWNER:
                    c = open_case(s, kind="RECON_BREAK", txn=txn, owner_role=OWNER[category],
                                  summary=f"{category}: {txn.txn_ref if txn else e2e}",
                                  details={"category": category, "e2e_id": e2e, "internal_minor": it.internal_amount_minor,
                                           "external_minor": ext_amt, "business_date": biz_date.isoformat()},
                                  sla_minutes=24 * 60)
                    it.case_id = c.id
                events.telemetry("recon", category.lower(), txn_ref=txn.txn_ref if txn else None,
                                 detail={"e2e_id": e2e}, level="info" if category in ("MATCHED", "TIMING_DIFFERENCE") else "warn")

            for e2e, line in external.items():
                txn = by_e2e.get(e2e)
                if txn is None:
                    known = s.execute(select(Transaction).where(Transaction.rail_e2e_id == e2e)).scalar_one_or_none()
                    if known is None:
                        item("MISSING_INTERNAL", None, e2e, line["amount_minor"])
                        _park_in_suspense(s, e2e, line["amount_minor"], actor)
                    continue
                if ext_counts[e2e] > 1:
                    item("DUPLICATE_EXTERNAL", txn, e2e, line["amount_minor"])
                if line["amount_minor"] != txn.amount_minor:
                    item("AMOUNT_MISMATCH", txn, e2e, line["amount_minor"])
                elif txn.status == "SETTLED":
                    late = txn.recon_result in ("MISSING_EXTERNAL", "TIMING_DIFFERENCE")
                    if late:  # an earlier break is explained by this later file: close it with evidence
                        for c in s.execute(select(Case).where(Case.txn_id == txn.id, Case.kind == "RECON_BREAK",
                                                              Case.state != "RESOLVED")).scalars():
                            c.state, c.resolution, c.resolved_by, c.resolved_at = (
                                "RESOLVED", "MATCHED_IN_LATER_FILE", actor, now())
                    txn.recon_result = "MATCHED"
                    transition(s, txn, "RECONCILED", actor=actor, reason="matched_settlement_file",
                               evidence={"recon_run": str(rr.id), "file_id": rr.file_id})
                    item("MATCHED", txn, e2e, line["amount_minor"])
                elif txn.status in ("PENDING", "UNDER_REVIEW"):
                    # Settlement proof arrived before our status enquiry resolved it: the file IS the evidence.
                    from .payments import apply_rail_outcome
                    apply_rail_outcome(s, txn, "ACCEPTED", source="settlement_file", evidence={"file_id": rr.file_id})
                    txn.recon_result = "MATCHED"
                    transition(s, txn, "RECONCILED", actor=actor, reason="matched_settlement_file",
                               evidence={"recon_run": str(rr.id)})
                    item("MATCHED", txn, e2e, line["amount_minor"])
                elif txn.status == "REVERSED":
                    txn.recon_result = "STATUS_MISMATCH"
                    item("STATUS_MISMATCH", txn, e2e, line["amount_minor"])

            cutoff = get_settings().settlement_cutoff_utc_hour
            for e2e, txn in by_e2e.items():
                if e2e in external or txn.status != "SETTLED" or txn.recon_result == "MISSING_EXTERNAL":
                    continue
                settled_at = s.execute(select(Journal.created_at).where(Journal.txn_id == txn.id,
                                                                          Journal.posting_type == "SETTLE")).scalar()
                if settled_at and settled_at.date() == biz_date and settled_at.hour >= cutoff:
                    txn.recon_result = "TIMING_DIFFERENCE"  # settled after cut-off: expected in the next file
                    item("TIMING_DIFFERENCE", txn, e2e, None)
                else:
                    txn.recon_result = "MISSING_EXTERNAL"
                    item("MISSING_EXTERNAL", txn, e2e, None)

            matched = counts["MATCHED"]
            total = sum(counts.values()) or 1
            rr.summary = {**counts, "match_rate": round(matched / total, 4)}
            summary = {"run_id": str(rr.id), "file_id": rr.file_id, "business_date": biz_date.isoformat(),
                       "records": rr.record_count, "value_total_minor": rr.value_total_minor, **rr.summary}
            events.emit(s, "recon.completed", aggregate_id=rr.id, correlation_id=f"recon-{rr.id}", payload=summary)
    except IntegrityError as exc:
        if "file_sha256" in str(exc) or "recon_runs_file_sha256_key" in str(exc):
            events.telemetry("recon", "duplicate_file_refused", detail={"file_id": settlement_file["header"]["file_id"]},
                             level="warn")
            raise DuplicateFile("this settlement file has already been processed") from exc
        raise
    events.telemetry("recon", "run_completed", detail=summary)
    return summary


def _park_in_suspense(s, e2e: str, amount_minor: int, actor: str) -> None:
    """The rail says money left our settlement account for a payment we have no record of.
    Recognise it as a claim on the rail/partner until a human resolves it - never silently absorb it."""
    holder = Transaction(txn_ref=f"ADJ-{e2e[-10:]}", type="ADJUSTMENT", status="UNDER_REVIEW",
                         amount_minor=amount_minor, correlation_id=f"recon-{e2e}")
    s.add(holder)
    s.flush()
    ledger.post(s, txn_id=holder.id, posting_type="CLAIM", reason_code="UNMATCHED_RAIL_DEBIT", actor=actor,
                correlation_id=holder.correlation_id, initiated_via="BATCH",
                lines=[Line(ledger.house_account(s, "1400").id, "D", amount_minor),
                       Line(ledger.house_account(s, "1010").id, "C", amount_minor)])
