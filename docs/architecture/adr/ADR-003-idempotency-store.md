# ADR-003: Idempotency in PostgreSQL at two layers (not Redis)

**Status:** Accepted · 2026-11-20

## Context
Clients retry after timeouts. The Week 9 workshop adds a harder case: the customer taps again from a new app session, so the request arrives with a *different* key.

## Decision
- **Layer 1 (HTTP):** the `Idempotency-Key` header, keyed by `(principal, operation, key)`, with a stored request hash and the stored response.
  - Same key and same body: the stored response is replayed (`Idempotent-Replayed: true`).
  - Same key while the first request is still running: `409 IDEMPOTENCY_IN_PROGRESS`.
  - Same key with a different body: `422 IDEMPOTENCY_KEY_REUSED`.
- **Layer 2 (business):** a partial unique index allows only one *live* payment per payment request (QR or order). A second attempt gets `409 PAYMENT_ALREADY_IN_PROGRESS`.
- **Ledger layer:** `UNIQUE(txn_id, posting_type)` means a retried posting can never post twice.

## Why not Redis
- Keeping the key in PostgreSQL places it next to the ledger, so the key record and the money movement share durability and can be checked together.
- Redis would add a second store whose failure modes, such as eviction or a restart without persistence, could re-allow a duplicate.

## Consequences
- There is one extra write per command. That is acceptable at prototype scale.
