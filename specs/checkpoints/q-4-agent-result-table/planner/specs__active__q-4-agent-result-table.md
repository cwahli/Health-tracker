---
id: q-4-agent-result-table
status: locked
class: KIT_DRIFT
skill: biomarkers
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - src/components/AgentResultTable.tsx
  - src/utils/agentResultParse.ts
  - src/utils/agentResultRows.ts
  - src/utils/agentResultMissingKeys.ts
  - src/utils/agentResultParse.test.ts
  - src/utils/agentResultRows.test.ts
  - src/utils/agentResultMissingKeys.test.ts
  - src/components/CATALOG.json
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
  - npx vitest run src/utils/agentResultParse.test.ts src/utils/agentResultRows.test.ts src/utils/agentResultMissingKeys.test.ts
  - node scripts/journey-guard.mjs q-4-agent-result-table
  - node scripts/assert-spec-diff.mjs q-4-agent-result-table
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-4 AgentResultTable thin (KIT_DRIFT extract-only)

**Unlocked 2026-09-17.** Grok catalog lock is in this packet + `CATALOG.json`. Any builder executes it. Do not wait for Grok quota. Do not invent a new primitive.

## Journey

`AgentResultTable.tsx` is the DataGrid primitive (`CATALOG.json` id `DataGrid`, status `partial`) but it also parses agent YAML, builds rows per `agentType`, and owns `localStorage` missing-keys. Class `KIT_DRIFT`. Better = the `.tsx` is grid behavior only (sort / page / row select / apply buttons that call props). Parse and row-build live in TypeScript modules. Call-site files stay Frozen — re-export the old names from `AgentResultTable.tsx` so InsightsTab / BiomarkerCard do not change.

Reward = `assert-budgets.mjs` green with `src/components/AgentResultTable.tsx` ceiling **1800** (ratchet today is 2975). Not “the page still works.”

## Findings (do not redo)

- File is **2975** lines. Q-1 ceiling added 2026-09-17 at 2975 so it cannot grow. Q-4 lowers that ceiling to **1800** in the same PR as the extract.
- Catalog: DataGrid = sort / page / row select — no agent YAML / apply / localStorage missing-keys. Do **not** invent `BiomarkerDataGrid`. ConfirmBar stays `planned` / `path: null`.
- Public exports used inside this file only (re-export after move): `getInitialMarkersFromText`, `getInitialMarkerDetails`, `generateSafeKey`, `resolveBiomarkerKey`.
- `localStorage` keys `batch_${batchIdx}_missing_keys_to_move` at lines ~213, ~233, ~1925.
- `tableData` `useMemo` is ~377–1628 (~1250 lines) of `if (agentType === …)` YAML/row parse.
- `mergedInfoForStep2` ~242–359 is Step-1 YAML replay for agent2 — belongs with row builders, not the grid.
- Apply / Continue buttons already call `onApplyChanges` / `onContinueToNextStep` props. Do **not** move Apply into InsightsTab this ID.
- Q-9 already shipped (extract-only App/LogChat/scout). Do not touch those files.
- Locked converts `1.293` / `1.411` / `3.362` / `79.56` / `13.68` are Frozen (`analyteConversions.ts`).

## Plan (procedural micro-node graph, extract-only)

### Node 1 — parse pures (target −140)

- Target: `AgentResultTable.tsx` lines **44–180** (`getInitialMarkersFromText`, `getInitialMarkerDetails`, `generateSafeKey`, `resolveBiomarkerKey`, `sanitizeUnitText`) → new `src/utils/agentResultParse.ts` (verbatim named exports). `sanitizeUnitText` may stay unexported if nothing else needs it.
- Thin call site: import those names; **re-export** the four public functions from `AgentResultTable.tsx` so existing import paths keep working.
- Guidance: verbatim. No unit-factor changes. `resolveBiomarkerKey` still uses `biomarkerDefinitions` + `profile.customBiomarkers`.
- Pitfalls: (Import cycle, new module must not import AgentResultTable) · (Export surface, keep names) · (Do not touch convertViaTable).
- Done when: `AgentResultTable.tsx` no longer contains the function bodies; tests round-trip a short clinical line → unique names.
- Step gate: `npx tsc --noEmit` · `npx vitest run src/utils/agentResultParse.test.ts`

