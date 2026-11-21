# Accessibility review (Paya 2.0)

**Standard:** WCAG 2.2 level AA (W3C Recommendation, October 2023; the current version). **Method:** computed contrast for every token pairing, an automated axe-core scan of 13 screens, scripted keyboard paths in the acceptance run, and a manual review against the criteria below. This is a self-assessment, not a third-party audit. Assistive-technology testing with real screen-reader users was **not** done.

## Results

| Check | Result | Evidence |
|---|---|---|
| Text contrast (1.4.3), non-text contrast (1.4.11) | **0 failing pairs** of 56 checked across both themes | `contrast-report.md` (`tools/contrast_check.py`) |
| axe-core 4.10 (WCAG 2.0/2.1/2.2 A + AA rules), 5 wallet + 8 console screens | **0 violations** after fixes | `evidence/revamp/a11y-axe.json` (`tools/a11y_scan.cjs`) |
| Found and fixed by the scan | Logo `aria-label` on a span without a role (all screens) → `role="img"`; 85% opacity caption on the green action card (contrast) → full opacity | |
| Keyboard: authorise a payment | Slide control is a focusable `role="slider"`; Enter or Space authorises | Acceptance run drives every payment by keyboard |
| Keyboard: dialogs and drawers | Radix Dialog: focus trapped, Escape closes, focus returns | Acceptance run closes drawers with Escape |
| Keyboard: tabs | WAI-ARIA tabs with arrow keys; `aria-selected`, roving `tabIndex` | `ds/ui.tsx` |
| Keyboard: tables | Rows are focusable and open with Enter or Space | `ds/table.tsx` |
| Global search shortcut | `/` focuses search (ignored while typing in a field) | `console/Console.tsx` |

## Criteria walk-through

| Criterion | How Paya meets it |
|---|---|
| 1.1.1 Non-text content | Icons are `aria-hidden` next to text; icon-only buttons have labels; charts have `role="img"`, an `aria-label` and a visually hidden data table; QR has a title |
| 1.3.1 Info and relationships | Real headings, `<table>` with captions and `scope`, `<dl>` for key-value pairs, labelled forms, landmarks (`main`, `nav`, `aside`), skip links |
| 1.4.1 Use of colour | Every status has an icon and a word (`StatusBadge`); topology nodes state their condition in words; charts have legends and tooltips; disabled nav items also say why on the page |
| 1.4.3 / 1.4.11 Contrast | Computed: see above. Input borders use a dedicated `control-line` token at ≥3:1 |
| 1.4.4 / 1.4.10 Resize and reflow | Wallet reflows at 360 px with no horizontal scrolling (verified at 360, 390, 430); console tables scroll inside their own container, not the page |
| 1.4.12 Text spacing | No fixed-height text containers except single-line truncated labels with full text in `title` |
| 2.1.1 Keyboard | All actions reachable; slide-to-pay has a keyboard path |
| 2.3.3 Animation from interactions | `MotionConfig reducedMotion="user"` plus a CSS media query; no perpetual decorative motion |
| 2.4.1 Bypass blocks | "Skip to content" links in both surfaces |
| 2.4.3 Focus order | DOM order matches visual order; dialogs trap focus |
| 2.4.7 / 2.4.11 Focus visible / not obscured | 2 px focus ring with a dedicated `focus` token (blue, distinct from every status colour); drawers are modal, so focused items are never hidden behind them |
| 2.5.7 Dragging movements | Slide-to-pay has a single-action alternative (Enter/Space) |
| 2.5.8 Target size (minimum) | Wallet controls are 40–52 px; console controls are ≥32 px, with compact table rows using the whole row as the target |
| 3.3.1 / 3.3.3 Errors | Errors in text near the field (`aria-describedby`, `aria-invalid`); server refusals in plain language |
| 4.1.3 Status messages | Toasts in an `aria-live` region; payment headline region is `aria-live="polite"`; the till's PAID is `assertive` |

## Known gaps

- No testing with VoiceOver, TalkBack or NVDA by real users.
- The topology canvas (React Flow) is a pointer-first visualisation. Its keyboard alternatives are the component search, the inspector's connection links, and the Transactions and Event stream pages, which carry the same facts as text.
- The camera-based onboarding steps need sight and movement. A production service would need an assisted (branch or video-agent) route. This is documented as a product limitation, not solved in the prototype.
- Urdu localisation and right-to-left layout are not implemented.
