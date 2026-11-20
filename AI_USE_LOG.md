# AI use log

The project brief requires every use of generative AI to be recorded. Every team member remains accountable for verifying generated code, security logic, calculations and references.

| Date | Tool | Task | Output used | How it was verified | Rejected or changed |
|---|---|---|---|---|---|
| 2026-11-20 | Claude (Anthropic), via Claude Code | Analysed the course lecture slides (Weeks 1–9), the project guideline and the 16-week pack; researched the Pakistani payments ecosystem; compared project concepts | Coverage matrix, compliance checklist, concept selection (Paya) | Checked against the uploaded PDFs. Ecosystem claims are cited to SBP and press sources, and figures marked "verify" are checked against the primary SBP documents before use in the deck | Stablecoin scope restricted to a sandbox after the PVARA/SBP rules were found |
| 2026-11-20 | Claude (Anthropic), via Claude Code | Scaffolded the repository; wrote the ledger, state machine, idempotency, mock rail, risk rules, recon, outbox and API; wrote the scenario tests | `src/paya/*`, `tests/*`, `infra/*` | 17 automated tests pass against PostgreSQL 16. Smoke-tested the Docker stack end to end (payment → settlement → reconciliation → balanced trial balance) | Two defects found by the tests were fixed: the audit `object_id` length, and timing-difference logic that depended on the wall clock |

**Team review required.** Before the final defence, each member reviews the module they will defend in the viva, and records here what they checked.
