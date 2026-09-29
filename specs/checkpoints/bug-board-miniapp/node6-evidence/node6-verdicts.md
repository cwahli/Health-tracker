# Node 6 live validation — verdicts (agent-run, no phone)

Stack (isolated, VPS): app `node dist/server.cjs` from `journey/bug-board-miniapp`
@ `fc29503` + fingerprint repair below, on `127.0.0.1:18081` (production D1,
read + packet-sanctioned test-card lifecycle only); gateway
`scripts/tui-gateway.mjs` on `127.0.0.1:18897` with `BUG_BOARD_UPSTREAM` to the
isolated app and a test `TUI_BOT_TOKEN_VM`; headless Chromium (Playwright +
system Chrome) with HMAC-valid `initData` crafted per
`assert-tui-gateway.test.mjs` `makeInitData`.

## Verdicts

- **L1-parity PASS** — board header `18` == overview `bugTags` `18` ==
  `/api/bugs/list` rows `18`; KPI quartet `{ready 11, stuck 1, open 14, done 4}`
  byte-identical across two independent fresh loads (`l1-board.png`,
  `overview.json`, `list-count.json`). Site-modal equality is structural: the
  modal renders the same `BugBoard` + `useBugBoard` against the same overview
  endpoint (`BugTrackerModal.tsx:1-14`); the modal itself needs a Google
  session and is not drivable headless (honest residual, see below).
- **L2-auto-update PASS** — `POST /api/bugs` test card appeared in the board
  with no reload, inside one 25 s poll interval (`l2-before.png`,
  `l2-after.png`, `tag_mumtthkvc_vpa5ym`).
- **L3-propagation PASS** — `PATCH queue=blocked` moved Stuck KPI `1 -> 2`
  within one interval; `PATCH queue=done` removed the row from the active view
  within one interval (`l3-blocked.png`, `l3-done-gone.png`,
  `l3-patch-resp.json`, `l3-truth.json`).
- **L4-interaction PASS** — status search, status-filter cycle
  (ready/stuck/done/all), card expand, sort toggle; zero `pageerror`
  (`l4-search.png`, `l4-interactions.png`).
- **L5-egress PASS** — 13 overview polls observed, last five all `46733` bytes;
  no `shots` array payload in overview; max `46749` bytes, far under the
  `512 KiB` sanity budget (no packet-recorded numeric budget exists; sizes
  recorded in `poll-log.json`).
- **Cleanup PASS** — test card `DELETE /api/bugs/:id` `200`, absent from list
  and board afterwards. No `NODE6` leftovers in D1.

## Repair made during this run (Node 3 fingerprint blind spot)

First three L3 attempts failed honestly: `PATCH` persisted server-side
(overview showed `queue=blocked` ≤21 s) but the board never re-rendered.
Root cause: `overviewPayloadKey` keyed per-tag rows on
`id:updated_at:status`, but overview rows carry **no `updated_at` field**, so a
PATCH that changes queue/bug text without changing `id`/`status`/counts
produced an identical key and the quiet poller skipped `setData` forever
(proven: board-received overview contained the blocked card while KPI stayed
`1` — see `l3-board-overview.json` vs `verdicts.json` history).
Repair (one writer, `useBugBoard.ts` only — the modal inherits it): fold the
per-tag `work_item` content into the fingerprint key. Rebuilt `dist/` and
re-ran: L1–L5 all PASS, `tsc` 0, boundary 1/1, guard spec-diff clean.

## Residuals (not painted)

- Site-modal KPI equality is by shared-component construction, not by driving
  the modal (needs human Google session).
- L5 budget is a recorded sanity bound; Node 3 recorded no numeric budget.
- `polls 5->5` observed in two early L3 attempts was a harness artifact of
  `waitForFunction` + server-cache timing, not a product defect; final run
  uses node-side KPI polling and all 13 polls flowed.
