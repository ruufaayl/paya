"""Structured JSON logging and lightweight request metrics (no external agent needed).

Every log line is one JSON object with a correlation_id, so a single payment can be followed across
the gateway, the worker and the rail. Sensitive keys are scrubbed before anything is written.
"""
import json
import logging
import re
import sys
import threading
import time
from collections import defaultdict
from contextvars import ContextVar

# Correlation id of the request being served; lets business telemetry share the request's id.
current_correlation: ContextVar[str | None] = ContextVar("paya_correlation", default=None)

SENSITIVE_KEYS = re.compile(r"pass(word)?|token|secret|authorization|cnic|iban|pin|otp|idempotency", re.I)
LATENCY_BUCKETS_MS = (25, 50, 100, 250, 500, 1000, 2500, 8000)


def scrub(obj):
    """Mask values of sensitive keys anywhere in a nested structure."""
    if isinstance(obj, dict):
        return {k: ("***" if SENSITIVE_KEYS.search(str(k)) else scrub(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    return obj


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
                "level": record.levelname.lower(), "logger": record.name, "msg": record.getMessage()}
        extra = getattr(record, "fields", None)
        if extra:
            base.update(scrub(extra))
        return json.dumps(base, default=str, separators=(",", ":"))


class _StdoutHandler(logging.StreamHandler):
    """Always writes to the *current* sys.stdout (container log driver, or a test's capture)."""

    @property
    def stream(self):  # type: ignore[override]
        return sys.stdout

    @stream.setter
    def stream(self, _value):
        pass


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger("paya")
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    h = _StdoutHandler()
    h.setFormatter(JsonFormatter())
    root.addHandler(h)
    root.setLevel(level)
    root.propagate = False


log = logging.getLogger("paya")


def emit(msg: str, level: str = "info", **fields) -> None:
    if "correlation_id" not in fields and current_correlation.get():
        fields["correlation_id"] = current_correlation.get()
    getattr(log, level if level in ("info", "warning", "error") else "info")(msg, extra={"fields": fields})


class RequestMetrics:
    """Counters and a latency histogram per route, exported in Prometheus text format."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.count: dict = defaultdict(int)          # (route, method, status_class) -> n
        self.buckets: dict = defaultdict(lambda: [0] * (len(LATENCY_BUCKETS_MS) + 1))
        self.sum_ms: dict = defaultdict(float)

    def observe(self, route: str, method: str, status: int, ms: float) -> None:
        key = (route, method)
        with self._lock:
            self.count[(route, method, f"{status // 100}xx")] += 1
            self.sum_ms[key] += ms
            b = self.buckets[key]
            for i, edge in enumerate(LATENCY_BUCKETS_MS):
                if ms <= edge:
                    b[i] += 1
            b[-1] += 1  # +Inf

    def prometheus(self) -> list[str]:
        out = ["# TYPE paya_http_requests_total counter"]
        with self._lock:
            for (route, method, sc), n in sorted(self.count.items()):
                out.append(f'paya_http_requests_total{{route="{route}",method="{method}",status="{sc}"}} {n}')
            out.append("# TYPE paya_http_request_duration_ms histogram")
            for (route, method), b in sorted(self.buckets.items()):
                for edge, n in zip(LATENCY_BUCKETS_MS, b):
                    out.append(f'paya_http_request_duration_ms_bucket{{route="{route}",method="{method}",le="{edge}"}} {n}')
                out.append(f'paya_http_request_duration_ms_bucket{{route="{route}",method="{method}",le="+Inf"}} {b[-1]}')
                out.append(f'paya_http_request_duration_ms_sum{{route="{route}",method="{method}"}} {self.sum_ms[(route, method)]:.1f}')
                out.append(f'paya_http_request_duration_ms_count{{route="{route}",method="{method}"}} {b[-1]}')
        return out

    def reset(self) -> None:
        with self._lock:
            self.count.clear(); self.buckets.clear(); self.sum_ms.clear()


metrics = RequestMetrics()


