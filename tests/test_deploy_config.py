"""Deployment configuration stays consistent with the code (Vercel services, ADR-018)."""
import json
import pathlib
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_vercel_service_requirements_mirror_pyproject():
    deps = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"]
    req = [l.strip() for l in (ROOT / "src" / "requirements.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
    assert req == deps


def test_vercel_routes_every_api_prefix_to_the_api_service_and_the_spa_to_web():
    cfg = json.loads((ROOT / "vercel.json").read_text())
    rw = cfg["rewrites"]
    to_api = {r["source"] for r in rw if r["destination"]["service"] == "api"}
    assert {"/v1/(.*)", "/healthz", "/docs", "/openapi.json", "/metrics"} <= to_api
    assert rw[-1] == {"source": "/(.*)", "destination": {"service": "web"}}          # catch-all last
    from paya.api.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    assert all(p.startswith("/v1/") or p in {"/healthz", "/metrics", "/docs", "/openapi.json", "/docs/oauth2-redirect", "/redoc"}
               for p in paths if p), sorted(p for p in paths if not p.startswith("/v1/"))


def test_database_url_from_the_platform_is_used_with_the_psycopg_driver(monkeypatch):
    from paya import config
    monkeypatch.delenv("PAYA_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@host.neon.tech/db?sslmode=require")
    assert config._platform_database_url() == "postgresql+psycopg://u:p@host.neon.tech/db?sslmode=require"


def test_on_vercel_the_public_default_jwt_secret_is_refused(monkeypatch):
    import pytest
    from paya import config
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("PAYA_JWT_SECRET", "dev-only-change-me")   # the public default (beats any local .env)
    config.get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="PAYA_JWT_SECRET"):
            config.get_settings()
        monkeypatch.setenv("PAYA_JWT_SECRET", "x" * 40)
        config.get_settings.cache_clear()
        assert config.get_settings().jwt_secret == "x" * 40
    finally:
        monkeypatch.delenv("VERCEL")
        config.get_settings.cache_clear()


def test_on_vercel_without_a_jwt_secret_one_is_derived_from_the_private_database_url(monkeypatch):
    from paya import config
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("PAYA_JWT_SECRET", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgres://u:secret-pw@host/db")
    config.get_settings.cache_clear()
    try:
        a = config.get_settings().jwt_secret
        config.get_settings.cache_clear()
        assert a == config.get_settings().jwt_secret and len(a) == 64 and "secret-pw" not in a   # stable, not the password
        monkeypatch.setenv("DATABASE_URL", "postgres://u:other-pw@host/db")
        config.get_settings.cache_clear()
        assert config.get_settings().jwt_secret != a
    finally:
        monkeypatch.delenv("VERCEL")
        config.get_settings.cache_clear()
