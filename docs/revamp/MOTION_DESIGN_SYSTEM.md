# Motion design system

**Principle:** motion explains a change the server has already made. It never anticipates a financial outcome.

**Technology choice.** We evaluated Motion for React (framer-motion), CSS transitions, GSAP and React Spring. We kept **framer-motion 11** (already a dependency; declarative React API; `MotionConfig reducedMotion="user"` honours the OS setting everywhere) plus **CSS transitions** for hover, press and colour. GSAP and React Spring would add weight without a need. SVG `animateMotion` carries packets on topology wires. No canvas animation is needed.

Tokens: `web/src/ds/motion.ts` (JS) mirrored by CSS variables in `web/src/ds/tokens.css`.

## Tokens

| Token | Value | Use |
|---|---|---|
| `instant` | 80 ms | Exits during route change |
| `fast` | 140 ms | Hover, press, colour, toggles |
| `base` | 220 ms | Entrances, tab indicator, drawer exit |
| `slow` | 320 ms | Step transitions in onboarding |
| `deliberate` | 480 ms | Reserved; rarely used |
| `ease.standard` | cubic-bezier(0.2, 0, 0, 1) | Movement between states |
| `ease.enter` | cubic-bezier(0, 0, 0.2, 1) | Elements arriving |
| `ease.exit` | cubic-bezier(0.4, 0, 1, 1) | Elements leaving (faster than entering) |
| `spring.gentle` | stiffness 260, damping 30 | Drawers, sheets |
| `spring.snappy` | stiffness 420, damping 34 | Tab indicator, slide-to-pay return |
| `spring.settle` | stiffness 180, damping 18 | **Confirmation marks only** (Paid, Approved) |

Variants: `fadeUp`, `stagger(step)`, `stepSlide(dir)`, `sheet`, `drawer`.

## Where motion is used

**Wallet**
- Route change: content fades up 6 px (`base`, enter easing); the exit is near-instant so navigation never feels sluggish.
- Home: staggered entrance (40–50 ms steps). Balance hide/show cross-fades with a short blur.
- Onboarding: step slide (`slow`), animated progress segments, a card "flip" reveal, and directional arrows during the liveness challenge (stopped once captured).
- Pay: slide-to-pay follows the finger; it springs back if released early and snaps on confirm. A keyboard alternative (Enter/Space) triggers the same action.
- Result: while `PENDING`, a rotating ring around a clock (processing tone). **Only when the server returns `SETTLED`** does the ring swap for a check mark with `spring.settle`. A refresh shows the same server-derived state; an animation can never "finish into success".
- Receipt: dialog scales from 0.97 with opacity (`base`).
- Tab bar: active indicator uses a shared `layoutId`.

**Mission Control**
- Metric values cross-fade when the number changes (no counting animations that would show values the server never returned).
- Topology: packets travel along a wire for 0.95 s when a real event arrives. A node scales by 3% on activity. Dimming in focus mode uses a `base` opacity transition.
- Drawers: `spring.gentle` from the right; the overlay fades.
- Tabs: sliding indicator (`spring.snappy`). Timelines enter with a 30 ms stagger.
- Live indicator: a 1.6 s opacity pulse only while connected (it means "receiving").

## Financial animation safety (enforced in code)

1. `Txn.tsx` chooses the headline from `paymentMeta(status).final`. Non-final states render the processing ring. The success mark is keyed by status, so it can only mount after the status changes.
2. The cashier till shows PAID only when `latest_payment.status ∈ {SETTLED, RECONCILED}`.
3. The acceptance test checks this directly: with the rail set to "lost reply", the screen must not say "Paid" while the backend says `PENDING` (`docs/revamp/tools/revamp_e2e.cjs`).

## Reduced motion

- `MotionConfig reducedMotion="user"` turns transform animations into instant changes when the OS asks for reduced motion.
- A CSS media query shortens every CSS animation and transition to 1 ms and stops repetition (skeleton shimmer, pulses, spinners keep their final frame).
- There are no perpetual decorative animations. Exceptions convey state: the scanner line (camera active), the live pulse (connected), spinners (waiting), and they stop under reduced motion.
- No parallax, no bounce on content, and blur only on the 150 ms balance reveal.
