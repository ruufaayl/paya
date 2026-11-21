# Existing product audit (before Paya 2.0)

**Audited:** commit `ac5164d` on `main`, 2026-11-21. Working tree clean. **Test baseline:** 47 backend tests pass (`pytest`); web `tsc -b && vite build` passes; CI green. The revamp is on branch `revamp/paya-2`.

This audit separates what **works end to end** from what is **only drawn on screen**.

## 1. Architecture as built

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18.3, TypeScript 5.6, Vite 5.4, Tailwind 3.4, framer-motion 11, @xyflow/react 12.3, lucide-react, jsQR, qrcode.react, react-router 6.30 | One SPA, three surfaces: landing `/`, phone PWA `/app/*`, Mission Control `/control` |
| Backend | Python 3.12+, FastAPI 0.165 / Starlette 1.10, SQLAlchemy 2, psycopg 3, Pydantic 2 | Modular monolith (ADR-001), synchronous commands, background worker thread |
| Database | PostgreSQL 16 | Schemas `public` (Paya), `rail` (simulated Raast), `registry` (simulated identity registry). Integrity enforced by triggers and constraints (`db.py: INTEGRITY_DDL`) |
| Events | Transactional outbox → in-process relay → consumers with inbox (`processed_events`); live WebSocket `/v1/stream` | Two message kinds: domain **events** (persisted in `outbox_events`) and **telemetry** (in-memory ring buffer, not persisted) |
| Auth | Local JWT (HS256, 60 min), Argon2 passwords, login lockout (5 failures / 15 min) | 8 roles + a scoped `APPLICANT` token for onboarding |
| AI | Reconciliation-triage agent: rules first, optional Ollama LLM behind guardrails, suggestions only | Never on KYC cases; no money-moving capability |
| Dev / deploy | Docker Compose (Postgres + API), Makefile, GitHub Actions CI (backend, web, image), PWA intended for Vercel | Face models fetched by `make models` with pinned SHA-256 |

## 2. Feature inventory: real or only visual?

| Feature | Status | Evidence |
|---|---|---|
| Double-entry ledger, append-only, balanced per journal | **Real**, DB-enforced | `ledger.py`, triggers; tests S1–S13 |
| Payment state machine with optimistic versioning and history | **Real** | `state.py`, `transaction_status_history` |
| Idempotency (HTTP key + one live payment per QR + one posting per type + rail E2E) | **Real** | `idempotency.py`, partial unique indexes |
| Simulated Raast rail with 9 chaos modes, circuit breaker, status enquiry | **Real (simulated rail)** | `rail.py`; UI exposes 8 of 9 modes (`DELAYED_ACK` is missing from the UI) |
| Compliance hold / release / reject | **Real** | `payments.compliance_decide` |
| Reversal maker-checker (Ops → Finance), DB `CHECK` | **Real** | S6, S6b, S6c |
| Reconciliation: file hash dedupe, control totals, 7 categories, break cases | **Real**, but **no UI to see results** beyond a toast | `recon.py`; `GET /v1/finance/recon/runs` exists, no item-level endpoint |
| Integrity monitor (14 checks, 4 layers) | **Real**, not shown anywhere in the UI | `GET /v1/finance/integrity` |
| Hash-chained audit log | **Real**; only chain verification is exposed | `GET /v1/audit/verify`; no log listing endpoint |
| AI triage + human review + case resolution | **Real** | `ai_service.py`, Mission Control card |
| Digital onboarding & KYC, two-person rule | **Real** (real face models; simulated registry) | `kyc.py`, K1–K15, browser e2e |
| Mission Control service map | **Partly real.** Animations come from real telemetry, but node colour is "last event seen", not service health. Two nodes are static. No search, filter or inspector for nodes | `graph.tsx` |
| Mission Control "LIVE" metrics | **Real**, polled every 2.5 s from `/v1/metrics/summary` | |
| Transaction search | **Missing.** The only way in is clicking a reference in the feed | |
| Event history | **Missing.** The live feed is lost on refresh (last 200 messages replayed from memory) | |
| Case assignment / ownership by person | **Missing.** Cases have `owner_role` only | |
| Charts / trends | **Missing** | |
| Customer receipt | **Missing.** There is a "What Paya did" timeline, but no receipt | |
| Customer sign-in | Persona picker using the shared demo password; new onboarded users sign in at the end of onboarding | |
| Mission Control identity | Silently logs in as `auditor` for reads and as named personas for each button. **The operator never chooses who they are**, so role boundaries are invisible in the UI (the server still enforces them) | `panels.tsx` |

## 3. Frontend screens

**Phone app** (`/app`): persona picker → customer home (gradient balance card, scan-to-pay, activity) → scan (camera + jsQR, UUID-only parser) → pay (slide to pay, stable idempotency key) → live tracker (`TxnLive`, polls every 2 s + stream). Cashier till: keypad → QR → PAID with voice. Onboarding: consent → details → specimen card → liveness → result.

**Mission Control** (`/control`): a single page with a left panel (payment generator, rail chaos, registry chaos, operations), a centre React Flow map (17 nodes), and a right panel (human gates, live feed, transaction inspector drawer).

