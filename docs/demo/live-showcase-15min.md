# Rupay live showcase: a 15-minute tour of everything

This is the presenter's guide for showing **every part of Rupay** on the live deployment in 15 minutes: the customer wallet on an iPhone, the merchant tills, Mission Control on the projector, and the backend behind them. It complements `demo-script.md` (the 10-minute failure-and-recovery script for the viva). Use this one when the audience wants to see the whole product.

Everything is synthetic: synthetic customers, merchants and identities, a simulated Raast rail and identity registry, and no real money. Say so once at the start, and point to the **Simulated** badge in the top bar.

## Live URLs

| What | URL | Notes |
|---|---|---|
| Start page | https://paya-six.vercel.app/ | QR to open the wallet on a phone |
| Customer wallet (PWA) | https://paya-six.vercel.app/app | Safari → Share → **Add to Home Screen** |
| Open a new wallet (onboarding) | https://paya-six.vercel.app/app/open | SPECIMEN card, liveness, two-officer rule |
| Scan / pay | https://paya-six.vercel.app/app/scan | Camera, or tap an open till request |
| Services (super app) | https://paya-six.vercel.app/app/services | Bills, top-up, shop, takaful, green |
| Green pot and footprint | https://paya-six.vercel.app/app/green | |
| Rupay Assistant | https://paya-six.vercel.app/app/assistant | English and Roman Urdu |
| Mission Control | https://paya-six.vercel.app/control | Sign in as a staff member |
| QR wall (six tills) | https://paya-six.vercel.app/control/qr-wall | Put this on a second screen |
| System topology | https://paya-six.vercel.app/control/topology | Live settlement ticker and wave |
| API health | https://paya-six.vercel.app/healthz | `{"status":"ok","rail_breaker":"CLOSED"}` |
| API reference (OpenAPI) | https://paya-six.vercel.app/docs | Every endpoint, with its role |
| Metrics | https://paya-six.vercel.app/metrics | Prometheus text |

Demo password for every account: `paya-demo-2026`.

## The cast

| Who | Login | Use it for |
|---|---|---|
| Sara Ahmed (customer, Rs 150,000) | `sara` | Main payer on the iPhone |
| Omar Farooq (customer, Tier 1) | `omar` | Second payer; tier limits |
| Zarak Khanzada (customer) | `zarak` | Synthetic watch-list match → compliance hold |
| Hina Baig (KYC pending) | `hina` | Unverified: can't pay |
| Ayesha, Kamran, Noor, Danish, Sadia, Imran | `<name>.cashier` | Tills: Chai Junction, Shifa Pharmacy, Green Leaf Grocers, Lahore Tikka House, Clifton Fuel Stop, Saddar Book Corner |
| Mudaser, Ateeq | `mudaser.ops`, `ateeq.ops` | Operations |
| Kanz, Harris | `kanz.compliance`, `harris.compliance` | Compliance (two officers) |
| Rufayl | `rufayl.finance` | Finance and reconciliation |
| Admin, Auditor | `admin`, `auditor` | Security; read-only audit |

**Synthetic bill consumer numbers** (also shown as tap-to-use chips on the bill screen; any 10 digits work):

| Biller | Consumer number | Label |
|---|---|---|
| Indus Power | 0412345678 | Home, Gulberg |
| Indus Power | 0498765432 | Shop, Saddar |
| Indus Power | 0455501234 | Flat, Clifton |
| Indus Power | 0477712345 | Office, Blue Area |
| Ravi Gas | 2201234567 | Home, Johar Town |
| Ravi Gas | 2209876543 | Restaurant, MM Alam |
| Ravi Gas | 2205550123 | Flat, DHA |
| Ravi Gas | 2207771234 | Hostel, Model Town |

A bill can be paid once per month. If a number says **already paid**, tap another one.

## Set-up (T−10 minutes)

| Step | Where | Check |
|---|---|---|
| 1 | Open https://paya-six.vercel.app/healthz | `status: ok`, breaker `CLOSED` |
| 2 | Laptop on the projector: `/control` → **Mudaser (Operations)** | Top bar: **Live**, Raast rail **Simulated · NORMAL**, **Integrity pass** |
| 3 | Mission Control → **Rail lab** → **Restore healthy** | Rail mode NORMAL. The live database is shared, so someone may have left a failure mode on |
| 4 | Second screen or second tab: `/control/qr-wall` | Six QRs, each "Waiting for a scan" |
| 5 | iPhone: Home Screen icon (or `/app`) → **Sara Ahmed** | Balance shows |
| 5b | First time after a new deploy: close the Home Screen app and reopen it (and reload Mission Control once) | The app picks up the latest version; top bar shows **Live** |
| 6 | Optional second phone: `/app` → a till (e.g. **Danish**, Lahore Tikka House) | "New sale" keypad |

