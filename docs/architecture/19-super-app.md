# 19. Super app: partner services (Theme 4)

**Goal.** Make the wallet a daily-use app (pay the electricity bill, top up the phone, shop, buy monthly takaful) **without adding a single new way to move money**. Every service is an order paid on the same review screen, through the same ledger and Raast path, and its status is read from that payment.

**Bounds (ADR-013).**
- One money path.
- Server-side prices.
- One bill is paid once.
- Data goes to partners only with per-partner consent.
- Compliance can switch a partner off.
- Investments are not offered.

Code: `src/paya/services.py`, API `src/paya/api/services_api.py`, models `Partner`, `PartnerConsent`, `ServiceOrder`. Wallet: `web/src/wallet/Services.tsx` (a new **Services** tab). Console: `web/src/console/pages/Partners.tsx`. Assistant intent `ORDERS`. Tests: `tests/test_services.py` (P1–P13). Browser run: `docs/revamp/tools/services_e2e.cjs` (14/14). Screenshots: `evidence/screenshots/services/`.

## Partners (all synthetic)

| Code | Partner | Kind | Receives (with consent) | What the customer does |
|---|---|---|---|---|
| INDUSPOWER | Indus Power Co. | BILLER | nothing | Enter a 10-digit consumer number → bill from the synthetic registry → pay |
| RAVIGAS | Ravi Gas | BILLER | nothing | Same |
| RAABTA | Raabta Mobile | TOPUP | masked mobile | Rs 100 / 300 / 500 / 1,000 for their own number |
| BAZAAR | Bazaar Lane | SHOP | name | Basket from the server catalogue; first-order offer 10% (max Rs 500), merchant-funded |
| HIFAZAT | Hifazat Takaful | INSURER | name, masked mobile | Phone screen cover Rs 149 or hospital cash Rs 299, one month |
| (not offered) | Investments | n/a | n/a | Stated in the app: an e-money wallet is not licensed for investments |

## Flow

```mermaid
sequenceDiagram
    participant W as Wallet (Services)
    participant S as services.py
    participant P as payments / ledger / Raast
    W->>S: POST /v1/services/{code}/orders (codes, qty / consumer no.)
    S->>S: partner ACTIVE? consent for its scopes? price from catalogue / bill registry; bill not already live or paid
    S-->>W: order ORD-… + payment request (kind SERVICE, 10 min)
    W->>P: normal review → POST /v1/payments (Idempotency-Key)
    P->>P: screening → AUTH_POST → Raast → SETTLE (or PENDING / REVERSED)
    W->>S: GET /v1/services/orders
    S->>P: read the payment behind the order
    S-->>W: AWAITING_PAYMENT · PROCESSING · COMPLETED ("Bill paid") · NOT_PAID
```

## Controls

| Risk | Control | Proof |
|---|---|---|
| A second money path | Services only creates payment requests; no posting, rail or `initiate_payment` code (source check) | P12 |
| "Done" before the money moved | Order status derived from the ledger-backed payment; PENDING stays "Processing", REVERSED is never fulfilled | P3, P4; e2e |
| Price or offer tampering | Server catalogue, bill registry and offer; client sends codes and quantities; integrity check `service_order_matches_payment_request` | P5, P6, P11 |
| Double bill payment | One live or completed order per biller, consumer number and month, under an advisory lock, across customers | P2; e2e |
| Over-sharing with partners | Declared scopes; consent per partner, revocable and audited; fields shared stored on the order; integrity check `partner_data_shared_only_with_consent` | P7, P11; e2e |
| Bad partner | Compliance suspends with a reason (audited); hidden in the wallet; new orders refused; old payments settle | P8; e2e |
| Seeing others' orders | Orders and their payment requests are private to the customer; not listed as open tills | P9 |
| Chat pays a bill | `ORDERS` intent reports status only and links to Services | P13 |

## Limits

- Partner fulfilment (bill posting at the utility, airtime, delivery, policy issuance) is **simulated** from the settled payment. Real partners need APIs, SLAs and settlement agreements.
- Partner settlement is the normal merchant settlement. Partner commissions, refunds of delivered goods and insurance claims are out of scope.
- The bill registry is synthetic and deterministic. Any 10-digit number returns a bill.
