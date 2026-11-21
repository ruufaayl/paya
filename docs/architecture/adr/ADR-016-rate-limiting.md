# ADR-016: Rate limiting: durable limits on abuse-prone actions, plus a per-client ceiling

**Status:** accepted · **Date:** 2026-11-21 · **Area:** security, availability

## Context

Three items in the technical-debt register, plus part of a pilot condition:
- the login lockout was held in process memory, so a restart cleared it, and with several processes each would keep its own count;
- there was no general API rate limit (threat T-09, rated "high for a public deployment");
- `/v1/onboarding/start` could be spammed with applications.

The assistant also had its own in-memory limit.

## Decision

1. **Named limits in PostgreSQL** (`rate_limit_counters`, migration 0003). They are shared by every API process and survive restarts. Each uses a sliding-window estimate: the previous window weighted by its remaining overlap, plus the current window. This avoids the burst a fixed window allows at its boundary.

   | Limit | Default | Key |
   |---|---|---|
   | Login attempts | 30 / minute | client address |
   | Login failures → lock | 5 / 15 minutes, then `LOGIN_LOCKED` even with the right password; cleared by a successful login | username |
   | Wallet applications (onboarding start) | 10 / hour | client address |
   | Assistant messages | 20 / minute | customer |

2. **A per-client ceiling on every `/v1` call** (default 600 per minute, keyed by the signed-in user, else the client address). It is held in process memory, because it is cheap and checked on every request. In production this layer belongs at the gateway or reverse proxy; health and metrics are never limited.
3. **Every refusal is a 429** with `Retry-After` and a stable code (`RATE_LIMITED` with its `scope`, or `LOGIN_LOCKED`). Each is counted, and logged as a `security.rate_limited` event; login denials are also audited.
4. **No personal data in the counters.** Keys are HMAC-SHA256 hashes under the server secret.
5. **Client address** is the socket peer. `X-Forwarded-For` is honoured only when `PAYA_TRUST_FORWARDED_FOR=true`, behind a proxy you control; otherwise a caller could choose their own key.
6. **Configurable, not removable, for tests.** Every limit is a setting. The load test raises the per-client ceiling instead of switching limiting off.

## Consequences

- Brute force, application spam and chat flooding are bounded, across processes and restarts.
- Each limited action costs one extra small database write. This is acceptable for actions that are already heavy (login hashes a password, onboarding runs image checks).
- Behind one tunnel or NAT, every user shares an address. The address limits are set high enough that the full demo and every browser suite run with zero refusals (evidence).
- Still open: MFA and token revocation, the rest of that pilot condition.

## Alternatives rejected

- **Redis:** another service to run, for a prototype that already has PostgreSQL.
- **Limiting only at a gateway:** the prototype has none, and the domain limits (per username, per customer) need application identity.
- **Fixed windows:** they allow a double burst at the boundary.
