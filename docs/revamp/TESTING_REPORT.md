# Testing report (Paya 2.0)

Run on 2026-11-21 against PostgreSQL 16 and the real face models (YuNet/SFace), on a **fresh database** for the acceptance run. All numbers below are from actual runs; nothing is estimated.

## Summary

| Suite | Tool | Result | Evidence |
|---|---|---|---|
| Backend unit and integration (financial integrity S1–S13, security, AI, KYC K1–K15, **ops API O1–O9**, **assistant C1–C10**) | pytest | **66 passed**, 0 failed (47 before the revamp + 9 ops + 10 assistant) | `pytest -q` |
| Conversational banking in a real browser (wallet chat → handoff → Ops transcript → close) | Playwright | **8 / 8** | `evidence/revamp/assistant-e2e.json`, `docs/revamp/tools/assistant_e2e.cjs` |
| End-to-end acceptance (wallet + Mission Control, real backend) | Playwright | **33 / 33 checks passed** | `evidence/revamp/e2e-results.json`, `docs/revamp/tools/revamp_e2e.cjs` |
| Accessibility (axe-core 4.10, WCAG 2.x A/AA rules, 13 screens) | axe | **0 violations** (2 found and fixed) | `evidence/revamp/a11y-axe.json` |
| Colour contrast (both themes) | `contrast_check.py` | **0 of 56 pairs fail** | `docs/revamp/contrast-report.md` |
| Chart palette colour-blind separation | dataviz validator | All checks pass (dark mode) | `PAYA_DESIGN_SYSTEM.md` §2 |
| Type check + production build | `tsc -b && vite build` | Pass | |
| Dependency audit (web) | `npm audit --omit=dev` | 2 moderate (react-router 6.x, already in the debt register); **no new advisories** from added packages | |

## Acceptance checks (all PASS)

**Customer**
1. Onboarding: clean applicant auto-approved (real models, drawn synthetic face).
2. Wallet activation: the new wallet shows a synthetic Rs 5,000 read from the ledger.
3. Payment: success shown only after the backend reports SETTLED.
4. Receipt opens with the reference.
5. Client retry: the same idempotency key returns the same payment, with no double debit.
6. Refresh during processing: still "Processing" after a reload (status read from the server).
7. Pending: the screen never shows "Paid" before the backend settles (sampled continuously: screen read first, then backend).
8. Pending: shows "Processing" while the backend is PENDING (rail scenario "lost request").
9. Pending: the recovery agent settles it exactly once, then the screen says "Paid".
10. Rejected: an unverified customer sees "Declined" and no money moves.
11. Onboarding: a near-watch-list name is referred, with no tipping off.
12–13. Wallet at 360 px and 430 px: no horizontal overflow.

**Operations**
14. Unauthorised: a cashier is refused by the console.
15. Overview loads real metrics.
16. Transaction explorer: search by reference, open full detail with ledger postings (AUTH_POST, SETTLE).
17–19. Rail lab: DUPLICATE_ACK → SETTLED; REJECT → REVERSED; PARTIAL → SETTLED.
20. Reconciliation run recorded.
21. Identical file refused.
22. Unmatched record (MISSING_EXTERNAL) has an owned case.
23. Exception assignment: the case is assigned to the operator, and audited.
24. AI triage suggestion recorded (advisory only).
25. Exception resolved by its owner.
26. Two-person rule: the same officer cannot confirm their own recommendation (server refusal).
27. Two-person rule: the second officer approves.
28. Unauthorised finance action: 403 from the server.
29. Audit page restricted for Ops.
30. Audit log: chain intact, denials visible.
31–32. Console at 1280 px and 1920 px renders without page-level overflow.
33. Event stream lists real events.

## Defects found during testing (and fixed)

| Found by | Defect | Fix |
|---|---|---|
| Visual review | Topology unreadable at fit-to-screen (wide layout, inspector column) | Full-width canvas, floating inspector, tighter layout, larger node text |
| Visual review | Dates and references wrapped in table cells | `whitespace-nowrap` on references and dates |
| Visual review | Topology could show "error in last minute" for events replayed from the server's buffer | Use each message's own timestamp |
| axe | Logo `aria-label` on a span without a role | `role="img"` |
| axe | 85% opacity caption on the brand action card under AA | Full opacity |
| Dev environment | A stale Docker API container held port 8000, so screenshots hit the 1.x backend | Container stopped (not removed); documented |
| Rail-lab copy review | Test ids quoted for scenarios did not match `tests/test_scenarios.py` | Corrected to S1, S3, S4, S5, S10, S10b, S12 |
| Harness | Pending check sampled too late or under the wrong scenario; modal drawer blocked the operator switch; liveness retry not followed | Continuous sampling under "lost request"; harness closes drawers; harness retries like a person |

## Not covered / outstanding

- **Frontend component unit tests** were not added. Behaviour is covered end to end by the acceptance run instead.
- The **Week 14 demo rehearsal** (`docs/architecture/tools/demo_rehearsal.cjs`) and the **Theme 1 browser run** (`docs/architecture/tools/kyc_e2e.cjs`) target the 1.x UI selectors and will not run against 2.0 without updating. Their recorded 1.x evidence remains valid as history. The revamp acceptance run covers the same flows, and more, on 2.0. Update `docs/demo/demo-script.md` before the next demo.
- No screen-reader user testing (see `ACCESSIBILITY_REVIEW.md`).
- No load test of the new read endpoints. They are paginated and indexed on existing columns, but have not been measured under load.