The live database is shared and is not reset between demos. That is fine: the ledger, audit chain and integrity checks are built for continuous history. The velocity rule holds a customer's 6th payment in 10 minutes, so switch payers (Sara → Omar) if you pay many times.

## The 15 minutes

### 0:00–1:00 · What Rupay is (Speaker A)

*Show:* the start page, then Mission Control **Overview**.

> "Raast P2M grew from 4.9 million to about 180 million payments between FY25 and FY26 (SBP Governor's Annual Reports 2024–25 and 2025–26, page 58). But at the counter, a cashier still decides a payment worked by looking at the customer's screenshot. Rupay's promise: the till says **PAID** only after the money has moved and our double-entry ledger says so. Everything here is synthetic and the rail is a simulator."

**Overview** shows payments today, settlement rate, work waiting for people (cases, KYC referrals, approvals), rail health and integrity status.

### 1:00–3:30 · Pay a till from the iPhone (Speaker B)

| Do | Say | The audience sees |
|---|---|---|
| Projector: **QR wall** | "Six merchant tills, each with a live dynamic Raast QR for one order." | Six QRs with amounts |
| iPhone (Sara): **Scan** → point at the Lahore Tikka House QR | "The amount and merchant name come from our server, not from the picture." | **Review payment**: merchant, amount, fee, balance after |
| **Slide to pay** | "One idempotency key per payment, so a double tap or a retry can never charge twice." | "Processing" ring |
| Watch the wall | "Paid only when the rail confirms and the ledger posts the settlement." | The Tikka House card flips to **PAID**, then issues its next QR. The wallet says **Paid**, and the **balance updates by itself** |
| iPhone: **View receipt** → **Where your money went** | "The customer sees the money trail from the ledger." | Journal lines: authorise, settle, fee |

### 3:30–5:00 · The system watching itself (Speaker E)

| Do | Say | See |
|---|---|---|
| Projector: **System topology** | "Real components, and the messages between them." | 18 components; legend |
| Pay another QR on the wall (Sara or Omar) | "Every settlement, from any user on any phone, appears here." | A green wave runs phone → gateway → risk → ledger → rail → outbox → notifier; those components glow; the **Live settlements** ticker shows "Rs X settled · merchant" |
| Click **Double-entry ledger** | "Click any component for its architecture facts and what we observed." | Inspector panel |
| **Event stream** | "The same facts as an event log: outbox, at-least-once delivery, de-duplicated by consumers." | Live rows: payment.created, payment.settled, … |
| **Transactions** → search the reference | "Full evidence for one payment: lifecycle with actors, balanced postings, screening, audit hash." | Drawer: AUTH_POST, SETTLE, FEE |

*Backend note:* on Vercel the API runs as several serverless instances. A WebSocket only sees its own instance, so live updates come from `GET /v1/live`, a database-backed feed (outbox events plus persisted telemetry) that every screen polls about once a second, de-duplicated by event id.

### 5:00–7:00 · When things go wrong (Speaker C)

| Do | Say | See |
|---|---|---|
| **Rail lab** → **Lost reply** → Apply; pay a wall QR | "Our call times out but Raast did pay. Most systems mark it failed and refund, and then both sides are paid." | Wallet stays **Processing**; the wall card shows Pending, not PAID |
| Wait about 5 seconds | "The recovery agent asks the rail and settles exactly once." | Card flips to **PAID**; topology wave |
| **Outage** → Apply; pay as Omar four times (Rail lab → **Trigger test payment**) | "After three failures the circuit breaker opens. The 4th is refused **before** any debit." | Breaker OPEN in the top bar; **RAIL_UNAVAILABLE** |
| **Restore healthy** → **Ask the rail about all pending payments** | "Nothing half-done: pending payments recover by enquiry." | Runs turn **Settled** |

### 7:00–8:30 · People decide, not the code (Speaker D)

| Do | Say | See |
|---|---|---|
| Rail lab → pay as **Zarak** → Trigger | "A synthetic watch-list match." | **Under review**: money reserved, not sent |
| **Cases & approvals** → open it as Mudaser | "Operations can see it but cannot decide." | No decision buttons |
| **Act as → Kanz** → **Release hold** with a reason | "Only Compliance decides, and the reason is in the hash-chained audit log." | Payment settles; decision trail |

### 8:30–10:00 · Reconciliation and AI (Speaker A)

| Do | Say | See |
|---|---|---|
| Rail lab → **Missing line** → pay as Sara → **Restore healthy** | "Raast pays but leaves the line out of its settlement file." | Settled |
| **Act as → Rufayl** → **Reconciliation** → **Import and reconcile** | "Control totals and file hash are checked, then every line is matched." | Match rate below 100%; **Missing in Raast file** with a case |
| **AI operations** (or open the case) | "The AI agent proposes a cause and an action with evidence. It's advisory: a test reads its source to prove it can't move money." | Suggestion with confidence |
| **Import the same file again** | "The same file twice is refused by its SHA-256." | Toast: *File already imported* |

