"""Runtime configuration. All values come from environment variables (see .env.example)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PAYA_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://paya@localhost:5433/paya"
    jwt_secret: str = "dev-only-change-me"  # overridden via env in every non-dev environment
    jwt_ttl_minutes: int = 60
    demo_mode: bool = True  # enables chaos controls and synthetic seed users

    # Business rules (configuration, not code - Week 6 "configure first")
    rules_version: str = "rules.v1"
    fee_bps: int = 50                      # synthetic merchant discount rate: 0.50%
    tier1_max_txn_minor: int = 25_000_00   # PKR 25,000 per payment for tier-1 wallets (synthetic)
    tier2_max_txn_minor: int = 500_000_00  # PKR 500,000 (synthetic)
    velocity_max_payments: int = 5         # per customer per window
    velocity_window_seconds: int = 600
    hold_ttl_seconds: int = 1800
    payment_request_ttl_seconds: int = 900

    # Rail behaviour
    rail_timeout_seconds: float = 8.0      # Week 9 outage scenario: 8 s
    enquiry_backoff_seconds: tuple[int, ...] = (5, 15, 45, 120, 300)
    pending_review_after_seconds: int = 900
    settlement_cutoff_utc_hour: int = 16  # 21:00 Pakistan time

    # Digital onboarding & KYC (Theme 1). Synthetic identities only; images are never stored.
    kyc_rules_version: str = "kyc.v1"
    kyc_pepper: str = "dev-only-kyc-pepper"     # keyed hash for identity numbers and image digests
    kyc_face_engine: str = "opencv"            # opencv | none (tests inject a mock)
    kyc_model_dir: str = "models"
    kyc_face_match_threshold: float = 0.363   # SFace cosine threshold published with the model
    kyc_face_grey_zone: float = 0.30          # below the threshold but above this: human review
    kyc_liveness_turn_ratio: float = 0.18     # nose offset / eye distance for a head turn
    kyc_liveness_centre_ratio: float = 0.10
    kyc_challenge_ttl_seconds: int = 120
    kyc_max_liveness_attempts: int = 3
    kyc_max_document_attempts: int = 5
    kyc_screening_threshold: float = 0.85     # fuzzy name similarity that counts as a potential match
    kyc_require_geolocation: bool = True
    kyc_abandon_after_hours: int = 72
    kyc_session_minutes: int = 30
    kyc_welcome_credit_minor: int = 5_000_00  # demo mode only: synthetic credit so a new wallet can pay


@lru_cache
def get_settings() -> Settings:
    return Settings()
