# ADR-007: Concurrency control with row locks, backed by database constraints

**Status:** Accepted · 2026-11-21 (after the load-test finding)

## Context
- The API's post-response dispatch, the recovery worker, async rail callbacks, status enquiries and reconciliation can all act on the same payment at the same moment.
- The first load test showed two actors racing to post SETTLE. The `UNIQUE(txn_id, posting_type)` constraint stopped the double posting, but the refused insert surfaced as an unhandled error.

## Decision
- **Row-lock the transaction** (`SELECT … FOR UPDATE`) on every path that applies a rail answer. Under the lock, a repeat answer is a no-op.
- **Make the first send an atomic claim** (`only_first_send`), so the worker never repeats the API's dispatch.
- **Serialise get-or-create** with advisory locks (accounts; mock rail per E2E id).
- **Keep the database constraints** (unique postings, partial unique indexes, balanced-journal trigger) as the last line of defence, not the normal control flow.
- **Optimistic version check** on every state transition.

## Alternatives considered
- **Serialisable isolation everywhere:** more retries and harder to explain at the viva.
- **A single-threaded worker only:** does not cover the API path or callbacks.

## Consequences
- `test_concurrent_dispatch_callbacks_and_enquiries_settle_exactly_once` passed 5 out of 5 runs.
- The load test re-run had zero errors and zero duplicate SETTLE journals across 400 payments.
- Lock hold times are short, measured in milliseconds.
