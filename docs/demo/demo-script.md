# Paya: technical demo script (Paya 2.0, about 10 minutes)

**The brief asks for:** the normal flow, at least two failure/recovery scenarios, and one reconciliation outcome.
**This script shows:** a normal flow; **three** failure/recovery scenarios (lost request, compliance hold, Raast outage); a reconciliation break triaged by AI and resolved by its owner; and the three themes (digital onboarding with the two-person rule, the green pot and footprint estimate, and the Paya Assistant).

**Rehearsal:** reset the data, then `make rehearse` plays this whole script against the real stack and checks every claim the presenter makes. Results: `evidence/demo/rehearsal-<date>.md` and `evidence/demo/scene-*.png`. (The 1.x rehearsal and screenshots are kept in `evidence/demo/v1/`.)

## Speakers

| Speaker | Member | Scenes |
|---|---|---|
| A | Rufayl Waseem (24i-5660) | Opening, Scene 5 |
| B | Taha Ali (24i-5525) | Scene 1, Evidence and decision |
| C | Harris Safi (24i-5652) | Scene 2, Scene 6 |
| D | Kanz ur Rehman (24i-5544) | Scene 3 |
| E | Mudaser Waleed (24i-5681) | Scene 4; runs Mission Control throughout |

## Before you start (T−15 min)

| Step | Command / action | Check |
|---|---|---|
| 1 | `make demo-reset`: **fresh synthetic data**. Never rehearse on live data. The velocity rule (5 payments per customer per 10 min) correctly holds a 6th payment | `curl localhost:8000/healthz` → ok |
| 2 | `make models` once (face models), then `cd web && npm run build && npx vite preview --port 4173`, or the Vercel URL | Start page loads |
| 3 | (iPhone) `cloudflared tunnel --url http://localhost:8000`; on the phone's start page paste the tunnel URL into **Paya server address**; Share → Add to Home Screen | Wallet sign-in loads |
| 4 | Laptop on the projector: `/control` → sign in as **Sana (Operations)** | Top bar shows **Live**, Raast rail **Simulated · NORMAL**, **Integrity pass** |
| 5 | Phone 1: **Ayesha** (Chai Junction till). Phone 2: **Sara Ahmed** | Till shows "New sale"; wallet shows the balance |
| 6 | Volume up (the till says "Rupees … received") | — |

**The operator switch is part of the story:** every action in Mission Control runs as the signed-in person, and the server checks their role. Switch from the top-right menu ("Act as").

**Fallbacks:**
- **No phone, tunnel or camera:** run both "phones" as browser windows. Scene 6's onboarding needs a camera; skip to the assistant, or show `evidence/screenshots/kyc/`.
- **Projector fails:** `evidence/demo/scene-*.png` tells the same story.

## Scene plan

### 0:00 – 0:40 · The problem and the promise (Speaker A)

*Show:* the start page (`/`), then Mission Control **Overview**.

> "At a Pakistani counter, a cashier often decides a QR payment worked by looking at the customer's phone. Raast P2M grew from 4.9 million to about 180 million payments in a year, but a screenshot isn't a settlement. Paya's promise: the till says **PAID** only when the money has moved and the ledger says so. Everything here is synthetic, the Raast rail is a simulator (you can see it badged in the top bar), and no real money moves."

### 0:40 – 2:20 · Scene 1: a normal payment (Speaker B)

| Do | Say | The audience sees |
|---|---|---|
| Ayesha keys **2450** → **Show Raast QR** | "A dynamic QR for one order." | QR on the till |
| Sara: **Pay a shop** → Chai Junction (or scan) | "The merchant's name and amount come from our server, not from the QR. You see your balance after the payment, the fee, the network." | **Review payment** screen |
| Sara: **slide to pay** (or focus the slider and press Enter) | "One idempotency key per payment request, so a retry can never charge twice." | "Processing" ring |
| Wait | "The wallet says Paid only when Raast confirms it." | Wallet **Paid**; till full-screen **PAID** with voice |
| Sara: **View receipt**; scroll to **Where your money went** | "The customer sees the money trail straight from the double-entry ledger." | Receipt; journal lines |
| Mission Control: type the reference in the search bar → open the row | "Operations sees the full evidence: lifecycle with actors, balanced postings, screening, audit hash." | Drawer with AUTH_POST, SETTLE, FEE |

### 2:20 – 3:40 · Scene 2: a lost request, and the customer refreshes (Speaker C)

| Do | Say | See |
|---|---|---|
| Mission Control → **Rail lab** → **Lost request** → **Apply scenario** | "Our call times out and Raast never received it. Most systems mark this failed and refund, and if the rail *did* get it, both sides end up paid." | Expected behaviour panel (test S4) |
| Ayesha: new sale **800**; Sara pays it | — | Wallet stays **Processing** ("Sent over Raast… not paid yet") |
| Sara closes and reopens the payment (or reloads the page) | "Reopening reads the truth from the server: still processing. No second debit." | Still **Processing** |
| Rail lab → **Restore healthy** | "Our recovery agent asks Raast. It says *not found*, so we resend the **same** end-to-end id. It settles exactly once." | Wallet turns **Paid** by itself; topology wire animates |

