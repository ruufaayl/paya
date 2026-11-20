# ADR-001: Modular monolith with synchronous commands and asynchronous events

**Status:** Accepted · 2026-11-20

## Context
The brief requires OpenAPI for synchronous services and at least one durable asynchronous flow. The team is small, the time frame is short, and operational complexity is a real cost (Week 11).

## Decision
- Paya is one deployable service with separate modules: payments, ledger, risk, rail, recon, events and security.
- Commands and queries are synchronous HTTP: paying, creating QR requests, and back-office decisions.
- State facts (`payment.*`, `case.opened`, `recon.completed`) are asynchronous events published through a transactional outbox.
- The settlement file is a batch exchange with a control trailer.
- This is the hybrid integration pattern from Week 5: an API for immediate decisions, events for reactions, batch for reconciliation.

## Evaluation (Week 5 dimensions)
| Dimension | Microservices | Modular monolith (chosen) |
|---|---|---|
| Coupling | Low, but needs strict contracts | Medium; module boundaries enforced by package and database role |
| Latency | Network hops on every step | In-process calls; one database transaction for validate → authorise → post |
| Consistency | Sagas everywhere | Local ACID for the money path; eventual consistency only for reactions |
| Scalability | Independent scaling | Scales vertically; contexts can be split later along the same seams |
| Observability | Needs distributed tracing | One correlation ID across logs, events and audit |
| Recovery | Many failure points | One worker reconciles unfinished work after a restart |

## Consequences
- The modules cannot be scaled independently.
- Validation, authorisation and posting are atomic. The rail is the only remote dependency, and it is isolated behind `RailPort`.
