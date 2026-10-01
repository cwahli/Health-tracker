---
id: BOT-CONTEXT-1
status: locked
class: SEAT_CONTEXT_BLIND
# The Drop 1a half (context.mjs, the delegation) is a patch; the 1b extension
# restructures council-runner's stage handling (37% of that file's lines), which
# is a rewrite and is declared as one rather than hidden under `patch`.
edit_mode: rewrite
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health/context.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/council-runner.mjs
  - scripts/lib/project-registry.mjs
  - scripts/lib/commands.mjs
  - scripts/lib/agent-gemini.mjs
  - scripts/bot-host.mjs
  - scripts/health-runner.mjs
  - scripts/assert-external-health.test.mjs
  - AI_HANDOVER.md
frozen_files:
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
  - node scripts/assert-external-projects.test.mjs
  - node scripts/assert-council-no-invented-case.test.mjs
  - node scripts/assert-command-scope.mjs
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

## Extension (2026-10-01) — 1b stage wiring and 1c readiness, the rest of Drop 1

**1b. A stage is the project's own seat.** `resolveCouncilStage(stage, projectId)`
resolves a token against the project's declared phases: its id (`data_steward`),
a role alias (`steward`, through the same table `/role` uses), a 1-based number
(`2`), or `all`/`run`/empty for every seat. A token that resolves to nothing is a
**refusal naming the real stages** — the old fallback ran the entire council for
an unknown token, which is the one thing a stage command must never do silently.

**The case pipeline stays declared, not inferred.** `LEGACY_CHECKPOINTS` holds
the three checkpoint phase sets and their exact messages, `LEGACY_DELIVERABLES`
the `A_/B_/C_` trio, and the registry says which projects use them
(`councilPipeline: 'case'` on external-1/external-2). Those projects answer
byte-for-byte as before: same phases, same `nextStepMsg`, same deliverables, same
`deliverablesReady`, and — because `resultDir()` still falls back to `output/`
when no `result/` exists — the same directory.

**One agreed directory.** `runCouncilStage` no longer hardcodes `output/` while
`getCouncilStatus` reads `resultDir()`; both go through `resultDir()`. Where
`result/` exists (external-health) a stage now writes into it and reads back as
completed; where it does not (both case projects) nothing moves.

**Deliverables belong to the project.** `runFullCouncil` and `getCouncilStatus`
report the project's own phase files for a roles project, and the trio only for a
case project. `/council <stage>` on bot-host routes any token to the resolver
(the handler used to accept exactly the three case checkpoints), and the status
reply prints the project's own numbered stages, keeping the checkpoint list for
case projects. `executeRoleTurn` gained one seam — `runGemini` can be injected —
so a stage runs end to end in a sensor with a fixture model.

**1c. `/health readiness`** (`lib/health/readiness.mjs`, wired to bot-host and to
`health-runner --readiness`). Each answer is `ok`, `finding`, or `blocker`:

- `ok` carries the number that makes it verifiable (context sections and bytes,
  five seats loaded, four documents published, the artifact's age in days);
- `finding` is a real gap that is not the machine's fault — an open gate (with
  every item id), no analysis payload, a stale verify artifact, and the host env
  this box is missing (`HEALTH_DOCS_FOLDER`, `HEALTH_ENV_FILE`, each with the
  exact line to add to `~/.config/bot-host/common.env`);
- `blocker` means a seat cannot run: no workspace/brief, no model credential.
  `ready:false` and **exit 3** — the same "refused on purpose" code `--analyze`
  uses, so a caller can tell "not ready" from "crashed".

`agent-gemini.mjs` gained `geminiKeyIn(env)`: the credential chain read from one
env map with **no** `process.env` fallback, because "does this host have a key?"
is the opposite question from `resolveGeminiKey`'s (and an explicit empty env must
read as empty). No secret value is ever printed — names and the file to fix only.

### Evidence

- `assert-external-health`: **266 → 321 checks, 0 fail**. New checks run a real
  stage against a workspace with a fixture model and assert the file lands where
  the status reader looks, that the prompt carried the live gate, the fix list
  and the not-present finding, that external-health's deliverables are its own
  five seats, and that the case project still reports its trio at `ready: true`.
- Proven red four ways, each restored: an unknown stage silently running every
  phase (2 checks fire); a stage writing to `output/` again (4); the status
  reporting the external-2 trio for every project (3); readiness passing with no
  model credential (6, including the CLI's exit code).
- Legacy gates unchanged and green: `assert-external-projects` 55/0,
  `assert-council-no-invented-case` 21/0, registry parity OK (17 shared aliases),
  command scope OK (28 canonical), `assert-auto-merge` 89/0,
  `assert-main-verify` 17/0, `tsc` 0, `npm run test:prepush` exit 0.
- **Live:** `/health readiness` on the real workspace → `exit 3`, one blocker
  (`GEMINI_API_KEY`), four findings (the open gate with all eight ids, no analysis
  payload, both host env vars), and the verified facts (6 sources / 10136 bytes,
  brief present, 0-day-old verify, four documents published, five seats).
- **Live:** a real `runCouncilStage('safety_reviewer', 'external-health')` against
  a copy of the real workspace (nothing written into the user's folder) resolved
  by id, wrote `result/04_safety_reviewer.md`, named the next stage, and the
  15096-byte prompt carried the live gate, the fix list and the not-present
  finding. `/council status` live: external-health → roles, 5 phases, 5 own
  deliverables; external-1 → case, 6 phases, 3 deliverables, `ready: true`;
  external-2 → case, 6, 3, `false`.

## Left

- **2 — the seats (next).** The Doctor seat and its report validator, the
  `research_lead` search lane with fetch-verified citations, and the publisher's
  staleness rule.
- **No live seat turn has run.** `GEMINI_API_KEY` is absent from
  `~/.config/bot-host/common.env`, so the context is proven by the sensor and by
  the real-workspace measurement, not by a model call. The credential is the
  user's to add (`HEALTH_ENV_FILE` / `HEALTH_DOCS_FOLDER` are missing there too).
- **The eight data-gate items (H-1…H-8) stay the user's to fix in the app**, and
  the pack and the readiness check report them as the gate does — no bypass.
