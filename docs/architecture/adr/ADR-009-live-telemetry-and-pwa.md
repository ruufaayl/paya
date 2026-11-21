# ADR-009: One React PWA plus a live WebSocket stream for Mission Control

**Status:** Accepted · 2026-11-20

## Context
- The demo has to show correctness (holds, retries, reversals, reconciliation) as it happens, on a phone and on a laptop.
- The brief requires at least one dashboard or metrics view, and says notifications must never create financial truth.

## Decision
- One React app (Vite, Tailwind, React Flow) with two experiences: `/app`, an installable PWA for customers and cashiers, and `/control`, Mission Control.
- The backend publishes two streams over one authenticated WebSocket (`/v1/stream`), filtered by role:
  - outbox **events**, which are durable business facts;
  - non-durable **telemetry**, used only for animation.
- Customers see only their own events.
- Screens always re-read authoritative state from the API.
- The service worker never caches API responses.

## Alternatives considered
- **Grafana only:** good for technical metrics, but cannot show human gates or explain a payment.
- **A native mobile app:** too much build effort for the gain.

## Consequences
- Mission Control is observability evidence, not a scripted animation: every pulse is a real event.
- Telemetry is per process. With several API processes, a broker would be needed to fan it out (ADR-004, tech-debt register).
