# ADR-012: Green banking: ledger-native, honest estimates, offsets through the normal money path

**Status:** accepted · **Date:** 2026-11-21 · **Area:** products, ledger, data protection, responsible claims

## Context

Theme 2 asks for platforms that track environmental impact through transactions and promote eco-friendly choices such as carbon offsetting, green investments and eco-conscious products. In Pakistan, SBP's Green Banking Guidelines (2017) and the Pakistan Green Taxonomy (notified December 2025, referenced by SBP as a guide for banks' green policies) frame this as risk management and green finance. There is no mandatory consumer carbon-reporting standard.

Three risks make this theme easy to get wrong:
- **Greenwashing:** presenting a rough estimate as a measurement, or selling "offsets" with no real retirement.
- **A second money path:** a green feature that moves money outside the ledger, idempotency and reconciliation controls.
- **Surveillance:** a per-customer footprint is behavioural data that staff do not need.

## Decision

1. **Footprint = labelled estimate.** Spend-based: settled payments (ledger state, never requests or holds) × a versioned factor table (`green.v1`, kg CO2e per Rs 1,000 by merchant category) with a ±50% band. The answer always says "estimate", shows the method, and names the factor set. The factors are illustrative and are labelled as such.
2. **Green pot = customer money on chart account 2110.** Moving money in or out is one balanced journal between the customer's own 2100 and 2110 accounts, under the same wallet row lock and available-balance check as a payment, with a mandatory Idempotency-Key. No interest or return is promised, and no money leaves Rupay. Round-ups are capped at what the customer's *settled* payments in the last 30 days earned.
3. **An offset is an ordinary Raast P2M payment** to a synthetic project merchant. Rupay creates only the payment request; the customer reviews and authorises it on the normal screen, and screening, ledger, rail, recovery and reconciliation all apply unchanged. A certificate is derived from the payment **only once the ledger shows it SETTLED**. It is labelled simulated: no registry, no real credit retired.
4. **Staff see aggregates only.** Mission Control shows pot totals (from 2110), settled offsets and a portfolio footprint by category. No endpoint lets staff read one customer's footprint.
5. **Two new integrity checks:** no negative green pots; exactly one journal per pot movement. The database's CHECK constraints were widened for the two new transaction and posting types, and nothing else.

## Consequences

- Footprint accuracy is coarse by design. It is a nudge, not a carbon account, and the UI says so.
- Offsets inherit every payment control for free, including PENDING recovery and reconciliation breaks.
- "Green investments" are **out of scope**: an EMI cannot offer investment products, and the assistant refuses investment advice (ADR-011).
- A production version would license an environmentally-extended input-output dataset, map categories to the Pakistan Green Taxonomy, and partner with a registry-backed offset provider under its own agreements.

## Alternatives rejected

- **Per-transaction precise "carbon receipts":** this claims a precision the data cannot support.
- **A separate offset wallet or token:** this creates a second money path and looks like issuing value.
- **Auto round-up on every payment:** this moves money without a fresh customer decision. The customer sweeps round-ups themselves.
- **Showing staff individual footprints "for marketing":** not needed for any control, and it is behavioural profiling.
