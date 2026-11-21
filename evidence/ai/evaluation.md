# AI triage agent: offline evaluation

Engine `triage-rules-v1` (deterministic default). Dataset: `data/ai_eval/breaks.jsonl`, 120 synthetic breaks, seed 2026. The true cause is chosen first; the agent sees only generated evidence, with noise and traps. Audit completeness (every suggestion has an audit row and prompt hash) is measured live by `GET /v1/ai/metrics` and proven by `test_recon_break_is_auto_triaged_*`.

| Metric | Result | Target | Met |
|---|---|---|---|
| Triage accuracy (acted cases) | 80/85 = 94.1% | >= 85% | yes |
| False reassurance rate (said 'wait' when action was needed) | 3/85 = 3.5% | <= 5% | yes |
| Unsafe autonomy (should abstain, did not) | 0/22 = 0.0% | 0% | yes |
| Policy violations (action off allow-list, invented evidence) | 0 | 0 | yes |
| Safe outcome rate (correct or handed to a human) | 115/120 = 95.8% | >= 95% | yes |
| Coverage (cases the agent handled without abstaining) | 85/120 = 70.8% | report | yes |
| Prompt-injection cases handled safely | 20/20 | 100% | yes |
| Latency p95 (rules engine) | 0.01 ms | <= 500 ms | yes |

## Where it goes wrong (acted, but wrong action)

| True cause | Agent suggested | Count | Why |
|---|---|---:|---|
| RAIL_OMITTED_LINE | WAIT_FOR_NEXT_FILE | 3 | omission settled near cut-off looks like a timing difference: the trap case |
| LATE_SETTLEMENT | RAISE_WITH_RAIL | 2 | late settlement not near our cut-off: rail's cut-off differs from ours |

## Abstentions by true cause

| Cause | Cases | Abstained |
|---|---:|---:|
| AMOUNT_ALTERED | 8 | 8 |
| DUPLICATE_LINE | 20 | 4 |
| FEE_NETTED | 12 | 4 |
| LATE_SETTLEMENT | 18 | 3 |
| PENDING_NEVER_RECEIVED | 12 | 2 |
| PENDING_RAIL_HAS_IT | 10 | 4 |
| RAIL_OMITTED_LINE | 16 | 5 |
| REVERSED_BUT_SETTLED | 12 | 1 |
| SETTLED_WITHOUT_RAIL_RECORD | 9 | 1 |
| UNKNOWN_RAIL_DEBIT | 3 | 3 |

## Reading these numbers

- **Errors are cheap by design.** The most common error is suggesting *wait for the next file* for an omission that settled near cut-off. The cost is a one-day delay, and the case re-opens if the next file does not match. A human still owns every case, and accepting a suggestion moves no money.
- **Unsafe autonomy must be zero.** Every case with missing evidence, high value or a compliance link was handed to a human.
- **Injection text in rail fields had no effect.** The rules engine never reads free text as instructions. The LLM path is guarded by schema, allow-list and evidence validation (see `tests/test_ai_triage.py`).
- **Not evaluated here:** an LLM engine. No model runs in this environment. The optional Ollama path falls back to rules on any failure, and should be evaluated on this same dataset before it is ever switched on.
