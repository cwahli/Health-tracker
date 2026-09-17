---
id: q-4b-batch-rows
status: locked
class: KIT_DRIFT
skill: biomarkers
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - src/components/AgentResultTable.tsx
  - src/utils/agentResultRows.ts
  - src/utils/agentResultRowsBatch.ts
  - src/utils/agentResultRowsBatch.test.ts
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
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
  - server_meal_gate.ts
gate:
  - npx tsc --noEmit
  - node scripts/assert-budgets.mjs
  - npx vitest run src/utils/agentResultRowsBatch.test.ts
  - node scripts/journey-guard.mjs q-4b-batch-rows
  - node scripts/assert-spec-diff.mjs q-4b-batch-rows
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-4b batch row path (shrink step 2 of 4)

**Precondition:** q-4a COMPLETE (in `specs/done/`, committed on branch
`journey/q-4-thin`). Check out that branch. Guard diffs vs HEAD, so q-4a's
commit is what keeps this step's churn at ~25% instead of ~50%.

**Parent:** Q-4 AgentResultTable thin (parent packet `superseded` — single-PR
needs ≥65% churn, gate allows ≤30%).

## Journey

Move the Step-2 merge replay, the not-used check, and the agent1
batchBiomarkers row path out of the grid. Everything else stays inline for
q-4c/q-4d. Class `KIT_DRIFT`, extract-only, verbatim.

## Plan (line numbers vs q-4a COMPLETE tree — re-verify before cutting)

All spans below assume q-4a removed ~178 lines above line 242, so regions sit
~160–180 lines higher than in the 2026-09-17 file. Builder: locate by anchor
text, not blind numbers.

### Node 1 — dispatcher skeleton → `src/utils/agentResultRows.ts` (new, ~50 lines)

- Export `AgentResultRowsArgs` (agentResult, agentType, profile,
  biomarkerHistory, initialRawText, precedingAgent1Result) and
  `buildAgentResultRows(args): any[] | null`.
- This step it handles ONE case: agent1-with-batchBiomarkers → delegates to
  `buildAgent1BatchRows` (Node 3). Every other input returns `null`
  (caller falls through to the remaining inline code — order preserved).
- No dispatcher unit test this step (kept for q-4d; chunk test below covers it).

### Node 2 — helpers → `src/utils/agentResultRowsBatch.ts` (new)

- `computeMergedInfoForStep2(agentType, precedingAgent1Result, profile)`:
  verbatim body of the `mergedInfoForStep2` useMemo (old 242–359). Deps were
  `[agentType, precedingAgent1Result]`; `profile` was closed over — now a param.
- `isKeyMarkedNotUsed(checkKey, checkName, profile)`: verbatim body of old
  362–375 (`profile?.notUsedBiomarkers || profile?.notUsedInMedicalHistory`).
- Both pure. No hooks. `profile.notUsedBiomarkers` still consulted.

### Node 3 — batch path → same module, `buildAgent1BatchRows(args)` (~424 lines)

- Verbatim body of the `if (agentResult?.batchBiomarkers && …)` block
  (old 479–~902, ends with `return finalRows;`). Signature:
  `({ agentResult, parsedRows, profile, biomarkerHistory, mergedInfo })`.
  `parsedRows` is still computed inline by the old 382–477 code (moves in q-4c).
- Internal calls to `isKeyMarkedNotUsed` / `resolveBiomarkerKey` /
  `sanitizeUnitText` become module imports (`../utils/agentResultParse`).
  No import of AgentResultTable (cycle = FAIL). Do not touch convertViaTable.
- Call site (inside the agent1 block, position unchanged):
  `return buildAgent1BatchRows({ agentResult, parsedRows, profile, biomarkerHistory, mergedInfo: mergedInfoForStep2 });`
  plus at the top of the agent1 block (or useMemo head):
  `const r = buildAgentResultRows({ …full args… }); if (r !== null) return r;`
  placed so evaluation order of the remaining inline code is unchanged.
- Guidance: verbatim move of the alignment scoring. Do not simplify. Do not
  change row keys or status flags (`isNew`, `isMissing`, `isAtRisk`, …).
- Done when: `wc` drops ~540 vs HEAD; fixture `agent1` batch-in matches
  before/after JSON (capture before/after with the new test).

### Churn budget (Builder MUST verify before commit)

Predicted: removed ~556, added ~18 → final ~2271 → **~25%** (limit 30%).
New modules are untracked → invisible to the churn gate. If measured
`(added+removed)/final` on `AgentResultTable.tsx` exceeds **27%**, STOP and
return to planner.

## Test plan

```text
npx tsc --noEmit
node scripts/assert-budgets.mjs
npx vitest run src/utils/agentResultRowsBatch.test.ts
node scripts/journey-guard.mjs q-4b-batch-rows
node scripts/assert-spec-diff.mjs q-4b-batch-rows
node scripts/assert-shell-smoke.mjs
```

Test file created once here (untracked → invisible). Fixture: agent1 payload
with `batchBiomarkers` + precedingAgent1Result; assert row keys/flags equal the
pre-move inline output (record expected JSON in-test, not by editing goldens).

## Audit plan

1. Scope vs this packet only (json-parse 382–477, fallback, review branches stay).
2. `git diff --name-only` ⊆ allowed_files.
3. Deletions ≥ additions in `AgentResultTable.tsx`.
4. Frozen InsightsTab/BiomarkerCard untouched — `agentResult` still passed as-is.

## Blast radius

Out of scope: json-parse move, fallback move, review branches, ceiling ratchet
(stays 2975), App/LogChat/Header splits, USDA, curator-on-Analyze, Q-10, R-13.

## COMPLETE

On branch `journey/q-4-thin`. Checkpoint
`node scripts/journey-checkpoint.mjs save q-4b-batch-rows builder-start` before
editing. On green gates: packet → `specs/done/`, commit on the branch (NOT
main), one AI_HANDOVER line. Next: q-4c.

## Stop and come back

Two repairs fail · Frozen file in the diff · churn >27% · Live Gemini requested ·
`assert-budgets.mjs` edited to pass
