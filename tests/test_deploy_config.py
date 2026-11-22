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
