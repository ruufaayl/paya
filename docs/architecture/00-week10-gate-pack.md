# Week 10 gate pack: Paya

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

- **Week 12:** ERD, ledger posting rules document, threat model, KYC/consent controls write-up.
- **Week 13:** SLO/SLI specification, RTO/RPO note, runbooks.
- **Week 14:** AI extension with governance and evaluation.

## Questions for the instructor

1. **Framing.** Is it acceptable to frame Paya as a technology service provider operating for a synthetic licensed Partner EMI? The implemented journey is still a wallet merchant payment, as the brief requires.
2. **Rail simulation.** Is a simulated Raast rail with documented assumptions (A3, A4) acceptable, given that no public Raast developer API exists?
