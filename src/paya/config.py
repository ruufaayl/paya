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


@lru_cache
def get_settings() -> Settings:
    return Settings()
