---
id: bug-board-parity
status: locked
skill: sync-jobs
edit_mode: patch
allowed_files:
  - serverIssueBacklog.ts
  - src/components/bug-board/useBugBoard.ts
  - src/components/bug-board/BugBoard.tsx
frozen_files:
  - serverBugSnapshot.ts
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - scripts/skills/common/bug-ticket/SKILL.md
  - bots/soul.bug_ticket.md
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
gate: []
---

# Packet: bug board ↔ bot list parity (read-path only)

Human replies: go | stop | one comment.

## Journey

`bugctl list` (`GET /api/bugs/list`, canonical, `serverBugSnapshot.ts:1500`) and the shared board (`GET /api/bug-tracker/overview`, `serverIssueBacklog.ts:544`) read the same D1 `issue_tags` with different projections. After `99196c74` (client fingerprint covers `work_item`, header shows `shown/total · filter`) the board no longer goes stale silently — but the two views can still disagree on Class/State text because overview projects its own subset. This packet aligns the read projections. No write paths, no endpoint removal, no V-30 reopen.

## Findings (do not redo)

- Canonical row = `hydrateWorkItem()` + `bugState()` per tag (`serverBugSnapshot.ts:1513-1548`); Class is a free string, State derived, `blocked` a flag (`src/utils/bugTicketState.ts:147-221`).
- Overview selects `issue_tags ... LIMIT 200` with `normIssueTag` + `hydrateWorkItem` already imported server-side (`serverIssueBacklog.ts:504-609`) but does not run the `bugState()` projection into rows.
- Bot prose lists are LLM-composed from `list` rows; the skill already mandates quoting `generated_at`/`count` (`scripts/skills/common/bug-ticket/SKILL.md:19`) — non-compliant past replies are agent behavior, not code; skills stay frozen here.
- Parent packet `bug-board-miniapp` (locked, Nodes 1–5 done, `99196c74` landed) explicitly deferred this unification.

## Plan (micro-node graph)

### Node 1 — Overview rows carry the canonical projection

- Target: `serverIssueBacklog.ts` only (overview handler + `loadBugTagsWithLinks`).
- Project each tag row through the same `hydrateWorkItem()` + `bugState()` used by `/api/bugs/list`: emit `public_n`, `class`, `state`, `flags`, `queue` per row. No new endpoint, no query-shape change beyond the projection, `LIMIT 200` cap documented in the response/header comment.
- Pitfalls: importing client-only modules (boundary gate); changing write paths (none here); EGRESS_BOMB (projection fields only, no shots/reports).
- Done when: `npx tsc --noEmit` 0; overview row for a fixture tag deep-equals the list row projection on `public_n/class/state/queue/flags`.

### Node 2 — Board header reads the canonical identity

- Target: `useBugBoard.ts` + `BugBoard.tsx` only.
- Header shows overview snapshot identity (`count` + payload key short hash) next to `shown/total · filter`; quiet-poll skip logic unchanged from `99196c74`.
- Pitfalls: changing default filter/sort (forbidden — display only); fetching a second endpoint for rows (rows stay overview-only).
- Done when: two checkouts pointed at the same server show identical header identity; `tests/bug-board-fingerprint.test.ts` still 6/6.

### Node 3 — Live L1–L5 validation (pre-COMPLETE gate, needs D1-backed host)

- Same L-steps as parent packet Node 6 (parity, auto-update, propagation, interaction, egress) plus: bot `list` rows and board rows agree field-for-field on `public_n/class/state/queue` for the same snapshot.
- Requires: `CLOUDFLARE_*` D1 env + gateway URL + headless Chromium with stubbed `Telegram.WebApp.initData`. Cannot run on a box without D1 env — do not fake it.
- Done when: L1–L5 all PASS with evidence bundle; any FAIL repairs its node only.

## Test plan

```text
npx tsc --noEmit
npx vitest run tests/client_import_boundary.test.ts tests/bug-board-fingerprint.test.ts
node scripts/assert-shell-smoke.mjs
node scripts/journey-guard.mjs bug-board-parity
(live, D1 host) Node 3 L1–L5
```

## Blast radius

Allowed / Frozen are the YAML lists above. Out of scope: unifying to one endpoint (deletion), any write/curate/handoff/repro change, `App.tsx` / `LogChat.tsx` / `JobStore.ts`, skill/soul text edits, standing/Guard edits.

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested · No D1 env for Node 3
