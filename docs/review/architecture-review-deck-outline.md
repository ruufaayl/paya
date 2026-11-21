# Architecture review deck: outline (10 slides)

**Brief:** 8–10 slides covering business context, architecture, transaction integrity, risks, controls, resilience, and a go / conditional-go recommendation.
**Style:** one message per slide, real screenshots and diagrams from the repo (no stock art), and every number cited to an evidence file.

| # | Title (the message) | Content | Visual (file) | Speaker |
|---|---|---|---|---|
| 1 | **Paya: payment pakka hai** | Raast P2M cashier confirmation problem; Paya as a technology service provider to a licensed partner; synthetic data and no real money | Landing page + cashier PAID (`evidence/screenshots/11-cashier-paid.jpg`) | A |
| 2 | **The problem is trust in "paid"** | Raast P2M grew from 4.9m to 182.5m transactions (FY26, verify against SBP PDF); registered ≠ active merchants; reconciliation is still manual. Journey: dynamic-QR merchant payment and linked reversal | Journey strip: QR → pay → PAID → reconciled | A |
| 3 | **Architecture: one money path** | C4 container; bounded contexts; systems of record; modular monolith (ADR-001); mock Raast behind `RailPort` (ADR-005) | `docs/architecture/rendered/c4-container.png` | B |
| 4 | **Transaction integrity: designed for the unhappy path** | State machine (timeout = PENDING, ADR-006); idempotency at four layers (ADR-003); append-only, balanced ledger (ADR-002); row locks plus constraints (ADR-007) | `rendered/state-model.png` + `rendered/seq-timeout.png` | B |
| 5 | **Ledger and reconciliation** | Posting rules (worked example E1); 4-layer recon stack; exception taxonomy with owners; 12 integrity checks | Table from `evidence/ledger/worked-examples.md`; break card screenshot | C |
| 6 | **Security, KYC/AML and access governance** | 8 roles; maker ≠ checker in app and DB; compliance hold with no money moved; hash-chained audit; lockout; dependency audits; threat model top risks and residual risk | Permission matrix excerpt; `rendered/threat-dfd.png` | D |
| 7 | **Resilience, observability and evidence** | Recovery drill: crash → healthy 1.3 s, settled exactly once in 6 s; DB restart 0.7 s; restore identical. Load test: 400 payments, 0 duplicates. SLO table. Race found by load test and fixed | Mission Control screenshot + drill table | E |
| 8 | **Responsible AI: suggests, never decides** | Recon-triage agent; abstention rules; owner-only review; no money-moving capability (source-checked test); 94.1% accuracy, 0% unsafe autonomy, 20/20 injection safe | `evidence/screenshots/ai-suggestion.jpg` + metrics table | C |
| 9 | **Risks and limits we accept, and those we don't** | Single process ~16 payments/s; no MFA or revocation; simulated rail (assumptions A3/A4); no LLM evaluated; react-router v7 debt. Each with an owner and next step (tech-debt register) | Risk table | D |
| 10 | **Recommendation: CONDITIONAL GO** | Conditions: (1) partner sandbox for `RailPort`; (2) MFA, token revocation and rate limiting before any pilot; (3) merchant interviews to validate A1 (screenshot problem); (4) separate DB roles; (5) LLM must pass the same evaluation before use. **Go** for a controlled synthetic pilot | Checklist | A |

**Backup slides** (not counted): CI run and reproducibility; BPMN model; ERD; per-scenario test map.

**Every member must be able to present any slide.** The viva checks individual mastery (`docs/viva/`).
