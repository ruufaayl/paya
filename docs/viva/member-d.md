# Member D: security, RBAC, SoD, KYC/AML, audit, threat model

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
| What stops brute force? | 5 failures in 15 min → 429 `LOGIN_LOCKED` (even with the right password), audited. Limit: the lock state is in-process |
| Where could a customer see someone else's data? | Nowhere: a foreign `txn_ref` returns 404, and the stream is filtered by ownership (`test_s8_*`) |
| What PII do you store? | None real. A synthetic `idv_token`; masked phone and IBAN strings; logs are scrubbed by key |
| Top residual risks? | Stolen token (no revocation); no general rate limit (T-09); a DB superuser could disable triggers (T-03); unsigned rail callbacks in the mock (T-05) |
| What did the dependency audit find? | Vulnerable Starlette (upgraded FastAPI 0.115 → 0.165), react-router highs (6.30.6), pytest (9.0.3). Two moderate react-router advisories are mitigated by UUID-only QR routing |
