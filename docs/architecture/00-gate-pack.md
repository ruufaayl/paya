# Gate pack: Paya (Weeks 10, 12 and 13)

**Course:** CS3017 Enterprise Systems & Applications, Fall 2026.
**Submitted:** 2026-11-20.
**Status:** for instructor review.

The brief (section 11) defines two Week 10 gates. Each item below points to its evidence.

## Gate 1: journey and architecture scope

| Minimum evidence required | Where it is |
|---|---|
| Approved transaction | [01: Journey and scope](01-journey-and-scope.md) §1. Merchant QR payment with linked reversal |
| Public context | [01](01-journey-and-scope.md) §2. SBP and press sources, with items marked "verify" |
| C4 context | [02: C4 context and container](02-c4-context-and-container.md). Rendered: `rendered/c4-context.svg` |
| Assumptions | [01](01-journey-and-scope.md) §4. Six assumptions, each with a risk rating and validation route |
| Ethical boundaries | [01](01-journey-and-scope.md) §5 |

## Gate 2: integration contracts

| Minimum evidence required | Where it is |
|---|---|
| API contract | `api/openapi.json` (generated from the running code) plus the catalogue and error model in [03](03-integration-contracts.md) §2 |
| Event decision | [03](03-integration-contracts.md) §3, [ADR-004](adr/ADR-004-outbox-before-broker.md), schemas in `api/events/` |
| Idempotency strategy | [03](03-integration-contracts.md) §4, [ADR-003](adr/ADR-003-idempotency-store.md) |
| Sequence diagram | [04](04-sequence-diagrams.md): normal flow, timeout recovery and duplicate handling. Rendered: `rendered/seq-*.svg` |

## Gate 3 (Week 12): data and control

| Minimum evidence required | Where it is |
|---|---|
| ERD | [07: Data model](07-data-model.md) (core view) and [generated/erd-full.md](generated/erd-full.md) (all 23 tables, generated from code), plus [table dictionary](generated/table-dictionary.md) |
| Source-of-truth rules | [08: Source of truth and lineage](08-source-of-truth.md). Attribute-level ownership, ledger-vs-rail conflict rules, lineage chain |
| Ledger/reconciliation logic | [09: Ledger and reconciliation](09-ledger-and-reconciliation.md). Chart of accounts, posting rules, exception taxonomy, 4-layer reconciliation stack. System-generated postings in [evidence/ledger/worked-examples.md](../../evidence/ledger/worked-examples.md) |
| Identity/consent or KYC controls | [10: Identity, KYC/AML and consent controls](10-identity-kyc-consent-controls.md). Permission matrix, SoD rules, joiner-mover-leaver, KYC/AML rules, consent and data minimisation, audit chain |

## Gate 4 (Week 13): prototype, failure/resilience, security/observability

| Gate | Minimum evidence required | Where it is |
|---|---|---|
| Prototype | Normal path works locally and is covered by an automated test | `make up`, `test_s1_normal_success_end_to_end`; [evidence/tests](../../evidence/tests/) (25 tests passing) |
| Failure/resilience | Timeout, duplicate and partial-failure behaviour demonstrated | [13: Resilience and recovery](13-resilience-and-recovery.md) failure catalogue F1–F13; tests S3, S4, S5, S11, S12, `test_concurrent_*`; live in Mission Control chaos modes |
| Security/observability | Threat model | [11: Threat model](11-threat-model.md). STRIDE (14 threats), top-5 attack paths, residual risk; dependency audits in [evidence/security](../../evidence/security/) |
| | RBAC | [10: Identity and controls](10-identity-kyc-consent-controls.md) permission matrix; tests S6, S7, S8; lockout test |
| | Audit evidence | Hash-chained `audit_log`, `GET /v1/audit/verify`; tests S6c, S8, lockout |
| | Metrics/logging | [12: Observability and SLOs](12-observability-and-slos.md). JSON logs with correlation ID, `/metrics`, integrity checks, Mission Control |
| | Recovery assumptions | [13](13-resilience-and-recovery.md) §2 RTO/RPO with business justification; **measured** drill in [evidence/resilience](../../evidence/resilience/) |
| | (brief §2) SLO/SLI | [12](12-observability-and-slos.md) §2, eight SLOs with measured values from [evidence/performance](../../evidence/performance/) |
| | (brief §2) Runbooks / exception handling | [14: Runbooks](14-runbooks.md) RB-1 to RB-7 |

## Delivered early (later gates)

| Item | Gate | Where |
|---|---|---|
| BPMN 2.0 with exception, timeout, reversal and manual-control paths | Core artefact | [06](06-bpmn-payment-journey.md), `bpmn/payment-journey.bpmn` |
| State-transition model | Core artefact | [05](05-state-model.md) |
| Systems-of-record table | Week 12 | [02](02-c4-context-and-container.md) |
| ADRs (4 of the ≥4 required) | Week 14 | `adr/` |
| Normal path working locally and covered by an automated test | Week 13 | `tests/test_scenarios.py::test_s1_*` |
| Timeout, duplicate and partial-failure behaviour | Week 13 | `test_s3_*`, `test_s4_*`, `test_s5_*`, `test_s11_*`, `test_s12_*` |

## Still to do

- **Week 14:** AI extension with governance and evaluation.

## Questions for the instructor

1. **Framing.** Is it acceptable to frame Paya as a technology service provider operating for a synthetic licensed Partner EMI? The implemented journey is still a wallet merchant payment, as the brief requires.
2. **Rail simulation.** Is a simulated Raast rail with documented assumptions (A3, A4) acceptable, given that no public Raast developer API exists?
