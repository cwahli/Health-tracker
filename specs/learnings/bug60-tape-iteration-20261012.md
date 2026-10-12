---
slug: bug60-tape-iteration
date: 2026-10-12
class: PROCESS_GAP
node: Builder
status: draft
---

# Learning: Bug-60 tape iteration — timestamp-first, loader-before-resolver, disprove-before-fix

## What happened
- Bug-60 (card #50 `tag_muwytoo8_plh9mi`) drained two active lines across two iterations: scout-resolve via PR #767 (server `loadJobTape` used browser `r2Storage` relative-fetch helpers under Node, so reanalyze always 409'd despite R2 holding the tape), then trial-balance via PR #768 (`extractLedgerBooks` read stale LLM `estimatedCalories` instead of post-foundation scout nutrients). Deployed reanalyze scored 100/allGreen; row is `review`.
- The original miss was a timestamp ordering the owner skipped: job ran 14 Aug 00:07 UTC, catalog coverage landed ~19h later. No code could have resolved it at runtime.
- The owner's fallback hypothesis (335 kcal gap = fallback-vs-canonical deltas) was disproven by number before any fix: canonical recompute of all 16 components = 1885.6 vs frozen saved 1885. True gap was stale-guess (1550) vs own-math (1885).
- CI friction on both PRs: same-SHA twin runs (one red, one green — retrigger, don't chase), the auto-pr bot rewriting the PR body on push (patch body via `gh api .../pulls/N -X PATCH -F body=@file` after pushing, keep `## Summary/Status/Left` + `Next:` + `Reverts:` + `Author:` trailer), and a direct-to-main no-trailer commit tripping the author-trail gate (record in `scripts/author-trail-debt.txt`, never rewrite history).

## What the user asked
"work on the bug-60? Get a sub-agent to work on it and observe and iterate" — then move the work to the VM3 bot with learnings passed on.

## Keep
- Checker-worker pattern: subagent hunts under the owner's claim (read-only on sheet), owner verifies timestamps/dist-bundle/sensor/CI before landing.
- `GET /api/debug/load?jobId=` as the ground-truth read for "tape missing vs loader missing".
- Local probe of the fixed function against the frozen tape id before claiming a flip.

## Propose standing (add only)
```json
{
  "id": "tape_timestamp_first",
  "rule": "On a frozen-tape miss, compare job epoch vs covering-commit timestamps before any code theory."
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: add frozen-tape hunts in order — (a) deploy/commit timing, (b) store-vs-loader direct read, (c) upstream assembly.
- builder: server-side Node must never use browser relative-fetch helpers; follow the Direct-reader precedent in the same bundle.
- guard: none.

## Do not
- Delete standing rows
- Merge journey packs
- Edit Guard scripts in this file's promote
