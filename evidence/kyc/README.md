# Evidence: digital onboarding and KYC (Theme 1)

| Claim | Evidence |
|---|---|
| All 15 onboarding scenarios pass (K1–K15) | `tests/test_kyc.py`; full suite in `../tests/` |
| The real YuNet + SFace models run end to end and open a wallet | K13, K14 (drawn synthetic face; no real person) |
| **Paya 2.0 browser run, 12/12:** a real browser on an emulated iPhone completes onboarding with the real models; a near watch-list name is referred without tipping off; the applicant token is refused outside onboarding; in Mission Control the same officer cannot confirm their own recommendation, a second officer approves, and the waiting phone updates by itself; both decisions and the refused self-confirmation are in the audit chain | `e2e-run.txt` (`docs/architecture/tools/kyc_e2e.cjs`), screenshots in `../screenshots/kyc/` |
| Real-model scores in that run | Face match cosine **0.876** (SFace threshold 0.363); head-turn liveness passed first time; 7 checks recorded with engine versions |
| No image or face template is stored anywhere | K9 scans every text/JSON column in every schema for image data; no binary columns exist |
| No automatic rejection; unknown = referral | K5, K6 |
| Two-person rule enforced by the service **and** the database | K7 and the browser run |
| Integrity monitor catches a wrongful auto-approval | K15 |

Screenshots: `a-*` = clean applicant (intro, details, specimen card, liveness, result, wallet); `b-*` = referred applicant, the Mission Control review, the two-person refusal, and the phone after approval.

Run again: `make models` once, start the API on :8000 (fresh database) and the web app on :5173, then `node docs/architecture/tools/kyc_e2e.cjs`.

The Paya 1.x run and its screenshots are kept in `v1/` and `../screenshots/kyc/v1/`.
