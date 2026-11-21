# Paya

**Payment pakka hai.** Paya is a Raast person-to-merchant (P2M) payment assurance platform. When a customer pays a shop by scanning a QR code, the cashier sees **PAID** only once the money has actually moved and been recorded in a double-entry ledger. Customer screens, screenshots and notifications are never treated as proof of payment.

> **Academic prototype – CS3017 Enterprise Systems & Applications, Fall 2026.**
> Team: Rufayl Waseem (24i-5660), Taha Ali (24i-5525), Harris Safi (24i-5652), Kanz ur Rehman (24i-5544), Mudaser Waleed (24i-5681).
> All people, merchants, aliases and IBANs are synthetic. **No real money moves.** The Raast rail is a local simulator. Paya does not claim to describe the internal systems of SBP, any bank, EMI or PSP. Its architecture is a *proposed reference architecture*.

## The problem

Pakistani merchants increasingly take Raast QR payments, but a cashier usually confirms a payment by looking at the customer's phone screen or an SMS. Settlement credits then arrive with no link back to orders, and reconciliation is done by hand. Paya makes the **ledger the only source of payment truth**, reconciles it against the rail's settlement file, and puts every exception into a queue with a named owner.

## Architecture in one picture

```
Wallet / Cashier / Back office  ──►  API gateway façade (auth, idempotency, correlation ID)
                                          │
                                   Transaction state machine ──► KYC/AML/fraud rules
                                          │
                              Double-entry ledger (PostgreSQL, append-only, balanced)
                                          │
                     Transactional outbox ──► consumers (notifications, live stream)
                                          │
                               RailPort ──► Mock Raast rail (separate schema, chaos modes)
                                          │
                     Reconciliation (settlement file vs ledger) ──► owned exception cases
```

Lifecycle: `CREATED → VALIDATED → AUTHORISED → POSTED → PENDING → SETTLED → RECONCILED`, with `UNDER_REVIEW` (holds and uncertainty) and `REVERSED` (compensating journal). See `src/paya/state.py`.

## Run it

**Option A: one command (Docker).**
```bash
cp .env.example .env   # then set PAYA_JWT_SECRET to 32+ random characters
make up                # Postgres + API on http://localhost:8000  (docs at /docs)
```

**Option B: local Python.** Needs PostgreSQL. Set `PAYA_DATABASE_URL` to point at it.
```bash
make setup && make run
```

Demo logins all use the password `paya-demo-2026` (synthetic, demo mode only):

| User | Role |
|---|---|
| `sara`, `omar` | Customers (verified) |
| `zarak` | Customer who triggers the synthetic watch-list hold |
| `hina` | Customer who is not KYC-verified |
| `ayesha.cashier`, `bilal.admin` | Chai Junction cashier / merchant admin |
| `sana.ops`, `faisal.ops` | Operations (request reversals, status enquiries) |
| `hamza.compliance` | Compliance (release or reject holds) |
| `nadia.compliance` | Compliance (second officer for the onboarding two-person rule) |
| `rabia.finance` | Finance (approve reversals, run reconciliation) |
| `admin` | System administrator (chaos controls only, no financial actions) |
| `auditor` | Read-only, verifies the audit hash chain |

## Phone app and Mission Control (`/web`)

`/web` is one React app with two surfaces that share one design system (**Paya 2.0**, see `docs/revamp/`):

- **`/app` (Paya Wallet)** is a light, mobile-first PWA for customers. It covers sign-in, digital onboarding, home (available, ledger and reserved balances), activity, scan or pick a till, review and authorise, an authoritative payment result with timeline, money trail and receipt, and the account screen. Cashiers get the till: keypad, Raast QR, and **PAID** only after settlement.
- **`/control` (Mission Control)** is a dark operations console. You sign in as a synthetic staff member, and every action runs as that person and is checked by the server. Pages: Overview, Transactions, System topology, Event stream, Cases & approvals, Identity & KYC, Reconciliation, AI operations, Rail lab, Audit & access.

```bash
cd web && npm install && npm run dev      # http://localhost:5173  (API defaults to http://localhost:8000)
```

### Demo on an iPhone

1. Run the backend on your laptop (`make up`). Expose it over HTTPS with a free tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
2. Deploy `/web` to Vercel (free Hobby plan): import the repo, set **Root Directory = `web`**, and optionally set `VITE_API_URL` to the tunnel URL. Alternatively, paste the tunnel URL into the start page. It is saved on each device.
3. On the iPhone, open the Vercel URL, go to `/app`, then tap **Share → Add to Home Screen**. Open Mission Control on the laptop.
4. Only ever show synthetic data on a public URL. Close the tunnel after the demo.