**Landing** (`/`): marketing-style entry with an API URL setting.

## 4. Backend services (`src/paya`)

`payments` (initiate, authorise and post, dispatch, rail outcomes, settle, reverse, enquiries, expiry, compliance), `ledger`, `state`, `risk`, `rail`, `recon`, `integrity`, `events`, `notifications`, `idempotency`, `security`, `audit`, `observability`, `worker`, `ai_triage`/`ai_service`, `kyc`/`kyc_engines`/`registry`, `seed`.

## 5. API contracts (41 operations; `api/openapi.json`)

Auth (`/v1/auth/login`, `/v1/me`); merchant (payment requests, merchant transactions); payments (`POST /v1/payments`, `/v1/wallet`, `/v1/transactions/{ref}`); back office (cases, compliance holds, enquiries, reversal requests, approvals); finance (recon run/runs, trial balance, integrity); AI (triage, review, metrics); cases resolve; audit verify; metrics summary; onboarding (6) and KYC back office (4); chaos (rail, registry, duplicate event); stream; health; Prometheus metrics.

## 6. Database entities (24 tables + 2 simulator schemas)

`users, customers, consents, merchants, accounts, journals, ledger_entries, holds, payment_requests, transactions, transaction_status_history, idempotency_records, screening_results, cases, approvals, outbox_events, processed_events, notifications, recon_runs, recon_items, audit_log, ai_suggestions, kyc_applications, kyc_checks`; `rail.payments`, `rail.callbacks`; `registry.identities`.

## 7. Business workflows (all working)

QR payment (happy path, retry, double tap) · compliance hold → release/reject · rail timeout → PENDING → enquiry → settle/resend · rail outage → circuit breaker → refusal before debit · rail reject → compensating reversal · pending > 15 min → Ops case → maker-checker reversal · daily recon → breaks → AI suggestion → owner resolves · duplicate file refused · duplicate event ignored · onboarding → auto-approve or referral → compliance (two-person for screening hits).

## 8. Visual and interaction deficiencies

1. **Neon green everywhere.** `#2EE58C` is the brand, the success colour, the primary button, the "info" pulse and the "healthy" node. Positive-looking but non-final states (rail accepted) look the same as final ones.
2. **Fonts depend on a CDN.** Inter and JetBrains Mono come from Google Fonts at runtime (five weights each), so an installed PWA opened offline falls back to system fonts, and every first load makes third-party requests. Tabular numerals are used only where a `num` class was remembered.
3. **Tiny type in Mission Control:** 10–11.5 px labels for operational data; graph node text unreadable at fit-to-screen.
4. **Decorative surfaces:** gradient balance card with a blurred blob, "aurora" backgrounds, glassmorphism tab bar.
5. **Mission Control has no information architecture.** Everything is on one screen. Reconciliation, audit, integrity, KYC history and AI metrics have no home. The right panel mixes approvals, cases and the feed.
6. **Map semantics are misleading.** A node turns green after any info event; there is no distinction between static architecture and observed runtime state. No legend for node status. No search, filter or node inspector.
7. **Operator identity is hidden.** Buttons labelled "Approve as Hamza" hard-code personas; the two-person rule is demonstrated by having two buttons rather than two signed-in people.
8. **No receipts, no amount review step,** and the payment result relies on one large animation.
9. **Colour-only status** on graph nodes and some chips.
10. **No reduced-motion handling;** perpetual animations (pulse rings, scanning line, spinning rings).
11. Several 403 responses show raw codes in toasts (`FORBIDDEN: role ...`).
12. **Onboarding copy** states "Photos are never kept" without pointing to proof (the proof exists: test K9).

## 9. Technical limitations

- No client-side cache layer: every component polls on its own timers (2 s, 2.5 s, 5 s), duplicating requests.
- `panels.tsx` (≈400 lines) and `Onboarding.tsx` (≈450 lines) are large single-file components.
- Live telemetry is not persisted; only outbox events are durable.
- No endpoint for transaction search, event history, recon items, audit log, case detail/assignment, or time series.
- The stream sends the last 200 in-memory messages on connect; the client does not de-duplicate by `event_id`.
- No frontend tests; browser coverage comes from rehearsal scripts.

## 10. Components that must be preserved (do not casually modify)

`ledger.py`, `state.py` transitions, `payments.py` (posting, dispatch, locks, reversal, compliance), `idempotency.py`, `rail.py` semantics and chaos modes, `recon.py`, `integrity.py`, `audit.py` hash chain, `events.py` outbox/inbox, `security.py` permission matrix (only extend), `kyc.py` decision rules and the two-person constraint, `INTEGRITY_DDL`, and all 47 tests.

## 11. Opportunities

- A real design system (tokens, typography, components) shared by the wallet and the console, with different density.
- Mission Control as a multi-page operations platform: Overview, Transactions, Topology, Rail lab, KYC, Cases, Reconciliation, AI, Event stream, Audit & access.
- Read-only backend extensions (search, history, time series, recon items, audit log, case detail) plus one control (case assignment), all behind existing permissions.
- A signed-in operator with an explicit "acting as" identity, so the server's role checks become visible.
- A light, calm customer wallet with an authoritative receipt; the dark, dense theme reserved for operations.
