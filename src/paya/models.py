"""Relational model. Every table here is a system of record for exactly one bounded context.

Money is always stored as integer paisa (amount_minor) in PKR. Never floats.
"""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Identity, Index, Integer, String,
    Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> uuid.UUID:
    return uuid.uuid4()


UUIDPK = lambda: mapped_column(UUID(as_uuid=True), primary_key=True, default=uid)  # noqa: E731
TS = lambda: mapped_column(DateTime(timezone=True), default=now, nullable=False)  # noqa: E731


# ---------------------------------------------------------------- Identity & access
class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = UUIDPK()
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"))
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("merchants.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = TS()
    __table_args__ = (
        CheckConstraint(
            "role IN ('CUSTOMER','CASHIER','MERCHANT_ADMIN','OPS','COMPLIANCE','FINANCE','SYSADMIN','AUDITOR')",
            name="ck_user_role",
        ),
    )


# ---------------------------------------------------------------- Customer & merchant master (CRM-lite)
class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[uuid.UUID] = UUIDPK()
    full_name: Mapped[str] = mapped_column(String(128), nullable=False)
    mobile_masked: Mapped[str] = mapped_column(String(32), nullable=False)  # synthetic, display-only
    idv_token: Mapped[str | None] = mapped_column(String(64), unique=True)  # tokenised identity ref; never a CNIC
    kyc_tier: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    kyc_status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)
    risk_rating: Mapped[str] = mapped_column(String(8), default="LOW", nullable=False)
    created_at: Mapped[datetime] = TS()
    __table_args__ = (
        CheckConstraint("kyc_tier BETWEEN 0 AND 2", name="ck_kyc_tier"),
        CheckConstraint("kyc_status IN ('PENDING','VERIFIED','REFERRED','REJECTED')", name="ck_kyc_status"),
    )


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[uuid.UUID] = UUIDPK()
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)  # SERVICE | MARKETING | PARTNER_SHARING
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # PUSH | EMAIL | CHAT
    granted_at: Mapped[datetime] = TS()
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Merchant(Base):
    __tablename__ = "merchants"
    id: Mapped[uuid.UUID] = UUIDPK()
    registration_ref: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # dup merchant = dup payout risk
    trading_name: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    raast_alias: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    settlement_iban_masked: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", nullable=False)
    created_at: Mapped[datetime] = TS()


# ---------------------------------------------------------------- Ledger (financial system of record)
class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[uuid.UUID] = UUIDPK()
    code: Mapped[str] = mapped_column(String(16), nullable=False)  # chart-of-accounts code, e.g. 2100
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    owner_type: Mapped[str | None] = mapped_column(String(16))  # CUSTOMER | MERCHANT | None (house account)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = TS()
    __table_args__ = (
        CheckConstraint("type IN ('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY')", name="ck_account_type"),
        UniqueConstraint("code", "owner_type", "owner_id", name="uq_account_owner"),
    )


class Journal(Base):
    """One balanced accounting event. UNIQUE(txn_id, posting_type) makes every posting happen at most once."""
    __tablename__ = "journals"
    id: Mapped[uuid.UUID] = UUIDPK()
    txn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), nullable=False)
    posting_type: Mapped[str] = mapped_column(String(24), nullable=False)
    booking_date: Mapped[date] = mapped_column(Date, nullable=False)
    value_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason_code: Mapped[str] = mapped_column(String(48), nullable=False)
    initiated_via: Mapped[str] = mapped_column(String(16), nullable=False)  # API | WORKER | BATCH | MANUAL_APPROVED
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(64))
    rule_version: Mapped[str] = mapped_column(String(16), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = TS()
    __table_args__ = (
        UniqueConstraint("txn_id", "posting_type", name="uq_journal_once_per_posting"),
        CheckConstraint(
            "posting_type IN ('AUTH_POST','SETTLE','FEE','REVERSAL','REFUND','ADJUSTMENT','CLAIM','TOPUP')",
            name="ck_posting_type",
        ),
    )


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    journal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("journals.id"), nullable=False, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(1), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = TS()
    __table_args__ = (
        CheckConstraint("direction IN ('D','C')", name="ck_entry_direction"),
        CheckConstraint("amount_minor > 0", name="ck_entry_positive"),
    )


class Hold(Base):
    """Funds reserved at authorisation. Available balance = ledger balance - active holds."""
    __tablename__ = "holds"
    id: Mapped[uuid.UUID] = UUIDPK()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    txn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), unique=True, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="ACTIVE", nullable=False)  # ACTIVE|RELEASED|CONSUMED
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = TS()


