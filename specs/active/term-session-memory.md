---
id: term-session-memory
status: locked
skill: tui-shell
edit_mode: patch
allowed_files:
  - scripts/tui-gateway.mjs
  - scripts/lib/tmux-session-mem.mjs
  - scripts/lib/tmux-session-mem.test.mjs
  - src/miniapp/app.tsx
  - src/miniapp/shell-session.ts
  - src/miniapp/shell-session.test.ts
  - src/git-version.generated.ts
frozen_files:
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-tui-gateway.test.mjs
  - src/App.tsx
  - src/components/LogChat.tsx
  - scripts/lib/fleet-status.mjs
gate:
  - npx tsc --noEmit
  - npx vitest run scripts/lib/tmux-session-mem.test.mjs src/miniapp/shell-session.test.ts src/miniapp/shell-nav.test.ts src/miniapp/frame-refusal.test.ts
  - node scripts/assert-tui-gateway.test.mjs
---

# Packet: terminal picker shows open state + memory per TUI

Agent fills this. Human replies: go | stop | one comment.

## Journey

The shell's Terminal tab already lists every TUI in a dropdown (`SessionMenu`
in `src/miniapp/app.tsx`, fed by `GET /api/ttys` + `GET /api/ttys/status`),
with a green/grey dot for live/dormant and a Kill button that exists precisely
because "a TUI agent holds ~150-1000MB while its tmux session lives". But the
dropdown shows no numbers, so tracking tmux memory cost today means SSH + `ps`.
Better = each dropdown row names its open state (already there, keep it) and
its current memory footprint, refreshed with the list, so the operator can see
which sessions are worth killing without leaving the terminal app.

## Findings (do not redo)

- Dropdown = `SessionMenu` (`src/miniapp/app.tsx:642`), rows keyed by
  `ttyRowId` (`tty:<bot>` vs `opencode:<sessionId>`). Liveness map comes from
  `loadStatus()` → `GET /api/ttys/status` (`app.tsx:773`). Bare `opencode:`
  rows have no tmux and no Kill; ttyd rows do.
- `GET /api/ttys/status` (`scripts/tui-gateway.mjs`, `/api/ttys/status`
  branch) returns `{ ok, status: [{ bot, live } | { id, bot, live }] }` after
  one `tmux has-session` per served bot. Same door as the list (any valid
  token); kill stays operator-only (`webop`). Do not move either door.
- Measured on the box 2026-10-13: tmux server itself ~7MB; the cost is the
  pane trees (~2GB RSS across 28 panes, mainly 2× `.cline` ~155MB, opencode
  198–411MB). Per-session accounting = sum of RSS over each session's pane
  PIDs plus descendants, via one `tmux list-panes -F` + one `ps`.
- Live-demo finding (headless Chromium against a loopback gateway + built
  shell): ttyd rows NEVER lit — `/api/ttys/status` keys unkeyed rows by bare
  `bot` while picker row ids are `tty:<bot>`. The client folds both keys now
  (`statusKeyMaps`); bare rows still paint only their own id.
- No standing.json feature applies (operator shell; no meal/biomarker/sync
  surface, no new pull/poll). No `specs/rejected/` entry covers this slug.
- ROADMAP flag: Current work item 5 scopes META-1 P1 to two new files and
  says later phases editing `scripts/tui-gateway.mjs` are "not this line".
  This packet edits exactly that file, so it is NOT pre-approved go — it
  waits for the human's go below.

## Plan

Sensitive transitions as (Condition, Action, Pitfall):

- (Status rows gain memory fields, old shell ignores unknown keys, pitfall:
  renaming/removing `{bot,live}` breaks `SessionMenu` + the `assert-tui-gateway`
  status checks — add fields only.)
- (A tty row is dormant, it has no processes, pitfall: reporting `0 MB`
  reads as free — omit the memory field, render no number.)
- (A row is a bare `opencode:` session with no tmux, it has no measurable
  backend here, pitfall: inventing a number — omit the field, keep title/model.)