### 10:00–12:30 · The four themes on the phone (Speaker C)

| Do | Say | See |
|---|---|---|
| iPhone: **Services** → **Indus Power** → tap **0412345678** → **Find bill** → **Pay** → slide | "Super app, but no new money path: the same review, ledger and Raast. The order says *Bill paid* only after settlement, and one bill can't be paid twice." | My orders: **Bill paid to the biller** |
| Tap the same number again | — | "This bill is already paid" |
| **Raabta Mobile** top-up or **Bazaar Lane** | "Partners get only the data you consent to, per partner, and you can revoke it." | Consent dialog |
| **Green** → footprint estimate; move Rs 200 into the green pot | "An estimate with a ±50% band, not a precise number. The pot is a real ledger account." | Footprint card; pot balance |
| **Ask Rupay** → "mera balance kitna hai", then "send 500 to Ali" | "Roman Urdu, answered from the ledger. It can't move money, however you ask." | Balance card; refusal |
| Mission Control: **Green banking**, **Partners & services**, **Stablecoin sandbox** | "Staff see aggregates only, can switch off a partner, and the stablecoin sandbox is off on this server by design." | Aggregates; kill switch; "Switched off on this server" |

### 12:30–13:45 · Digital onboarding with two officers (Speaker D)

| Do | Say | See |
|---|---|---|
| iPhone: `/app/open` → name **Zarak Khanzad** → SPECIMEN card → head turn | "A synthetic card, no real CNIC. Photos are checked in memory and never stored." | "A person is checking a few details" |
| **Act as → Kanz** → **Identity & KYC** → **Recommend approval**; try **Confirm** | "A possible watch-list match needs two officers. The server refuses the same person." | "Needs a different person" |
| **Act as → Harris** → **Confirm approval** | — | Phone: **Your wallet is open** |

### 13:45–15:00 · Security, audit and the backend (Speaker B)

| Do | Say | See |
|---|---|---|
| **Security** (as Kanz): turn on two-step verification | "TOTP for staff, enforced outside demo mode. Signing out ends the session on the server at once." | QR and key; session list |
| **Act as → Auditor** → **Audit & access** | "Read-only. The audit chain is hash-linked and verified; every denial is recorded." | **Chain intact**; denials |
| `/docs` | "Every endpoint, with role-based access checked on the server." | OpenAPI |
| `/healthz` | — | ok |

> "149 backend tests, browser acceptance runs, an integrity checker with 20 checks, and a load test at about 14 payments a second. The limits are a simulated rail and registry, basic liveness, and tokens in browser storage. Our recommendation: a **conditional go**."

## Every screen, and where it appears in the tour

| Area | Screen | Shown at |
|---|---|---|
| Wallet | Home (balance, recent) | 1:00 |
| Wallet | Scan, Review, Receipt | 1:00 |
| Wallet | Activity | (optional) after any payment |
| Wallet | Services: bills, top-up, shop, takaful | 10:00 |
| Wallet | Green | 10:00 |
| Wallet | Assistant | 10:00 |
| Wallet | Account (sign out, sessions) | 13:45 |
| Wallet | Onboarding (`/app/open`) | 12:30 |
| Till | Cashier keypad and QR | Set-up step 6, or the QR wall |
| Mission Control | Overview | 0:00 |
| Mission Control | Transactions | 3:30 |
| Mission Control | System topology | 3:30 |
| Mission Control | QR wall | 1:00 |
| Mission Control | Event stream | 3:30 |
| Mission Control | Cases & approvals | 7:00 |
| Mission Control | Identity & KYC | 12:30 |
| Mission Control | Reconciliation | 8:30 |
| Mission Control | AI operations | 8:30 |
| Mission Control | Green banking, Partners & services, Stablecoin sandbox | 10:00 |
| Mission Control | Rail lab | 5:00 |
| Mission Control | Audit & access | 13:45 |
| Mission Control | Security | 13:45 |
| Backend | `/healthz`, `/docs`, `/metrics` | 13:45 |

## If something goes wrong live

| Symptom | Say | Do |
|---|---|---|
| A payment stays **Processing** | "This is the system being honest about uncertainty." | Rail lab → **Restore healthy** → **Ask the rail about all pending payments** |
| A payment is held unexpectedly | "The velocity rule did its job." | Release it as Kanz, or pay as Omar |
| The first request is slow | "A cold start of the serverless API." | Wait 2–3 seconds; open `/healthz` before the demo |
| A wall card doesn't flip | — | Click **New QR** on that card, or reload the page; the payment is still in the ledger |
| Bill says already paid | "One bill, one payment, enforced with a database lock." | Tap another consumer number |