### Node 2 — row builders (target −1250)

- Target: `isKeyMarkedNotUsed` (~362–375), `mergedInfoForStep2` (~242–359), `tableData` `useMemo` (~377–1628) → new `src/utils/agentResultRows.ts` exporting `buildAgentResultRows(args)` (pure: args in, row array out).
- `AgentResultTable.tsx` keeps `const tableData = useMemo(() => buildAgentResultRows(…), deps)`.
- Guidance: verbatim move of the agentType switches. Do not simplify agent1/2/3/4/data_review/biomarker_review/medical_extract into one generic mapper. Do not change row keys or status flags (`isNew`, `isMissing`, `isAtRisk`, …).
- Pitfalls: (Hook rules, builder is a pure function not a hook) · (profile.notUsedBiomarkers still consulted) · (Frozen InsightsTab — do not change how agentResult is passed).
- Done when: `wc` of AgentResultTable drops by ≥1200 vs HEAD; row fixture for `agent1` array-in and `medical_extract` array-in matches before/after JSON.
- Step gate: `npx tsc --noEmit` · `npx vitest run src/utils/agentResultRows.test.ts src/utils/agentResultParse.test.ts`

### Node 3 — missing-keys localStorage out of the grid (target −40)

- Target: `localStorage.getItem` / `setItem` for `batch_${batchIdx}_missing_keys_to_move` → `src/utils/agentResultMissingKeys.ts` (`readMissingKeys(batchIdx)`, `writeMissingKeys(batchIdx, keys)`). Table initial state and `handleSelectedMissingKeysChange` call the helper.
- Guidance: same key string. Swallow quota errors like today. Controlled `selectedMissingKeys` prop path unchanged.
- Pitfalls: (Do not add a new missing-keys store) · (Do not edit BiomarkerCard).
- Done when: `AgentResultTable.tsx` has no `localStorage` literal.
- Step gate: `npx vitest run src/utils/agentResultMissingKeys.test.ts`

### Node 4 — ratchet ceiling

- In `CATALOG.json` `ceilings["src/components/AgentResultTable.tsx"]`: **2975 → 1800**.
- Done when: `node scripts/assert-budgets.mjs` PASS (including `GOD_FILE_GROWTH` on AgentResultTable).
- Honest residual: Apply YAML still arrives as `agentResult` from Frozen call sites. “Call sites pass pre-built rows” is **not** this ID.

## Test plan

```text
npx tsc --noEmit
node scripts/assert-budgets.mjs
npx vitest run src/utils/agentResultParse.test.ts src/utils/agentResultRows.test.ts src/utils/agentResultMissingKeys.test.ts
node scripts/journey-guard.mjs q-4-agent-result-table
node scripts/assert-spec-diff.mjs q-4-agent-result-table
node scripts/assert-shell-smoke.mjs
```

## Audit plan

1. Scope vs ROADMAP Q-4 only (no Q-10, no Header split, no ConfirmBar).
2. `git diff --name-only` ⊆ allowed_files.
3. Deletions ≥ additions in `AgentResultTable.tsx`.
4. Honest residual named: call sites still pass `agentResult` YAML.

## Blast radius

Allowed / Frozen are the YAML lists. Out of scope: App/LogChat/Header splits, USDA, curator-on-Analyze, fill-template C1–C7, R-13, Q-10, rewriting InsightsTab Apply.

## Stop and come back

Two repairs fail · Frozen file in the diff · New primitive id in CATALOG.json · Live Gemini requested · `assert-budgets.mjs` edited to pass
