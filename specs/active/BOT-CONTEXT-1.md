---
id: BOT-CONTEXT-1
status: locked
class: SEAT_CONTEXT_BLIND
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health/context.mjs
  - scripts/council-runner.mjs
  - scripts/lib/project-registry.mjs
  - scripts/assert-external-health.test.mjs
  - AI_HANDOVER.md
frozen_files:
  - scripts/health-runner.mjs
  - scripts/lib/health/docs.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/lib/health/reconcile.mjs
  - projects/external-health/soul.md
  - projects/external-health/roles/health_analyst.md
  - projects/external-health/roles/safety_reviewer.md
  - .github/workflows/ci.yml
  - src/App.tsx
  - server.ts
gate:
  - node scripts/assert-external-health.test.mjs
  - node scripts/assert-auto-merge.test.mjs
  - node scripts/assert-main-verify.test.mjs
  - npx tsc --noEmit
---

# BOT-CONTEXT-1 — a seat must see the data, not just the brief

## Goal

The council's seat context (`readWorkspaceContext`) was written for the case/
layout — root `*.md` plus `case/` and `working/`. The Personal Health Coach's
workspace is a *data* workspace: its verified facts live in `result/` and
`sources/`. Measured against the real folder, the reader returned **one file,
`BRIEF.md` (1906 bytes)**, and `executeRoleTurn` then sliced every file to its
first 1000 characters. A seat turn therefore reasoned from the brief and none of
the verified numbers: not the verify artifact, not the fix list, not the four
published documents, not the banked sheet. Five seats that cannot see the data
are five opinions about a brief.

This drop gives the project a context provider, wires it through the registry,
and pins it with sensors. It is Drop 1a of the approved plan; 1b (stage
resolution, `output/` vs `result/`, the external-2 deliverable trio) and 1c (the
`/health readiness` self-check) are deliberately not in this diff — see **Left**.

## What changes

- **`scripts/lib/health/context.mjs` (new).** `buildHealthContext(workspace)`
  returns `{ ok, workspace, at, refuses, sections, absent, bytes }` and
  `renderContextBlock(context)` renders the prompt block. Sections: the brief,
  the verify artifact (gate first, then fix-list items, profile, sheet/app
  dates and coverage), the fix list verbatim, the analysis payload under review
  with its `validateAnalysisSections` verdict, the document registry, the last
  refresh receipt, and a sources inventory (names, sizes, mtimes — never bodies).
- **Byte budgets, marked inline.** Each section has its own budget
  (`CONTEXT_BUDGET`) and cuts on a **character boundary that fits the byte
  budget**, printing `… [truncated: N bytes withheld]` in the text and reporting
  `truncatedBytes` on the section. The old blind 1000-character slice cut the
  fix list mid-item and said nothing.
- **Every candidate is accounted for.** `CONTEXT_CANDIDATES` is the closed list;
  each key ends up either as a section or as an `absent` entry with a reason
  ("not present — the analysis pass has not written a payload, so every analysis
  section is unproven"). `renderContextBlock` prints them under
  `not present — a finding, not a hole to fill` (soul law 4).
- **A missing brief refuses; a missing artifact does not.** No such folder, or no
  brief/charter in it → `ok:false` with reasons and an empty rendered block. The
  caller refuses the turn rather than send nothing: a seat reasoning from an
  empty context produces exactly the confident claims this project exists to
  prevent. Absent artifacts are findings the seat reports, so they never refuse.
- **Registry + delegation.** `external-health` declares
  `contextProvider: 'health'`. `readWorkspaceContext(workspace, { projectId })`
  resolves the provider (explicit id, or reverse lookup by workspace) and returns
  `{ ok, provider, refuses, context, text }`; `runFullCouncil` /
  `runCouncilStage` use one `seatContextText()` helper that throws the refusal.
  Projects without a provider keep the legacy reader **byte for byte** — same
  file map, same `### File:` rendering, same 1000-character slice.

## Evidence (measured on this box, 2026-10-01)

Against the real workspace `~/projects/external-health-coach`:

| | before | after |
|---|---|---|
| files a seat saw | 1 (`BRIEF.md`) | 6 sections + 1 declared absence |
| bytes into the prompt | 1000 (sliced) | 10136 (nothing truncated) |

Sections: brief 1925 B · verify 2252 B · fix list 3810 B · docs registry 635 B ·
refresh receipt 781 B · sources inventory 733 B; absent:
`result/health-analysis.json`. Council delegation reports `provider: health`,
`ok: true`, 11018 rendered bytes.

`scripts/assert-external-health.test.mjs`: **223 → 266 checks**, 0 fail. The
end-to-end checks read the pack from the workspace a real `runHealthVerify` just
wrote, so the reader and the writer are pinned to the same paths; a hand-written
artifact (no `summary` block) is reported as carrying no coverage numbers rather
than as zeros.

Red proofs (each sabotage restored afterwards; the check names that fired):

1. drop a section (`fix_list` key renamed) → *every candidate is a section or an
   absence, exactly once* + 3 more;
2. drop an absence (`docs` miss suppressed) → *no candidate is dropped*, *every
   artifact that is missing is named*;
3. change the legacy slice (`1000` → `900`) → *the legacy text still slices at
   1000 characters*;
4. drop the truncation marker → *the truncation marker names the withheld
   bytes*, *the over-budget section says so inline*.

Gates: `assert-external-health` 266/0 · `assert-auto-merge` 89/0 ·
`assert-main-verify` 17/0 · `assert-no-undo` 23/0 · `tsc --noEmit` 0 ·
`npm run test:prepush` exit 0.

## Left

- **1b — stage wiring.** `runCouncilStage` still maps only external-1's
  `audit`/`defense`/`finalize` and writes to `output/` while `getCouncilStatus`
  reads `result/`; `runFullCouncil` / `getCouncilStatus` still report the
  external-2 `A_/B_/C_` deliverables for any project. Until 1b lands, `/council`
  on `external-health` is still wrong at the tail.
- **1c — `/health readiness`.** The self-check (workspace, gate, artifact age,
  model credential, context bytes, repo-vs-workspace role drift) that answers
  "is it ready for bots?" inside the product.
- **No live seat turn has run.** `GEMINI_API_KEY` is absent from
  `~/.config/bot-host/common.env`, so the context is proven by the sensor and by
  the real-workspace measurement, not by a model call. The credential is the
  user's to add (`HEALTH_ENV_FILE` / `HEALTH_DOCS_FOLDER` are missing there too).
- **Drop 2 — the seats.** The Doctor seat + its report validator, the
  `research_lead` search lane, and the publisher's staleness rule.
- **The eight data-gate items (H-1…H-8) stay the user's to fix in the app**, and
  the pack reports them as the gate does — no bypass.
