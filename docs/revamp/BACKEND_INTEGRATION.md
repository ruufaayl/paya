# Backend integration: every screen and action mapped

The frontend is never the authority for financial truth. Every value shown and every action taken maps to an endpoint below, and permissions are enforced there.

## Wallet

| UI | Endpoint | Server-side guarantees |
|---|---|---|
| Sign in | `POST /v1/auth/login` | Argon2; lockout after 5 failures / 15 min |
| Home, Activity | `GET /v1/wallet` | Ledger and available balances computed from journals and holds |
| Open tills | `GET /v1/payment-requests?status=OPEN` | Demo-mode only |
| Review | `GET /v1/payment-requests/{id}` | Merchant identity and amount from our database |
| Authorise | `POST /v1/payments` + `Idempotency-Key` | HTTP idempotency, one live payment per request, posting uniqueness, row locks |
| Result, detail, receipt | `GET /v1/transactions/{ref}` | Status from the state machine; customer sees only their own payments; `money_trail` from journals |
| Live refresh | `WS /v1/stream` | Customer sees only events whose payload carries their id |
| Onboarding | `/v1/onboarding/*` | KYC rules `kyc.v1`; applicant token scoped to one application |
| Till | `POST/GET /v1/payment-requests`, `GET /v1/merchant/transactions` | Cashier sees only their merchant |

## Mission Control

| UI action | Endpoint | Permission | Notes |
|---|---|---|---|
| Choose operator | `POST /v1/auth/login`, `GET /v1/me` | any staff | Console refuses roles without back-office access |
| Overview | `GET /v1/ops/overview`, `/v1/ops/timeseries` | backoffice:read | |
| Search / explorer | `GET /v1/ops/transactions` | backoffice:read | |
| Transaction drawer | `GET /v1/transactions/{ref}` | staff | Ledger, screening, cases, approvals, recon, audit |
| Ask the rail now | `POST /v1/ops/transactions/{ref}/enquiry` | ops:enquiry | |
| Request reversal (maker) | `POST /v1/ops/transactions/{ref}/reversal-requests` | reversal:request | |
| Approve reversal (checker) | `POST /v1/finance/approvals/{id}/approve` | reversal:approve | DB `CHECK approved_by <> requested_by` |
| Case queue, detail | `GET /v1/cases`, `GET /v1/cases/{ref}` | cases:read | |
| Assign / take | `POST /v1/cases/{ref}/assign` | cases:assign + owner role | Audited; refusal audited |
| Release / reject hold | `POST /v1/compliance/holds/{ref}/decision` | compliance:decide | |
| Resolve break | `POST /v1/cases/{ref}/resolve` | cases:resolve + owner role | Moves no money |
| Ask AI / review suggestion | `POST /v1/ai/cases/{ref}/triage`, `POST /v1/ai/suggestions/{id}/review` | ai:triage, ai:review | Never on KYC |
| KYC list, evidence | `GET /v1/kyc/applications[/{ref}]`, `/v1/kyc/engine` | kyc:read | |
| KYC decision | `POST /v1/compliance/kyc/{ref}/decision` | kyc:decide | Two-person rule (service + DB) |
| Import & reconcile / same file again | `POST /v1/finance/recon/run` | recon:run | File SHA-256 unique |
| Runs, lines | `GET /v1/finance/recon/runs`, `.../runs/{id}/items` | finance:read / backoffice:read | |
| Trial balance, integrity | `GET /v1/finance/trial-balance`, `/v1/finance/integrity` | finance:read | |
| Rail scenario | `POST /v1/chaos/rail` | chaos:control (demo mode) | Audited |
| Registry scenario | `POST /v1/chaos/registry` | chaos:control (demo mode) | Audited |
| Re-deliver event | `POST /v1/chaos/relay-duplicate` | chaos:control | Consumers idempotent |
| Test payment (rail lab) | `POST /v1/payment-requests` (as Ayesha), `POST /v1/payments` (as Sara) | their own roles | Synthetic actors, labelled |
| Event stream | `WS /v1/stream`, `GET /v1/events` | backoffice:read | |
| Audit log | `GET /v1/audit/log` | audit:read | Chain verified on each read |
| Access matrix | `GET /v1/admin/access` | access:read | |

## What did not change

`ledger.py`, `payments.py`, `state.py`, `rail.py`, `recon.py`, `kyc.py`, `idempotency.py`, `audit.py`, `events.py`, and the integrity DDL (except one additive column statement). The full backend suite still passes, with 9 new tests added (56 total).