### 3:40 – 5:00 · Scene 3: compliance hold, with people deciding (Speaker D)

| Do | Say | See |
|---|---|---|
| Rail lab → pay as **Zarak (watch-list match)** → **Trigger test payment** | "Zarak matches our synthetic watch-list." | Run shows **Under review**: money reserved, not sent |
| Mission Control → **Cases & approvals** → open the **compliance hold** | "As Sana, from Operations, I can see it, but the drawer says only Compliance can decide." | No decision buttons for Ops |
| **Act as → Hamza** → **Release hold** → reason | "Only Compliance can release it, and the reason goes into the hash-chained audit log. Then the normal path resumes." | Payment settles; decision trail shows Hamza |

### 5:00 – 6:00 · Scene 4: Raast outage (Speaker E)

| Do | Say | See |
|---|---|---|
| **Act as → Sana** → Rail lab → **Outage** → Apply; pay as **Omar**; **Trigger test payment** ×4 | "Raast is down. After three failures the circuit breaker opens." | 4th run: **refused: RAIL_UNAVAILABLE**; top bar: breaker OPEN |
| — | "The 4th payment is refused **before** any debit. Nothing is half-done." | — |
| **Restore healthy** → **Ask the rail about all pending payments** | "Payments sent before the breaker opened are recovered by enquiry, and settle exactly once." | Runs turn **Settled** |

### 6:00 – 8:00 · Scene 5: reconciliation break → AI → owner (Speaker A)

| Do | Say | See |
|---|---|---|
| Rail lab → **Missing line** → Apply; pay as **Sara**; Trigger; **Restore healthy** | "Raast pays, but leaves the line out of its settlement file." | Run settles |
| **Act as → Rabia** → **Reconciliation** → **Import and reconcile** | "Finance verifies the file's control totals and hash, then matches every line." | Match rate < 100%; a **Missing in Raast file** line with its case |
| **Act as → Sana** → open the case → **Take it** | "The AI agent already looked at this break when it was opened. It proposes a cause and an action, with evidence. It's advisory: it can't move money, and we prove that with a test that reads its source." | Purple suggestion box, e.g. *raise with rail · 80%* (use **Re-run** to ask again) |
| **Accept suggestion** → **Resolve with evidence** | "Only the owning role decides, and every step is in the decision trail." | Case resolved |
| **Act as → Rabia** → **Import the same file again** | "The same file twice is refused by its SHA-256." | Toast: *File already imported* |

### 8:00 – 9:30 · Scene 6: the new themes, onboarding and the assistant (Speaker C)

| Do | Say | See |
|---|---|---|
| Phone: sign out → **Open a new Paya wallet** → name **Zarak Khanzad** → specimen card → head-turn check | "Digital onboarding with a synthetic SPECIMEN card, no real CNIC. Photos are checked in memory and never stored." | **A person is checking a few details** (nothing said about screening) |
| **Act as → Hamza** → **Identity & KYC** → open the referral → **Recommend approval** | "A possible watch-list match needs **two** compliance officers." | "Waiting for a second officer" |
| Hamza tries **Confirm** | "The server refuses: same person." | Toast **Needs a different person** |
| **Act as → Nadia** → **Confirm approval** | "A second officer confirms. The database itself enforces it." | Phone flips to **Your wallet is open** |
| Phone (Sara): **Ask Paya** → "mera balance kitna hai", then "send 500 to Ali" | "Conversational banking in Roman Urdu, answered from the ledger. And it can't move money, even if you ask nicely." | Balance card; "I can't send money from chat" |

### 9:30 – 10:30 · Evidence and decision (Speaker B)

*Show:* Mission Control **Audit & access** (as Auditor: chain intact, denials listed), then `docs/revamp/TESTING_REPORT.md`.

> "77 backend tests cover the required scenarios and more. The browser acceptance run checks 33 claims on a fresh database, and the rehearsal you just watched is automated too. Accessibility is scanned with zero violations. The limits: one process at about 16 payments a second, no MFA yet, a simulated rail and registry, and liveness that is basic rather than certified. Our recommendation is a **conditional go**."

## If something goes wrong live

| Symptom | Say | Do |
|---|---|---|
| A payment stays **Processing** | "This is the system being honest about uncertainty." | Rail lab → Restore healthy → Ask the rail about all pending payments |
| A payment is held unexpectedly | "The velocity rule just did its job." | Release it as Hamza, or pay as another customer |
| Top bar shows **Reconnecting…** | "The stream is display-only; the money is in the database." | Wait, or refresh the page |
| Onboarding liveness says **Try again** | "It wants a clearer head turn. That's the anti-spoofing check." | Turn further; it allows 3 attempts, then refers to a person |
| API down | "Let's prove recovery." | `docker restart paya-api-1`; healthy within seconds |
