# ADR-011: Conversational banking — a bounded, deterministic assistant that cannot move money

**Status:** accepted · **Date:** 2026-11-21 · **Area:** customer channels, responsible AI, data protection

## Context

Theme 3 asks for conversational banking. A chat channel is attractive to attackers and error-prone:
- prompt injection;
- social engineering ("send it now");
- leaking another customer's data;
- customers pasting card numbers and OTPs into a box that gets logged.

The project's principles are that the ledger is the source of truth and that AI suggests and never decides (ADR-008).

## Decision

1. **Read-only tools scoped to the authenticated customer.** The assistant can read balances, transactions, limits and verification status, and can open a support case. It imports no payment, posting, transition or reversal function (a test checks the source).
2. **Actions are links, not executions.** "Pay" and "refund" requests get an explanation and a link into the normal flow, where the customer reviews and authorises.
3. **Deterministic intents (`assistant.v1`), English and Roman Urdu.** There is no LLM in the loop, so there is nothing to prompt-inject, and every answer is reproducible and testable.
4. **Redact before anything else.** Card (Luhn-checked), CNIC-like, IBAN, OTP/PIN/password and mobile patterns are removed before classification and storage; only the kinds are kept.
5. **Human handoff as a case** (`SUPPORT_HANDOFF`, owner OPS, 60-minute SLA), one per conversation, audited. Staff transcript reads are audited.
6. **Retention:** 30 days, then deleted.

## Consequences

- Narrower understanding than an LLM. The "not understood" rate is monitored, and unknown questions get help options and a route to a person.
- Answers are always grounded in ledger data and cannot hallucinate balances or statuses.
- An LLM can be added later only to phrase replies from the same tool outputs, after evaluation.

## Alternatives rejected

- **An LLM with tool-calling, including payments:** one manipulated message could move money.
- **Storing raw transcripts for "quality":** this creates a store of secrets and personal data.
- **Answering in the cashier channel:** merchants have a separate, simpler surface.
