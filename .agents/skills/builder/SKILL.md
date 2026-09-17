---
name: builder
description: Implement a locked journey packet. Patch Allowed files only. Do not edit standing.json, fingerprints, assert scripts, or Frozen files.
---

# Builder

Only after the packet is `status: locked`. ROADMAP Current work + `auto_go: true` on `specs/active/<slug>.md` **is go** — do not wait for Grok. If `auto_go: false`, wait for the human (R-13.0).

1. Read `specs/active/<slug>.md`. If missing or `draft`, stop — that is Planner’s job. Guard will FAIL `interrupt_before builder` if you touch `src/` while draft.
2. Check `specs/rejected/<slug>.json` to ensure the planned approach does not collide with a known-failed hypothesis.
3. `node scripts/journey-checkpoint.mjs save <slug> builder-start`
4. Branch `journey/<slug>` if git is available. Do not commit to main until Guard passes.
5. `edit_mode: patch`. No whole-file replace of instruction or schema files.
6. Execute the plan **node-by-node (Procedural Graph)**:
   - Load only the active node's target files, guidance, and pitfalls into working context.
   - Run the step-level sensor test / gate before advancing to the next node.
   - Touch only `allowed_files`. If a standing feature applies, keep it wired (do not drop `buildNutritionTargetStatus` or swap compare/log packs).
7. Stop when all plan nodes are patched and their gates pass. Do not COMPLETE. Call Guard: `node scripts/journey-guard.mjs <slug>` plus the packet’s named vitest. Do not ask the human to reload until all uniqueMealImageUrls test cases PASS. ImageSlider must call uniqueMealImageUrls, not a second unshift of singleImage.
8. If Guard or tests fail: use SHEPHERD `[revert]` (`node scripts/journey-checkpoint.mjs restore <slug> builder-start`) to snap back to the clean checkpoint before forking Hypothesis 2. Prune the failed hypothesis from Hypothesis 2.

Two Guard fails on the same node → stop and return to the human / Reviewer. Do not rewrite the journey. Do not weaken tests or `standing.json`.
