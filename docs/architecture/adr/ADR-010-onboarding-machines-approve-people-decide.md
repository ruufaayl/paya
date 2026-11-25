# ADR-010: Onboarding — machines approve clear cases, people decide the rest; no biometric data at rest

**Status:** accepted · **Date:** 2026-11-21 · **Area:** identity / KYC, responsible AI, data protection

## Context

Theme 1 asks for digital onboarding with biometrics, document reading and AI. Rupay is a technology service provider to a licensed partner, so it cannot make the final legal KYC decision on its own. The course rules forbid real CNIC or biometric data. Face-matching models make mistakes, and their error rates can differ between groups of people.

## Decision

1. **Automated approval only when every check passes.** Any other result, including "the registry did not answer" and "the model is missing", becomes a `KYC_REVIEW` case owned by Compliance. No automated path rejects an applicant.
2. **Two-person rule** for approving a possible watch-list match. This is enforced in the service and by a database `CHECK` constraint.
3. **No biometric data at rest.** Images and templates exist only within one request. The card photo is sent again at the verify step, instead of keeping a template between steps. Only keyed digests, scores and reasons are stored.
4. **Permissive, pinned models.** YuNet (MIT) and SFace (Apache 2.0) from the OpenCV zoo, with SHA-256 pinned. InsightFace was rejected because of its non-commercial licence.
5. **Simulated registry behind `RegistryPort`, with synthetic SPECIMEN identities.** This mirrors ADR-005 for the rail.
6. **Applicant token:** a separate `APPLICANT` role, valid for 30 minutes, that can only complete its own application.

## Consequences

- More referrals than a vendor product would produce. This is an accepted cost: Compliance workload is the price of not refusing people by algorithm. The referral rate is a metric to watch.
- The verify request is larger (card + 3 frames, about 0.5–1 MB), in exchange for nothing biometric being stored.
- Liveness is basic (active head turns). A certified PAD vendor can replace `FaceEngine` without changing the rules.
- Tests need no real faces: a mock engine drives the rules, and drawn faces exercise the real models.

## Alternatives rejected

- *Auto-reject on face non-match:* unfair under biometric error rates, and not our legal decision to make.
- *Store encrypted templates for re-verification:* a breach would leak biometric data that can never be changed; not needed for the prototype.
- *Tesseract OCR of printed fields:* less reliable than a signed machine-readable code, and needs a system package. It could be added later behind the same interface.
