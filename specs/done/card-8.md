---
id: BUGCTL-PACKET-TEXT
status: locked
class: TOOLING
skill: specify
edit_mode: patch
allowed_files:
  - scripts/bugctl.mjs
  - tests/bugctl-queue.test.ts
frozen_files:
  - AGENTS.md
  - docs/agent
  - plan/ROADMAP.md
  - serverBugSnapshot.ts
gate:
  - node scripts/assert-bug-dispatch.mjs
  - npx vitest run tests/bugctl-queue.test.ts
---

# card-8 — bugctl packet --format text must print the text packet

## Goal
Make `node scripts/bugctl.mjs packet --id <n> --format text` print the server's
text/plain packet body and exit 0. Change only `scripts/bugctl.mjs` (and add one
regression case to `tests/bugctl-queue.test.ts`).

## Understanding (what this bug is NOT) — anti-patch field
- Mechanism: bugctl's `api()` helper always `JSON.parse`s the response; the server
  deliberately answers `format=text` with `Content-Type: text/plain`, so the parse
  fails into `{ error: "HTTP 200" }` and that stub is what the `packet` case prints.
- Not this: the server route is correct (`res.type('text/plain').send(...)`) — do
  not change server code and do not make the server return JSON for `format=text`.
- Not this: do not remove `--format text`, do not change the default JSON packet
  path, and do not let this read enter the offline write queue.

## Layer (pick ONE; siblings are frozen) — anti-patch field
- Layer: CLI client (`scripts/bugctl.mjs` only).
- Frozen: server routes and every other file.

## Forbidden patch (named) — anti-patch field
- No server change (`serverBugSnapshot.ts` is frozen).
- No JSON-wrapping of the text body (callers want the raw text).
- No removal of the packet read contract (reads never queue; writes still do).

## Two-sided fixture (prove structure, not symptom)
- Broken input → correct output: `packet --id 8 --format text` prints a body whose
  first line starts `# Bug 8`, exit 0.
- Adjacent input → unchanged: `packet --id 8 --json` still prints the JSON packet
  object (same shape as before).

## In scope
- `scripts/bugctl.mjs` `api()`/`packet` handling of non-JSON (text/plain) responses.
- One added regression test in `tests/bugctl-queue.test.ts`.

## Out of scope
- Everything else in the repository.

## Done when
1. `node scripts/bugctl.mjs packet --id 8 --format text` exits 0 and its first line
   starts with `# Bug 8` (never `{"error":"HTTP 200"}`).
2. `npx vitest run tests/bugctl-queue.test.ts` passes (including the new case).
3. `node scripts/assert-bug-dispatch.mjs` exits 0.
