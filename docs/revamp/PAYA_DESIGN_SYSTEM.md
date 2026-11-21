# Paya design system

One visual language, two densities: **Wallet** (light, calm, roomy, for customers on a phone) and **Console** (dark, dense, precise, for operators on a laptop). Both read the same semantic tokens, so a component written once works in both.

**Source of truth:** `web/src/ds/tokens.css` (tokens) → `web/tailwind.config.js` (semantic classes) → `web/src/ds/*` (components). The contrast of every text pairing is computed by `docs/revamp/tools/contrast_check.py` → `contrast-report.md` (0 failing pairs).

**Learning from the reference brand book, without borrowing its identity.** The NayaPay guidelines show the discipline a fintech brand needs: a defined core and supporting palette, AA-checked pairings, a display-plus-text type pair with set line-height and tracking rules, logo clear-space and minimum-size rules, and a "don'ts" list. Paya follows the same structure with its own decisions. It uses none of NayaPay's colours (Electric Orange, Blackberry), fonts (Poppins, DM Sans), symbol or layouts.

## 1. Brand

**Idea:** *payment, pakka*. "Paid" means confirmed by the ledger and the rail.

**Symbol.** A geometric "P" whose bowl closes into a confirmation tick (`Symbol` in `ds/ui.tsx`, `public/icon.svg`). It evolves the 1.x mark: the gradient is removed (flat, two colours), and the stroke weights are unified.

| Rule | Value |
|---|---|
| Lockup | Symbol + lowercase wordmark "paya" (Manrope ExtraBold, −0.04em tracking), gap = 0.28 × symbol height |
| Clear space | ½ symbol height on every side (lockup); ¼ symbol height (symbol alone) |
| Minimum size | Symbol 20 px; lockup 20 px tall |
| Colour | Jade mark on Night (`#0C1B24`) tile; mono and inverse variants only. No gradients, outlines, effects, rotation or distortion |
| Product suffix | "Control", "Till": label weight after a hairline divider (`<Logo suffix>`) |
| App icon / favicon | Symbol tile, 22% corner radius (`public/icon.svg`, PNGs) |

## 2. Colour

### Decision

The 1.x identity (dark, emerald) was evaluated rather than replaced.
- **Kept:** Jade green as the brand, and a dark surface for operations.
- **Changed:** the neon `#2EE58C` used for everything became a calmer Jade. Green is no longer the default "positive" colour: **green means confirmed by the ledger**.
- **Added:** a light wallet theme. Paper, not glass, earns trust for a first-time wallet user.

### Brand

| Token | Wallet | Console | Use |
|---|---|---|---|
| `brand` | `#0A7D56` | `#34C78C` | Primary action fill |
| `brand-fg` | `#FFFFFF` | `#04160F` | Text on brand (5.3:1 / 9.6:1) |
| `brand-accent` | `#0A7D56` | `#5CD6A4` | Links, brand text on surfaces |
| `night` | `#0C1B24` | `#090D12` | Brand secondary: balance card, wordmark |

### Surfaces and text

| Token | Wallet | Console |
|---|---|---|
| `canvas` | `#F5F6F3` | `#090D12` |
| `surface` / `raised` | `#FFFFFF` | `#0F151C` / `#151D26` |
| `sunken` / `hover` | `#EDEFEB` / `#EEF1ED` | `#070A0E` / `#1B2530` |
| `line` / `line-strong` | `#E2E5E0` / `#C7CDC6` | `#212C38` / `#303E4D` |
| `control-line` (input borders, ≥3:1) | `#808A85` | `#5C6C7C` |
| `fg` / `fg-2` / `fg-muted` | `#0D1B16` / `#45524D` / `#626E69` | `#E8EDF2` / `#A8B4C0` / `#84919E` |
| `focus` | `#1667D6` | `#78AAFF` |

### Status: consistent operational meaning

| Tone | Meaning, **only** this | Wallet fg / soft | Console fg / soft |
|---|---|---|---|
| `success` | Confirmed by the ledger: settled, reconciled, verified, approved | `#15763E` / `#E6F5EC` | `#58CF8C` / `#0F2C1E` |
| `processing` | In flight, not final (including "rail accepted") | `#1A5CC4` / `#E8F0FD` | `#76A8FF` / `#11213D` |
| `review` | Waiting for a person | `#6739C4` / `#F1ECFD` | `#B49CFF` / `#231B40` |
| `warning` | Uncertainty, retries, returned money | `#965400` / `#FFF3DE` | `#F5B94B` / `#34250A` |
| `danger` | Failed, declined, denied, broken | `#B92028` / `#FDEBEB` | `#FF8080` / `#3A1316` |
| `info` | Neutral information, "simulated" labels | `#0E6880` / `#E4F4F8` | `#62C8DE` / `#0D2A33` |
| `neutral` | Expired, inactive | `#626E69` / `#EDEFEB` | `#84919E` / `#18202A` |

**Rules**
1. Status is **never colour-only**: every status carries an icon and a word (`StatusBadge`, `ds/status.ts`).
2. Brand jade is for identity and the primary action. A green *status* always comes with a check icon and the word "Paid" / "Confirmed".
3. A payment the rail has accepted but not yet settled is **processing (blue)**, never green.

### Chart palette (console)

