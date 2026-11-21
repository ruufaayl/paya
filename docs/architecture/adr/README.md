# Architecture decision records

| ADR | Decision | Rubric area |
|---|---|---|
| [001](ADR-001-modular-monolith-sync-and-async.md) | Modular monolith; synchronous commands, asynchronous events, batch file | Architecture & bounded contexts |
| [002](ADR-002-double-entry-ledger.md) | Append-only double-entry ledger in PostgreSQL | Ledger, data & reconciliation |
| [003](ADR-003-idempotency-store.md) | Idempotency in PostgreSQL at two layers (not Redis) | Integration & transaction integrity |
| [004](ADR-004-outbox-before-broker.md) | Transactional outbox/inbox; broker later | Integration & transaction integrity |
| [005](ADR-005-rail-port-and-mock-raast.md) | `RailPort` with a simulated Raast rail in its own schema | Integration; ethics (no probing real services) |
| [006](ADR-006-timeout-means-pending.md) | A timeout is PENDING (unknown), never FAILED | Transaction integrity; resilience |
| [007](ADR-007-concurrency-row-locks-plus-constraints.md) | Row locks plus DB constraints as the last line of defence | Transaction integrity; resilience |
| [008](ADR-008-ai-rules-first.md) | AI triage: rules first, LLM optional, suggestion only | Responsible AI |
| [009](ADR-009-live-telemetry-and-pwa.md) | One PWA plus a live WebSocket stream for Mission Control | Observability; communication |
| [010](ADR-010-onboarding-machines-approve-people-decide.md) | Onboarding: machines approve clear cases, people decide the rest; no biometric data at rest | Identity/KYC; responsible AI; data protection |
| [011](ADR-011-assistant-bounded-deterministic.md) | Conversational banking: bounded, deterministic assistant that cannot move money | Channels; responsible AI; data protection |
| [012](ADR-012-green-banking-ledger-native-and-honest.md) | Green banking: labelled estimates, green pot on ledger 2110, offsets as ordinary payments | Products; ledger; responsible claims |
