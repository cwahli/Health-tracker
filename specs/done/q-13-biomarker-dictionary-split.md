---
id: q-13-biomarker-dictionary-split
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: extract
who: any-agent
# DONE 2026-09-19: nodes 1-3 landed as planned (consolidation / data-accuracy /
# agent panels); the file reached < 200 KB via a different fourth node —
# DictionaryItem + autoCalibrateBiomarkerDef moved out (see the amendment below),
# so the batch-paste panel is no longer required and is left as optional.
# BiomarkerDictionaryModal.tsx 6,230 -> 3,725 lines / 352,884 -> 183,970 B.
auto_go: false
allowed_files:
  - src/components/BiomarkerDictionaryModal.tsx
  - src/components/DictionaryConsolidationPanel.tsx
  - src/components/DictionaryDataAccuracyPanel.tsx
  - src/components/DictionaryAgentPanel.tsx
  - src/components/DictionaryBatchPastePanel.tsx
  - src/components/CATALOG.json
  - src/components/DictionaryItem.tsx
  - src/utils/biomarkerAutoCalibrate.ts
  - scripts/parity-baseline.json
frozen_files:
  - src/types.ts
  - src/App.tsx
  - src/jobs/JobStore.ts
  - src/components/AuthScreen.tsx
  - src/hooks/useAuthSession.ts
  - src/hooks/useAppSync.ts
  - src/utils/translations.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - scripts/assert-parity.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - node scripts/assert-egress-bomb.mjs
  - npx playwright test prototype/tests/key-journeys.spec.ts prototype/tests/dialog-inventory.spec.ts prototype/tests/header-chrome.spec.ts
  - node scripts/journey-guard.mjs q-13-biomarker-dictionary-split
  - node scripts/assert-spec-diff.mjs q-13-biomarker-dictionary-split
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-13 — BiomarkerDictionaryModal split (Studio blocker #2)

`src/components/BiomarkerDictionaryModal.tsx` is the second-largest file in the
tree and the next AI Studio transfer blocker after `Header.tsx` (Q-11.12) and
`LogChat.tsx` — and unlike `LogChat.tsx` nobody else is editing it.

## Measured now (`main` @ `b29a888`, 2026-09-19)

| Region | Lines | Bytes |
|---|---|---|
| file total | 6,230 | 352,884 (345 KB) |
| `BiomarkerDictionaryModal` function | 882–6,229 | 304,080 |
| its `return` statement | 3,134–6,228 | 207,576 |
| **`isDataAccuracyMode` panel, 3213–3793** | 581 | 41,710 (26 deps) |
| **`isNameConsolidationMode` panel, 3795–4505** | 711 | 49,669 (27 deps) |
| **`isAgentMode` panel, 4636–5125** | 490 | 37,608 (26 deps) |
| **`isBatchPasteMode` panel, 5264–6028** | 765 | 49,162 (74 deps) |
| sibling modals + instruction viewers, 6031–6224 | 194 | ~8,500 |
| `DictionaryItem` (already its own component) | 178–880 | 38,198 |

The body of the returned `<div>` is a chain of mutually exclusive mode panels
(`isDataAccuracyMode ? … : isNameConsolidationMode ? … : isAgentMode ? … :
isBatchPasteMode ? … : <list>`). Each panel is a contiguous, brace-balanced
sub-tree, which makes them individually movable byte-identically.

## Goal

`src/components/BiomarkerDictionaryModal.tsx` **< 200 KB** (the Studio ceiling),
line ceiling ratcheted to the achieved count, with the four mode panels owning
their own files. Verbatim moves only — no behaviour change.

## Amendment 2026-09-19 — the fourth node took a different route

Nodes 1–3 landed exactly as planned. For the fourth node the batch-paste panel
(765 lines / 49.2 KB) turned out to depend on `DictionaryItem`, a module-scope
component in the same file (703 lines / 38,198 B), whose own dependency
`autoCalibrateBiomarkerDef` (100 lines / 6,393 B, exported but imported by no
other file) was likewise in the way. Moving those two out of
`BiomarkerDictionaryModal.tsx` instead of the panel:

- removes **44,591 B** (vs 49,152 B for the panel) with **no props at all** —
  both are module-scope declarations, so there is no prop surface to plumb;
- lands the file at **183,970 B / 3,725 lines**, under the 200 KB ceiling; and
- makes the batch-paste panel strictly optional, so it is dropped from this
  packet and becomes a fresh small packet (or simply left: the file is no longer
  a Studio blocker).

`ensureCustomRanges` (8 lines), private to `DictionaryItem`, moved with it.
`DictionaryItem.tsx` and `utils/biomarkerAutoCalibrate.ts` were added to
`allowed_files` for this. Note that the batch-paste panel remains the reason the
file is still 180 KB rather than ~130 KB.

## In scope (one node per commit)

1. **Node 1 (largest cheap panel):** `DictionaryConsolidationPanel.tsx` ←
   3,795–4,505 (711 lines / 49,669 B, 27 props).
2. **Node 2:** `DictionaryDataAccuracyPanel.tsx` ← 3,213–3,793
   (581 lines / 41,710 B, 26 props).
3. **Node 3:** `DictionaryAgentPanel.tsx` ← 4,636–5,125
   (490 lines / 37,608 B, 26 props).
4. **Node 4 (most entangled — 74 props, do last):**
   `DictionaryBatchPastePanel.tsx` ← 5,264–6,028 (765 lines / 49,162 B).
   After node 4 the file is ≈ 175 KB, under the ceiling.
5. **Node 5:** ratchet `CATALOG.json` `src/components/BiomarkerDictionaryModal.tsx`
   ceiling to the achieved count (never a target, never a bump) and, only if
   `types.ts` / i18n / appLines improved, `assert-parity --update`.

## Out of scope

- `LogChat.tsx` — it is over its 7,000-line ceiling and **another agent is
  editing it in this working tree**; do not touch it in the same commit.
- `FoodCard.tsx`, `HomeTab.tsx`, `InsightsTab.tsx`, `utils/biomarkers.ts`
- `DictionaryItem.tsx` (already extracted), the sibling modals (6031–6224)
- Auth, sync, kcal writers, `finalizeDishLedger`, the biomarker conversion table

## Invariants

- **Move, do not rewrite.** Each moved region must be verifiable by
  string-containment against the pre-move file; a diff should be ±the same
  lines with no semantic edits.
- Preserve existing quirks, staleness and render conditions. Do not "fix" a
  panel while moving it.
- Every handle the shell smoke relies on stays: the modal's own root/ids, the
  `DictionaryItem` rows, and the four sibling modals' triggers.
- `src/types.ts` stays frozen; no `@ts-nocheck`; no deleted gate.
- Do not raise any `CATALOG.json` ceiling.

## Done when

1. `wc -c src/components/BiomarkerDictionaryModal.tsx` < 200,000 — **MET**
   (183,970 B).
2. No mode-panel markup that has been moved remains in the parent — **MET** for
   consolidation / data-accuracy / agent panels and for `DictionaryItem`.
3. Live: Health portal → biomarker dictionary still opens, edit mode and the
   modes render, no page errors — **MET** (`key-journeys` Journey 4 and
   shell-smoke 13/13; every moved region proven byte-identical).
4. `CATALOG.json` ceiling equals the achieved line count — **MET** (3726).
5. `git diff --name-only` ⊆ allowed_files; gate commands exit 0 — MET except the
   known unrelated `LogChat.tsx` 7,039 > 7,000 budget red and the
   `extra_file` / `frozen_touched` noise from another agent's in-flight edits.
