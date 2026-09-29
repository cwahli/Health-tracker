---
id: bug-board-miniapp
status: locked
skill: sync-jobs
edit_mode: patch
allowed_files:
  - src/components/bug-board/BugBoard.tsx
  - src/components/bug-board/useBugBoard.ts
  - src/components/BugTrackerModal.tsx
  - src/miniapp/bugs.tsx
  - bugs.html
  - vite.config.ts
  - scripts/bot-host.mjs
  - scripts/tui-gateway.mjs
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - serverBugSnapshot.ts
  - serverIssueBacklog.ts
  - qa-evidence/table_template.py
  - qa-evidence/build-table.py
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
gate: []
---

# Packet: shared bug board + Telegram mini app (read-only v1)

Human replies: go | stop | one comment.

## Journey

One bug board codebase rendered in two places — the Health Tracker site modal and a Telegram WebApp opened from the bug_ticket bot — showing identical KPIs (Ready Now / Stuck / Bug Open / Done), filters, and rows from the same endpoint, auto-refreshing in both. No table redesign; the current accordion board UI is reused verbatim. "Better" means the TG view can never drift from the site because there is only one component and one data hook.

## Findings (do not redo)

- Board logic lives only in `src/components/BugTrackerModal.tsx`: accordion cards (no `<table>` anywhere), KPI strip, filters/sort/search, data via `GET /api/bug-tracker/overview` on open + manual Refresh + reload-after-mutation. No polling, no SSE, no pagination (`sortedQueueTags` renders all).
- Canonical agent read is `GET /api/bugs/list` (`serverBugSnapshot.ts:1500`, via `bugctl list --json`); same D1 `issue_tags` source as overview, different projection. v1 reuses the **overview** path verbatim so the site view is byte-identical by construction; unifying on one endpoint is a later packet, not this one.
- TG open precedent: `/tui` sends a `web_app` inline button (`scripts/bot-host.mjs:2522`); `scripts/tui-gateway.mjs` gates pages on Telegram `initData` (HMAC `WebAppData`), own hostname via Caddy. An iframe of the live site is rejected: Google OAuth refuses embedded WebViews and the TG WebView holds no Firebase session.
- No `specs/rejected/` entries cover bug board / mini app / WebApp — no pruned hypotheses.
- Standing rows are journey-scoped (food_log/compare); applicable process law is AGENTS.md L1 (blast radius), L8 (extract, don't rewrite god files), L10/L11 (tsc + named gates), client import boundary (`tests/client_import_boundary.test.ts`), EGRESS_BOMB (light polling only).

## Plan (full execution plan — micro-node graph)

Conventions: each node lists target files, pitfalls, and its own done-gate. Builder executes in order, one node at a time. Any node gate red → repair that node only; two failed repairs → STOP, SHEPHERD revert, Reviewer.

### Node 1 — Extract `useBugBoard.ts` (data hook, verbatim move)

- Target: new `src/components/bug-board/useBugBoard.ts`; touch `src/components/BugTrackerModal.tsx` only to import it.
- Move as-is: overview fetch, `bugTags/allReports/deletionCandidates` state, KPI derive, filter/sort/search, select + `fetchTagDetail`, Refresh. No polling yet, no endpoint change.
- Pitfalls: dropping the `migrate-inbox` fire-and-forget on open (`BugTrackerModal.tsx:606`); dropping `saveBugTrackerCache`/localStorage seed; changing default filter/sort.
- Done when: `npx tsc --noEmit` 0; modal behavior identical by inspection; `npx vitest run tests/client_import_boundary.test.ts` green.

### Node 2 — Extract `BugBoard.tsx` (presentational, verbatim move)

- Target: new `src/components/bug-board/BugBoard.tsx`; `BugTrackerModal.tsx` becomes portal chrome + lightbox + mutation-button wiring around it.
- Props-in/callbacks-out only; no fetching inside; accordion UI unchanged (no table redesign — human-rejected).
- Pitfalls (Condition, Action, Pitfall): (per-card action tapped, board must call the modal's existing handler, never reimplement the mutation); (expanded detail open, lazy `fetchTagDetail` must still fire once per select, not on every render).
- Done when: modal pixel-identical; `node scripts/assert-shell-smoke.mjs` green; `tsc` 0.

### Node 3 — Polling in the hook (both surfaces inherit it)

- Target: `src/components/bug-board/useBugBoard.ts` only.
- Poll `GET /api/bug-tracker/overview`, interval 20–30s, page-visible only (`document.visibilityState`), skip when tab hidden; re-render only if `generated_at` moved; keep manual Refresh; header shows `generated_at` + `count`.
- Pitfalls: polling with `with_shots`/reports (EGRESS_BOMB — keep the light overview shape); `setInterval` leak on unmount; polling while a mutation is in flight (debounce 5s after any write).
- Done when: two browsers open — file/link a card in one, it appears in the other within one interval; network tab shows only light overview payloads.

### Node 4 — Mini-app entry (Telegram auth adapter, no board logic)

- Target: new `src/miniapp/bugs.tsx` (+ build wiring next to the existing `miniapp/dist` pattern per `Tui_proposal2b.md:129`).
- Renders `BugBoard` full-page; auth via Telegram `initData` only (no Firebase/Google code in this entry); dark styling to match board.
- Pitfalls: importing anything server-only (client boundary test is the gate); importing `App.tsx`/shell (frozen — must stay out); Google-auth components leaking into the mini bundle.
- Done when: `tsc` 0; boundary test green; page renders board standalone against dev gateway.

### Node 5 — Gateway route + `/bugs` command

- Target: `scripts/tui-gateway.mjs` (new path reusing the initData gate, same host/TLS/Caddy as TUI) and `scripts/bot-host.mjs` (`/bugs` case mirroring `/tui` at `bot-host.mjs:2516-2524`, including the stale-tunnel warning behavior).
- Serving bot is `vm` (master, holds `TUI_BOT_TOKEN_VM` so the exchange validates with zero new secrets). `bug_ticket` is a hermes bot with no bot-host command surface, so it cannot serve the button; it stays in the scope list for correctness. Other bot-host bots get a pointer to vm.
- Pitfalls: new route bypassing initData validation (never anonymous — same HMAC check); button URL missing `?bot=bug_ticket`; `/bugs` answering on non-bug_ticket bots (scope the command or say which bot serves it).
- Done when: tapping the button from the vm bot chat opens the live board; killing/regenerating the tunnel reproduces the stale-button warning, not a silent dead button.
- Build wiring (human-approved 2026-09-29): `vite.config.ts` gains a `rollupOptions.input` entry for `bugs.html` so `vite build` emits it into dist; the gateway proxies the built page from the app upstream. Done when: `vite build` emits `bugs.html` + its assets and the gateway `/bugs/app` serves them (Node 6 L-steps). No other build config changes.

### Node 6 — Agent-run live validation (pre-COMPLETE gate, no phone needed)

Executed by an agent (not the Builder), after Nodes 1–5 gates are green. Uses the gateway URL in a headless browser + server API — no human phone tap required:

1. **Setup**: record gateway base URL, `generated_at`/`count` from `GET /api/bugs/list`, screenshot mini-app board (headless Chromium with stubbed `Telegram.WebApp.initData` per `assert-tui-gateway.test.mjs:316` pattern).
2. **L1 — Parity**: board header `count`/`generated_at` equals API response; KPI values (Ready/Stuck/Open) equal the site modal's values for the same snapshot. Evidence: screenshot + API dump. Fail if any KPI differs.
3. **L2 — Auto-update**: POST a new card via `POST /api/bugs` (test card, delete after), wait one poll interval + margin; assert it appears in the mini-app board without reload, header `generated_at` advanced. Evidence: before/after screenshots. Fail if not visible within 90s.
4. **L3 — Update propagation**: PATCH the test card (state/queue change), assert the board row updates within one interval. Then delete the test card, assert the row disappears. Fail on any stale row.
5. **L4 — Interaction**: filter by status, text search, expand one card (detail fetch fires once), sort toggle — all client-side, no console errors (`pageerror` listener, per basic-bugs table). Fail on any page error.
6. **L5 — Egress**: record total bytes of 5 consecutive polls; fail if any poll carries shots/reports payloads or exceeds the light-overview budget recorded in Node 3.
7. **Cleanup**: test card deleted, evidence bundle (screenshots + API dumps + poll log) attached to the packet checkpoint. Verdict posted as PASS/FAIL per L-step, not a single "looks good".

COMPLETE requires L1–L5 all PASS. Any FAIL → repair the indicated node, re-run that L-step only (never "re-run until green" across unrelated steps).

## Test plan

```text
npx tsc --noEmit
npx vitest run tests/client_import_boundary.test.ts
node scripts/assert-shell-smoke.mjs
node scripts/journey-guard.mjs bug-board-miniapp
(live) Node 6 L1–L5 agent-run validation above — pre-COMPLETE gate
```

## Audit plan

1. Scope vs ROADMAP (this packet only; endpoint unification and write-actions are separate packets, not silent extras).
2. One-writer check: no second board formatter; modal and mini app import the same `BugBoard`/`useBugBoard`.
3. Honest residual named, not painted (e.g. mini-app mutation buttons stay absent in v1; overview `LIMIT 200` cap documented in header if hit).

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: table-layout redesign (explicitly rejected by human); unifying overview vs canonical list endpoints; any write action (curate/handoff/repro) — needs a proxied-token packet; `App.tsx` / `LogChat.tsx` / `JobStore.ts` untouched; no server-route changes (v1 is read-only reuse).

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