### Paya 2.0 documentation

`docs/revamp/`: audit of the 1.x product, product experience, design system (with a generated contrast report), wallet UX, Mission Control UX, motion system, frontend architecture, backend integration, API changes, accessibility review, testing report and changelog. The acceptance run is `docs/revamp/tools/revamp_e2e.cjs`; screenshots are in `evidence/screenshots/revamp/`.

## Digital onboarding and KYC (Theme 1)

Open a wallet from the phone: tap **Open a new Paya wallet**, consent, enter synthetic details, make a SPECIMEN ID card on the device, take a selfie, turn your head left and right, and get a decision in seconds. Clear cases are approved automatically. Anything else goes to Compliance in Mission Control; a possible watch-list match needs two officers (Hamza, then Nadia). Photos and face templates are never stored.

Run `make models` once to fetch the face models (YuNet, MIT licence; SFace, Apache 2.0; checksums pinned). Without them, every application is referred to a person. Design: `docs/architecture/16-digital-onboarding-kyc.md`, ADR-010. Evidence: `evidence/kyc/`.

## Sustainable and green banking (Theme 2)

**Green** in the wallet shows an *estimate* of the carbon linked to your settled spending (spend-based factors, `green.v1`, with a ±50% range and the method on screen). A **green pot** ring-fences your own money on ledger account 2110, moved by balanced, idempotent journals; round-ups come only from settled payments. **Offsets** are ordinary Raast payments to a synthetic project, reviewed on the normal screen; a certificate appears only after settlement and is labelled simulated. Mission Control's **Green banking** page shows aggregates only. Design: `docs/architecture/18-green-banking.md`, ADR-012.

## Super app: partner services (Theme 4)

A **Services** tab turns the wallet into a daily-use app: pay an electricity or gas bill by consumer number, top up your own mobile, shop at Bazaar Lane (with a merchant-funded first-order offer), or buy a month of micro-takaful. Every partner is paid on the **same review screen and money path** as a shop payment, so an order only says "Bill paid" or "Cover active" once the ledger has settled it. Prices and bills come from the server; one bill can be paid once; partners receive only the fields you consented to; Compliance can suspend a partner from Mission Control's **Partners & services** page. Investments are not offered. All partners are synthetic. Design: `docs/architecture/19-super-app.md`, ADR-013.

## Stablecoin sandbox (Theme 5), off by default

Stablecoin payments aren't permitted for Paya under PVARA/SBP rules, so this is a **switched-off prototype**: start the server with `PAYA_STABLECOIN_SANDBOX=true` to see it. Fully verified customers acknowledge that the tokens have no value, then get worthless `tPKR-TEST` tokens from a faucet on a **simulated chain** (mempool, blocks, reorgs, outages). They can pay two synthetic merchants or an address. Transfers are screened, limited and travel-rule-checked, count only at 3 confirmations, and are reconciled against the chain. Nothing converts to rupees or touches the rupee ledger. Design: `docs/architecture/20-stablecoin-sandbox.md`, ADR-014.

## Conversational banking (Theme 3)

**Ask Paya** in the wallet answers questions about your own money in English or Roman Urdu ("mera balance kitna hai", "did my payment to Chai Junction go through?"), using read-only data from the ledger. It cannot move money; for actions it links into the normal review-and-authorise flow. Card numbers, CNICs, OTPs and passwords are removed before anything is stored. "Talk to a person" opens a case for Operations, who can read the redacted transcript (each read is audited). Design: `docs/architecture/17-conversational-banking.md`, ADR-011.

## Database migrations and roles

The schema is managed by Alembic (`src/paya/migrations`): `make migrate` upgrades to the latest revision as the schema owner and grants the app role data privileges only. In Docker Compose a one-shot `migrate` service does this, and the API connects as `paya_app`, which cannot alter tables, disable the ledger's triggers, or update or delete ledger, journal, audit or status-history rows. A database created before migrations existed is stamped and upgraded, never rebuilt. Design: ADR-015. Evidence: `evidence/security/db-roles-2026-11-21.md`.

## Sessions and two-step verification

Every access token belongs to a server-side session checked on each request, so signing out, "sign out everywhere else", an administrator ending someone's sessions, or deactivating a user stops the token immediately. Staff can turn on two-step verification (any authenticator app, RFC 6238) from Mission Control → **Security**. Outside demo mode it is required for staff, and the password alone gives no access. Secrets are encrypted with `PAYA_MFA_ENCRYPTION_KEY`. Design: ADR-017.

