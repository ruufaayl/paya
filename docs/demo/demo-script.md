# Paya: technical demo script (8–10 minutes)

**The brief asks for:** the normal flow, plus at least two failure/recovery scenarios, plus one reconciliation outcome.
**This script shows:** a normal flow, **four** failure/recovery scenarios, and a reconciliation break triaged by AI and resolved by a human.

**Rehearsal:** `make demo-reset` then `make rehearse` plays this whole script automatically and checks every claim below. See [`evidence/demo/`](../../evidence/demo/).

## Before you start (T−15 min)

| Step | Command / action | Check |
|---|---|---|
| 1 | `make demo-reset`: **fresh synthetic data**. Do not rehearse on the live data. The velocity rule (5 payments per customer per 10 min) will correctly hold repeat demo payments | `curl localhost:8000/healthz` → ok |
| 2 | `cd web && npm run build && npx vite preview --port 4173`, or the Vercel URL | Start page shows **connected** |
| 3 | (iPhone demo) `cloudflared tunnel --url http://localhost:8000`; paste the URL on the start page on the phone; Share → Add to Home Screen | Persona picker loads on the phone |
| 4 | Laptop on the projector: `/control`; press **F** to hide panels for the opening view | **LIVE** badge is green |
| 5 | Phone 1: **Ayesha – Chai Junction till**. Phone 2 (or a second browser tab sized as a phone): **Sara** | Both signed in |
| 6 | Volume up (the till speaks "Rupees … received") | — |

**Fallbacks:**
- **No phone or tunnel:** run both "phones" as browser windows on the laptop. Every step works the same.
- **Projector fails:** the scene screenshots in `evidence/demo/` and `evidence/screenshots/` tell the same story.

## Scene plan

### 0:00 – 0:45: The problem and the promise (Speaker A)

*Show:* the start page.

> "At a Pakistani counter, a cashier often decides a QR payment worked by looking at the customer's phone. Raast P2M went from 4.9 million to 182 million payments in a year, but a screenshot isn't a settlement. Paya's promise is simple: the till says **PAID** only when the money has actually moved and the ledger says so. Everything you'll see is synthetic, and no real money moves."

### 0:45 – 2:30: Scene 1, normal payment (Speaker B)

| Do | Say | The audience sees |
|---|---|---|
| Ayesha keys **2450**, then **Show Raast QR** | "A dynamic QR for one order." | Big QR on the till |
| Sara scans it (or picks the till from the list), then **slide to pay** | "One idempotency key is created per payment intent." | Packets flow: wallet → gateway → risk → ledger → Raast |
| Point at Mission Control | "Risk rules pass, funds are reserved, the ledger posts debit wallet / credit in-transit, and we hand it to Raast." | Nodes light up in order |
| Wait for the till | "The till waits for Raast's confirmation, not the customer's screen." | Full-screen **PAID**, plus the voice |
| Click the transaction in the feed (inspector) | "Every payment has a full evidence chain: state history, balanced journals, fee, notifications, audit hash." | AUTH_POST, SETTLE and FEE entries |

### 2:30 – 3:45: Scene 2, lost reply and an impatient customer (Speaker C)

| Do | Say | See |
|---|---|---|
| Chaos → **Lost reply** | "Raast takes the money but its reply is lost. Most systems mark this *failed* and refund, and that's how a customer and a merchant both get paid." | Rail node turns amber |
| Generate payment → Sara, 800 → **Pay + retry** | "The customer taps again with the same request." | Toast: *Retry with same key → … (replayed: true)* |
| — | "Same key, same answer, **one** debit. A new tap from a fresh session is also blocked: one live payment per QR." | — |
| Chaos → **Healthy**; **Ask rail about pending payments** | "We never blind-resend. We ask the rail: it says accepted, so we settle." | Recovery agent → rail → ledger: SETTLED |

### 3:45 – 5:00: Scene 3, compliance hold, a refused cashier, and a human decision (Speaker D)

| Do | Say | See |
|---|---|---|
| Generate payment → **Zarak**, 600 → Pay now | "Zarak matches our synthetic watch-list." | Risk → compliance gate pulses purple; card **COMPLIANCE HOLD** |
| — | "**No money has moved.** The decision and the rules fired are evidence." | Inspector: no journals |
| **Cashier tries finance action** | "Least privilege: a cashier can't run reconciliation." | Red `FORBIDDEN`; gateway → audit chain turns red |
| **Release as Hamza** | "Only Compliance can release, and the reason is recorded. Then the normal path resumes." | Packet compliance → ledger → rail; SETTLED |

### 5:00 – 6:15: Scene 4, Raast outage (Speaker E)

| Do | Say | See |
|---|---|---|
| Chaos → **Outage**; Omar pays Rs 50 four times | "The rail is down. After three failures the circuit breaker opens." | 4th attempt: `RAIL_UNAVAILABLE` |
| — | "Refused **before** any debit: the customer is told immediately, and nothing is half-done." | Breaker shows OPEN in the metrics bar |
| Chaos → **Healthy**; Ask rail about pending payments | "Payments accepted before the breaker opened are recovered by enquiry, and settled exactly once." | Settled |
| (Optional, terminal) `python docs/architecture/tools/recovery_drill.py` | "We also kill -9 the server mid-payment. It's back in 1.3 seconds and every payment settles exactly once." | Drill output |

### 6:15 – 8:00: Scene 5, reconciliation break → AI triage → human (Speaker A)

| Do | Say | See |
|---|---|---|
| Chaos → **Missing line**; Omar pays 450; Chaos → Healthy | "Raast pays, but leaves the line out of its settlement file: a partial failure at the rail." | — |
| **Run reconciliation (Rabia)** | "Finance checks the file's control totals, then matches every line to our ledger." | Recon node; ops gate pulses; **RECON BREAK** card |
| Point at the purple box | "The AI agent proposes a cause, an owner and an action, with evidence. It can't move money: we prove that with a test that reads its source." | *AI triage suggests: Raise with the rail operator, 80%* |
| **Accept as Sana**, then **Resolve as Sana** | "Only the case owner decides. Accepting changes nothing financially, and every step is in the audit chain." | Card closes |
| **Import same file again** | "Importing the same file twice is refused." | `DUPLICATE_SETTLEMENT_FILE` |

### 8:00 – 9:30: Evidence and decision (Speaker B)

*Show:* README test table → `evidence/` → the integrity checks (`/v1/finance/integrity`, all PASS) → the trial balance (balanced).

> "32 automated tests cover all ten required scenarios and more. The load test ran 400 payments, including a duplicate-acknowledgement storm, with zero duplicate settlements. Load testing found a real race; the database constraints held, we fixed it and we wrote a test for it. The AI evaluation shows 94% accuracy and zero unsafe autonomy. Our limits are a single process at about 16 payments a second, no MFA yet, and a simulated rail. Our recommendation is a **conditional go**."

## If something goes wrong live

| Symptom | Say | Do |
|---|---|---|
| A payment stays "awaiting confirmation" | "This is the system being honest about uncertainty." | Ask rail about pending payments |
| A payment is held unexpectedly | "The velocity rule just did its job." | Release as Hamza, or switch persona |
| Mission Control shows *reconnecting* | "The stream is display-only; the money is in the database." | Refresh the page |
| API down | "Let's prove recovery." | `docker restart paya-api-1`; it's healthy within seconds |
