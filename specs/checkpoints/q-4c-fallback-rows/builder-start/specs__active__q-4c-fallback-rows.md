---
id: q-4c-fallback-rows
status: locked
class: KIT_DRIFT
skill: biomarkers
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - src/components/AgentResultTable.tsx
  - src/utils/agentResultRows.ts
  - src/utils/agentResultRowsFallback.ts
  - src/utils/agentResultRowsFallback.test.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/components/Header.tsx
  - src/components/InsightsTab.tsx
  - src/components/chat-cards/BiomarkerCard.tsx
  - src/jobs/JobStore.ts
  - src/utils/analyteConversions.ts
  - src/utils/agentResultParse.ts
  - src/utils/agentResultMissingKeys.ts
  - src/utils/agentResultRowsBatch.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
  - server_meal_gate.ts
gate:
  - npx tsc --noEmit
  - node scripts/assert-budgets.mjs
  - npx vitest run src/utils/agentResultRowsFallback.test.ts src/utils/agentResultRowsBatch.test.ts
  - node scripts/journey-guard.mjs q-4c-fallback-rows
  - node scripts/assert-spec-diff.mjs q-4c-fallback-rows
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-4c agent1 json-parse + fallback + biomarker_review (shrink step 3 of 4)

**Precondition:** q-4b COMPLETE (in `specs/done/`, committed on branch
`journey/q-4-thin`). Guard diffs vs HEAD — q-4b's commit is what keeps this
step at ~25%.

**Parent:** Q-4 AgentResultTable thin (parent packet `superseded`).

## Journey

Move the agent1 JSON/YAML parse, the fallback row map (+missing +unmapped),
and the whole biomarker_review branch. Left for q-4d: medical_extract, agent2,
agent3, data_review + dispatcher final + ceiling ratchet. Class `KIT_DRIFT`,
extract-only, verbatim.

## Plan (locate by anchor text — numbers shifted after q-4a/q-4b)

### Node 1 — json-parse → `src/utils/agentResultRowsFallback.ts` (new)

- `parseAgent1Json(agentResult)`: verbatim old 382–477
  (`const jsonText = agentResult.filledRows || agentResult.extractedData || agentResult;`
  through the `parsedRows.length === 0` YAML branch).
  Returns `{ parsedRows }`. Note line ~474 mutates `p.value` on freshly mapped
  objects only — no external side effects; keep verbatim.
- Call site replaces the inline block with
  `const { parsedRows } = parseAgent1Json(agentResult);` at the same position
  (evaluation order vs the q-4b dispatcher probe unchanged).

### Node 2 — fallback → same module, `buildAgent1FallbackRows(args)` (~238 lines)

- Verbatim old 904–1141: `finalRowsFallback = parsedRows.map(…)` (ends
  `return finalRowsFallback;`), including the missing-markers block
  (`getInitialMarkersFromText(initialRawText)` — import from
  `../utils/agentResultParse`) and the `unmappedTests` append.
- Signature: `({ agentResult, parsedRows, profile, biomarkerHistory, initialRawText })`.
- Do not change row keys or status flags.

### Node 3 — biomarker_review → same module, `buildBiomarkerReviewRows(args)` (~116 lines)

- Verbatim old 1510–~1625 branch. Dispatcher (Node 4) routes it; the inline
  branch is deleted.

### Node 4 — dispatcher grows (~+10 lines on `src/utils/agentResultRows.ts`)

- `buildAgentResultRows` also delegates agent1-fallback-complete (json-parse +
  fallback inline remainder now fully covered → route the whole agent1 case
  when NOT batch? Careful: agent1 block after Nodes 1–2 is empty — route
  `agentType === 'agent1'` fully to a `buildAgent1Rows` composer in the fallback
  module that calls parse → batch? No: batch lives in the q-4b module.
  Simplest honest routing: dispatcher handles `biomarker_review` (new) and
  keeps agent1-batch (q-4b); agent1 non-batch still flows inline through
  parseAgent1Json + buildAgent1FallbackRows calls until q-4d unifies.
  Keep additions to the dispatcher ≤12 lines (churn guard on the small file).
- No dispatcher unit test yet (q-4d).

### Churn budget (Builder MUST verify before commit)

Predicted: removed ~450, added ~15 → final ~1836 → **~25%** (limit 30%).
Dispatcher file: +≤12 lines on a ~70-line file (~15%) — fine.
If `AgentResultTable.tsx` churn exceeds **27%**, STOP and return to planner.

## Test plan

```text
npx tsc --noEmit
node scripts/assert-budgets.mjs
npx vitest run src/utils/agentResultRowsFallback.test.ts src/utils/agentResultRowsBatch.test.ts
node scripts/journey-guard.mjs q-4c-fallback-rows
node scripts/assert-spec-diff.mjs q-4c-fallback-rows
node scripts/assert-shell-smoke.mjs
```

Test file created once here. Fixtures: agent1 array-in (matches before/after
JSON) + biomarker_review payload. Do not edit goldens.

## Audit plan

1. Scope vs this packet only (medical_extract/agent2/agent3/data_review stay).
2. `git diff --name-only` ⊆ allowed_files.
3. Deletions ≥ additions in `AgentResultTable.tsx`.

## Blast radius

Out of scope: stage branches, dispatcher final, ceiling ratchet (stays 2975),
App/LogChat/Header splits, USDA, curator-on-Analyze, Q-10, R-13.

## COMPLETE

On branch `journey/q-4-thin`. Checkpoint
`node scripts/journey-checkpoint.mjs save q-4c-fallback-rows builder-start`
before editing. Green gates → packet to `specs/done/`, commit on branch (NOT
main), one AI_HANDOVER line. Next: q-4d.

## Stop and come back

Two repairs fail · Frozen file in the diff · churn >27% · Live Gemini requested ·
`assert-budgets.mjs` edited to pass
