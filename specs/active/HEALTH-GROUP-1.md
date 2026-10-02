---
id: HEALTH-GROUP-1
status: locked
class: CANNED_ANSWER_FALLBACK
edit_mode: rewrite
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health-group.mjs
  - scripts/bot-host.mjs
  - scripts/assert-health-group.test.mjs
  - specs/active/HEALTH-GROUP-1.md
frozen_files:
  - scripts/lib/health/docs.mjs
  - scripts/health-runner.mjs
  - scripts/lib/health/context.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/lib/health/doctor.mjs
  - scripts/lib/commands.mjs
  - scripts/lib/project-registry.mjs
  - bots/registry.json
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-health-group.test.mjs
  - node scripts/assert-tax-group.test.mjs
  - node scripts/assert-chat-scope.test.mjs
  - node scripts/assert-project-registry-parity.mjs
  - npx vitest run tests/bot-host.test.ts
  - npm run test:prepush
---

# HEALTH-GROUP-1 — a refused draft is rewritten, not replaced by a canned paragraph

## Goal

The health room's live replies of 2026-10-02 were all fallback text: "how to
clean up the data" got a wall of clipped repairs, and the same question on the
other bot got "No. The record has to be fixed in the app…" or "No health status
yet…" — paragraphs that ignored what was asked. Behind them: **a model answer
the record check refused fell silently into a per-kind canned paragraph**, so
the room stopped answering the question it was asked.

This drop makes the refusal recoverable — **the checker's own reason goes back
to the model once, with the same question and context** — and only a second
failure falls back, to **one short line that names the reason** instead of a
per-kind paragraph. The safety rules are untouched: no invented numbers, no
disease, drug, or test outside the repairs while the gate is open.

## What changes

- **`scripts/lib/health-group.mjs` — the retry and the honest fallback.**
  `answerHealthGroup`:
  - a first refused draft → **one retry**: `healthAnswerPrompt({ …, refusal })`
    pushes the checker's own reason into the prompt ("Your previous draft was
    refused: it named a condition the record does not state — rewrite the same
    answer without it…"), with the same question, context and rules;
  - accepted first draft: one call, unchanged; accepted rewrite: two calls,
    `usedModel: true`, no fallback reason;
  - a second refusal → one short line: `I couldn't put that answer together just
    now — <reason>. Nothing was invented in its place.`;
  - a thrown call (first or retry) → the same line with "the model call failed"
    and `fallbackReason: 'model failed: <message>'`; the message never reaches
    the reply;
  - the return gains `fallbackReason` — the checker's reason (`condition`,
    `number 42`) or the thrown error — empty when the model answered;
  - the per-kind paragraphs are deleted (`seatOpenText`, `councilOpenText`,
    `askKind`, `firstRepair`, `listText`, `gateSentence`); `formatHealthGroupReply`
    is now reason-driven and keeps only the two refusals that already name their
    own cause (no artifact, no fix-list items);
  - a refused number never appears in the text — only in `fallbackReason`,
    because the text must not reprint a value the record does not state.
- **`scripts/bot-host.mjs` — the fallback stops being silent.** The health turn
  logs `fell back: <reason>` whenever `fallbackReason` is set, so "every question
  got a template" is visible on the host instead of invisible.
- **`scripts/assert-health-group.test.mjs` — the contract, not the wording.**
  The old canned strings and the per-kind `formatHealthGroupReply` cases are
  gone; new proofs: a refused first draft is rewritten and accepted (exactly two
  calls, the second prompt carries the same question and the checker's reason),
  a second refusal falls back with `fallbackReason === 'condition'`, an invented
  number surfaces as `'number 42'` and not in the text, a thrown call as
  `'model failed: lane down'`, no model as `'no council model'`, and the host
  logs the reason.

## Findings (the decisions worth not re-deriving)

- **One retry, not a loop.** The retry is for the model's own fixable mistake
  (a named condition, an invented number); a second refusal is evidence, not an
  accident, and the room gets the honest line.
- **A thrown call does not retry.** There is no draft to correct; retrying a
  dead lane is a second failure for nothing. The reason is surfaced for the log.
- **The fallback never repeats the refused value.** `refusalPhrase` drops the
  number a `number NN` refusal names ("a draft used a number the record does not
  state") while `refusalNote` — the retry — names it, because the model must
  know which number to remove. The sensor pins both directions.
- **The old canned paragraphs were pinned by the sensor, which is why they
  survived.** `assert-health-group` asserted `startsWith('No health status yet')`
  and `In the app, do this first: H-1` — checks that locked a canned paragraph in
  place. They are replaced by checks on the *contract* (one line, reason named,
  nothing invented), not on a wording.
- **The red proof found a sensor crash, and the fix is in the sensor.** With the
  retry removed, `retryCalls[1].includes(…)` threw `TypeError` instead of
  reporting FAILs. A sabotage must produce red lines, not an exception; the check
  now reads `retryCalls[1] || ''`.
- **This is step 1 of the approved mission.** Brief asks routing to
  `/health refresh`, the vm2 stale deploy and the vm model-path diagnosis,
  `/health` help/parity for `triage`/`dashboard`, and the monthly renewal timer
  land separately; nothing here touches them.

## Evidence (measured on this box, 2026-10-02)

- `node scripts/assert-health-group.test.mjs` → **64 pass, 0 fail**.
- **Red twice, each restored to 64/0**: the retry removed → **5 FAIL** (the
  retried call, the reason on the retry prompt, the rewritten answer, the
  recovered reply, and the second call's identity); `refusal:` dropped from the
  retry prompt → **1 FAIL** (the reason is actually fed back). The first red also
  caught the sensor crash above.
- Gates: `assert-tax-group` 38/0 (1 skipped host-only), `assert-chat-scope` ok,
  `assert-project-registry-parity` OK (23 aliases), `vitest run
  tests/bot-host.test.ts` 162/162, `npm run test:prepush` exit 0 (receptionist +
  bio + food + external-health + bugctl + `tsc --noEmit`).
- Not yet live: the retry runs through the `runModel` seam; the host that sets
  `GEMINI_API_KEY` gets the real call and the new `fell back:` log line.

## Left

- **The rest of the approved mission**, in order: brief asks run `/health refresh`
  (drafts now, analysis withheld) with the brief-state block; find and fix why
  the live bots never model-answer (vm2's pre-merge tree; vm's silent fallback —
  the new log line is how it becomes visible); `/health` help + parity for
  `triage`/`dashboard`; the monthly renewal timer.
- **The handover bullet lands separately** (lane convention: feature PR first,
  handover PR after).
- **No live model call has run** — this box has no `GEMINI_API_KEY`; the retry is
  proven through the `runModel` seam only.

Next: specs/active/HEALTH-GROUP-1.md#left
