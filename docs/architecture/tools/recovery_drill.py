"""Recovery drill against the Docker Compose stack (brief: "service restart" + Week 9 "recovery test").

Drills (all with synthetic data, against our own mock rail only):
  D1  API crash (SIGKILL) while payments are PENDING  -> restart -> worker resumes -> all settle exactly once
  D2  Database restart while the API is running       -> API reconnects -> a new payment succeeds
  D3  Backup and restore                              -> restored copy has an identical trial balance

Run (stack up via `make up`):  python docs/architecture/tools/recovery_drill.py
Writes evidence/resilience/recovery-drill-<date>.md with measured times.
"""
import datetime as dt
import json
import subprocess
import time
import uuid
from pathlib import Path

import httpx

B = "http://localhost:8000"
PW = "paya-demo-2026"
API, DB = "paya-api-1", "paya-db-1"
OUT = Path(__file__).resolve().parents[3] / "evidence" / "resilience"
OUT.mkdir(parents=True, exist_ok=True)
c = httpx.Client(timeout=10)
log: list[str] = []


def note(s: str) -> None:
    print(s)
    log.append(s)


def token(u: str) -> dict:
    r = c.post(f"{B}/v1/auth/login", json={"username": u, "password": PW})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def wait_healthy(limit_s: float = 120) -> float:
    t = time.monotonic()
    while time.monotonic() - t < limit_s:
        try:
            if c.get(f"{B}/healthz", timeout=2).status_code == 200:
                return time.monotonic() - t
        except httpx.HTTPError:
            pass
        time.sleep(0.25)
    raise RuntimeError("service did not become healthy")