# ---------------------------------------------------------------- Payments (transaction system of record)
class PaymentRequest(Base):
    """A merchant's dynamic QR / Request-to-Pay. Its id is the business idempotency anchor."""
    __tablename__ = "payment_requests"
    id: Mapped[uuid.UUID] = UUIDPK()
    merchant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("merchants.id"), nullable=False)
    order_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="PKR", nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="DYNAMIC_QR", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="OPEN", nullable=False)  # OPEN|PAID|EXPIRED|CANCELLED
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = TS()
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_pr_amount"),
        CheckConstraint("currency = 'PKR'", name="ck_pr_currency"),
        UniqueConstraint("merchant_id", "order_ref", name="uq_pr_order"),
    )


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[uuid.UUID] = UUIDPK()
    txn_ref: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # immutable business reference
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # PAYMENT | REVERSAL | REFUND | TOPUP
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # optimistic concurrency
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="PKR", nullable=False)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"), index=True)
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("merchants.id"), index=True)
    payment_request_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("payment_requests.id"))
    original_txn_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id"))
    rail: Mapped[str] = mapped_column(String(16), default="RAAST", nullable=False)
    rail_e2e_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    rail_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_enquiry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    pending_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recon_result: Mapped[str | None] = mapped_column(String(24))
    failure_reason: Mapped[str | None] = mapped_column(String(64))
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = TS()
    updated_at: Mapped[datetime] = TS()
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_txn_amount"),
        CheckConstraint("currency = 'PKR'", name="ck_txn_currency"),
        CheckConstraint("type IN ('PAYMENT','REVERSAL','REFUND','TOPUP','ADJUSTMENT')", name="ck_txn_type"),
        CheckConstraint(
            "status IN ('CREATED','VALIDATED','AUTHORISED','POSTED','PENDING','SETTLED','RECONCILED',"
            "'UNDER_REVIEW','REVERSED','REJECTED','FAILED','EXPIRED','COMPLETED')",
            name="ck_txn_status",
        ),
        CheckConstraint("type IN ('PAYMENT','TOPUP','ADJUSTMENT') OR original_txn_id IS NOT NULL", name="ck_correction_links_original"),
        Index("ix_txn_status", "status"),
    )


class TransactionStatusHistory(Base):
    """Append-only event log: case id, activity, timestamp, resource, object (Week 2 event-log fields)."""
    __tablename__ = "transaction_status_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    txn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16), nullable=False)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(String(128), nullable=False)
    evidence: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = TS()


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_keys"
    principal: Mapped[str] = mapped_column(String(64), primary_key=True)
    operation: Mapped[str] = mapped_column(String(64), primary_key=True)
    idem_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # IN_PROGRESS | COMPLETED
    response_code: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = TS()


# ---------------------------------------------------------------- Risk & compliance
class ScreeningResult(Base):
    __tablename__ = "screening_results"
    id: Mapped[uuid.UUID] = UUIDPK()
    txn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), nullable=False, index=True)
    outcome: Mapped[str] = mapped_column(String(8), nullable=False)  # PASS | HOLD | REJECT
    rules_fired: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    data_used: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = TS()


