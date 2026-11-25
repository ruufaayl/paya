# Rupay Wallet UX

Code: `web/src/wallet/`. Mobile-first: one column capped at 480 px; tested at 360, 390 and 430 px (no horizontal overflow, as checked by the acceptance run).

## Screens

| Screen | File | Data (backend) | Key decisions |
|---|---|---|---|
| Sign in | `SignIn.tsx` | `POST /v1/auth/login` | Primary action is **Open a new wallet**. Onboarded users sign in with their own credentials. Demo accounts are labelled as synthetic and say which path each one exercises |
| Onboarding | `Onboarding.tsx` | `/v1/onboarding/*` | Progress segments, back navigation, specimen card made on the device, demo-grade liveness labelled as such, "photos aren't stored" backed by test K9, retry tips, live "under review" status with no tipping off |
| Home | `Home.tsx` | `GET /v1/wallet` + live stream | Personal greeting. Night balance card: available (headline), ledger, reserved, with a one-line explanation. Hide/show is remembered per device. Primary actions: Scan, Pay a shop. Verification and limits. "Paid this month" (derived from the server list, labelled). Recent activity |
| Activity | `Activity.tsx` | `GET /v1/wallet` | Grouped by day; filters All / Paid / In progress / Returned; incoming in green with "+", outgoing neutral; non-final payments carry a status badge |
| Scan / Pay a shop | `Scan.tsx` | `GET /v1/payment-requests?status=OPEN` | Camera with clear permission states; QR accepted only as `paya://pay?pr=<UUID>`; open tills list (labelled "Demo") as an accessible alternative |
| Review & authorise | `Review.tsx` | `GET /v1/payment-requests/{id}`, `POST /v1/payments` | Merchant identity from **our server, not the QR**. Amount set by the shop. Available now and after, fee, network, expiry. Slide to authorise with an Enter/Space alternative. One idempotency key per payment request, stored in `sessionStorage`, so a refresh or retry reuses it |
| Payment result & detail | `Txn.tsx` | `GET /v1/transactions/{ref}` (polls until final) + stream | Headline from server status only. Pending shows "Processing" with an explanation that it's safe to leave. Review / declined / returned show explicit callouts. Timeline, money trail, references with copy, receipt (Paid only) with print |
| Account | `Account.tsx` | `GET /v1/wallet`, session | Verification, limits, velocity rule, how Rupay protects money, about the prototype (synthetic, simulated), server address, sign out |
| Till (cashier) | `Cashier.tsx` | payment requests, merchant transactions | Large keypad, QR with live overlay, PAID only after settlement (voice), today's sales |

## States covered

Loading (skeletons, never fake zeros) · empty (activity, tills) · error (wallet load retry; payment not found; network failure on pay explains it is safe to retry) · permission (camera denied/unsupported) · processing · pending at Raast · under review · declined · returned · paid · receipt.

## Copy rules

- Say what happened to the money: "No money left your wallet", "The full amount is back in your wallet".
- Never "Success!" before settlement; "Sent over Raast. We'll show Paid only when the rail confirms it."
- Plain refusal reasons (KYC not verified, limits); never mention screening to a customer.
- Every claim about privacy points to evidence or is phrased as what the system does ("checked once in memory, not stored").
