# Testing report (Paya 2.0)

Run on 2026-11-21 against PostgreSQL 16 and the real face models (YuNet/SFace), on a **fresh database** for the acceptance run. All numbers below are from actual runs; nothing is estimated.

## Summary

| Suite | Tool | Result | Evidence |
|---|---|---|---|
| Backend unit and integration (financial integrity S1–S13, security, AI, KYC K1–K15, **ops API O1–O9**, **assistant C1–C10**, **green banking G1–G11**, **super app P1–P13**, **stablecoin sandbox SC1–SC12**, **migrations and DB roles M1–M6**) | pytest | **115 passed**, 0 failed, **all running as the data-only `paya_app` role** (47 before the revamp + 9 ops + 10 assistant + 11 green + 13 super app + 12 sandbox + 13 migrations/roles, M3 parametrised over 8 statements) | `pytest -q` |
| Conversational banking in a real browser (wallet chat → handoff → Ops transcript → close) | Playwright | **8 / 8** | `evidence/revamp/assistant-e2e.json`, `docs/revamp/tools/assistant_e2e.cjs` |
| Green banking in a real browser (footprint → pot with double tap → round-ups → offset through the normal review → certificate → Mission Control aggregates → integrity) | Playwright | **14 / 14** | `evidence/revamp/green-e2e.json`, `docs/revamp/tools/green_e2e.cjs`, `evidence/screenshots/green/` |
| End-to-end acceptance (wallet + Mission Control, real backend) | Playwright | **33 / 33 checks passed** | `evidence/revamp/e2e-results.json`, `docs/revamp/tools/revamp_e2e.cjs` |
| Super app in a real browser (hub → bill paid through the normal review → same bill refused → shop with offer and consent → Compliance suspends a partner → audit → integrity) | Playwright | **14 / 14** | `evidence/revamp/services-e2e.json`, `docs/revamp/tools/services_e2e.cjs`, `evidence/screenshots/services/` |
| Stablecoin sandbox in a real browser: flag **off** (no tile, `FEATURE_DISABLED`, console explains) and flag **on** (disclaimer → enrol → faucet pending until 3 confirmations → merchant payment final → screened address blocked with a case → chain down sends nothing → reconciliation matched → rupee balance unchanged) | Playwright | **3 / 3 off, 10 / 10 on** | `evidence/revamp/sandbox-e2e.json`, `docs/revamp/tools/sandbox_e2e.cjs`, `evidence/screenshots/sandbox/` |
| Accessibility (axe-core 4.10, WCAG 2.x A/AA rules, 22 screens) | axe | **0 violations** (3 found and fixed) | `evidence/revamp/a11y-axe.json` |
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
| Full suite after 16:00 UTC | Ops tests O5/O6 assumed the clock was before the 16:00 UTC settlement cut-off, so a missing line became a (correct) timing difference and no case was opened | Tests pin the cut-off, as the scenario tests already did; acceptance runs set `PAYA_SETTLEMENT_CUTOFF_UTC_HOUR=24`; the setting is now in docker compose and `.env.example`, and the demo script says to set it for demos after 21:00 PKT |
| Green e2e | The shared Dialog rendered off-centre on phones (framer-motion's transform replaced Tailwind's translate) | Centre through motion `x`/`y` instead of CSS translate; e2e asserts the dialog is centred |
| Green e2e | A double tap on "Confirm" moved money once (idempotency held) but showed a spurious "still being processed" error | The dialog sends once per intent; e2e asserts no error |
| axe | Horizontally scrollable tables were not keyboard-focusable (`scrollable-region-focusable`) | Table wrapper is a labelled, focusable region |
| Harness | Pending check sampled too late or under the wrong scenario; modal drawer blocked the operator switch; liveness retry not followed | Continuous sampling under "lost request"; harness closes drawers; harness retries like a person |

## Not covered / outstanding

- **Frontend component unit tests** were not added. Behaviour is covered end to end by the acceptance run instead.
- The **demo rehearsal** (`demo_rehearsal.cjs`) and `docs/demo/demo-script.md` are rewritten for 2.0. The rehearsal passes 8/8 scenes on a fresh database (`evidence/demo/rehearsal-*.md`); the 1.x run is archived in `evidence/demo/v1/`. The **Theme 1 browser run** (`kyc_e2e.cjs`) still targets 1.x selectors; its flows are covered by the 2.0 acceptance run and the rehearsal.
- No screen-reader user testing (see `ACCESSIBILITY_REVIEW.md`).
- No load test of the new read endpoints. They are paginated and indexed on existing columns, but have not been measured under load.
