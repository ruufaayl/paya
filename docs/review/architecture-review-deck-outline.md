# Architecture review deck (10 slides)

**The deck:** https://claude.ai/artifact/2uR7wF94vQVqfD9czFayYF. It is private until shared from its Share menu, and exports to PowerPoint or PDF from there. Slide sources are in `deck-source/`. Speaker notes name the presenting member on every slide.

## Outline

**Updated for Paya 2.0 and Themes 1 and 3 (version 7+ of the deck).** **Brief:** 8–10 slides covering business context, architecture, transaction integrity, risks, controls, resilience, and a go / conditional-go recommendation.
**Style:** one message per slide, real screenshots and diagrams from the repo (no stock art), and every number cited to an evidence file.

| # | Title (the message) | Content | Visual (file) | Speaker |
|---|---|---|---|---|
| 1 | **Paya: payment pakka hai** | Raast P2M cashier confirmation problem; Paya as a technology service provider to a licensed partner; synthetic data and no real money; the team | Paya 2.0 till PAID (`evidence/demo/scene-1-till.png`) | A (Rufayl) |
| 2 | **The problem is trust in "paid"** | Raast P2M grew from 4.9m to 182.5m transactions (FY26, verify against SBP PDF); registered ≠ active merchants; reconciliation is still manual. Journey: dynamic-QR merchant payment and linked reversal | Journey strip: QR → pay → PAID → reconciled | A (Rufayl) |
| 3 | **Architecture: one money path** | C4 container incl. Themes 1 and 3; modular monolith (ADR-001); ledger is truth; simulators and bounded themes (ADR-005/010/011) | `docs/deliverables/figures/brief-architecture.png` | B (Taha) |
| 4 | **Transaction integrity: designed for the unhappy path** | State machine (timeout = PENDING, ADR-006); idempotency at four layers (ADR-003); append-only, balanced ledger (ADR-002); row locks plus constraints (ADR-007) | `rendered/state-model.png` + `rendered/seq-timeout.png` | B (Taha) |
| 5 | **Ledger and reconciliation** | Posting rules (worked example E1); 4-layer recon stack; exception taxonomy with owners; 14 integrity checks | Table from `evidence/ledger/worked-examples.md`; break card screenshot | C (Harris) |
| 6 | **Security, KYC/AML and access governance** | Maker ≠ checker; holds move no money; onboarding two-person rule; hash-chained audit incl. transcript reads; 21 STRIDE threats | Cards | D (Kanz) |
| 7 | **Resilience, observability and evidence** | Recovery 1.3 s; 0/400 duplicates; 66 tests; 33/33 browser acceptance; rehearsal 8/8; truthful topology | `evidence/screenshots/revamp/console-topology-inspector-1440.png` | E (Mudaser) |
| 8 | **Bounded AI: it suggests, people decide** | Triage agent metrics (94.1%, 0% unsafe, 20/20 injection); Paya Assistant (read-only, Roman Urdu, redaction); neither can move money | Case drawer + assistant phone screenshots | C (Harris) |
| 9 | **Risks and limits we accept, and those we don't** | Single process ~16/s; no MFA or revocation; DB roles; simulated rail; A1 unvalidated; AI and biometrics not evaluated on real data | Risk table | D (Kanz) |
| 10 | **Recommendation: CONDITIONAL GO** | Six conditions (adds certified liveness and a consented fairness study before onboarding real customers) | Checklist | A (Rufayl) |

**Backup slides** (not counted): CI run and reproducibility; BPMN model; ERD; per-scenario test map.

**Every member must be able to present any slide.** The viva checks individual mastery (`docs/viva/`).
