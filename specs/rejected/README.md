# specs/rejected — Negative Procedural Memory (Rejection Cache)

Inspired by **Procedural Graphs (Lu et al., 2026)** and **SHEPHERD (2026)**.

When an agent hypothesis fails Guard or named sensor tests and is reverted, the Reviewer (or failed Builder fork) records the invalidated hypothesis here.

## Purpose
1. **Prevent Amnesia Retries:** Stops future agent sessions (across Grok, Gemini/Antigravity, AI Studio) and unattended night loops (`scripts/discover-gated-work.mjs`) from proposing or attempting already-invalidated architectural edits.
2. **Search Space Pruning:** The Planner queries this directory before drafting `specs/active/<slug>.md`.
3. **Contrastive Trajectory Grounding:** Forms the negative boundary for contrastive refinement.

## Schema (`specs/rejected/<slug>.json`)
```json
{
  "slug": "compare-learn-from-log",
  "timestamp": "2026-09-10T20:00:00Z",
  "failed_hypotheses": [
    {
      "id": "h1-direct-import-scout-instruction",
      "summary": "Imported scoutSystemInstruction directly into compare call site",
      "why_failed": "Violated standing invariant siblings_distinct; dropped EVALUATION ONLY and allExtractedDishes",
      "signature": "import { scoutSystemInstruction } from './server_vision_scout.js'",
      "divergent_node": "server_food_analyze_run_scout.ts",
      "guard_fail_id": "food_compare_instruction_missing"
    }
  ]
}
```
