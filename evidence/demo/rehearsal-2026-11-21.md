# Demo rehearsal - 2026-11-21 03:52 UTC

Automated run of [docs/demo/demo-script.md](../../docs/demo/demo-script.md) against the Compose stack, with two emulated iPhones and Mission Control. **Result: ALL CHECKS PASSED.**

Machine time 18 s. Presenter time is planned at 8-10 min (the script budgets narration per scene).

| Scene | Machine time | Checks |
|---|---:|---|
| 0. Set-up: Mission Control live, two phones signed in | 1.8 s | PASS Mission Control shows LIVE<br>PASS cashier till open<br>PASS customer wallet open |
| 1. Normal payment: QR -> slide to pay -> PAID only after Raast | 2.0 s | PASS customer sees Paid<br>PASS till shows PAID<br>PASS ledger shows AUTH_POST + SETTLE + FEE |
| 2. Lost reply + customer retry: no double debit, recovery by enquiry | 2.6 s | PASS toast proves replay<br>PASS exactly one debit of Rs 800<br>PASS payment settled after enquiry |
| 3. Watch-list hold -> human gate -> denied cashier -> compliance release | 2.3 s | PASS hold card appears<br>PASS denial toast shown<br>PASS released payment PAYA-20261121-A4F523 settled<br>PASS audit chain intact |
| 4. Raast outage: circuit breaker refuses before taking money | 5.4 s | PASS RAIL_UNAVAILABLE shown<br>PASS only payments accepted before the breaker opened exist (3 of 4 attempts)<br>PASS each accepted payment recovered and settled<br>PASS money taken equals settled payments only (refused attempts took nothing) |
| 5. Reconciliation break -> AI suggestion -> human accepts and resolves; duplicate file refused | 4.1 s | PASS AI suggestion appears<br>PASS duplicate file refused<br>PASS integrity has no FAIL (got: none)<br>PASS trial balance balanced |

Browser errors: none.