- (Memory collection runs per status request, `tmux`/`ps` can hang, pitfall:
  the status endpoint never hangs with them — short timeouts, failure falls
  back to today's rows.)

1. `scripts/lib/tmux-session-mem.mjs` (new, pure + one injected seam).
   Exports: `parsePaneLines(text)` → `{session: [pid]}`;
   `parsePsLines(text)` → `{pid: {ppid, rssKb}}`;
   `sumSessionTrees(panesBySession, psByPid)` → `{session: mib}`;
   `collectSessionMem({ sessions, execFile, timeoutMs })` (default execFile =
   node's, always injected in tests) doing at most one `tmux list-panes -a -F`
   + one `ps -eo pid,ppid,rss`. Best-effort: any failure → `{}`.
   Done when: `scripts/lib/tmux-session-mem.test.mjs` green, including
   malformed-line and empty-input cases red-proven against a naive parser.
2. Gateway `/api/ttys/status`: attach `memMiB` (integer) per live tty row
   from `collectSessionMem` over the allowlisted `tmuxNameFor` set; dormant
   rows and bare session rows carry no `memMiB`.
   Done when: `node scripts/assert-tui-gateway.test.mjs` green UNMODIFIED
   (shape stays backward-compatible) + new lib tests cover row-merge logic via
   the helper (no new gateway test file; the assert file is frozen).
3. Shell UI: `SessionMenu` rows render `· N MB` next to the agent/status line
   when `memMiB` is present; the trigger shows the picked session's memory;
   Refresh reloads list + status together as today. `formatMem` and the
   `tty:<bot>` key folding (`statusKeyMaps`) live in the new
   `src/miniapp/shell-session.ts` (pure, tested in
   `src/miniapp/shell-session.test.ts`); `shell-nav.ts` stays untouched.
   Done when: `tsc` + shell vitest green, and a local stub-gateway render
   shows numbers on tty rows and none on bare rows.
4. Guard + COMPLETE: `journey-guard.mjs term-session-memory`, named gates,
   live `GET /api/ttys/status` read on the box showing `memMiB` on live rows.
5. Kill-signal pass (user feedback 2026-10-13): memory moves onto the row's
   main line in full-size text; idle sessions get a red dot (green = active)
   plus idle duration (`idle 2h`), because idle is the kill criterion.
   Server adds `idleMs` per live tty row from `tmux list-sessions`
   `session_activity` (one extra spawn, best-effort, omitted when unknown);
   bare rows derive idle duration client-side from their existing `updatedAt`.
   Dormant/bare-unknown rows stay numberless. Same gates as above plus a
   headless-Chromium dropdown screenshot re-proof.
6. Full tmux inventory (user feedback 2026-10-13: the panel covered 2 of 15
   tmux sessions — both cline TUIs, all colab viewers/sessions and the
   opencode session were invisible). `/api/ttys/status` adds a `tmux` array
   with `{ name, memMiB?, idleMs?, route }` for EVERY live tmux session
   (`route` = served bot when the session is a bot's attach target, else
   null); routeless sessions render as view-less rows with mem + idle + red
   dot, keyed `tmux:<name>`. Bare opencode rows stay memory-less by design
   (DB rows with no backend here; their cost is inside the tmux trees).
   Kill extends to `{ tmux }` targets: operator-only, exact-match validated
   against a fresh `tmux list-sessions` in the same tick, never free-form;
   the `{ bot }` path behaves byte-identically. Same gates; live proof must
   show panel tmux-row count equal to `tmux ls` count.
7. Honest accounting (user audit 2026-10-13, measured with PSS, not RSS):
   RSS double-counts shared pages (the `opencode` 1.6 GB was ~740 MB PSS +
   transients: CLI ~300 + serve ~428 + build/audit children). Session figures
   switch to PSS (`smaps_rollup` per pid, RSS fallback per process, tracked).
   `opencode` is NOT the sum of agents — it is its own tree; cline backends
   are verified inside the `VM-tui`/`VM-tui-vm4` trees, plus a standalone
   cline-hub-daemon covered by the new aggregate row. Bare rows stay
   memory-less by evidence (the single bare session with a live CLI proc is
   the same process already counted in its tmux tree — attributing it would
   double-count; the rest are serve-side). A new `other processes` aggregate
   row (non-tmux PSS + count) makes panel sessions + aggregate reconcile with
   all-process PSS; the remainder to `free` (kernel slab, swapped-out) is
   named, never forced. Rows sort by memory desc, unmeasured last. Proof only
   after `/do-verify` passes: no screenshot shared before approval.
8. Visible-implies-measurable (user audit 2026-10-13: bare rows numberless
   at the bottom). Re-audited thoroughly: serve API exposes tokens/cost but
   no per-session RAM (single heap); exactly one bare session has a live CLI
   proc and it is the VM-tui-vm2 pane root already counted in that tree.
   Rule: a bare row is listed with an EXCLUSIVE-backend annotation and shows
   only then; shared-backend and backend-less rows hide as duplicate/dead
   even before status truth arrives (no numberless flash — a status outage
   degrades the viewer, but the alternative is exactly the wrongly-placed
   numberless rows). The gateway keeps listing/reporting every entry — the
   frozen `assert-tui-gateway` gate requires it — and the hide lives
   client-side (`filterBareRows`, tested). Viewer API + Web tab unaffected;
   rows return automatically if a backend appears. Dormant tty doors stay as
   the sole numberless exception (a door, not an agent — hiding it removes
   the open action). Blind adversarial re-review (requirements-only brief, own
   measurements) must approve before sharing.

## Test plan

```text
npx tsc --noEmit
npx vitest run scripts/lib/tmux-session-mem.test.mjs src/miniapp/shell-session.test.ts src/miniapp/shell-nav.test.ts src/miniapp/frame-refusal.test.ts
node scripts/assert-tui-gateway.test.mjs
node scripts/journey-guard.mjs term-session-memory
```

## Audit plan

1. Scope vs ROADMAP: not a ROADMAP ID (explicit user ask); touches no
   Current-work files beyond the allowed list; `tui-gateway.mjs` edit waits
   for this packet's go per the META-1 P1 scoping line. `src/git-version.
   generated.ts` is allowed as vite build fallout (regenerated by
   `prebuild:web`, never hand-edited); the guard's list parser drops any
   entry after a `#` comment line, so no comments inside the YAML lists.
   Merge-gate declarations (no-undo): the picker rewrite supersedes lines
   from 7b8128cd, 2887f4ed, 10f04477, abfdb634 (SessionMenu/loadStatus/
   killSession/viewer flow preserved + extended, proven by the frozen
   259-gate) and the build stamp from 75728496; recorded as `Reverts:`
   lines in the PR body.
2. Doors unchanged: list/status readable by any valid token, kill stays
   `webop`-only; memory is deployment shape, not session data.
3. Honest residual: RSS overcounts shared libs (sums are upper bounds);
   bare `opencode:` rows report no memory by design — named, not painted.

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: kill semantics, `/api/ttys` list shape, `fleet-status.mjs`
picker entries, fleet/review mini apps, translations (the shell hardcodes
English today — `app.tsx` has no i18n wiring; follow that convention, do not
start a second copy system).

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini
requested · Another open PR claims `scripts/tui-gateway.mjs` (claim-guard —
one writer per hub file).
