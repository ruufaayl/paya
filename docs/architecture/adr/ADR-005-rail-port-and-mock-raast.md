# ADR-005: A `RailPort` interface with a simulated Raast rail

**Status:** Accepted · 2026-11-20

## Context
- There is no public Raast developer API. Access is through participating institutions under NDA.
- The brief forbids probing real services, and requires simulating success, timeout, duplicate acknowledgement, rejection and partial failure.

## Decision
- Define `RailPort`: `send_credit(e2e_id, …)`, `enquire(e2e_id)`, `settlement_file(date)`.
- Implement `MockRaastRail` with its **own schema** (`rail.*`), so its records are a separate system that we reconcile against, never part of our ledger.
- Make the mock idempotent on the end-to-end id, as real credit-transfer schemes are.
- Add nine chaos modes, switchable from Mission Control and from tests.

## Alternatives considered
- **A wallet provider's merchant sandbox** (e.g. JazzCash): gated behind merchant onboarding; not Raast P2M; adds an external dependency to the demo.
- **Simulating the rail inside the ledger tables:** rejected. Reconciliation would then compare the ledger with itself.

## Consequences
- Every failure the brief lists can be produced on demand and is covered by a test.
- A licensed sandbox can replace the mock by implementing `RailPort`, with no change to payments or reconciliation.
- **Limit:** the mock's behaviour is assumed (A3 and A4 in `01-journey-and-scope.md`), not taken from Raast's specifications.
