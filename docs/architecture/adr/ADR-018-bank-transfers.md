# ADR-018: Send money to any bank account, with a simulated title fetch

**Status:** accepted (2026-11-25). **Owner:** Ateeq Riaz (Operations).

## Context

Customers asked to send money to any bank or wallet in Pakistan, not only to pay shops by QR. A real wallet
does this over Raast P2P or IBFT and first asks the network for the account holder's name ("title fetch"), so
the sender can check who they are paying. We are not a bank and have no access to 1LINK or Raast, and the
project's ethics rules forbid collecting or storing real banking information or real people's names.

## Decision

1. **One money path.** A transfer is a `TRANSFER` transaction that goes through the same steps as a QR payment:
   risk screening (with the account holder's name on the watch-list check and the shared velocity rule), a hold,
   one balanced `AUTH_POST` into 2150 in transit, the simulated Raast rail, then `SETTLE`. No shop fee. Status
   enquiry, timeouts, reversals, reconciliation and the integrity checks treat it like a payment.
2. **Simulated bank directory.** The bank list uses real, public bank and wallet names, but every title fetch is
   answered by a simulated directory of synthetic people: eight listed demo accounts plus any number that starts
   with 99, which gets a deterministic synthetic name. Any other number is "not found" and is neither stored nor
   sent anywhere. The screen says "simulated directory" next to every name.
3. **Data minimisation.** `bank_transfers` keeps the bank, the masked number (`•••• 1234`), a keyed HMAC of the
   number, the fetched name and the purpose. The full number exists only inside the request. The rail is told
   `BANK:****1234`. The idempotency store keeps only a hash of the request body. The table is append-only for the
   app role.
4. **Abuse controls.** Title fetch is limited to 20 lookups a minute per customer (stops enumerating the
   directory). IBANs are checked (format, mod-97 check digits, and the bank code must match the chosen bank).

## Alternatives considered

- *Look up real account names.* Rejected: needs a licensed 1LINK/Raast connection, would expose real people's
  names, and breaks the project's ethical boundaries.
- *Model the beneficiary as a merchant.* Rejected: mixes two different parties and would wrongly charge a shop fee.

## Consequences

- The feature is fully demonstrable end to end with no real data. Replacing the directory with a licensed
  title-fetch service only changes `banks.lookup`; the money path is unchanged.
- Evidence: tests B1–B9 in `tests/test_transfers.py` (title fetch, not-found handling, IBAN checks, settlement with
  no fee, nothing stored in full, idempotency, insufficient funds, timeout recovery with integrity checks, rate limit).
