# ADR-004: Transactional outbox and inbox now; RabbitMQ as a later relay target

**Status:** Accepted · 2026-11-20

## Context
The brief requires at least one durable asynchronous flow with duplicate-safe consumers. The failure Week 5 warns about: "a transaction commits but the related event is lost".

## Decision
- **Outbox:** state changes and their events are written in the same database transaction (`outbox` table).
- **Relay:** a relay publishes rows in sequence order, at least once. After a crash it republishes every row where `published_at IS NULL`.
- **Inbox:** consumers record `(consumer, event_id)` in `processed_events` inside their own transaction, so redelivered events have no second effect (tested in S3).
- **Rail acknowledgements** are consumed the same way. They can be duplicated or delayed.
- **RabbitMQ** (with a dead-letter exchange) can be added later as the relay's destination without changing producers or consumers.

## Consequences
- The prototype has no broker container yet. This is recorded in the technical debt register.
- Event durability does not depend on a broker. The outbox *is* the durable log, and it is easy to show at the viva.
