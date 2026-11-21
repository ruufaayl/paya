# Member A (Rufayl Waseem, 24i-5660): product, journey, scope, ethics (demo lead)

**Read:**
- `docs/architecture/01-journey-and-scope.md`
- `00-gate-pack.md`
- `docs/demo/demo-script.md`
- `docs/review/architecture-review-deck-outline.md`

## 90-second explanation
> "Paya is a payment-assurance layer for Raast person-to-merchant payments. We operate as a technology service provider for a licensed partner EMI, which is synthetic in our prototype. We never hold money ourselves. Our journey is a dynamic-QR merchant payment from a wallet, with a linked reversal. The till shows PAID only after Raast confirms and our ledger has posted settlement. Next day, Finance reconciles against the rail's file. Everything is synthetic, and the Raast rail is simulated because no public API exists."

## Questions you must handle

| Question | Answer |
|---|---|
| Why not build a wallet? | Wallets exist; the gap is trust and reconciliation at the counter. The brief's journey list includes merchant payment, and our implementation still contains every mandatory component, including the wallet ledger |
| Are you a bank or an EMI? | No. A TSP under a licensed partner. Raast access is only through participants. The SBP 2025 Technology Risk Management Framework covers outsourcing to TSPs |
| What is your riskiest assumption? | A1: that cashiers trust screenshots. We found no Pakistan-specific study, so merchant interviews are a condition of our GO |
| Where does the ~180m figure come from? | SBP Governor's Annual Reports 2024–25 and 2025–26, p. 58. We checked it against the reports themselves; an earlier secondary source said 182.5m, so we quote the rounded primary figure |
| What would you never do? | Store real CNIC, biometric or card data; probe a real bank or Raast endpoint; present a stablecoin as a live payment method (PVARA/SBP rules) |
| Why "conditional go"? | The integrity core is proven. The conditions are a partner sandbox, MFA/revocation/rate limits, separate DB roles, merchant validation, and an LLM evaluation |
| Show me the evidence the demo is not faked | `make demo-reset && make rehearse` replays the demo and asserts every claim. Mission Control renders real backend events only |

## Paya 2.0, Theme 2 and Theme 3 additions (also yours)

- **Product and UX of Paya 2.0:** `docs/revamp/PAYA_PRODUCT_EXPERIENCE.md`, `PAYA_DESIGN_SYSTEM.md`, `CUSTOMER_WALLET_UX.md`. Be ready to explain why green means "confirmed by the ledger" and why a rail-accepted payment is shown as *processing*.
- **Green banking (Theme 2):** `src/paya/green.py`, ADR-012, doc 18, tests G1–G11. Know: why the footprint is an *estimate* (spend-based, `green.v1`, ±50%); why the pot is just account 2110 moved by one balanced, idempotent journal; why an offset is an ordinary Raast payment and its certificate appears only after SETTLED; why staff see aggregates only.
- **Conversational banking (Theme 3):** `src/paya/assistant.py`, ADR-011, doc 17. Why there is no LLM in the loop; how redaction runs before anything else; why "send money" returns a link instead of a payment.
- **Likely questions:** "What stops the assistant moving money?" (no money-moving imports, test C9). "What does the assistant store?" (redacted text, intent, tools used; 30 days). "Isn't the footprint greenwashing?" (it is labelled an estimate with a range, method and factor version; the factors are marked illustrative; certificates exist only for settled payments and say no real credit is retired). "Does the green pot create money?" (no: it moves the customer's own balance from 2100 to 2110 in one balanced journal; total liability is unchanged).