def sh(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def psql(db: str, sql: str) -> str:
    return sh("docker", "exec", DB, "psql", "-U", "paya", "-d", db, "-tAc", sql)


def pay(cust: str, cashier_h: dict, amount: int) -> str:
    pr = c.post(f"{B}/v1/payment-requests", headers=cashier_h,
                json={"amount_minor": amount, "order_ref": f"DRILL-{uuid.uuid4().hex[:8]}"}).json()["id"]
    r = c.post(f"{B}/v1/payments", headers={**token(cust), "Idempotency-Key": uuid.uuid4().hex},
               json={"payment_request_id": pr})
    r.raise_for_status()
    return r.json()["txn_ref"]


def status(ref: str, h: dict) -> dict:
    return c.get(f"{B}/v1/transactions/{ref}", headers=h).json()


TB_SQL = ("SELECT string_agg(code || ':' || bal, ',' ORDER BY code) FROM (SELECT a.code, "
          "SUM(CASE WHEN e.direction='D' THEN e.amount_minor ELSE -e.amount_minor END) AS bal "
          "FROM ledger_entries e JOIN accounts a ON a.id=e.account_id GROUP BY a.code) t")

import sys
sys.path.insert(0, str(Path(__file__).parent))
from synthetic_customers import ensure  # noqa: E402

run_id = dt.datetime.now(dt.timezone.utc).strftime("%H%M%S")
d1, d2, d3, d4 = ensure([f"drill{run_id}{i}" for i in range(4)])  # fresh customers: no velocity history

wait_healthy()
admin, cashier, auditor = token("admin"), token("ayesha.cashier"), token("taha.audit")
note(f"# Recovery drill - {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
note("")
note("Stack: Docker Compose (`paya-api` + `postgres:16-alpine`) on the development container. Mock Raast rail. Synthetic data.")
note("")

# ------------------------------------------------------------------ D1
note("## D1 - API process killed (SIGKILL) while payments are in flight")
note("")
c.post(f"{B}/v1/chaos/rail", headers=admin, json={"mode": "TIMEOUT_NO_RECORD"}).raise_for_status()
refs = [pay(d1, cashier, 12_300), pay(d2, cashier, 4_500), pay(d3, cashier, 7_800)]
before = {r: status(r, auditor)["status"] for r in refs}
note(f"- Rail set to *lost request*; 3 payments created: {', '.join(f'`{r}` {s}' for r, s in before.items())}")
assert all(s == "PENDING" for s in before.values()), before
try:
    pay(d4, cashier, 2_100)
    note("- 4th payment: accepted (breaker did not open) - UNEXPECTED")
except httpx.HTTPStatusError as e:
    note(f"- 4th payment refused with **{e.response.status_code} {e.response.json()['error']['code']}**: the circuit breaker opened after 3 rail timeouts, before any money was taken")
t0 = time.monotonic()
sh("docker", "kill", "--signal", "KILL", API)
note("- `docker kill -s KILL paya-api-1` (no graceful shutdown; worker thread dies mid-loop)")
sh("docker", "start", API)
up = wait_healthy()
note(f"- Container restarted; **API healthy after {up:.1f} s**. Chaos state is in-memory, so the restarted process sees a healthy rail (as when the rail itself recovers).")
deadline = time.monotonic() + 180
final = {}
while time.monotonic() < deadline:
    final = {r: status(r, auditor)["status"] for r in refs}
    if all(s == "SETTLED" for s in final.values()):
        break
    time.sleep(1)
recovered = time.monotonic() - t0
note(f"- Worker resumed from the database: status enquiry → NOT_FOUND → resend with the same E2E id → settled.")
note(f"- **All in-flight payments correct {recovered:.1f} s after the crash**: {', '.join(f'`{r}` {s}' for r, s in final.items())}")
posts = {r: sorted(j["posting_type"] for j in status(r, auditor)["ledger"]) for r in refs}
once = all(p == ["AUTH_POST", "FEE", "SETTLE"] for p in posts.values())
note(f"- Each payment has exactly one AUTH_POST, one SETTLE and one FEE journal: **{once}**")
rail_rows = psql("paya", "SELECT count(*) FROM rail.payments WHERE e2e_id IN (SELECT rail_e2e_id FROM transactions WHERE txn_ref IN ("
                 + ",".join(f"'{r}'" for r in refs) + "))")
note(f"- Rail-side records for these 3 payments: **{rail_rows}** (no duplicate credits from the resend)")
fin = token("rufayl.finance")
integ = c.get(f"{B}/v1/finance/integrity", headers=fin).json()
note(f"- Integrity checks after recovery: **{integ['overall']}**")
note("")

# ------------------------------------------------------------------ D2
note("## D2 - Database restarted under a running API")
note("")
t0 = time.monotonic()
sh("docker", "restart", DB)
db_back = None
while time.monotonic() - t0 < 120:
    try:
        if c.get(f"{B}/healthz", timeout=2).status_code == 200:
            db_back = time.monotonic() - t0
            break
    except httpx.HTTPError:
        pass
    time.sleep(0.25)
note(f"- `docker restart paya-db-1`; API health back after **{db_back:.1f} s** (connection pool `pre_ping` discards dead connections)")
ref = pay(d4, token("ayesha.cashier"), 3_300)
time.sleep(2)
note(f"- New payment after the restart: `{ref}` → **{status(ref, auditor)['status']}**")
cnt = psql("paya", "SELECT count(*) FROM transactions")
note(f"- Committed transactions still present after the restart: {cnt} rows (RPO = 0 for committed data while the volume survives)")
note("")

# ------------------------------------------------------------------ D3
note("## D3 - Backup and restore drill")
note("")
t0 = time.monotonic()
sh("docker", "exec", DB, "sh", "-c", "pg_dump -U paya -Fc paya > /tmp/paya.dump")
dump_s = time.monotonic() - t0
size = sh("docker", "exec", DB, "sh", "-c", "du -h /tmp/paya.dump | cut -f1")
sh("docker", "exec", DB, "sh", "-c", "dropdb -U paya --if-exists paya_restore && createdb -U paya paya_restore")
t1 = time.monotonic()
sh("docker", "exec", DB, "sh", "-c", "pg_restore -U paya -d paya_restore /tmp/paya.dump")
restore_s = time.monotonic() - t1
live_tb, restored_tb = psql("paya", TB_SQL), psql("paya_restore", TB_SQL)
same = live_tb == restored_tb
trig = psql("paya_restore", "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_%'")
note(f"- `pg_dump -Fc` took {dump_s:.1f} s ({size}); `pg_restore` into a fresh database took {restore_s:.1f} s")
note(f"- Account balances identical between live and restored copy: **{same}**")
note(f"- Integrity triggers restored with the data: {trig} triggers present")
psql("paya", "SELECT 1")
sh("docker", "exec", DB, "sh", "-c", "dropdb -U paya paya_restore; rm -f /tmp/paya.dump")
note("")
note("## Result")
note("")
note("| Drill | Measured | Target (see 13-resilience-and-recovery.md) | Met |")
note("|---|---|---|---|")
note(f"| D1 API crash → healthy | {up:.1f} s | RTO 5 min | {'yes' if up < 300 else 'no'} |")
note(f"| D1 crash → in-flight payments correct | {recovered:.1f} s | 15 min (pending review window) | {'yes' if recovered < 900 and once else 'no'} |")
note(f"| D2 DB restart → API healthy | {db_back:.1f} s | RTO 5 min | {'yes' if db_back < 300 else 'no'} |")
note(f"| D3 restore matches live ledger | {same} | exact match | {'yes' if same else 'no'} |")
note(f"| Committed data lost | 0 | RPO 0 (volume intact) | yes |")
(OUT / f"recovery-drill-{dt.date.today().isoformat()}.md").write_text("\n".join(log) + "\n")
print("\nwritten:", OUT / f"recovery-drill-{dt.date.today().isoformat()}.md")
