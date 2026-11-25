# 02: C4 system context and container views

**Gate:** Week 10, C4 context. The container view is included so the sequence diagrams have named participants.
**Rendered images:** `rendered/c4-context.svg`, `rendered/c4-container.svg`.

## Level 1: system context

```mermaid
C4Context
  title Rupay - system context (proposed reference architecture, synthetic data)
  Person(customer, "Customer", "Partner EMI wallet holder. Pays by scanning a Raast QR.")
  Person(cashier, "Cashier / merchant admin", "Shows the QR. Hands over goods only on PAID.")
  Person(backoffice, "Back office", "Ops, Compliance, Finance and Audit staff. Make the human decisions.")
  System(paya, "Rupay", "Payment assurance platform: transaction state, double-entry ledger, risk screening, reconciliation, live operations view.")
  System_Ext(raast, "Raast P2M rail", "SBP instant payment system, reached via the licensed partner. SIMULATED in the prototype.")
  System_Ext(emi, "Partner EMI / MSP", "Licensed institution that holds customer funds and the merchant relationship. Synthetic.")
  System_Ext(registry, "Identity registry", "NADRA-style identity verification. Mocked; institutional access only.")
  Rel(customer, paya, "Pays, tracks status", "HTTPS / WebSocket")
  Rel(cashier, paya, "Creates payment requests, watches PAID", "HTTPS / WebSocket")
  Rel(backoffice, paya, "Releases holds, approves reversals, reconciles", "HTTPS")
  Rel(paya, raast, "Credit transfer, status enquiry, settlement file", "RailPort adapter")
  Rel(paya, emi, "Runs as TSP under partner licence")
  Rel(paya, registry, "KYC check (roadmap)", "IdentityRegistryPort")
  UpdateRelStyle(paya, raast, $offsetY="-62", $offsetX="-60")
  UpdateRelStyle(paya, emi, $offsetX="-150", $offsetY="10")
  UpdateRelStyle(paya, registry, $offsetX="40", $offsetY="10")
  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

**Systems of record** (Week 1: record / engagement / intelligence):

| Data object | System of record | Classification | Who may change it |
|---|---|---|---|
| Customer master, consent, KYC tier | Rupay customer master (`customers`, `consents`) | Record | Onboarding/KYC process only |
| Merchant master, Raast alias, settlement IBAN | Rupay merchant master (`merchants`) | Record | Merchant onboarding; IBAN change needs dual approval (roadmap) |
| Payment request (QR / order) | Rupay payments (`payment_requests`) | Record | Cashier creates; system expires |
| Transaction state | Rupay transaction service (`transactions` + `transaction_status_history`) | Record | State machine only (`state.py`) |
| **Internal financial truth** | **Rupay ledger** (`journals`, `ledger_entries`) | **Record** | Posting service only; append-only |
| External rail claims | Raast (simulated: `rail.payments`, settlement file) | External record | Rail only. **Never copied into the ledger without a matching transaction.** |
| Risk decisions | Rupay risk (`screening_results`, `cases`) | Record | Rules engine; humans for holds |
| Notifications | Rupay notifier (`notifications`) | Engagement | Consumer of events. **Never a source of truth.** |
| Metrics, Mission Control view | Derived | Intelligence | Read-only |
| Audit evidence | Rupay audit chain (`audit_log`) | Record | Append-only, hash-linked |

## Level 2: containers

```mermaid
C4Container
  title Rupay - containers
  Person(customer, "Customer")
  Person(cashier, "Cashier")
  Person(staff, "Back office")
  System_Boundary(p, "Rupay") {
    Container(pwa, "Phone app", "React PWA", "Wallet: scan, slide-to-pay, live tracker. Till: keypad, QR, PAID.")
    Container(mc, "Mission Control", "React + React Flow", "Live service map, human gates, chaos panel, inspector.")
    Container(api, "Rupay API", "Python 3, FastAPI", "Gateway facade: JWT/RBAC, correlation ID, idempotency. Payments, risk, ledger, recon modules (modular monolith).")
    Container(worker, "Recovery worker", "Python thread", "Outbox relay, rail dispatch, callbacks, status enquiry, expiry.")
    ContainerDb(db, "Rupay database", "PostgreSQL 16", "Ledger, transactions, outbox/inbox, cases, audit chain. Integrity enforced by triggers and constraints.")
  }
  System_Boundary(ext, "External (simulated)") {
    Container(rail, "Mock Raast rail", "Python + schema 'rail'", "Credit transfer, enquiry, callbacks, settlement file. Chaos modes.")
  }
  Rel(customer, pwa, "Uses", "HTTPS")
  Rel(cashier, pwa, "Uses", "HTTPS")
  Rel(staff, mc, "Uses", "HTTPS")
  Rel(pwa, api, "Commands and queries", "JSON/HTTPS")
  Rel(pwa, api, "Live status", "WebSocket")
  Rel(mc, api, "Decisions, chaos, live stream", "JSON/HTTPS, WebSocket")
  Rel(api, db, "Reads/writes in one ACID transaction per command", "SQL")
  Rel(worker, db, "Relays outbox, resumes unfinished work", "SQL")
  Rel(worker, rail, "Dispatch, enquiry, callbacks", "RailPort")
  Rel(api, rail, "Settlement file for reconciliation", "RailPort (batch)")
  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="2")
```

## Bounded contexts (inside the API container)

| Context | Module | Owns | Talks to others by |
|---|---|---|---|
| Gateway | `api/main.py`, `idempotency.py`, `security.py` | Idempotency keys, sessions | In-process calls |
| Payments | `payments.py`, `state.py` | Payment requests, transactions, state history | Calls Ledger and Risk; emits events |
| Ledger | `ledger.py` | Accounts, journals, entries, holds | Called only by Payments and Recon |
| Risk & Compliance | `risk.py` | Screening results, compliance cases | Called by Payments |
| Rail integration | `rail.py` | Circuit breaker, adapter | `RailPort` interface |
| Reconciliation | `recon.py` | Recon runs, recon items, break cases | Reads rail file; calls Ledger |
| Events | `events.py`, `notifications.py` | Outbox, inbox, notifications | Outbox / subscribers |
| Audit | `audit.py` | Hash-chained audit log | Called by all decision points |

The decision to use one deployable (a modular monolith) instead of microservices is recorded in [ADR-001](adr/ADR-001-modular-monolith-sync-and-async.md).