class Case(Base):
    """Human work item: compliance holds, pending reviews, reconciliation breaks."""
    __tablename__ = "cases"
    id: Mapped[uuid.UUID] = UUIDPK()
    case_ref: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)  # COMPLIANCE_HOLD | PENDING_REVIEW | RECON_BREAK
    txn_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id"), index=True)
    owner_role: Mapped[str] = mapped_column(String(16), nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="OPEN", nullable=False)  # OPEN|IN_REVIEW|RESOLVED
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    resolution: Mapped[str | None] = mapped_column(String(48))
    resolved_by: Mapped[str | None] = mapped_column(String(64))
    assigned_to: Mapped[str | None] = mapped_column(String(64))  # the person working it (Paya 2.0)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sla_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = TS()
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Approval(Base):
    """Maker-checker. The database refuses a checker who is also the maker."""
    __tablename__ = "approvals"
    id: Mapped[uuid.UUID] = UUIDPK()
    action: Mapped[str] = mapped_column(String(32), nullable=False)  # REVERSAL | REFUND
    txn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(12), default="REQUESTED", nullable=False)
    created_at: Mapped[datetime] = TS()
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("approved_by IS NULL OR approved_by <> requested_by", name="ck_maker_checker"),
    )


# ---------------------------------------------------------------- Events (transactional outbox / inbox)
class OutboxEvent(Base):
    __tablename__ = "outbox"
    event_id: Mapped[uuid.UUID] = UUIDPK()
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    aggregate_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    occurred_at: Mapped[datetime] = TS()
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class ProcessedEvent(Base):
    __tablename__ = "processed_events"
    consumer: Mapped[str] = mapped_column(String(48), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    processed_at: Mapped[datetime] = TS()


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = UUIDPK()
    txn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), nullable=False, index=True)
    recipient: Mapped[str] = mapped_column(String(16), nullable=False)  # CUSTOMER | MERCHANT
    template: Mapped[str] = mapped_column(String(48), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    source_event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = TS()


# ---------------------------------------------------------------- Reconciliation
class ReconRun(Base):
    __tablename__ = "recon_runs"
    id: Mapped[uuid.UUID] = UUIDPK()
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    file_id: Mapped[str] = mapped_column(String(64), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)  # same file twice = refused
    record_count: Mapped[int] = mapped_column(Integer, nullable=False)
    value_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    summary: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    run_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = TS()


class ReconItem(Base):
    __tablename__ = "recon_items"
    id: Mapped[uuid.UUID] = UUIDPK()
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recon_runs.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(24), nullable=False)
    txn_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id"))
    rail_e2e_id: Mapped[str | None] = mapped_column(String(40))
    internal_amount_minor: Mapped[int | None] = mapped_column(BigInteger)
    external_amount_minor: Mapped[int | None] = mapped_column(BigInteger)
    case_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("cases.id"))
    created_at: Mapped[datetime] = TS()
    __table_args__ = (
        CheckConstraint(
            "category IN ('MATCHED','MISSING_EXTERNAL','MISSING_INTERNAL','DUPLICATE_EXTERNAL',"
            "'AMOUNT_MISMATCH','STATUS_MISMATCH','TIMING_DIFFERENCE')",
            name="ck_recon_category",
        ),
    )


# ---------------------------------------------------------------- Audit (tamper-evident)
class AuditLog(Base):
    """Who / what / when / why / how / evidence. Each row hashes the previous row (hash chain)."""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    object_type: Mapped[str] = mapped_column(String(32), nullable=False)
    object_id: Mapped[str | None] = mapped_column(String(160))
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)  # ALLOWED | DENIED | ERROR
    reason: Mapped[str | None] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # API | WORKER | BATCH | CHAT
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    row_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = TS()


# ---------------------------------------------------------------- AI (suggestions only - never authority)
class AISuggestion(Base):
    """Every AI output, its inputs (by reference), engine, prompt hash and the human decision on it."""
    __tablename__ = "ai_suggestions"
    id: Mapped[uuid.UUID] = UUIDPK()
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cases.id"), nullable=False, index=True)
    engine: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    input_refs: Mapped[dict] = mapped_column(JSONB, nullable=False)
    output: Mapped[dict] = mapped_column(JSONB, nullable=False)
    next_action: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(nullable=False)
    abstained: Mapped[bool] = mapped_column(Boolean, nullable=False)
    latency_ms: Mapped[float] = mapped_column(nullable=False)
    fallback_reason: Mapped[str | None] = mapped_column(Text)
    reviewer_decision: Mapped[str | None] = mapped_column(String(12))  # ACCEPTED | OVERRIDDEN
    reviewer: Mapped[str | None] = mapped_column(String(64))
    override_reason: Mapped[str | None] = mapped_column(String(48))
    review_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = TS()
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("reviewer_decision IS NULL OR reviewer_decision IN ('ACCEPTED','OVERRIDDEN')", name="ck_ai_decision"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_ai_confidence"),
    )


