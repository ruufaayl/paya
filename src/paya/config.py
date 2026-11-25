"""Runtime configuration. All values come from environment variables (see .env.example)."""
import os
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PAYA_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://paya@localhost:5433/paya"
    # Schema owner, used only to run migrations. Unset = same as database_url (single-role dev mode).
    migration_database_url: str | None = None
    app_db_password: str | None = None   # creates the app role if missing (migration step only)
    migrate_on_start: bool = True        # dev/tests: the API migrates itself. Compose: a separate one-shot job does
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

    # Rate limiting (ADR-016). Limits are per sliding window; raise them (not disable) for load tests.
    rate_limit_enabled: bool = True
    rate_login_per_ip_per_minute: int = 30
    login_max_failures: int = 5                    # per username per 15 minutes, then locked
    rate_onboarding_per_ip_per_hour: int = 10
    rate_assistant_per_customer_per_minute: int = 20
    rate_title_fetch_per_customer_per_minute: int = 20   # account-name lookups (stops enumerating the directory)
    rate_general_per_client_per_minute: int = 600   # every /v1 call, per signed-in user (else per address)
    trust_forwarded_for: bool = False              # only behind a reverse proxy you control

    # Sessions and staff MFA (ADR-017)
    mfa_enforced: bool | None = None         # None = enforced unless demo_mode; enrolled staff always need a code
    mfa_encryption_key: str | None = None    # base64 32 bytes for AES-GCM; dev fallback derives one from jwt_secret
    mfa_challenge_minutes: int = 5
    mfa_max_attempts: int = 5                # code attempts per user per 5 minutes

    @field_validator("mfa_enforced", "mfa_encryption_key", "migration_database_url", "app_db_password", mode="before")
    @classmethod
    def _empty_is_unset(cls, v):
        return None if v == "" else v   # docker compose passes "" for an unset ${VAR:-}

    # Live feed: persist telemetry so every instance can serve it (/v1/live). On by default on Vercel only:
    # a single local process does not need it, and it costs a small write per telemetry message.
    live_feed_persist: bool = False

    # Stablecoin sandbox (Theme 5). OFF unless explicitly enabled. Test tokens only; no rupee conversion.
    stablecoin_sandbox: bool = False
    token_confirmations: int = 3             # "confirmed" only at this depth (a reorg can undo less)
    token_block_seconds: float = 2.0         # simulated block interval (worker)
    token_max_txn_units: int = 10_000_00     # 10,000 test tokens per transfer (hundredths)
    token_daily_max_units: int = 25_000_00
    token_faucet_units: int = 1_000_00       # once per 24 h
    token_travel_rule_units: int = 1_000_00  # external transfers at or above this need beneficiary details


def on_vercel() -> bool:
    return bool(os.getenv("VERCEL"))   # set by Vercel at build and run time


def _platform_database_url() -> str | None:
    """Vercel Marketplace Postgres (e.g. Neon) injects DATABASE_URL / POSTGRES_URL. Use it when PAYA_DATABASE_URL
    is not set, with the psycopg driver."""
    for key in ("DATABASE_URL", "POSTGRES_URL"):
        url = os.getenv(key)
        if url:
            for prefix in ("postgres://", "postgresql://"):
                if url.startswith(prefix):
                    return "postgresql+psycopg://" + url[len(prefix):]
            return url
    return None


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not os.getenv("PAYA_DATABASE_URL"):
        url = _platform_database_url()
        if url:
            s.database_url = url
    if on_vercel() and not os.getenv("PAYA_JWT_SECRET") and os.getenv("DATABASE_URL"):
        # No explicit secret: derive a stable one from a secret the platform already holds privately (the database
        # connection string includes its password). Same on every instance, never public; an explicit
        # PAYA_JWT_SECRET always wins, and rotating the database password rotates this key.
        import hashlib
        import hmac
        s.jwt_secret = hmac.new(os.environ["DATABASE_URL"].encode(), b"paya-jwt-signing-key-v1", hashlib.sha256).hexdigest()
    if on_vercel() and (s.jwt_secret == "dev-only-change-me" or len(s.jwt_secret) < 32):
        # The development default is public in the repository: anyone could forge sign-in tokens with it.
        raise RuntimeError("PAYA_JWT_SECRET must be set to 32+ random characters in the Vercel project settings")
    if on_vercel() and not os.getenv("PAYA_LIVE_FEED_PERSIST"):
        s.live_feed_persist = True
    if on_vercel() and not os.getenv("PAYA_KYC_MODEL_DIR"):
        s.kyc_model_dir = "/tmp/paya-models"   # the only writable place; models are fetched there on first use
    return s
