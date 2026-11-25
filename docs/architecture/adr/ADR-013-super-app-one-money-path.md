# ADR-013: Super app: partner services on one money path, consent-scoped data, and a partner kill switch

**Status:** accepted · **Date:** 2026-11-21 · **Area:** products, integration, third-party risk, data protection

## Context

Theme 4 asks to reimagine the banking app as a super app, integrating services such as e-commerce, investments, insurance and lifestyle offers into a secure, daily-use ecosystem. In Pakistan, the daily-use services in wallets are bill payment, mobile top-up, shopping and micro-insurance/takaful.

Every partner integration is a new way to break integrity:
- a second payment path that skips screening, the ledger or reconciliation;
- client-supplied prices;
- a bill paid twice;
- an order that says "done" when the money didn't move;
- customer data leaking to third parties;
- no way to switch off a misbehaving partner.

Rupay is an EMI-style wallet. It cannot sell investments, and it does not underwrite insurance.

## Decision

1. **One money path.** A partner is a merchant record. Checkout only creates a payment request (`kind = SERVICE`) for a server-priced order. The customer authorises it on the normal review screen, so screening, holds, the ledger, Raast, recovery and reconciliation apply unchanged. The services module contains no posting, rail or payment-initiation code (a test reads its source).
2. **Order state is derived, not stored.** "Bill paid", "cover active" or "order confirmed" are read from the ledger-backed payment behind the order. An order cannot run ahead of the ledger.
3. **Server catalogue.** Items, prices, bill amounts (from a synthetic biller registry) and offers are server-side. The client sends codes and quantities only. Offers are merchant-funded discounts on the request amount: Rupay pays no cashback, so no money is created.
4. **One bill, paid once.** A second order for the same biller, consumer number and month is refused while one is live or done, under an advisory lock, even across customers.
5. **Consent-scoped sharing.** Each partner declares the fields it may receive. The customer grants consent per partner (revocable, audited). The exact fields shared are stored on the order, and an integrity check verifies them against a live consent.
6. **Third-party kill switch.** Compliance (`partners:manage`) can suspend or resume a partner with a reason, written to the audit chain. Suspension hides the service and refuses new orders. Payments already made settle normally.
7. **Not offered:** investments, stated in the app. Insurance is the partner's product; Rupay distributes and collects payment.

## Consequences

- Each new partner inherits every payment control with no new money code. Two integrity checks were added: `service_order_matches_payment_request` and `partner_data_shared_only_with_consent`.
- Partner settlement to real partners (net of fees), partner APIs, refunds of delivered goods and claims handling are out of scope; partner fulfilment is simulated.
- Deriving order state means a read joins orders to payments. That is fine at demo scale; at production scale it becomes a projection fed by the outbox.

## Alternatives rejected

- **Partner-specific debit endpoints (e.g. "pay bill" posting directly):** this duplicates the money path and skips screening and reconciliation.
- **Client-side cart pricing:** trivially tampered.
- **Cashback paid by Rupay:** creates liabilities from nothing and looks like issuing value.
- **A blanket "share with partners" consent at sign-up:** not specific or revocable per partner.
- **Embedding third-party web views with the session token:** gives partners the customer's credentials.
