# Frontend architecture (Rupay 2.0)

**Stack kept:** React 18.3 + TypeScript 5.6 (strict) + Vite 5.4 + Tailwind 3.4 + framer-motion 11 + @xyflow/react 12 + lucide-react. No framework rewrite: the existing stack fits, and replacing it would have added risk without benefit.

## Dependencies added (all MIT/OFL, local, free)

| Package | Version | Why | Alternatives considered |
|---|---|---|---|
| `@tanstack/react-query` | 5.62.8 | One cache for every screen: de-duplicated requests, polling only where needed, retries for reads (not for 4xx), **no retries for mutations** | Hand-rolled polling (1.x: each component polled on its own timer) |
| `@radix-ui/react-dialog` | 1.1.4 | Accessible dialog/drawer: focus trap, Escape, scroll lock, ARIA labelling | Writing focus management by hand |
| `@fontsource-variable/inter`, `@fontsource-variable/manrope`, `@fontsource/jetbrains-mono` | 5.1.x | Self-hosted fonts; the PWA works offline; no third-party font requests | Google Fonts CDN (1.x) |

**Considered, not added:**
- shadcn/ui: its patterns are adopted, but generating its code would duplicate our token layer.
- TanStack Table: our tables are server-paged, so a small `DataTable` suffices.
- React Hook Form + Zod: forms are few and small; validation is authoritative on the server (Pydantic), and the client shows the server's message.
- Recharts / ECharts: they add 100+ kB for two chart types. Our SVG charts carry tooltips, legends and data tables.
- GSAP / React Spring: not needed (see `MOTION_DESIGN_SYSTEM.md`).

## Structure

```
web/src/
  ds/                 design system: tokens.css, motion.ts, status.ts, ui.tsx, overlay.tsx, toast.tsx, table.tsx, timeline.tsx, charts.tsx
  lib/                api.ts (typed fetch client, sessions, idempotency keys), hooks.ts (useApi, useAction, useTheme), stream.ts
  wallet/             customer + till surface (one file per screen)
  console/            Mission Control: Console.tsx (gate, shell, routes), core.tsx (operator, permissions, live stream, page frame),
                      inspectors.tsx (transaction, case, KYC drawers), graph.tsx (topology model), pages/*.tsx (one per page)
  pages/Landing.tsx   entry
```

Feature boundaries: wallet and console share only `ds/` and `lib/`. The console is lazy-loaded (React Flow and charts never ship to the phone first).

## Data flow

- **Reads:** `useApi(as, path, opts)` wraps `useQuery` with the key `[user, path]`. Pages poll only what changes (overview 4 s; transaction detail every 2 s **until final**, then stop).
- **Writes:** `useAction(fn)` wraps `useMutation`. It shows a toast with the **server's** answer (success text or the server's refusal in plain language), then invalidates the cache. Nothing is optimistic: the UI never assumes a write succeeded.
- **Live:** the wallet uses `useStream(user)` (role-filtered by the server) to refetch when a relevant event arrives. The console has one `StreamProvider` per operator: de-duplicated by `event_id`, reconnecting with backoff, pausable, with subscribers (topology) and debounced cache invalidation.
- **Identity:** wallet sessions (customer or cashier) and the console operator are separate. The console's operator is stored as a username only; tokens stay in the existing session store.
- **Permissions:** `useCan(perm)` reads the server's permission list for clarity; `<Restricted perm>` guards pages. The server remains the enforcement point.

## Errors and resilience

- 401 clears the session; 403 shows a plain "Not allowed for your role" toast with the server's reason; 409/422 show the server's message.
- The payment flow keeps one idempotency key per payment request in `sessionStorage`, so a reload or network retry cannot double-charge (also enforced by the server at two layers).
- Payment status survives a browser refresh because it is always re-read from the server.

## Synthetic data boundary

No production component contains mock data. The fixtures that do exist are labelled and real:
- the demo accounts list (seeded synthetic users);
- Rail lab test payments, made by named synthetic actors through the real API;
- the Rail lab's "expected behaviour" catalogue, which is documentation of what the backend does, each item mapped to an automated test.
