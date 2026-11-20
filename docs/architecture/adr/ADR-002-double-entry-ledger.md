# ADR-002: Build an append-only double-entry ledger in PostgreSQL

**Status:** Accepted · 2026-11-20

## Context
The ledger is the authoritative record of internal financial postings. Week 9 says: "avoid overwriting prior entries". The Horizon inquiry shows what happens when a system lets financial records be silently corrected.

## Options
1. A mutable `balance` column on each wallet (rejected: no audit trail, lost-update races).
2. An external open-source ledger product (rejected for now: adds a service the team must defend at the viva; this is the "COTS vs home-grown" question from Week 1).
3. **A home-grown double-entry ledger with database-enforced invariants (chosen).**

## Decision
- Store journals and entries. Amounts are positive integers in paisa, and every entry is debit or credit.
- Enforce balance with a deferred constraint trigger, make the tables append-only with triggers, and enforce `UNIQUE(txn_id, posting_type)`.
- Derive balances from entries. Available balance = ledger balance − active holds.
- Make every correction a new REVERSAL, ADJUSTMENT or CLAIM journal that links to the original.

## Consequences
- Balance queries aggregate entries. This is acceptable at prototype scale; a cached projection could be added later.
- No application bug, and no manual SQL, can produce an unbalanced journal or rewrite history.
