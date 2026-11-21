"""Local load test (evidence for SLO/SLI; NOT a production capacity claim).

Phase A  steady load:        N payments, C concurrent customers, healthy rail
Phase B  duplicate-ack storm: M payments while the rail acknowledges every credit twice

Run with the velocity rule raised for the test only:
  PAYA_VELOCITY_MAX_PAYMENTS=100000 docker compose -f infra/docker-compose.yml --env-file .env up -d api
  python docs/architecture/tools/load_test.py
Writes evidence/performance/load-test-<date>.md
"""
import datetime as dt
import os
import statistics
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

B, PW = "http://localhost:8000", "paya-demo-2026"
N, M, C = int(os.getenv("N", 300)), int(os.getenv("M", 100)), int(os.getenv("C", 10))
OUT = Path(__file__).resolve().parents[3] / "evidence" / "performance"
OUT.mkdir(parents=True, exist_ok=True)
http = httpx.Client(timeout=30, limits=httpx.Limits(max_connections=C + 5))


def tok(u):
    return {"Authorization": "Bearer " + http.post(f"{B}/v1/auth/login", json={"username": u, "password": PW}).json()["access_token"]}


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else float("nan")


def psql(sql):
    return subprocess.run(["docker", "exec", "paya-db-1", "psql", "-U", "paya", "-d", "paya", "-tAc", sql],
                          check=True, capture_output=True, text=True).stdout.strip()


CUSTOMERS = int(os.getenv("CUSTOMERS", 40))


def ensure_load_customers(n: int) -> list[str]:
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from synthetic_customers import ensure
    return ensure([f"loadtest{i:03d}" for i in range(n)])


cashier, admin = tok("ayesha.cashier"), tok("admin")
customers = [tok(u) for u in ensure_load_customers(CUSTOMERS)]


def make_requests(n):
    t = time.perf_counter()
    ids, lat = [], []
    for _ in range(n):
        s = time.perf_counter()
        r = http.post(f"{B}/v1/payment-requests", headers=cashier, json={"amount_minor": 1_000, "order_ref": f"LT-{uuid.uuid4().hex[:10]}"})
        lat.append((time.perf_counter() - s) * 1000)
        ids.append(r.json()["id"])
    return ids, lat, time.perf_counter() - t


def run_phase(label, n):
    ids, pr_lat, _ = make_requests(n)

    def one(i):
        h = customers[i % len(customers)]
        s = time.perf_counter()
        r = http.post(f"{B}/v1/payments", headers={**h, "Idempotency-Key": uuid.uuid4().hex}, json={"payment_request_id": ids[i]})
        return (time.perf_counter() - s) * 1000, r.status_code, (r.json().get("txn_ref") if r.status_code == 202 else None)

    t0 = time.perf_counter()
    with ThreadPoolExecutor(C) as ex:
        res = list(ex.map(one, range(n)))
    wall = time.perf_counter() - t0
    refs = [x[2] for x in res if x[2]]
    deadline = time.time() + 120
    inlist = ",".join(f"'{r}'" for r in refs)
    while time.time() < deadline:
        left = int(psql(f"SELECT count(*) FROM transactions WHERE txn_ref IN ({inlist}) AND status NOT IN ('SETTLED','RECONCILED')"))
        if left == 0:
            break
        time.sleep(1)
    settle = [float(x) for x in psql(
        "SELECT extract(epoch FROM (j.created_at - t.created_at))*1000 FROM transactions t JOIN journals j ON j.txn_id=t.id "
        f"AND j.posting_type='SETTLE' WHERE t.txn_ref IN ({inlist})").split()]
    dup_settle = int(psql(f"SELECT count(*) FROM (SELECT t.id FROM transactions t JOIN journals j ON j.txn_id=t.id AND j.posting_type='SETTLE' WHERE t.txn_ref IN ({inlist}) GROUP BY t.id HAVING count(*)>1) x"))
    notif = int(psql(f"SELECT count(*) FROM notifications n JOIN transactions t ON t.id=n.txn_id WHERE t.txn_ref IN ({inlist}) AND n.template='payment.settled' AND n.recipient='CUSTOMER'"))
    lat = [x[0] for x in res]
    codes = {}
    for x in res:
        codes[x[1]] = codes.get(x[1], 0) + 1
    return {"label": label, "n": n, "wall_s": wall, "tps": n / wall, "codes": codes,
            "p50": pct(lat, 50), "p95": pct(lat, 95), "p99": pct(lat, 99), "max": max(lat),
            "pr_p95": pct(pr_lat, 95), "settled": len(settle), "settle_p50": pct(settle, 50), "settle_p95": pct(settle, 95),
            "dup_settle": dup_settle, "notifications": notif, "unsettled": len(refs) - len(settle)}


http.post(f"{B}/v1/chaos/rail", headers=admin, json={"mode": "NORMAL"})
A = run_phase("A steady load, healthy rail", N)
http.post(f"{B}/v1/chaos/rail", headers=admin, json={"mode": "DUPLICATE_ACK"})
Bp = run_phase("B duplicate-ack storm", M)
http.post(f"{B}/v1/chaos/rail", headers=admin, json={"mode": "NORMAL"})
time.sleep(3)
integ = http.get(f"{B}/v1/finance/integrity", headers=tok("rabia.finance")).json()
cpu = subprocess.run(["nproc"], capture_output=True, text=True).stdout.strip()

rows = ["| Phase | Payments | Concurrency | Throughput | p50 | p95 | p99 | max | HTTP codes | Settled | Settle p50 | Settle p95 | Duplicate SETTLE | Customer notices |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|"]
for r in (A, Bp):
    rows.append(f"| {r['label']} | {r['n']} | {C} | {r['tps']:.1f}/s | {r['p50']:.0f} ms | {r['p95']:.0f} ms | {r['p99']:.0f} ms | {r['max']:.0f} ms | "
                f"{r['codes']} | {r['settled']} | {r['settle_p50']:.0f} ms | {r['settle_p95']:.0f} ms | {r['dup_settle']} | {r['notifications']} |")
md = [f"# Load test - {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC", "",
      f"Environment: Docker Compose on a {cpu}-vCPU development container; one uvicorn process with its in-process worker; "
      f"PostgreSQL 16 in a sibling container; mock Raast rail; {CUSTOMERS} synthetic load-test customers. Velocity rule raised for the test only. "
      "**This measures the prototype on one machine. It is not a production capacity claim.**", "",
      "`POST /v1/payments` latency is client-measured end to end (includes idempotency, risk, posting and commit). "
      "Settle latency = SETTLE journal time - transaction creation time (database clock).", "", *rows, "",
      f"Payment-request creation p95 (cashier QR): {A['pr_p95']:.0f} ms.", "",
      f"Integrity checks after both phases: **{integ['overall']}** "
      f"({', '.join(c['check'] + '=' + c['status'] for c in integ['checks'] if c['status'] != 'PASS') or 'all checks PASS'})."]
path = OUT / f"load-test-{dt.date.today().isoformat()}.md"
path.write_text("\n".join(md) + "\n")
print("\n".join(md))
