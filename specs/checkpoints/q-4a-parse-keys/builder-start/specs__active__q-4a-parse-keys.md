---
id: q-4a-parse-keys
status: locked
class: KIT_DRIFT
skill: biomarkers
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - src/components/AgentResultTable.tsx
  - src/utils/agentResultParse.ts
  - src/utils/agentResultMissingKeys.ts
  - src/utils/agentResultParse.test.ts
  - src/utils/agentResultMissingKeys.test.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/components/Header.tsx
  - src/components/InsightsTab.tsx
  - src/components/chat-cards/BiomarkerCard.tsx
  - src/jobs/JobStore.ts
  - src/utils/analyteConversions.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - AGENTS.md
  - server_meal_gate.ts
gate:
  - npx tsc --noEmit
  - node scripts/assert-budgets.mjs
  - npx vitest run src/utils/agentResultParse.test.ts src/utils/agentResultMissingKeys.test.ts
  - node scripts/journey-guard.mjs q-4a-parse-keys
  - node scripts/assert-spec-diff.mjs q-4a-parse-keys
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-4a parse pures + missing-keys (shrink step 1 of 4)

**Parent:** Q-4 AgentResultTable thin. Parent single-PR plan is mathematically
unexecutable: 2975→1800 needs ≥65% file churn, gate allows ≤30%
(`specs/active/q-4-agent-result-table.md` is `superseded`). This sequence
commits per step on branch `journey/q-4-thin` so each Guard diffs only its own
step: q-4a (~7%) → q-4b (~25%) → q-4c (~25%) → q-4d (~26% + ratchet).
**Do not start q-4b until q-4a is COMPLETE (packet in `specs/done/`, committed
on `journey/q-4-thin`).**

## Journey

`AgentResultTable.tsx` (2975 lines) is the DataGrid primitive but also parses
agent YAML and owns `localStorage` missing-keys. Class `KIT_DRIFT`. This step
moves only the leaf pures; grid, rows, and call sites untouched.

## Plan (extract-only, verbatim)

### Node 1 — parse pures → `src/utils/agentResultParse.ts` (new, ~140 lines)

- Move verbatim lines **43–180**: `getInitialMarkersFromText` (44–81),
  `getInitialMarkerDetails` (83–127), `generateSafeKey` (129–133),
  `resolveBiomarkerKey` (136–163), `sanitizeUnitText` (165–180).
- `sanitizeUnitText` MUST be exported (planner-authorized deviation from parent
  packet: row modules q-4b/c/d import it; still zero behavior change).
- `resolveBiomarkerKey` keeps using `biomarkerDefinitions` + `profile.customBiomarkers`.
  New module imports `biomarkerDefinitions` from `../utils/biomarkers` directly.
  No import of AgentResultTable (cycle = FAIL). Do not touch convertViaTable.
- Call site: `import { … } from '../utils/agentResultParse'` + re-export the four
  public names from `AgentResultTable.tsx` so import paths keep working
  (only used in-file today; InsightsTab / BiomarkerCard import the component only).
- Done when: no function bodies remain in the `.tsx`; test round-trips a short
  clinical line → unique names.

### Node 2 — missing-keys → `src/utils/agentResultMissingKeys.ts` (new, ~30 lines)

- `readMissingKeys(batchIdx)` wraps lines 209–218 + the ~1925 effect read
  (same key string `` batch_${batchIdx}_missing_keys_to_move ``, same
  try/catch, same `[]` default, same "only seed when no saved value" semantics
  at the call site — the effect keeps its guards, it just calls the helper).
- `writeMissingKeys(batchIdx, keys)` wraps lines 230–235 (same swallow-quota-errors).
- Controlled `selectedMissingKeys` prop path unchanged. No new store. No BiomarkerCard edit.
- Done when: no `localStorage` literal remains in `AgentResultTable.tsx`.

### Churn budget (Builder MUST verify before commit)

Predicted: removed ~178, added ~16 → final ~2813 → **~7%** (limit 30%).
If measured `(added+removed)/final` on `AgentResultTable.tsx` exceeds **27%**,
STOP and return to planner — do not commit, do not weaken the gate.

## Test plan

```text
npx tsc --noEmit
node scripts/assert-budgets.mjs
npx vitest run src/utils/agentResultParse.test.ts src/utils/agentResultMissingKeys.test.ts
node scripts/journey-guard.mjs q-4a-parse-keys
node scripts/assert-spec-diff.mjs q-4a-parse-keys
node scripts/assert-shell-smoke.mjs
```

New tests are created once in this packet (untracked → invisible to churn gate).
Fixtures: clinical text with 2 markers + date line; batchIdx round-trip incl.
quota-throw swallow (mock `localStorage.setItem` to throw).

## Audit plan

1. Scope vs this packet only (no row moves — those are q-4b/c/d).
2. `git diff --name-only` ⊆ allowed_files.
3. Deletions ≥ additions in `AgentResultTable.tsx`.
4. Byte-identical moved bodies (`git diff` on moved regions shows only deletion).

## Blast radius

Out of scope: row builders, useMemo, ceiling ratchet (stays 2975 — budgets must
still PASS), App/LogChat/Header splits, USDA, curator-on-Analyze, Q-10, R-13.

## COMPLETE

Branch `journey/q-4-thin` (create if missing). Checkpoint `builder-start`
equivalent: `node scripts/journey-checkpoint.mjs save q-4a-parse-keys builder-start`
before editing. On green gates: move packet to `specs/done/`, commit on the
branch (NOT main), one AI_HANDOVER line. Next: q-4b.

## Stop and come back

Two repairs fail · Frozen file in the diff · churn >27% · Live Gemini requested ·
`assert-budgets.mjs` edited to pass
