# 10: Identity, access, KYC/AML and consent controls

**Gate:** Week 12, identity/consent or KYC controls.
**Code:** `src/paya/security.py`, `risk.py`, `audit.py`, `models.py` (`consents`, `cases`, `approvals`).

## 1. Authentication

| Control | Implementation | Limit (honest) |
|---|---|---|
| Passwords hashed | Argon2id (`argon2-cffi`) | Demo users share one synthetic password, in demo mode only |
| Session tokens | JWT HS256, 60-minute expiry, signed with a secret of 32+ characters from the environment | No refresh or revocation list yet; an OIDC provider (Keycloak) is the documented path |
| Failed logins | Audited with outcome `DENIED` in the hash-chained log | No lockout or rate limit yet (Week 13 threat model item) |
| Secrets | `.env` (git-ignored); Compose refuses to start without `PAYA_JWT_SECRET` | Local prototype; no vault |
| Transport | HTTPS via the tunnel or Vercel for demos | Local Compose uses plain HTTP on localhost |

## 2. Authorisation: least privilege and segregation of duties

Permission matrix (source of truth: `security.PERMISSIONS`; every refusal is audited):

| Permission | Customer | Cashier | Merchant admin | Ops | Compliance | Finance | Sys admin | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Pay from own wallet | ✔ | | | | | | | |
| Read own wallet and transactions | ✔ | | | | | | | |
| Create payment request (QR) | | ✔ | ✔ | | | | | |
| Read own merchant's sales | | ✔ | ✔ | | | | | |
| Status enquiry | | | | ✔ | | | | |
| **Request** reversal (maker) | | | | ✔ | | | | |
| **Approve** reversal (checker) | | | | | | ✔ | | |
| Release or reject compliance hold | | | | | ✔ | | | |
| Run reconciliation | | | | | | ✔ | | |
| Read cases | | | | ✔ | ✔ | ✔ | | ✔ |
| Read back office (transaction detail with ledger) | | | | ✔ | ✔ | ✔ | ✔ | ✔ |
| Finance reports, integrity checks | | | | | | ✔ | | ✔ |
| Verify audit chain | | | | | ✔ | | | ✔ |
| Chaos controls (demo mode only) | | | | ✔ | | | ✔ | |

**Segregation-of-duties rules:**

| # | Rule | Enforced by | Proven by |
|---|---|---|---|
| SoD-1 | Nobody can both request and approve a reversal | Different roles (OPS vs FINANCE), plus an application check (the denial is audited in its own transaction), plus DB `CHECK approved_by <> requested_by` | `test_s6_*`, `test_s6b_*`, `test_s6c_*` |
| SoD-2 | The compliance officer decides holds but cannot post, reverse or reconcile | No posting permissions for COMPLIANCE | matrix |
| SoD-3 | Only Compliance can release or reject holds; Ops and Finance cannot | Matrix | `test_s7_*` (Ops attempt refused with 403) |
| SoD-4 | The system administrator can change chaos/config in demo mode but has no financial permission | Matrix | matrix |
| SoD-5 | The auditor is read-only everywhere | Matrix | matrix |
| SoD-6 | Customers cannot see other customers' transactions; references are not revealed | `404` instead of `403` for foreign `txn_ref` | `test_s8_*` |

### Joiner-mover-leaver (Week 10 reading pack)

| Event | Required action | Prototype status |
|---|---|---|
| Joiner | Account created with exactly one role, by an administrator, audited | Seeded users only; admin UI not built |
| Mover (e.g. Ops → Finance) | Old role removed **before** the new one is granted, so one person never holds maker and checker at once | One role per user by design (`users.role` is a single value). This makes the SoD conflict structurally impossible |
| Leaver | `users.active = false`; tokens expire within 60 minutes | `active` flag enforced at login; no token revocation list (gap) |

## 3. KYC / AML / fraud controls (transaction time)

Rules engine `risk.screen`, version `rules.v1`. Every decision stores the rules fired and the data used.

| Rule | Condition | Outcome | Rationale |
|---|---|---|---|
| `KYC_NOT_VERIFIED` | Customer KYC not VERIFIED, or tier 0 | **REJECT** | No payments before identity is established (Week 3 control defect: "account opened before KYC completion") |
| `TIER_LIMIT_EXCEEDED` | Amount > tier limit (tier 1: PKR 25,000; tier 2: PKR 500,000, synthetic) | **REJECT** | Risk-based limits by KYC level |
| `VELOCITY` | 5 or more earlier payments by the same customer in the last 10 minutes | **HOLD** | Account takeover or testing behaviour |
| `WATCHLIST_MATCH` | Customer or merchant name on the synthetic watch-list | **HOLD** | Sanctions screening (stand-in for UNSC/ATA lists) |
| `HIGH_RISK_CUSTOMER_LARGE_PAYMENT` | Risk rating HIGH and amount ≥ PKR 10,000 | **HOLD** | Enhanced due diligence |

**Human escalation:**
- A HOLD creates a `COMPLIANCE_HOLD` case with a 4-hour SLA, owned by Compliance.
- **No money moves while a payment is held.** A held payment has no journal (evidence E4). Release re-enters the normal authorise → post path. Reject ends it with the reason recorded.
- The decision, reviewer and reason are stored on the case and in the audit chain.
- Thresholds, limits and the list are configuration (`config.py`, `risk.WATCHLIST`), not code paths (Week 6: configure first).

**Onboarding KYC (Theme 1, planned):** document OCR, active liveness, face match and a mocked identity-registry adapter, with REFERRED cases going to Compliance. Design is in the Stage 3 plan. This build implements the *transaction-time* controls above. Customer `kyc_status` and `kyc_tier` are the integration point.

## 4. Consent and privacy

| Control | Implementation |
|---|---|
| Purpose- and channel-specific consent | `consents(customer_id, purpose SERVICE / MARKETING / PARTNER_SHARING, channel, granted_at, revoked_at)` |
| Executable, not just documented (Week 7) | The notifier sends only SERVICE (transaction) messages. No marketing path exists. Future marketing or partner sharing must check an un-revoked consent row for that purpose and channel |
| Data minimisation | No CNIC, biometric, card, real IBAN or real phone number fields. Identity is a synthetic `idv_token`, phones and IBANs are masked strings, and events carry internal IDs only |
| No data leaks in contracts | Event schemas declare a privacy class; the stream is filtered by role (customers see only their own events) |
| Idempotency keys | Random UUIDs; never contain personal data (Week 9) |
| Logs and telemetry | Telemetry carries `txn_ref`, amounts and rule names, never names or identifiers |
| Retention | Prototype keeps everything for evidence. A production retention schedule is required (gap, documented) |

## 5. Audit trail

- Covers who, what, when, why, how and evidence (Week 9). Each `audit_log` row has actor, role, action, object, outcome, reason, channel and correlation ID.
- Each row stores the SHA-256 of the previous row (`prev_hash` → `row_hash`). `GET /v1/audit/verify` recomputes the chain and reports the first broken row.
- Audited events:
  - every login, successful or failed;
  - every refused permission;
  - every compliance decision;
  - every reversal request and approval, including a refused self-approval;
  - every chaos-mode change.
