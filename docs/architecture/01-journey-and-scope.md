# 01: Journey, scope, assumptions and ethical boundaries

**Gate:** Week 10, journey and architecture scope.
**Status:** submitted for instructor approval, 2026-11-20.

## 1. Approved transaction journey

**Journey type in the brief:** *merchant payment*, with the linked *refund/reversal* path.

> A customer of a licensed wallet provider (the *Partner EMI*, synthetic) pays a merchant by scanning a dynamic Raast QR at the counter. The cashier hands over the goods only when Rupay shows **PAID**. Rupay shows PAID only after the Raast rail confirms the credit and the ledger has posted settlement. The next day, Rupay reconciles the payment against the rail's settlement file.

This trace covers every layer the brief lists, from channel to finance:

| Brief layer | Rupay component | Evidence in repository |
|---|---|---|
| Channel | Customer wallet PWA and cashier till (`web/src/pages/app`) | `evidence/screenshots/06-*.jpg` to `11-*.jpg` |
| Gateway | FastAPI façade: JWT, role check, correlation ID, idempotency (`src/paya/api/main.py`, `idempotency.py`) | `test_s2_*`, `test_s8_*` |
| Identity/KYC/AML controls | Rule-based screening and compliance case (`risk.py`) | `test_s7_*` |
| Wallet/core ledger | Double-entry ledger with holds (`ledger.py`) | `test_ledger_*`, `test_s1_*` |
| Payment rail | `RailPort` with a mock Raast rail in a separate schema (`rail.py`) | `test_s4_*`, `test_s12_*` |
| Posting | Journals AUTH_POST, SETTLE, FEE and REVERSAL (`payments.py`) | `test_s1_*`, `test_s5_*` |
| Settlement | Rail acknowledgement or status enquiry leads to SETTLE journal | `test_s4_*` |
| Reconciliation | Settlement file with control trailer, compared with the ledger (`recon.py`) | `test_s10_*`, `test_s13_*` |
| Notification | Outbox consumer that de-duplicates (`notifications.py`) | `test_s3_*` |
| Finance/reporting | Trial balance, reconciliation runs, metrics (`/v1/finance/*`) | `evidence/screenshots/14-*.jpg` |

**Case anchor.** The brief's default anchor is a Pakistani digital wallet such as SadaPay or NayaPay. We use its public product journey (a QR merchant payment from a wallet) **as context only**. Everything inside Rupay is a **proposed reference architecture**. It makes no claim about any firm's proprietary systems.

## 2. Public context

These figures are from public sources. Before the deck, re-check each one against the primary SBP document.

| Fact | Source |
|---|---|
| Digital channels carried 88% of retail transactions by volume in FY25 (9.1bn transactions). | SBP Annual Payment Systems Review FY25 ([SBP PR, 3 Nov 2025](https://www.sbp.org.pk/press/2025/Pr-03-Nov-2025.pdf); [Dawn](https://www.dawn.com/news/1953006)) |
| Raast P2M grew from 4.9m transactions in FY25 to about 180m in FY26. | SBP Governor's Annual Reports 2024–25 and 2025–26, p. 58 (verified by the team against the reports) |
| 3.6m merchants are registered on a Raast alias. | SBP FY26 review, as reported by [Pakera](https://pakera.pk/raast-2-76-billion-payments-fy26-sbp-payment-systems-review/) (secondary source) |
| Fewer than 0.7m retailers were linked to digital payments in Nov 2025. | [Profit](https://profit.pakistantoday.com.pk/2025/11/11/less-than-700000-retailers-linked-with-digital-payment-systems-as-pm-pushes-for-cashless-economy/). The gap between *registered* and *active* merchants is part of our problem statement. |
| SBP requires providers to give merchants real-time payment confirmation or rejection. Merchant service providers (MSPs) handle QR deployment, refunds and settlement. | [SBP PSP&OD Circular 04/2023](https://www.sbp.org.pk/psd/2023/C4.htm) |
| Small merchants report problems with reconciliation, settlement and digital literacy. | [Express Tribune](https://tribune.com.pk/story/2630109/digital-payments-target-merchant-growth) |
| There is no public Raast developer API. Access is through participating institutions, so the prototype must use a mock rail. | Our research (see `AI_USE_LOG.md`). This is an absence of evidence, stated as such. |

## 3. Scope

| In scope (built and tested) | Out of scope (stated, not built) |
|---|---|
| Dynamic-QR payment from a Partner EMI wallet to a merchant | Card payments, chargebacks (card-scheme concept) |
| KYC tier limits, velocity, synthetic watch-list screening, compliance hold | Real NADRA/biometric verification (planned as a mock adapter) |
| Mock Raast rail: accept, reject, timeout, duplicate ack, delayed ack, partial, late file, outage | Any connection to a real bank, EMI, PSP or Raast |
| Reversal (before finality), with maker-checker | Merchant-initiated refund after settlement (roadmap) |
| Reconciliation against the rail settlement file; exception cases | Sponsor-bank statement reconciliation (third source, roadmap) |
| Live operational view (Mission Control) | Production deployment, high availability, multi-tenancy |

## 4. Assumptions

Each assumption carries a risk level. "Highest" marks the one that would hurt most if wrong (Week 3: "which assumption creates the highest risk if wrong?").

| # | Assumption | Risk if wrong | How we would validate it |
|---|---|---|---|
| A1 | Many small merchants confirm a payment from the customer's screen or an SMS rather than from an authoritative feed. | **Highest.** It weakens the problem statement. | Interview 10–15 merchants and cashiers. No Pakistan-specific study was found. |
| A2 | The Partner EMI holds both customer wallets and the merchant relationship (acting as MSP). | Medium. It changes which institution posts which leg. | Read public EMI/MSP product pages; check the SBP list of regulated entities. |
| A3 | Raast offers a status enquiry and an end-to-end ID that the receiving side treats idempotently. | Medium. Without these, recovery from a timeout would need a manual process. | ISO 20022 practice; partner documentation under NDA. |
| A4 | The rail issues a daily settlement file with control totals; T+1 cycle. | Low. Bank Alfalah publicly lists T+1 for P2M. | Partner documentation. |
| A5 | Fees (0.50% merchant discount rate) and wallet tier limits are **synthetic** and configurable. | Low. They are configuration, not code (`config.py`). | Not needed for the prototype. |
| A6 | 21:00 Pakistan time is the settlement cut-off. | Low. It only affects the timing-difference category. | Partner documentation. |

## 5. Ethical and legal boundaries

- **Synthetic data only.** No real CNIC, biometric, card, bank-account, wallet or credential data is stored anywhere. Identity is represented by a synthetic `idv_token`. The `customers` table has no CNIC column at all.
- **No probing of real services.** We do no scanning, load testing or reverse engineering of any real wallet, bank, Raast or payment endpoint. All failure testing runs against our own mock rail.
- **No real money moves.** The UI, README and API description all say so.
- **No impersonation.** Rupay uses its own brand. We do not reproduce any SadaPay, NayaPay, Easypaisa, JazzCash or SBP branding or QR specification.
- **Regulatory honesty.** Rupay is positioned as a *technology service provider* to a licensed institution. It does not claim to be a bank, an EMI or a PSO/PSP. Stablecoin features stay a disabled sandbox design: PVARA's 2026 regulations bar virtual assets as a domestic means of payment without SBP approval.
- **Bounded AI.** AI may suggest. It never moves money, posts to the ledger, releases holds or approves reversals (brief §7). See the AI governance document, which arrives with the AI extension.
- **Every use of generative AI is recorded** in `AI_USE_LOG.md`.