# ---------------------------------------------------------------- Digital onboarding & KYC (Theme 1)
class KYCApplication(Base):
    """One attempt to open a wallet. Holds decisions and evidence about images, never the images themselves.

    Biometric data (photos, face templates) is processed in memory and discarded in the same request.
    Identity numbers are stored only as a keyed hash, so duplicates can be found without keeping the number.
    """
    __tablename__ = "kyc_applications"
    id: Mapped[uuid.UUID] = UUIDPK()
    ref: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="STARTED", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    full_name: Mapped[str] = mapped_column(String(128), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    mobile_masked: Mapped[str] = mapped_column(String(32), nullable=False)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text)  # moved to users on approval, then cleared
    consent_version: Mapped[str] = mapped_column(String(16), nullable=False)
    biometric_consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    id_number_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    document_digest: Mapped[str | None] = mapped_column(String(64))
    document_data: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)  # extracted fields, no number
    challenge: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)  # nonce, steps, expiry, used
    document_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    liveness_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    geolocation: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)  # rounded to ~1 km
    decision: Mapped[str | None] = mapped_column(String(16))  # AUTO_APPROVED | APPROVED | REJECTED | MORE_INFO
    decision_reasons: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    decided_by: Mapped[str | None] = mapped_column(String(64))
    recommended_by: Mapped[str | None] = mapped_column(String(64))  # first officer on a two-person decision
    recommendation: Mapped[str | None] = mapped_column(String(16))
    tier_granted: Mapped[int | None] = mapped_column(Integer)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"))
    case_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("cases.id"))
    rule_version: Mapped[str] = mapped_column(String(16), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = TS()
    updated_at: Mapped[datetime] = TS()
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("state IN ('STARTED','DOCUMENT_OK','REFERRED','APPROVED','REJECTED','MORE_INFO','ABANDONED')",
                        name="ck_kyc_app_state"),
        CheckConstraint("decided_by IS NULL OR recommended_by IS NULL OR decided_by <> recommended_by",
                        name="ck_kyc_two_person"),
        CheckConstraint("tier_granted IS NULL OR tier_granted BETWEEN 1 AND 2", name="ck_kyc_tier_granted"),
    )


class KYCCheck(Base):
    """One automated check on an application: outcome, score, engine and the evidence used (no images)."""
    __tablename__ = "kyc_checks"
    id: Mapped[uuid.UUID] = UUIDPK()
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kyc_applications.id"), nullable=False, index=True)
    check: Mapped[str] = mapped_column(String(24), nullable=False)
    outcome: Mapped[str] = mapped_column(String(8), nullable=False)  # PASS | REFER | FAIL | ERROR
    score: Mapped[float | None] = mapped_column()
    engine: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(64))
    evidence: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    input_digest: Mapped[str | None] = mapped_column(String(64))  # keyed hash of the image, not the image
    created_at: Mapped[datetime] = TS()
    __table_args__ = (CheckConstraint("outcome IN ('PASS','REFER','FAIL','ERROR')", name="ck_kyc_check_outcome"),)


# ---------------------------------------------------------------- Conversational banking (Theme 3)
class Conversation(Base):
    """A customer's chat with the Paya Assistant. Text is stored only AFTER redaction; purged after retention."""
    __tablename__ = "conversations"
    id: Mapped[uuid.UUID] = UUIDPK()
    ref: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), nullable=False, index=True)
    handoff_case_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("cases.id"))
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime] = TS()
    last_at: Mapped[datetime] = TS()


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[uuid.UUID] = UUIDPK()
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # USER | ASSISTANT
    text: Mapped[str] = mapped_column(Text, nullable=False)        # redacted
    intent: Mapped[str | None] = mapped_column(String(24))
    tools: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)       # read-only tools used
    redactions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)  # kinds removed, never values
    created_at: Mapped[datetime] = TS()
    __table_args__ = (CheckConstraint("role IN ('USER','ASSISTANT')", name="ck_chat_role"),)
