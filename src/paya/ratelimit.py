"""Rate limiting (ADR-016). Two layers:

1. Named limits on abuse-prone actions, kept in PostgreSQL so every API process shares them and a restart
   does not reset them: login attempts per client address, the per-username failure lockout, opening a
   wallet (onboarding) per client address, and assistant messages per customer. Sliding-window estimate:
   previous window weighted by its remaining overlap + the current window.
2. A per-client ceiling on every /v1 request (signed-in user, else client address), in process memory:
   cheap, and enough to stop a runaway script. In production this layer belongs at the gateway.

Keys are HMAC-SHA256 hashes with the server's secret: no raw address or username is stored.
Every refusal is a 429 RATE_LIMITED (or LOGIN_LOCKED) with Retry-After, and is logged and counted.
"""
import hashlib
import hmac
import threading
import time
from collections import defaultdict, deque

from sqlalchemy import delete, select, text

from . import events
from .config import get_settings
from .db import session_scope
from .errors import RateLimited
from .models import RateLimitCounter

# name -> (settings attribute for the limit, window seconds)
LIMITS = {
    "login_ip": ("rate_login_per_ip_per_minute", 60),
    "login_fail": ("login_max_failures", 900),
    "onboard_ip": ("rate_onboarding_per_ip_per_hour", 3600),
    "chat": ("rate_assistant_per_customer_per_minute", 60),
    "mfa": ("mfa_max_attempts", 300),
}


def _key(raw: str) -> str:
    secret = get_settings().jwt_secret.encode()
    return hmac.new(secret, raw.encode(), hashlib.sha256).hexdigest()[:32]


def _limit(scope: str) -> tuple[int, int]:
    attr, window = LIMITS[scope]
    return int(getattr(get_settings(), attr)), window


def _estimate(s, scope: str, kh: str, window: int, now: float) -> tuple[float, int]:
    cur = int(now // window) * window
    rows = dict(s.execute(select(RateLimitCounter.window_start, RateLimitCounter.count).where(
        RateLimitCounter.scope == scope, RateLimitCounter.key_hash == kh,
        RateLimitCounter.window_start.in_([cur, cur - window]))).all())
    overlap = 1 - (now - cur) / window
    return rows.get(cur - window, 0) * overlap + rows.get(cur, 0), cur


def _retry_after(scope: str, window: int, now: float) -> int:
    return max(1, int(window - (now % window)) if scope != "login_fail" else window)


def peek(scope: str, raw_key: str) -> bool:
    """True if the key is currently over its limit (does not count this call)."""
    if not get_settings().rate_limit_enabled:
        return False
    limit, window = _limit(scope)
    with session_scope() as s:
        est, _ = _estimate(s, scope, _key(raw_key), window, time.time())
    return est >= limit


def hit(scope: str, raw_key: str, *, raise_on_limit: bool = True) -> bool:
    """Count one event. Returns True if allowed. Over the limit: raises RateLimited (default)."""
    cfg = get_settings()
    if not cfg.rate_limit_enabled:
        return True
    limit, window = _limit(scope)
    kh, now = _key(raw_key), time.time()
    with session_scope() as s:
        est, cur = _estimate(s, scope, kh, window, now)
        allowed = est < limit
        if allowed:
            s.execute(text(
                "INSERT INTO rate_limit_counters (scope, key_hash, window_start, count) VALUES (:s, :k, :w, 1) "
                "ON CONFLICT (scope, key_hash, window_start) DO UPDATE SET count = rate_limit_counters.count + 1"),
                {"s": scope, "k": kh, "w": cur})
    if not allowed:
        events.telemetry("security", "rate_limited", detail={"scope": scope}, level="warn")
        _refusals[scope] += 1
        if raise_on_limit:
            raise RateLimited("too many requests; please wait and try again", scope=scope,
                              retry_after_s=_retry_after(scope, window, now))
    return allowed


def clear(scope: str, raw_key: str) -> None:
    with session_scope() as s:
        s.execute(delete(RateLimitCounter).where(RateLimitCounter.scope == scope,
                                                 RateLimitCounter.key_hash == _key(raw_key)))


def purge_expired() -> int:
    """Worker: drop windows older than the longest window plus one."""
    oldest = int(time.time()) - 2 * max(w for _, w in LIMITS.values())
    with session_scope() as s:
        return s.execute(delete(RateLimitCounter).where(RateLimitCounter.window_start < oldest)).rowcount


# ------------------------------------------------------------------ layer 2: per-client ceiling (in process)
class Ceiling:
    def __init__(self) -> None:
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, client: str, per_minute: int) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            q = self._hits[client]
            while q and now - q[0] >= 60:
                q.popleft()
            if len(q) >= per_minute:
                return False, max(1, int(60 - (now - q[0])) + 1)
            q.append(now)
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


ceiling = Ceiling()
_refusals: dict[str, int] = defaultdict(int)


def refusals() -> dict[str, int]:
    return dict(_refusals)


def client_address(request) -> str:
    """The caller's address. Behind a trusted reverse proxy, the first X-Forwarded-For hop (opt-in only:
    otherwise anyone could pick their own rate-limit key)."""
    if get_settings().trust_forwarded_for:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"
