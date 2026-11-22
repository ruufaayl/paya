# Member E (Mudaser Waleed, 24i-5681): rail, resilience, events, observability, Mission Control

**Read:**
- `src/paya/rail.py`: `MockRaastRail`, `Chaos`, `CircuitBreaker`
- `src/paya/events.py`: outbox, `relay_once`, `consume_once`
- `src/paya/worker.py`
- `src/paya/observability.py`
- `web/src/pages/control/graph.tsx`: `effectOf`
- `docs/architecture/12-observability-and-slos.md`, `13-resilience-and-recovery.md`, `14-runbooks.md`
- ADR-004, ADR-005, ADR-009

## 90-second explanation
> "The rail sits behind a port with a simulator that has nine failure modes, so every failure in the brief is reproducible. A circuit breaker refuses new payments before debiting when the rail is down. Events go through a transactional outbox, so a committed change can never lose its event. Consumers keep an inbox, so duplicates have no effect. The worker resumes everything from the database after a crash. We measured it: healthy in 1.3 s, every payment settled exactly once. Mission Control shows real events only."

## Questions you must handle

| Question | Answer |
|---|---|
| What is the outbox pattern and why? | The event row is written in the same DB transaction as the state change. The relay publishes it at least once, so we never commit without the event (Week 5) |
| How are duplicate events made harmless? | `processed_events(consumer, event_id)` primary key, written in the consumer's own transaction; a duplicate fails the insert and is skipped (`test_s3_*`) |
| What does the circuit breaker protect? | After 3 failures it OPENs. New payments get 503 **before** any debit; it half-opens after 30 s |
| RTO and RPO? | API 5 min (measured 1.3 s); DB RPO 0 for committed data while the volume survives, ≤ 24 h if the volume is lost (daily dump); in-flight payments correct within 15 min (measured 6 s) |
| Why are your SLOs credible? | Measured by `load_test.py` and `recovery_drill.py`; stated as prototype numbers on one machine, not production claims |
| Why only ~14 payments/s? | ~70 ms per payment in one Python process (60 ms before every request checked its session for instant revocation: a deliberate ~12% trade); extra latency at c=10 is queueing. Scaling path: more processes plus a separate worker (now safe thanks to the row locks) |
| Is Mission Control scripted? | No. `effectOf()` maps live WebSocket events and telemetry to animations; refresh it and it shows the replay buffer |
| How do you trace one payment in the logs? | `correlation_id` on every request log line and in-request telemetry; worker lines join on `txn_ref` |

## Paya 2.0 additions (also yours)

- **Mission Control 2.0:** `web/src/console/` (operator gate and shell, live stream de-duplicated by event id with reconnect and pause, inspectors, ten pages). Topology separates static architecture from observed runtime and never claims "healthy" from a colour.
- **Rail lab:** all nine simulated rail scenarios, expected behaviour mapped to tests, trigger, observed outcome, recovery tools.
- **Frontend architecture:** `docs/revamp/FRONTEND_ARCHITECTURE.md` (TanStack Query cache, Radix dialogs, self-hosted fonts, SVG charts), `MOTION_DESIGN_SYSTEM.md`, `ACCESSIBILITY_REVIEW.md` (axe 0 violations).
- **Stablecoin sandbox (Theme 5), yours:** `src/paya/chain.py`, `tokens.py`, ADR-014, doc 20, tests SC1–SC12. Know: why it is **off by default** (PVARA/SBP; `PAYA_STABLECOIN_SANDBOX`); why the token is worthless and faucet-only with no rupee conversion (SC4, SC12); why "confirmed" means 3 confirmations and what a reorg does (SC6); how Paya reconciles its records against the chain (SC11); screening, limits and the travel rule (SC7, SC8); why chain-down means "nothing sent" (SC10). Likely questions: "Why not a real testnet?" (control, chaos testing, and no risk of looking like a real deployment). "Could this become a digital-rupee rail?" (yes: an approved instrument plugs in behind the same submit/mine/status/balance port, with screening, finality and reconciliation already there). "Why no stablecoin savings?" (yield is not an EMI product).
- **Rehearsal:** `docs/architecture/tools/demo_rehearsal.cjs` drives the whole demo and asserts every claim.