## Test

```bash
make test
```

The suite covers the 10 scenarios the brief requires plus 3 from the Week 9 lecture:

| # | Scenario | Test |
|---|---|---|
| S1 | Normal success → settled → reconciled | `test_s1_*` |
| S2 | Client retry with the same idempotency key → no double debit | `test_s2_*` |
| S3 | Duplicate rail ack and duplicate event → single effect | `test_s3_*` |
| S4 | Downstream timeout → PENDING → status enquiry (no blind replay) | `test_s4_*` |
| S5 | Partial failure: debited, rail rejects → compensating reversal | `test_s5_*` |
| S6 | Reversal with maker-checker (OPS requests, FINANCE approves) | `test_s6_*` |
| S7 | KYC/AML hold without moving money; compliance release | `test_s7_*` |
| S8 | Unauthorised role → denied and written to a tamper-evident log | `test_s8_*` |
| S9 | Restart mid-flight → worker resumes, truth preserved | `test_s9_*` |
| S10 | Reconciliation break → owned exception case | `test_s10_*` |
| S11 | Week 9 workshop: retry with a *new* key blocked by business idempotency | `test_s11_*` |
| S12 | Rail outage → circuit breaker refuses before taking money | `test_s12_*` |
| S13 | Same settlement file imported twice → refused | `test_s13_*` |
| W2 | Process conformance over the event log (no settlement without authorisation and posting) | `test_conformance_*` |
| W9 | Reconciliation stack: technical, operational, financial and exception checks | `test_integrity_checks_*` |
| SoD | Self-approval refused and the denial kept in the audit chain | `test_s6c_*` |
| Race | Concurrent dispatch, callbacks and enquiries settle exactly once (found by load test) | `test_concurrent_*` |
| Security | Login lockout, rate limits (ADR-016), security headers, metrics, JSON logs with correlation, secret scrubbing | `tests/test_security_observability.py`, `tests/test_ratelimit.py` |
| AI | Triage agent suggests, abstains, is audited, owner-only review, LLM guardrails, no money-moving capability | `tests/test_ai_triage.py` |

## Demo

- Script: [docs/demo/demo-script.md](docs/demo/demo-script.md).
- Rehearse: `make demo-reset && make rehearse`.
- Viva preparation: [docs/viva/](docs/viva/README.md).
- Deck outline: [docs/review/](docs/review/architecture-review-deck-outline.md).

## Evidence tools

```bash
python docs/architecture/tools/recovery_drill.py   # crash, DB restart, backup/restore drill against the Compose stack
PAYA_VELOCITY_MAX_PAYMENTS=100000 PAYA_RATE_GENERAL_PER_CLIENT_PER_MINUTE=100000 PAYA_RATE_LOGIN_PER_IP_PER_MINUTE=1000 make up   # (load test only) then:
python docs/architecture/tools/load_test.py         # writes evidence/performance/
python docs/architecture/tools/ai_eval.py           # AI triage evaluation -> evidence/ai/evaluation.md
```

## Repository map

| Path | Contents |
|---|---|
| `src/paya` | Ledger, state machine, payments, risk, rail, recon, events, security, API |
| `tests` | Automated normal and failure scenarios |
| `api` | `openapi.json` (sync contract) and `events/*.schema.json` (async contract) |
| `docs/architecture` | gate pack for Weeks 10, 12 and 13 (`00-gate-pack.md`), journey and scope, C4, contracts, sequences, state model, BPMN 2.0, ADRs; rendered diagrams in `rendered/` |
| `data` | Synthetic seed data only |
| `web` | Phone app (PWA) and Mission Control (React, Vite, Tailwind, React Flow) |
| `infra` | Dockerfile and Compose |
| `evidence` | Test results, screenshots, recon output |
| `AI_USE_LOG.md` | How generative AI was used, and how its output was verified |

## Integrity guarantees enforced by the database

- Journals must balance (a deferred constraint trigger), and amounts are positive integer paisa.
- `ledger_entries`, `journals`, `audit_log` and `transaction_status_history` are append-only. Triggers reject `UPDATE` and `DELETE`.
- `UNIQUE(txn_id, posting_type)` means a posting can never be repeated.
- A partial unique index allows only one live payment per payment request (business idempotency).
- A maker cannot be the checker on the same approval (`CHECK approved_by <> requested_by`).
- Each audit-log row stores the hash of the previous row (`GET /v1/audit/verify`).
