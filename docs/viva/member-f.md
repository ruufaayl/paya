# Member F (Ateeq Riaz): operations and bank transfers

**Read:**
- `src/paya/banks.py`: bank list, simulated directory (`lookup`), `initiate_transfer`, `counterparties`
- `src/paya/payments.py`: `_authorise_and_post`, `dispatch`, `_settle` (the shared money path a transfer uses)
- `src/paya/risk.py`: `screen` (payments and transfers), velocity rule
- `web/src/wallet/SendMoney.tsx`, `web/src/wallet/Txn.tsx`
- `docs/architecture/adr/ADR-018-bank-transfers.md`, `tests/test_transfers.py` (B1–B9)
- Mission Control as `ateeq.ops`: Transactions, Rail lab, Cases & approvals

## 90-second explanation
> "Besides paying a shop by QR, a customer can send money to any bank or wallet in Pakistan. They pick the bank, enter the account number or IBAN, and we show the account holder's name first, so they can check who they are paying. That name lookup is simulated: only synthetic test accounts exist, and a real account number is simply not found and never stored. The transfer then uses exactly the same money path as a shop payment: risk screening, a hold, one balanced ledger entry into 'in transit', the simulated Raast rail, then settlement. A timeout leaves it pending, never failed, and the recovery agent settles it exactly once. As an Ops officer I can see every transfer in Mission Control and request a reversal, which Finance must approve."

## Questions you must handle

| Question | Answer |
|---|---|
| Why show the account name before sending? | So the sender can catch a wrong number before money leaves. Real wallets do this with a title fetch over 1LINK/Raast |
| Do you look up real account names? | No. We have no licence or connection to 1LINK/Raast, and real names are personal data we must not collect. A simulated directory answers: 8 demo accounts plus any number starting with 99 (deterministic synthetic name). Anything else is "not found" (B2) |
| What do you store about the account? | Bank, masked number (`•••• 1234`), a keyed HMAC of the number, the fetched name and the purpose. Never the full number; the rail sees `BANK:****1234` (B5); the idempotency store keeps only a hash of the request |
| How is an IBAN checked? | `PK` + 2 check digits + 4-letter bank code + 16 digits; mod-97 must equal 1, and the bank code must match the chosen bank (B3) |
| Can someone use the lookup to list accounts? | Title fetch is limited to 20 lookups a minute per customer (B9, threat of enumeration) |
| Is a transfer a different money path? | No. Same screening (watch-list on the account holder's name, the shared velocity rule), hold, `AUTH_POST`, rail, `SETTLE`. No shop fee, so only two journals (B4) |
| What if Raast doesn't answer? | The transfer stays PENDING ("not sure yet"), the recovery agent asks the rail, and it settles exactly once; integrity checks still pass (B8) |
| Same tap twice? | The same Idempotency-Key replays the first answer: one debit (B6) |
| Not enough money? | Refused before anything is taken (B7) |
| What does Ops do with transfers? | Sees them in Transactions with the beneficiary, follows stuck ones in Rail lab, and can request a reversal; Finance approves (maker-checker) |
