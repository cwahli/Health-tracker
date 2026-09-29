---
id: bug-board-miniapp
status: draft
skill: sync-jobs
edit_mode: patch
allowed_files:
  - src/components/bug-board/BugBoard.tsx
  - src/components/bug-board/useBugBoard.ts
  - src/components/BugTrackerModal.tsx
  - src/miniapp/bugs.tsx
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

## Plan

1. **Extract `useBugBoard.ts`** from `BugTrackerModal.tsx` (fetch overview, KPI derive, filter/sort/search, select+detail fetch). Verbatim move, no behavior change. Done when: modal renders identically, `tsc` 0.
2. **Extract `BugBoard.tsx`** (KPI strip, filters, accordion list, expanded detail) as props-in/callbacks-out; modal becomes a thin portal wrapper. Done when: modal pixel-identical, existing bug-modal interactions green.
3. **Add polling to the hook**: refetch overview when `generated_at` moves, interval ~20–30s, only while page visible (`document.visibilityState`), manual Refresh kept, header shows `generated_at` + `count`. Payload stays light (no `with_shots`, no reports) per EGRESS_BOMB. Done when: site modal auto-updates on a second client filing a card; no full-table download introduced. (Bonus: this fixes today's "looks disconnected" on the site too.)
4. **Mini-app entry `src/miniapp/bugs.tsx`**: renders `BugBoard` full-page, Telegram `initData` auth adapter (no Google/Firebase), `table_template.py`-adjacent dark styling to match. Done when: page renders board standalone, client import boundary test green.
5. **Gateway + `/bugs` command**: serve the mini-app bundle on the existing gateway host (same TLS + initData door as TUI, new path); bug_ticket bot `/bugs` replies with a `web_app` button (`?bot=bug_ticket`), mirroring `/tui` (`bot-host.mjs:2516-2524`). Done when: tapping the button from the bug_ticket bot opens the live board; stale-button warning behavior matches `/tui`.
6. **Live confirm (budget 3, once)**: open via real TG button, file a card from the site, watch it appear in the mini app within one poll interval; screenshot receipt. Done when: receipt posted, no other live runs.

## Test plan

```text
npx tsc --noEmit
npx vitest run tests/client_import_boundary.test.ts
node scripts/assert-shell-smoke.mjs
node scripts/journey-guard.mjs bug-board-miniapp
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
