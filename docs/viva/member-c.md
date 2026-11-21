# Member C: reconciliation, data model, integrity checks, AI triage

**Read:**
- `src/paya/recon.py`: `run`, `verify_control_totals`
- `src/paya/integrity.py`
- `src/paya/ai_triage.py`, `src/paya/ai_service.py`
- `docs/architecture/07-data-model.md`, `08-source-of-truth.md`, `09-ledger-and-reconciliation.md`, `15-ai-governance.md`
- `evidence/ai/evaluation.md`, `evidence/ledger/worked-examples.md`

## 90-second explanation
> "Reconciliation compares our ledger with the rail's settlement file. First the batch controls: record count, value total and SHA-256 must match the trailer, and the same file can't be imported twice. Then we match by end-to-end id and classify each line into seven categories. Every break becomes a case with an owner and an SLA. Twelve continuous integrity checks cover the other Week 9 layers. Our AI agent triages breaks: it suggests a cause and action with evidence, abstains when it should, and can't move money."

## Questions you must handle

| Question | Answer |
|---|---|
| Name the reconciliation categories | MATCHED, MISSING_EXTERNAL (Ops), MISSING_INTERNAL (Finance, plus CLAIM journal), DUPLICATE_EXTERNAL (Ops), AMOUNT_MISMATCH (Finance), STATUS_MISMATCH (Finance), TIMING_DIFFERENCE (none) |
| Timing difference vs missing? | Settled after the 21:00 cut-off → expected in the next file. Otherwise missing. A later file match auto-closes the case as `MATCHED_IN_LATER_FILE` |
| What if the rail never sends a file containing a payment? | Integrity check `settled_but_unreconciled_after_d1`. We found this gap ourselves: an identical file is correctly refused as a duplicate |
| Why are the rail's records in a separate schema? | They are external claims. Mixing them into the ledger would mean reconciling the ledger with itself (ADR-005) |
| What does the AI see? | Minimum data with evidence references; no names or identifiers (`build_context`) |
| When does it abstain? | Confidence < 0.75; rail status unknown; amount > PKR 100k; compliance link (Week 4 list) |
| How do you know it can't move money? | `test_ai_has_no_money_moving_capability` parses the modules' source and fails on any import of ledger, payments, state or recon functions |
| Are your 94% numbers circular? | The true cause is chosen first; the agent sees only generated evidence with noise and traps; the errors are reported (omission near cut-off) |
| Show me the ERD | `rendered/erd-core.png`. The full ERD is generated from the code, so it cannot drift |
