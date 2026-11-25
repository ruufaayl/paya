# ADR-014: Stablecoin sandbox: off by default, test tokens only, finality-aware and reconciled

**Status:** accepted · **Date:** 2026-11-21 · **Area:** regulation, integration, transaction integrity

## Context

Theme 5 asks for secure platforms for stablecoin payments, covering wallets, compliance, savings and merchant integrations.

In Pakistan, virtual assets are not legal tender, and the Pakistan Virtual Assets Act 2026 and the PVARA regulations do not permit us to offer stablecoin payments. A rupee-backed stablecoin has been announced but not launched, and the digital rupee is in pilot. The project rules forbid assuming that we can issue money or settle payments.

A tokenised rail does differ from Raast in ways an EIS must handle:
- a transaction can be included and later undone (a reorg);
- finality is a depth of confirmations, not an acknowledgement;
- addresses need screening;
- the travel rule asks for beneficiary data;
- Rupay's records must be reconciled against a chain it does not control.

## Decision

1. **Off by default.** Every sandbox endpoint answers `404 FEATURE_DISABLED` unless the server runs with `PAYA_STABLECOIN_SANDBOX=true`. The worker does nothing, and the wallet and Mission Control say it is switched off.
2. **Test tokens on a simulated chain.** `chain.py` keeps its own schema (`chain`), like the Raast simulator, and models a mempool, blocks, confirmations, reorgs, congestion and outages. The only asset is `tPKR-TEST`, issued only by a faucet (once per 24 hours). There is **no conversion to or from rupees**, and nothing posts to the rupee ledger; a test reads the source, and an integrity check scans the ledger.
3. **Wallets:** custodial sandbox addresses, only for tier-2 verified customers who acknowledge "no value, not a payment method".
4. **Compliance:** every transfer is screened against a synthetic blocked-address list (block + Compliance case + audit); per-transfer and daily limits apply; an external transfer at or above the travel-rule threshold requires beneficiary details; transfers carry an Idempotency-Key.
5. **Finality:** a transfer is "Confirmed" only at 3 confirmations. Spendable balance counts only final tokens minus pending outgoing transfers. A reorg returns a transfer to PENDING, never to CONFIRMED.
6. **Merchant integration:** two synthetic merchants accept test tokens at derived addresses.
7. **Reconciliation:** every confirmed transfer is checked against the chain (same addresses, amount, still final). Two new integrity checks: `token_transfers_match_chain` and `sandbox_tokens_never_in_rupee_ledger`.
8. **Savings are not built:** yield on stablecoins is not something an EMI may offer, and the wallet says nothing about returns.

## Consequences

- The design shows how an SBP-approved instrument (a sovereign stablecoin or the digital rupee) could plug in behind the same `submit / mine / status / balance` port, with screening, finality and reconciliation already in place.
- The chain is simulated, so there are no signatures, gas or real key custody. A real integration needs an HSM-backed custody design and the regulator's approval.
- Mining runs in the worker on an interval, plus a "Mine a block" control for demos.

## Alternatives rejected

- **A public testnet (e.g. Sepolia):** it needs network access and faucet accounts, it is not under our control for chaos testing, and it could be mistaken for a real deployment.
- **A local EVM node (Anvil/Hardhat):** it adds a heavy toolchain for behaviour we can model more clearly. The port allows it later.
- **Converting rupees to tokens:** this would be issuing or exchanging value, which is outside our licence and outside the project rules.
- **Enabled by default with a warning banner:** a default-on feature gets demoed as real. Off by default is the safe failure mode.
