# ADR-006: A rail timeout makes a payment PENDING, never FAILED

**Status:** Accepted · 2026-11-20

## Context
Week 9 outage scenario: the processor times out after 8 s, then later sends settlement files for transactions the wallet had marked as failed. If we mark a timeout as failed and refund the customer, and the rail had actually paid the merchant, the customer and the merchant are both paid.

## Decision
- A timeout means **unknown outcome**. The payment stays PENDING with its money in *payments in transit* (2150).
- Recovery is by **status enquiry** with backoff (5 s, 15 s, 45 s, 2 min, 5 min).
- Resend only after the rail answers NOT_FOUND, and then with the **same** E2E id.
- After 15 minutes the payment goes to UNDER_REVIEW with an owned case. A reversal then needs maker-checker approval.
- Customers and cashiers see "Sent – awaiting confirmation", never "Paid", until settlement.

## Alternatives considered
- **Fail fast and refund:** simple, but it creates the double-benefit error.
- **Blind retry:** risks a second credit when the rail is not idempotent.

## Consequences
- The cashier may wait for an uncertain payment. That is the honest state.
- The S4, S11, S12 and drill D1 evidence shows this recovering without any duplicate effect.
- A late "accepted" after a human-approved reversal becomes a STATUS_MISMATCH break with a claim path. It is never silently absorbed.
