# Rupay 2.0 product experience

**Rupay** is a payment-assurance layer for Raast person-to-merchant (P2M) payments, built as a technology service provider to a licensed partner. It has two connected surfaces.

| | Rupay Wallet | Rupay Mission Control |
|---|---|---|
| For | Customers (and cashiers, via the till) | Operations, compliance, finance, audit |
| Device | Phone, mobile-first PWA | Laptop/desktop (1280–1920 px) |
| Theme | Light, calm, roomy | Dark, dense, precise |
| Promise | "Paid" means confirmed by the ledger and Raast | Every number is from a system of record; every action is a named person, checked by the server |

## Product principles

1. **The ledger is truth.** Screens read status; they never create it. No balance or outcome is computed in the browser beyond labelled presentation (for example "paid this month" is summed from the server's transaction list and labelled as such).
2. **Unknown is not failure.** A timeout is pending and shown as processing until the rail answers.
3. **People decide what machines shouldn't.** Maker-checker and two-person rules are visible in the UI and enforced by the server and the database.
4. **Simulation is labelled.** The Raast rail and identity registry are simulators and are badged as such wherever they appear.
5. **Explain, don't decorate.** Motion and charts exist only to explain real changes and real data.

## Information architecture

**Wallet** (`/app`): Sign in · Open a wallet (onboarding) · Home · Activity · Pay (scan → review → authorise) · Payment (status, timeline, money trail, references, receipt) · Account. A merchant till (`/app` as a cashier) is a separate role-based surface.

**Mission Control** (`/control`), grouped by job:
- **Monitor:** Overview · Transactions · System topology · Event stream
- **Work:** Cases & approvals · Identity & KYC · Reconciliation (& settlement) · AI operations
- **Control:** Rail lab · Audit & access

Changes from the suggested 15-item list:
- "Payment Operations" and "Rail Control" merged into **Rail lab**.
- "Compliance Review", "Exception Management" and approvals merged into **Cases & approvals** (one queue, filterable by type).
- "Settlement and Finance" merged into **Reconciliation** (trial balance and integrity checks sit beside the files).
- "Risk and Fraud" is covered by Transactions (risk filter, screening evidence) and Cases (holds); there is no separate risk data to justify a page.
- "System Settings" was omitted: there are no runtime settings to change safely from a UI (configuration is environment-based by design).

The result is 10 items in 3 groups, with no empty pages.

## Key journeys

| Journey | Surface | Path |
|---|---|---|
| Open a wallet | Wallet | Welcome → consent → details → specimen card → document check → head-turn liveness → instant approval **or** "a person is checking" (live status) |
| Pay a shop | Wallet | Scan QR or pick a till → review (merchant, amount set by the shop, balance after, fee, network) → slide (or Enter) to authorise → processing → Paid / pending / declined / returned → receipt |
| Understand a payment | Wallet | Timeline of states with times, "where your money went" from journals, Raast E2E id and confirmation time, reconciliation state |
| Sell | Till | Keypad → dynamic QR → live status → PAID (voice) only after settlement |
| Watch the business | Console | Overview: success rate, in flight, awaiting ack, value in transit, human work, settle-time p95, recon match, integrity; charts by outcome and time to settle |
| Investigate | Console | Search reference/E2E/correlation → drawer with lifecycle, double-entry postings, screening, cases, approvals, recon, audit, notifications → request enquiry or reversal (if permitted) |
| Prove resilience | Console | Rail lab: choose scenario → expected behaviour (with test id) → apply → trigger synthetic payment → observed outcome |
| Work exceptions | Console | Cases queue → case drawer → assign/take → AI suggestion (advisory) → decide (owner role only) → trail |
| Review onboarding | Console | KYC referrals → evidence (each check, score, engine) → recommend → second officer confirms |
| Reconcile | Console | Import file → match rate and categories → break → case → resolve; identical file refused |
| Audit | Console | Hash-chain status, filters for denials, role/permission matrix |