The series colours were validated for colour-vision deficiency on the console surface using the dataviz validator (all checks pass). They are assigned in a fixed stack order:

| Order | Series | Colour |
|---|---|---|
| 1 | Settled | `#2FA36B` |
| 2 | In flight | `#3D7FE6` |
| 3 | Failed / returned | `#E0603A` |
| 4 | Under review | `#A86BC0` |

Violet and blue never touch: they were too close for protanopes when adjacent.

## 3. Typography

| Family | Role | Licence | Why |
|---|---|---|---|
| **Manrope** (variable) | Display: headlines, amounts, key numbers | OFL | Geometric and confident at large sizes, with open counters and distinct figures. Not the reference brand's Poppins |
| **Inter** (variable) | Text and UI: body, labels, tables | OFL | Superb small-size legibility; true tabular figures (`tnum`) for money |
| **JetBrains Mono** (400, 500) | References: `PAYA-…`, E2E ids, hashes | OFL | Unambiguous 0/O and 1/l for references people read aloud |

Self-hosted from npm (`@fontsource`), so the PWA works offline. Google Fonts is no longer requested. Only the weights in use are loaded: two variable files and two mono weights.

| Style | Size / line | Tracking | Weight | Use |
|---|---|---|---|---|
| `display-xl` | 40/44 | −2.5% | 800 | Hero amounts and titles |
| `display` | 32/38 | −2.2% | 800 | Wallet page hero |
| `title-1` | 24/30 | −1.8% | 700 | Page titles |
| `title-2` | 20/26 | −1.2% | 700 | Section titles |
| `title-3` | 17/24 | −0.8% | 600 | Card headings |
| `body` | 15/23 | 0 | 400 | Body |
| `body-sm` | 14/21 | 0 | 400 | Secondary information, tables |
| `label` | 13/18 | 0 | 500 | Form labels, nav |
| `caption` | 12/16 | 0 | 400 | Metadata (the minimum for content) |
| `overline` | 11/16 | +6% | 600 | Uppercase section labels only |
| `amount-xl` / `amount` | 48/52, 32/36 | −3% / −2% | 800 / 750 | Money |

Money always uses `.num` (tabular figures). References always use `.ref` (mono). As in the reference brand book: tight leading for display (≈110%), relaxed leading for body (≈150%), and sentence case everywhere except overlines.

## 4. Space, shape, elevation

- **Spacing:** 4 px base (Tailwind scale). Wallet gutters are 20 px; console gutters are 24 px. Cards use 16 px padding in the wallet and 16–24 px in the console.
- **Radius:** `xs 6 · sm 8 · md 12 · lg 16 · xl 20 · 2xl 28`. Controls use `md`, cards use `lg`, sheets and hero cards use `xl`. No pill-shaped cards.
- **Elevation:** three shadows (`e1` resting, `e2` raised, `e3` overlays). The console relies on borders more than shadows.
- **Controls:** heights 32 / 40 / 52 px (`sm/md/lg`). Wallet primary actions are 52 px (thumb-friendly); the console uses 32–40 px.
- **Breakpoints:** `xs 360`, `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`, `3xl 1680`. The wallet column is capped at 480 px; console content is capped at 1440 px except full-bleed pages (topology).

## 5. Components (`web/src/ds`)

| Component | File | Notes |
|---|---|---|
| `Button`, `IconButton` | `ui.tsx` | primary / secondary / ghost / danger / subtle; `loading` sets `aria-busy`; icon buttons require a label |
| `Card`, `SectionHeader`, `KV`, `Metric` | `ui.tsx` | `Metric` shows a skeleton while loading, never a fake zero |
| `StatusBadge`, `Badge`, `Dot`, `Alert` | `ui.tsx` | Icon + word; `Alert` uses `role=alert` for danger |
| `Input`, `Select`, `SearchInput` | `ui.tsx` | Visible labels, `aria-invalid`, hint and error text linked by `aria-describedby` |
| `Tabs` | `ui.tsx` | WAI-ARIA tabs with arrow-key support |
| `Money`, `Ref`, `pkr()` | `ui.tsx` | PKR formatting `Rs 1,250`; true minus sign; tabular |
| `Skeleton`, `EmptyState`, `Spinner` | `ui.tsx` | |
| `Drawer`, `Dialog` | `overlay.tsx` | Radix Dialog: focus trap, Escape, scroll lock, labelled |
| `Toast` (`useToast`) | `toast.tsx` | `aria-live`; plain-language refusals (403 → "Not allowed for your role") |
| `DataTable`, `Pagination` | `table.tsx` | Real `<table>`, caption, keyboard-activatable rows |
| `Timeline` | `timeline.tsx` | Each step states its own state in words |
| `StackedBars`, `LineChart`, `ShareBar`, `Legend` | `charts.tsx` | SVG, no dependency, hover tooltip, visually hidden data table |
| `Symbol`, `Logo` | `ui.tsx` | Brand |

## 6. Don'ts

- No gradients behind text, blurred blobs, glassmorphism, or neon glows (all removed).
- No raw hex in components: use tokens (the legacy `ink`/`paya` palette remains only for compatibility and is unused by new screens).
- No green for "probably fine".
- No decorative charts: every chart answers a question from real data, and says so when there is none.
- No status shown by colour alone; no text below 12 px for content (11 px only for uppercase overlines and chart axis ticks).
