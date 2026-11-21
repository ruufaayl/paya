# Mission Control UX

Code: `web/src/console/`. Desktop-first; verified at 1280, 1440 and 1920 px. Usable on large tablets: the sidebar collapses to icons.

## Identity: a real operator

The 1.x console read as `auditor` and pressed buttons as hard-coded personas. 2.0 asks **who is operating** (one of seven synthetic staff), shows them in the top bar, and performs every action as that person. The permission list comes from `GET /v1/me`. Navigation items the operator cannot use are dimmed. Pages they cannot read show a "Not available for your role" state that names the permission. Most importantly, **the server enforces every rule**: the e2e run includes a cashier refused at the gate, Ops refused the audit log, and a same-officer KYC confirmation refused (two-person rule). Switch operator from the top bar to demonstrate maker-checker and two-person approvals with real people.

## Shell

- **Sidebar** (232 px, collapsible to 64 px), grouped Monitor / Work / Control, with live badges (open cases + waiting approvals; referred KYC).
- **Top bar:** global search (`/` to focus) by reference, E2E or correlation id; Live / Reconnecting indicator; Raast rail badge marked **Simulated** with mode and breaker; integrity status; operator menu ("Act as").
- **Inspectors** (drawers) for transactions (`?txn=`), cases (`?case=`) and KYC applications (`?app=`) open from any page, so links can be shared.

## Pages

| Page | Decisions it supports | Backend |
|---|---|---|
| **Overview** | Is money flowing? What needs a person? Is the rail healthy? Does the ledger balance? | `/v1/ops/overview`, `/v1/ops/timeseries`, stream |
| **Transactions** | Find and investigate any payment; filters in the URL | `/v1/ops/transactions`, `/v1/transactions/{ref}` |
| **System topology** | What talks to what; what is active or failing *now* | Static architecture + live telemetry (see below) |
| **Event stream** | What happened, in order, with correlation | WebSocket + `/v1/events` |
| **Cases & approvals** | Who owns which exception, SLA, assignment, decisions; maker-checker queue | `/v1/cases`, `/v1/cases/{ref}`, assign, holds, reversals, approvals, AI |
| **Identity & KYC** | Referred applications with every check's evidence; two-person approvals | `/v1/kyc/*`, `/v1/compliance/kyc/*` |
| **Reconciliation** | Import, match rate, categories, breaks to cases, finance impact; trial balance; 16 integrity checks | `/v1/finance/recon/*`, trial balance, integrity |
| **AI operations** | Is the agent behaving? Abstention, acceptance, overrides, audit completeness | `/v1/ai/metrics`, cases |
| **Rail lab** | Does recovery work? Scenario → expected → trigger → observed | `/v1/chaos/*`, payments, enquiry |
| **Audit & access** | Who did what (incl. denials), chain integrity, who may do what | `/v1/audit/log`, `/v1/admin/access` |

## Topology: truthful by construction

- **Static vs runtime are separated.** The inspector has an "Architecture · static" section (what the component is, what it owns, its code path, its layer) and an "Observed · runtime" section (messages seen, last activity, last message, errors). The runtime section is built only from telemetry the console actually received (live, plus the server's replay of its recent buffer on connect), and is timed by each message's own timestamp so replayed history never looks recent.
- **No false green.** A node shows "no telemetry yet", "active · n", "quiet · last 3m ago" or "error in last minute", always in words. With no data the inspector says: *that means "no recent activity", not "healthy"*.
- Simulators use dashed borders and are labelled "simulator (not real infrastructure)".
- Interaction: zoom/pan, fit to screen, minimap, search-to-focus, layer filters, focus mode (dims everything except the selected node and its neighbours), click-to-inspect, and animated packets from real events with a legend.

## Two-person and maker-checker, made visible

- **KYC:** the inspector explains the rule. The first officer's button says "Recommend approval"; after that it shows "Recommended by Hamza. Waiting for a second officer", and the button becomes "Confirm approval (2nd officer)". If Hamza tries to confirm, the server refuses (403, SoD) and the refusal is written to the audit chain.
- **Reversals:** the Approvals tab names the maker. The approve button reads "Approve (you are the maker)" when that's true, and the server refuses it.

## Density and readability

Body text is 14 px in tables, metadata is 12 px minimum, and references are monospace. Tables use real `<table>` markup with sticky headers. Charts have hover tooltips, legends and hidden data tables. The 1.x 10–11 px labels are gone except uppercase overlines and chart axis ticks.
