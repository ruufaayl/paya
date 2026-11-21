# Paya 2.0 changelog

Branch `revamp/paya-2`. All 47 pre-existing backend tests still pass; 9 were added. The financial domain modules are unchanged.

## Before → after

| Area | Paya 1.x | Paya 2.0 |
|---|---|---|
| Visual identity | Neon green on near-black everywhere; gradient logo; glass and aurora backgrounds | Paya design system: light **Wallet** and dark **Console** themes from one token set; Jade brand; flat symbol; green reserved for confirmed outcomes |
| Fonts | Inter + JetBrains Mono from Google Fonts at runtime | Self-hosted Manrope (display), Inter (text, tabular money), JetBrains Mono (references); works offline |
| Status language | Colour pills, green for many positive-looking states | One status map (icon + word + tone); rail-accepted is "processing", not success |
| Wallet | Persona picker → home → scan → slide → tracker | Sign-in with demo accounts or own credentials; home with balance explanation, hide/show, verification and limits, monthly insight; activity with filters; review step (balance after, fee, network); keyboard-accessible authorise; authoritative result; timeline; money trail from the ledger; receipt; account |
| Onboarding | Dark flow; "photos never kept" claim | Restyled; liveness labelled demo-grade; privacy claim points to test K9 |
| Till | Dark till | Restyled; PAID only after settlement, unchanged rule |
| Mission Control | One screen: chaos panel, graph, gates and feed; silent `auditor` reads; buttons hard-coded to personas | Ten pages in three groups; a real signed-in operator with "act as"; server-driven permissions with restricted states; global search; transaction, case and KYC inspectors |
| Topology | Graph coloured by last event; no inspector | Static architecture separated from observed runtime; no false "healthy"; search, layer filters, focus mode, fit, minimap; simulators dashed and labelled |
| Reconciliation | Toast after a run | Import history, file hash, match rate, category filter, every line with case and finance impact; trial balance and 14 integrity checks beside it |
| Cases | Cards in a side panel | Queue with type, owner, assignee, SLA and AI; drawer with assignment, decisions, AI review and full decision trail; maker-checker tab |
| Rail chaos | Eight buttons | Rail lab: all nine scenarios, expected behaviour with test ids, trigger, observed outcome, recovery tools, registry modes |
| Events | In-memory feed | Live and durable (outbox) stream, de-duplicated, filterable, pausable, with an inspector |
| Audit | Chain verification only | Searchable log incl. denials, chain status, permission matrix, people |
| Charts | None | Outcome-over-time bars and time-to-settle line from real data; validated colour-blind-safe palette |
| Accessibility | Not evaluated | Contrast computed (0 failures), keyboard paths, focus rings, ARIA dialogs/tabs, reduced motion; axe scan |
| Data fetching | Each component polled on its own | Shared TanStack Query cache; mutations never retried silently |

## Backend

New read models and one control (`src/paya/api/ops.py`); see `API_CHANGES.md`. Additive column upgrade for case assignment. Two new permissions. `/v1/me` returns permissions; transaction detail returns a customer-safe money trail and rail status.

## Removed

`web/src/pages/app/*` and `web/src/pages/control/*` (replaced by `web/src/wallet` and `web/src/console`), `web/src/components/ui.tsx`, `web/src/lib/status.ts` (replaced by `web/src/ds`). No backend functionality was removed.
