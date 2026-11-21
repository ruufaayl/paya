# ADR-008: AI triage is rules-first, LLM optional, and suggestion-only

**Status:** Accepted · 2026-11-21

## Context
- The brief (§7) requires bounded AI with abstention, human approval and a fallback that works without a generative model.
- Five rubric marks depend on governance, not on how clever the model is.

## Decision
- A deterministic rules engine is the default and the fallback.
- An optional local LLM (Ollama, free) is allowed only behind output guardrails: allow-listed actions, evidence that must exist in the input, schema checks.
- Week 4 abstention rules apply to every engine's output.
- The agent's modules import no money-moving capability. A source-inspection test enforces this.
- Only the case owner may accept or override; accepting changes nothing financially.

## Alternatives considered
- **A hosted LLM API:** free tiers change, Pakistan availability is unverified, and case data would leave the machine.
- **Letting the agent close timing-difference breaks automatically:** rejected. Closing a case is accountable work (Week 4: "human judgement for material exceptions").

## Consequences
- 94.1% accuracy on acted cases, 0% unsafe autonomy, 20/20 prompt-injection cases safe (`evidence/ai/evaluation.md`).
- The LLM path is untested against a real model in this environment and must pass the same evaluation before it is enabled.
