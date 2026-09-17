---
id: q-4d-stage-rows-ratchet
status: locked
class: KIT_DRIFT
skill: biomarkers
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - src/components/AgentResultTable.tsx
  - src/utils/agentResultRows.ts
  - src/utils/agentResultRowsStages.ts
  - src/utils/agentResultRows.test.ts
  - src/utils/agentResultRowsStages.test.ts
  - src/components/CATALOG.json
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
  - src/utils/agentResultRowsFallback.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
  - server_meal_gate.ts
gate:
  - npx tsc --noEmit
  - node scripts/assert-budgets.mjs
  - npx vitest run src/utils/agentResultParse.test.ts src/utils/agentResultRows.test.ts src/utils/agentResultRowsStages.test.ts src/utils/agentResultRowsBatch.test.ts src/utils/agentResultRowsFallback.test.ts src/utils/agentResultMissingKeys.test.ts
  - node scripts/journey-guard.mjs q-4d-stage-rows-ratchet
  - node scripts/assert-spec-diff.mjs q-4d-stage-rows-ratchet
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-4d stage branches + dispatcher final + ceiling ratchet (step 4 of 4)

**Precondition:** q-4c COMPLETE (in `specs/done/`, committed on branch
`journey/q-4-thin`). This packet finishes Q-4: the reward is
`assert-budgets.mjs` green with `AgentResultTable.tsx` ceiling **1800**.

**Parent:** Q-4 AgentResultTable thin (parent packet `superseded`).

## Journey

Move the last four row branches, collapse the useMemo to a thin dispatch, add
the dispatcher contract test, ratchet the ceiling 2975→1800. Honest residual
(unchanged): Apply YAML still arrives as `agentResult` from Frozen call sites —
"call sites pass pre-built rows" is NOT this ID.

## Plan (locate by anchor text)

### Node 1 — stage branches → `src/utils/agentResultRowsStages.ts` (new, ~365 lines)

Verbatim, one function each, pure (args in, row array out):

- `buildMedicalExtractRows(args)` — old ~1145–1314 branch.
- `buildAgent2Rows(args)` — old ~1316–1367 (`bucketMapping` path).
- `buildAgent3Rows(args)` — old ~1369–1466.
- `buildDataReviewRows(args)` — old ~1468–1508.
- Shared imports (`sanitizeUnitText`, `resolveBiomarkerKey`, …) from
  `../utils/agentResultParse`; `isKeyMarkedNotUsed` re-implemented? No —
  import from `../utils/agentResultRowsBatch`. No AgentResultTable import
  (cycle = FAIL). Do not touch convertViaTable. Do not change row keys/flags.

### Node 2 — useMemo goes thin + dispatcher final (~+10 on `agentResultRows.ts`)

- `buildAgentResultRows` routes all seven agentTypes (agent1 via q-4b/q-4c
  builders, biomarker_review via q-4c, four new stage builders). Returns rows
  (never null at end).
- `AgentResultTable.tsx` useMemo collapses to:
  `if (!agentResult) return [];` + `return buildAgentResultRows({ … }) ?? [];`
  All interim probes/fall-throughs deleted.

### Node 3 — dispatcher contract test → `src/utils/agentResultRows.test.ts` (new)

- Routes each agentType to the right builder (mock builders or tiny fixtures);
  unknown type → `[]`. Small file, created once here.

### Node 4 — ratchet ceiling

- `CATALOG.json` `ceilings["src/components/AgentResultTable.tsx"]`: **2975 → 1800**.
- Done when: `node scripts/assert-budgets.mjs` PASS including `GOD_FILE_GROWTH`.
  Predicted final file ~1470 lines — margin ~330 under the ratchet.

### Churn budget (Builder MUST verify before commit)

Predicted on `AgentResultTable.tsx`: removed ~375, added ~12 → final ~1473 →
**~26%** (limit 30%). Dispatcher: +≤12 lines (~15%) — fine. CATALOG.json:
~2 lines — fine. If ART churn exceeds **27%**, STOP and return to planner.

## Test plan

```text
npx tsc --noEmit
node scripts/assert-budgets.mjs
npx vitest run src/utils/agentResultParse.test.ts src/utils/agentResultRows.test.ts src/utils/agentResultRowsStages.test.ts src/utils/agentResultRowsBatch.test.ts src/utils/agentResultRowsFallback.test.ts src/utils/agentResultMissingKeys.test.ts
node scripts/journey-guard.mjs q-4d-stage-rows-ratchet
node scripts/assert-spec-diff.mjs q-4d-stage-rows-ratchet
node scripts/assert-shell-smoke.mjs
```

Fixtures: `medical_extract` array-in matches before/after JSON (parent-packet
requirement, preserved). Do not edit goldens.

## Audit plan

1. Scope vs ROADMAP Q-4 only (no Q-10, no Header split, no ConfirmBar).
2. `git diff --name-only` ⊆ allowed_files.
3. Deletions ≥ additions in `AgentResultTable.tsx`.
4. Honest residual named: call sites still pass `agentResult` YAML.

## Blast radius

Allowed / Frozen are the YAML lists. Out of scope: App/LogChat/Header splits,
USDA, curator-on-Analyze, fill-template C1–C7, R-13, Q-10, rewriting InsightsTab
Apply, inventing `BiomarkerDataGrid` (ConfirmBar stays planned/path null).

## COMPLETE

On branch `journey/q-4-thin`. Checkpoint
`node scripts/journey-checkpoint.mjs save q-4d-stage-rows-ratchet builder-start`
before editing. Green gates → packet to `specs/done/`, commit on branch (NOT
main — morning merge), one AI_HANDOVER line. Q-4 DONE → next open ID is Q-10
(separate packet, separate turn).

## Stop and come back

Two repairs fail · Frozen file in the diff · churn >27% · New primitive id in
CATALOG.json · Live Gemini requested · `assert-budgets.mjs` edited to pass
