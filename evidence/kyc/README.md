# Evidence: digital onboarding and KYC (Theme 1)

| Claim | Evidence |
|---|---|
| All 15 onboarding scenarios pass (K1–K15) | `test-run.txt` (`tests/test_kyc.py`) |
| The real YuNet + SFace models run end to end and open a wallet | K13, K14 (drawn synthetic face; no real person) |
| A real browser on an emulated iPhone completes onboarding; a near watch-list name is referred, needs two officers, and the phone updates when they decide | `e2e-run.txt` (`docs/architecture/tools/kyc_e2e.cjs`), screenshots in `../screenshots/kyc/` |
| Real-model scores in that run | Face match cosine 0.859 (threshold 0.363); all head-turn steps passed |
| No image or face template is stored anywhere | K9 scans every text/JSON column in every schema for image data; no binary columns exist |
| No automatic rejection; unknown = referral | K5, K6 |
| Two-person rule enforced by the service **and** the database | K7 |
| Integrity monitor catches a wrongful auto-approval | K15 |

Screenshots: `a-*` = clean applicant (intro, details, specimen card, liveness, approved, wallet); `b-*` = referred applicant and the Mission Control review with the two-person rule.

Run again: start the API (with `make models` done) on :8000 and `npx vite preview` on :4173, then `node docs/architecture/tools/kyc_e2e.cjs`.
