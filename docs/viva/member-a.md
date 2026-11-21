# Member A: product, journey, scope, ethics (demo lead)

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
| Where does the 182.5m figure come from? | SBP FY26 payment systems review, as reported by Pakera. We mark it "verify against the primary PDF" |
| What would you never do? | Store real CNIC, biometric or card data; probe a real bank or Raast endpoint; present a stablecoin as a live payment method (PVARA/SBP rules) |
| Why "conditional go"? | The integrity core is proven. The conditions are a partner sandbox, MFA/revocation/rate limits, separate DB roles, merchant validation, and an LLM evaluation |
| Show me the evidence the demo is not faked | `make demo-reset && make rehearse` replays the demo and asserts every claim. Mission Control renders real backend events only |
