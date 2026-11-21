# Engineering evidence pack

The brief (§10) asks for: test results, API collection, performance/resilience evidence, logs/traces and screenshots.
**Everything here was produced by running the system.** Every file can be regenerated with the command shown.

| Evidence | File(s) | How to regenerate |
|---|---|---|
| Automated test results (90 tests: the 10 brief scenarios, 3 Week 9 scenarios, concurrency, security, AI, onboarding/KYC K1–K15, operations API O1–O9, assistant C1–C10, green banking G1–G11, super app P1–P13, stablecoin sandbox SC1–SC12, migrations and roles M1–M6) | [tests/](tests/) | `make test` |
| Continuous integration | [GitHub Actions](https://github.com/ruufaayl/paya/actions) (green on every push) | push to `main` |
| API collection and run (16 requests, all assertions pass) | [api/bruno-run.txt](api/bruno-run.txt), [api/bruno-junit.xml](api/bruno-junit.xml); collection in [`/api/bruno`](../api/bruno/) | `cd api/bruno && npx @usebruno/cli run --env local` |
| API contract | [`/api/openapi.json`](../api/openapi.json), [`/api/events/`](../api/events/) | `make openapi` |
| Performance (load test, c=1 and c=10, duplicate-ack storm) | [performance/](performance/) | `docs/architecture/tools/load_test.py` |
| Resilience (SIGKILL crash, DB restart, backup/restore) | [resilience/](resilience/) | `docs/architecture/tools/recovery_drill.py` |
| Logs and traces (one payment followed end to end) | [logs/](logs/) | `docker logs paya-api-1` filtered by `txn_ref` / `correlation_id` |
| Ledger worked examples (system-generated postings, trial balance, integrity) | [ledger/worked-examples.md](ledger/worked-examples.md) | `docs/architecture/tools/ledger_examples.py` |
| Security: dependency audits | [security/](security/) | `pip-audit`, `npm audit --omit=dev` |
| AI triage evaluation (120 labelled cases, 8 metrics) | [ai/evaluation.md](ai/evaluation.md) | `docs/architecture/tools/ai_eval.py` |
| Demo rehearsal (6 scenes, every claim asserted) | [demo/](demo/) | `make demo-reset && make rehearse` |
| Reproducibility (fresh clone; CI) | [reproducibility/](reproducibility/) | see file |
| Screenshots (phone app, cashier, Mission Control, AI) | [screenshots/](screenshots/), [demo/](demo/) | demo rehearsal |

## Evidence by rubric criterion

| Criterion (marks) | Strongest evidence |
|---|---|
| Architecture and bounded contexts (15) | `docs/architecture/02`, `04`, `05`, `06`; ADR-001, ADR-005 |
| Integration contracts and transaction integrity (20) | OpenAPI + event schemas; Bruno run (replay, 409 second tap); tests S2–S5, S11; `test_concurrent_*`; ADR-003, ADR-006, ADR-007 |
| Ledger, data and reconciliation (15) | `ledger/worked-examples.md`; tests S10, S13, `test_integrity_*`; `docs/architecture/07`–`09` |
| Security, KYC/AML and access governance (15) | tests S6–S8, `test_security_observability.py`; audit chain verify; threat model (`11`); dependency audits |
| Resilience, observability and testing (15) | `resilience/`, `performance/`, `logs/`; `docs/architecture/12`–`14`; CI |
| Implementation and reproducibility (10) | `reproducibility/`; `make verify`; CI |
| Responsible AI extension (5) | `ai/evaluation.md`; `tests/test_ai_triage.py`; `docs/architecture/15` |
| Technical communication and viva (5) | `docs/deliverables/`, `docs/demo/`, `docs/viva/` |

**Theme 1, onboarding & KYC:** see [`kyc/README.md`](kyc/README.md).

**Paya 2.0 and Theme 3 (conversational banking):** `revamp/e2e-results.json` (33/33), `revamp/assistant-e2e.json` (8/8), `revamp/a11y-axe.json` (0 violations), screenshots in `screenshots/revamp/` and `screenshots/assistant/`. See `docs/revamp/TESTING_REPORT.md`.

**Theme 2 (green banking):** `revamp/green-e2e.json` (14/14), screenshots in `screenshots/green/`; the axe scan now covers 20 screens with 0 violations.

**Theme 4 (super app):** `revamp/services-e2e.json` (14/14), screenshots in `screenshots/services/`.

**Database roles (ADR-015):** `security/db-roles-2026-11-21.md`, run against the real Docker Compose stack: the migrate job runs as the owner; the API connects only as `paya_app`, which is refused UPDATE/DELETE on evidence, ALTER, DROP, TRUNCATE and CREATE.

**Theme 5 (stablecoin sandbox, off by default):** `revamp/sandbox-e2e.json` (3/3 with the flag off, 10/10 with it on), screenshots in `screenshots/sandbox/`. The axe scan covers 22 screens with 0 violations.
