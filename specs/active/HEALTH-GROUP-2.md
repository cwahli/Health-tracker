---
id: HEALTH-GROUP-2
status: locked
class: BRIEF_ASK_ROUTING
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health-group.mjs
  - scripts/health-runner.mjs
  - scripts/bot-host.mjs
  - scripts/assert-health-group.test.mjs
  - specs/active/HEALTH-GROUP-2.md
frozen_files:
  - scripts/lib/health/docs.mjs
  - scripts/lib/health/context.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/lib/commands.mjs
  - bots/registry.json
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-health-group.test.mjs
  - node scripts/assert-tax-group.test.mjs
  - node scripts/assert-chat-scope.test.mjs
  - node scripts/assert-project-registry-parity.mjs
  - npx vitest run tests/bot-host.test.ts
  - npm run test:prepush
  - node scripts/assert-spec-diff.mjs HEALTH-GROUP-2
---

# HEALTH-GROUP-2 — a brief ask runs the publisher, and the brief's state rides along

## Goal

The live ask — "Can you work on the brief?" — got a refusal instead of work:
an explicit ask to work the brief was classified as a normal council question,
the room answered in words, and nothing ran `/health refresh`, so the four
documents never updated. The feedback, verbatim: the bot must really work the
brief above all.

This drop makes a brief ask do brief work: `classifyHealthGroupTurn` gains its
own kind (`mode: 'brief'`), the bot-host health turn runs the existing
`runHealthRefresh({ projectId, botId })` under the same busy guard
`/health refresh` uses, and the room gets `formatRefreshText`'s reply — drafts
publish, the analysis stays withheld, the four Docs update in place. No refusal
line. A question *about* the brief also gets a brief-state block in the model
context (last refresh, the four documents, what is withheld — facts only).

## What changes

- **`scripts/lib/health-group.mjs` — the kind and the facts.** `isBriefAsk`
  (work on / update / refresh / renew / redo / bring + brief / docs / documents,
  with "update me on…" excluded) classifies a broadcast health-room ask as
  `{ mode: 'brief', roleId: null }`. `readBriefState(workspace)` reads
  `result/health-refresh.json` and `result/health-docs.json`; `healthAnswerPrompt`
  gains a `brief` block — last refresh time/mode/counts, each of the four
  documents with its last write and open count, the withheld section headings,
  and why — passed to the first and the retry prompt. Facts only, no prose.
- **`scripts/health-runner.mjs` — the turn's reply.** `answerBriefAsk({ projectId,
  botId, refresh })` runs the publisher (injectable for the sensor) and returns
  the real `formatRefreshText` as `{ answered, usedModel: false, text,
  markdown: true }`; a refused run keeps its own stage and error
  (`brief refused: <stage>` / `brief failed: <message>`) and says nothing was
  invented.
- **`scripts/bot-host.mjs` — the wiring.** The health turn gains the brief
  branch under the same busy guard: a progress line, the publisher, then the
  reply as markdown; the existing `fell back:` log covers brief failures.
- **`scripts/assert-health-group.test.mjs` — the contract.** New checks:
  classification (brief / council / tax room), the executable brief turn
  (the publisher is called exactly once, the reply equals `formatRefreshText`,
  a refused run keeps its stage and never the fallback line), the brief-state
  facts reaching the prompt, and the host's guard placement.

## Findings (the decisions worth not re-deriving)

- **Only the health room's broadcast ask is a brief turn.** A named seat still
  answers as a seat (pinned by the existing sensor), a tax room is untouched,
  and another project is not stolen. A question that merely mentions the
  documents ("what do the documents say…") stays a council ask.
- **No refusal line for brief work.** The publisher's own reply is the answer;
  when refresh cannot run (folder, credential, verify) the room gets the stage
  and the reason — never the canned fallback.
- **The brief-state block is facts, not a summary.** The model still may not
  invent a number; the block quotes the workspace, and the number checker is
  unchanged.
- **`answerBriefAsk` exists for the executable proof.** The sensor cannot drive
  the live host message path, so the turn's logic lives where the host and the
  sensor call the same function.

## Evidence (measured on this box, 2026-10-02)

- `node scripts/assert-health-group.test.mjs` → **79 pass, 0 fail** (was 64).
- **Red three ways, each restored to 79/0**: the brief classification removed →
  **3 FAIL** (the three brief-ask checks); the brief block dropped from the
  prompt calls → **3 FAIL** (last refresh, the four documents, a withheld
  section); `answerBriefAsk` made to answer with a canned line instead of
  running the publisher → **3 FAIL** (the run count, the real refresh text, and
  the refusal path the canned line swallowed).
- Gates: `assert-tax-group` 38/0 (1 skipped host-only), `assert-chat-scope` ok,
  `assert-project-registry-parity` OK (23 aliases), `vitest run
  tests/bot-host.test.ts` 162/162, `npm run test:prepush` exit 0 (receptionist +
  bio + food + external-health + bugctl + `tsc --noEmit`).
- Not live: no `GEMINI_API_KEY` on this box — the turn runs through the injected
  `refresh`, and the real publisher path is the same `/health refresh` run
  `assert-external-health` already drives end to end.

## Left

- **The rest of the approved mission, in order**: find and fix why the live bots
  never model-answer (vm2's pre-merge tree; vm's silent fallback — the
  `fell back:` log is how it becomes visible); `/health` help + parity for
  `triage`/`dashboard`; the monthly renewal timer; the live re-ask of the
  transcript's questions.
- **The handover bullet lands separately** (lane convention: feature PR first,
  handover PR after).
- **No live model call has run** — the brief-state block is proven through the
  `runModel` seam; the host that sets a key gets it for real.

Next: specs/active/HEALTH-GROUP-2.md#left
