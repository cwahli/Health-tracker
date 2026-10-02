---
id: HEALTH-GROUP-3
status: locked
class: FALLBACK_GUIDANCE
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health-group.mjs
  - scripts/lib/commands.mjs
  - scripts/assert-health-group.test.mjs
  - specs/active/HEALTH-GROUP-3.md
frozen_files:
  - scripts/health-runner.mjs
  - scripts/lib/health/docs.mjs
  - bots/registry.json
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-health-group.test.mjs
  - node scripts/assert-command-parity.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-project-registry-parity.mjs
  - npx vitest run tests/bot-host.test.ts
  - npm run test:prepush
  - node scripts/assert-spec-diff.mjs HEALTH-GROUP-3
---

# HEALTH-GROUP-3 — the room's guidance names commands that exist, and the help finally lists them

## Goal

The health room's surviving guidance descends from the pre-item-1 canned
paragraph — "Not a habit and not a new test. Ask again when /health verify says
0 open." — which tells the user to re-ask once the fix list is empty. That
contradicts the lane: the documents refresh as drafts **now**, the analysis
opens when the fix list closes, and the room has two working commands
(`/health triage`, `/health dashboard`) the help line never names. This drop
retires the old wording, gives the guidance the truth, and makes the two
commands discoverable.

## What changes

- **`scripts/lib/health-group.mjs`** — the two surviving refusal texts (missing
  artifact, no fix-list items) drop "then/and ask again" and say what actually
  happens: `/health verify` writes the list, `/health refresh` publishes the
  documents as drafts, and the analysis sections open when the fix list closes.
  The open-gate prompt rule stops telling the model to say the change is made in
  the app and to run `/health verify` after; it now points at `/health triage`
  for the repair steps and `/health dashboard` for the full list, with the same
  drafts-now/analysis-later truth. The safety rules are untouched.
- **`scripts/lib/commands.mjs`** — the `/health` help line gains `triage` and
  `dashboard`, nothing else. It is the only copy of the list (no capability
  registry carries it).
- **`scripts/assert-health-group.test.mjs`** — the new contract: no health-room
  reply carries the retired guidance (`0 open`, `not a habit`, `not a new test`,
  `ask again`); the guidance it does carry names the lane commands; every named
  command is handled by the `/health` case in bot-host and appears in
  `HELP_USAGE.health.text`; the help lists triage and dashboard.

## Findings (the decisions worth not re-deriving)

- **The retired phrases were already gone from live text.** Item 1 deleted the
  canned paragraph that carried them; what survived was the "ask again" habit
  in the two refusals and the model's open-gate rule. The sensor now fails on
  any of the four retired fragments anywhere in the room's reply builders.
- **The busy lines were audited and left alone.** "Still working through the
  seats. Ask again when that answer is in the chat." names no `/health` command
  and never mentions verify or 0 open — it is about the in-flight turn, not lane
  guidance — so no busy text changed.
- **`/health status` and the one-line fallback were already truthful.** Status
  says "drafts while the gate is open" (`docsStatusLines`), and the fallback
  carries no guidance by design (item 1); nothing to replace there.
- **`formatRefreshText`'s "fix the open items in the app" stays for now.** It is
  a reply path in `scripts/health-runner.mjs`, which the stalled open PR #455
  owns (one file, one owner); the fix-steps wording this pass adds points at
  `/health triage` anyway, and the runner's wording is the next owner's to take.

## Evidence (measured on this box, 2026-10-02)

- `node scripts/assert-health-group.test.mjs` → **84 pass, 0 fail** (was 79).
- **Red twice, each restored to 84/0**: the retired "Run /health verify and ask
  again." put back → **1 FAIL** (the retired-guidance check); `triage` and
  `dashboard` removed from the help line → **2 FAIL** (the help-line check and
  the named-commands check, which lists all four).
- Gates: `assert-tax-group` 38/0 (1 skipped host-only), `assert-chat-scope` ok,
  `assert-project-registry-parity` OK (23 aliases), `assert-command-parity` OK
  (27 menu commands, help generated from the one list), `assert-command-scope`
  OK (29 canonical), `vitest run tests/bot-host.test.ts` 162/162, `npm run
  test:prepush` exit 0 (receptionist + bio + food + external-health + bugctl +
  `tsc --noEmit`).
- Not live: no Telegram exchange was run — this is reply wording and help text,
  proven through the builders the host calls.

## Left

- **The rest of the approved mission, in order**: find and fix why the live bots
  never model-answer (vm2's pre-merge tree; vm's silent fallback — the
  `fell back:` log is how it becomes visible); the monthly renewal timer; the
  live re-ask of the transcript's questions.
- **The handover bullet lands separately** (lane convention: feature PR first,
  handover PR after).
- **No live model call has run** — the guidance contract is proven through the
  `runModel`/builder seams.

Next: specs/active/HEALTH-GROUP-3.md#left
