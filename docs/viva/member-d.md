# Member D (Kanz ur Rehman, 24i-5544): security, RBAC, SoD, KYC/AML, audit, threat model

**Read:**
- `src/paya/security.py`: `PERMISSIONS`
- `src/paya/risk.py`: `screen`
- `src/paya/audit.py`: `record`, `verify_chain`
- `src/paya/observability.py`: `LoginGuard`, `scrub`
- `payments.compliance_decide`, `payments.approve_reversal`
- `docs/architecture/10-identity-kyc-consent-controls.md`, `11-threat-model.md`
- `evidence/security/`

## 90-second explanation
> "Eight roles, least privilege, and one role per user, so a person can never hold maker and checker at once. Reversals are requested by Ops and approved by Finance, enforced in the application and by a database CHECK. KYC and AML rules are versioned configuration, and every decision stores the rules fired and the data used. A hold moves no money until Compliance decides. The audit log is hash-chained and verifiable. The threat model covers 15 STRIDE threats with residual risk, and we fixed real vulnerable dependencies our audit found."

## Questions you must handle

| Question | Answer |
|---|---|
| Show me SoD in the database | `ck_maker_checker: approved_by <> requested_by` in `models.Approval` (`test_s6b_*`) |
| What if someone tries to approve their own reversal? | Refused with 403 `SEGREGATION_OF_DUTIES`. The denial is audited **in its own transaction**, so it survives the rollback (`test_s6c_*`) |
| How does the audit chain detect tampering? | Each row stores the SHA-256 of the previous row's hash plus its own content. `/v1/audit/verify` recomputes the chain and reports the first broken row |
| What stops brute force? | 5 failures in 15 min → 429 `LOGIN_LOCKED` (even with the right password), audited; plus 30 login attempts a minute per address. Both are in PostgreSQL, so they survive restarts and are shared across processes (ADR-016) |
| Where could a customer see someone else's data? | Nowhere: a foreign `txn_ref` returns 404, and the stream is filtered by ownership (`test_s8_*`) |
| What PII do you store? | None real. A synthetic `idv_token`; masked phone and IBAN strings; logs are scrubbed by key |
| Top residual risks? | Tokens in browser storage (XSS could read one, but it can be revoked at once, ADR-017); unsigned rail callbacks in the mock (T-05); a stolen *owner* DB credential (the app role cannot disable triggers, ADR-015); no MFA recovery codes |
| What did the dependency audit find? | Vulnerable Starlette (upgraded FastAPI 0.115 → 0.165), react-router highs (6.30.6), pytest (9.0.3). Two moderate react-router advisories are mitigated by UUID-only QR routing |

## Theme 1 and Paya 2.0 additions (also yours)

- **Digital onboarding and KYC (Theme 1):** `src/paya/kyc.py`, `kyc_engines.py`, `registry.py`, ADR-010, doc 16, tests K1–K15. Know: machines approve only clear cases, people reject; the two-person rule (service check + DB `CHECK`); no images or face templates stored (K9); licences of YuNet (MIT) and SFace (Apache 2.0).
- **Operator identity in Mission Control:** every action runs as the signed-in staff member; `/v1/me` returns permissions for display only, and the server enforces them. New permissions: `cases:assign`, `access:read`, `assistant:use`.
- **Threat model additions:** T-16 to T-21 (liveness spoofing, biometric data, two-person rule, fairness, chat injection, chat data).
- **Rate limiting (ADR-016), yours:** `src/paya/ratelimit.py`, migration `0003`, tests L1–L9, `evidence/security/rate-limits-2026-11-21.md`. Know the four durable limits (login per address, lockout per username, onboarding per address, chat per customer) and the per-client ceiling; why a sliding window and not a fixed one (L8); why keys are HMAC hashes (L7); why `X-Forwarded-For` is ignored unless configured; and why the whole demo runs with zero refusals. Likely question: "Everyone behind the cloudflared tunnel shares one address. Can one person lock out the demo?" (they could use up the 30 logins a minute for that address, but not lock other users' accounts: the lockout is per username).
- **Sessions, revocation and staff MFA (ADR-017), yours:** `src/paya/auth.py`, `api/auth_api.py`, migration `0004`, the console's Security page, tests A1–A13, browser run `mfa_e2e.cjs` (opt-in 9/9, enforced 3/3). Know: why every token names a server-side session (revocation on the next request, also for the WebSocket); why the console does not silently sign back in after a revocation; the TOTP details (RFC 6238 vectors, ±1 step, a code works once, 5 wrong codes per 5 min); why the password alone yields only a challenge that no endpoint accepts; AES-GCM with the user id as associated data; why an administrator cannot reset their own MFA; and why MFA is opt-in in demo mode but enforced by default otherwise. Likely question: "A staff laptop is stolen. What do you do?" (Security → Staff accounts → End sessions with a reason: the token stops on its next request; reset MFA if the phone went too).
