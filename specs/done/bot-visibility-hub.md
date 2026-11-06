---
id: bot-visibility-hub
status: locked
skill: tui-shell
edit_mode: patch
allowed_files:
  - scripts/lib/activity-hub.mjs
  - scripts/lib/activity-hub.test.mjs
  - scripts/lib/session-orphans.mjs
  - scripts/lib/session-orphans.test.mjs
  - scripts/tui-gateway.mjs
  - scripts/bot-host.mjs
  - src/miniapp/app.tsx
  - src/miniapp/shell-session.ts
  - src/miniapp/shell-session.test.ts
  - tests/bot-host.test.ts
  - src/git-version.generated.ts
frozen_files:
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-tui-gateway.test.mjs
  - src/App.tsx
  - src/components/LogChat.tsx
  - scripts/lib/work-session.mjs
  - scripts/lib/worker-presence.mjs
  - scripts/lib/location-state.mjs
gate:
  - npx tsc --noEmit
  - npx vitest run scripts/lib/activity-hub.test.mjs scripts/lib/session-orphans.test.mjs src/miniapp/shell-session.test.ts
  - node scripts/assert-tui-gateway.test.mjs
  - node scripts/journey-guard.mjs bot-visibility-hub
---

# Packet: one visible place for every agent turn + no orphan sessions

Agent fills this. Human replies: go | stop | one comment.

## Journey

Every bot-driven turn already writes a redacted JSONL observer log
(`~/.hermes/work-observers/session-<sha>.log`, via the same fanout for local
and relayed remote turns) and registers live runs in `leases.json`, but no
surface reads either — so each TG chat's session is invisible unless its own
`/tui` pane is opened, and abandoned session ids pile up server-side with no
owner. Better = one hub that joins sessions + leases + observer logs into a
live activity list surfaced where the operator already looks (the terminal
picker), an `/attach` command to land on any session deliberately, and
orphan prevention (stop minting the throwaways) plus a dry-run-first reaper
for the existing pile. Nothing invisible, nothing ownerless.

## Findings (do not redo)

- Observer logs: `observerLogPath` = `sha256(session.id)` (`scripts/lib/work-session.mjs:38`);
  `createObserver` per turn (`:174`); 1 MB cap with `.1` rotation (`:156`);
  records redacted + secret-scrubbed, 0600. Remote worker events fan through
  the identical `fanoutProgressEvent` (`scripts/bot-host.mjs:5024`), written
  at `run_start`/`run_complete`/`failed` (`:6861`, `:6880`) — so the hub
  covers remote hosts free, with no new per-host code.
- Live-run registry: `recordRunStart` writes `leases.json` per chat with
  messageId/startedAt/pid (`scripts/bot-host.mjs:6518`); nothing displays it.
- Session binding: `sessionForWorkspace` requires exact workspace match
  (`scripts/bot-host.mjs:477`); local turns bind back `result.sessionID`
  except pings (`:7198`); remote turns bind back `handed.sessionID` (`:6917`).
  Cline ids go to the separate `cline-sessions.json` map (`:7199`) — never
  mixed into `sessions.json`, or the next turn dies.
- Orphan sources, verified in code: (a) `/new` drops the binding, server
  session kept by design (`:3122`, "untouched"); (b) `/project` switch does
  the same (`sessions.delete`, `:3730`); (c) ping throwaway is a commented-out
  TEMP-TEST awaiting a final decision (`:6704` — pings currently run in-chat,
  polluting the transcript with one bracketed line); (d) stale-session repair
  runs fresh, abandoning the ghost id; (e) every Cline message mints a fresh
  thread, overwriting the map entry. Steady-state local/remote turns do NOT
  orphan (bind-back exists) — fix the exceptions, not the path.
- Picker precedent: `term-session-memory` (specs/active/term-session-memory.md,
  now on main) extended `/api/ttys/status` additively and renders per-row
  memory in `SessionMenu`. Activity badges ride the same door and pattern.
- No standing.json feature applies (operator shell surface; no meal/biomarker/
  sync pull). `allowance_hold_needs_evidence` spirit kept: every Held line
  carries lane + duration evidence. No `specs/rejected/` entry covers this slug.
- Not a ROADMAP ID (explicit user ask 2026-10-14); touches no Current-work
  files. Hub files (`bot-host.mjs`, `tui-gateway.mjs`) need this packet's go
  (no auto-go on later phases per JOURNEY.md).
- Node-7 dry run (2026-10-15, read-only, script `/tmp/opencode/orphan-dryrun.py`):
  487 live sessions, 11 bindings — archive candidates under the rule
  (unbound + 14d+ inactive + bot workspaces): **0**. The 3 known 8-day
  bot-workspace orphans from node 1 have not aged into the 14d rule yet;
  305 sessions active <7d and 117 non-bot-workspace unbound are excluded by
  design. Archive node correctly does nothing; rerun the report (not a new
  packet) when the list is non-empty.
- Attach performance (measured read-only 2026-10-14, `~/.local/share/opencode/opencode.db`
  `session_message`): 906 sessions with messages, 553.9 MB total history;
  median 24 KB, p90 ~1.2 MB, max 36 MB / 1,853 msgs (~9M tokens @4B/tok).
  Heap correlation measured earlier: 145 MB TUI at 2 MB history vs 709 MB at
  6 MB. A run carries its session's history as context, so attach-by-default
  would tax every small TG turn with the shared thread's full weight, plus
  serialize turns (one at a time per session) vs parallel separate sessions.
  Decision (user 2026-10-14): NO always-attach. `/attach` is on-demand only,
  and only to sessions the operator can already see in their normal opencode
  UI (same background service the TUI uses) — never to hidden bot-internal
  ids. Honest caveat: server-side context windowing not verifiable from here;
  token math is directional, heap math is measured.

## Plan

Sensitive transitions as (Condition, Action, Pitfall):

- (Hub joins three stores, any file missing/unreadable, pitfall: hub throws
  and the status endpoint dies — every read best-effort, missing source
  degrades that row to `unknown`, never throws.)
- (Observer filename is a digest, pitfall: hub shows anonymous rows — reverse
  map via `sha256(session.id)` from the sessions store; unmapped digests
  render as `unbound` rows, never dropped silently.)
- (`/attach` rebinds the chat, pitfall: cross-surface id reuse kills the next
  turn — opencode lanes only, workspace-exact match required, Cline ids
  refused with the reason said out loud; rebind only, never starts a turn,
  spends nothing.)
- (Reaper archives server sessions, pitfall: deleting the user's live TUI
  conversation — exclusion first: any id bound in `sessions.json` /
  `cline-sessions.json` / work-session store / live TUI lease is untouchable;
  archive (`time_archived`) only, never delete; dry-run report is a separate
  node that must pass before any archive node runs.)
- (Ping decision, pitfall: re-introducing the Telegram/web-UI incoherence the
  TEMP-TEST fixed — pings keep running where the UI reads; the dedicated
  ping-session alternative is accepted only if the UI coherence proof passes.)

1. Inventory spike (read-only, no code). Count: server-side sessions
   (`session_v2`) vs ids bound in `sessions.json` + `cline-sessions.json` +
   work-session store + live TUI leases → orphan table by source
   (new-drop, project-drop, ghost-repair, cline-thread, ping-era).
   Done when: counts table in the packet, builder has never written code.
2. `scripts/lib/activity-hub.mjs` (new, pure + injected seams). Exports:
   `collectActivity({ sessions, clineSessions, leases, observerMtimes })` →
   rows `{ chat, project, lane, host, state: working|idle|held, elapsedMs,
   lastEvent, sessionId8 }`; `mapObserverFile(digest, sessions)` reverse map.
   Done when: `scripts/lib/activity-hub.test.mjs` green, incl. unmapped
   digest, missing leases file, held-chat (blocked-location) cases.
3. Gateway: `/api/ttys/status` gains additive `activity` array from the hub
   over the allowlisted bot set; same token door; kill path byte-identical.
   Done when: `node scripts/assert-tui-gateway.test.mjs` green UNMODIFIED.
4. Picker badges: `SessionMenu` rows show `● working <lane> <elapsed>` /
   `○ idle <age>` from `activity` keyed by session/bot; pure formatting in
   `src/miniapp/shell-session.ts` (+ tests). Done when: `tsc` + shell vitest
   green and a stub-gateway render shows badges on working rows only.
5. `/attach <session-id>` bot command (on-demand only — there is deliberately
   no always-attach mode): validate the id against the session list of the
   SAME background service the operator's TUI uses (so the target is always
   one the operator can already see in their normal opencode UI); workspace-
   exact match; opencode lanes only; Cline ids refused with the reason said
   out loud. Size guardrail: target over ~500 msgs / ~2 MB history → warn in
   chat with the measured size and suggest `/compact` first (attach proceeds
   only on explicit confirmation). Rebind via `bindSessionForWorkspace` +
   `saveSessions`; no turn started, nothing spent.
   Done when: unknown-id, wrong-workspace, Cline-id, and oversize-warning
   copies proven; happy path lands the next turn on the attached session.
6. Orphan prevention in `scripts/bot-host.mjs` (narrow): ping TEMP-TEST
   resolved finally (in-chat stays unless the coherence proof passes for a
   dedicated per-workspace ping session that is never TUI-attached);
   `/new` + `/project` register the abandoned id into the orphan list
   (`scripts/lib/session-orphans.mjs`, new) instead of dropping silently.
   Done when: orphan-list unit tests green; `/new` chat copy unchanged.
7. Reaper, dry-run first: report node lists archive candidates (unbound +
   inactive N days + never TUI-leased, bot workspaces only) with counts;
   archive node runs only after the report is approved in chat, sets
   `time_archived`, verified-backup first (same backup discipline as the
   2026-10-14 manual archive). Done when: report reconciles with node-1
   counts; archived count + remaining unarchived stated in chat.
8. Guard + COMPLETE: `journey-guard.mjs bot-visibility-hub`, named gates,
   live proof = hub `working` count equals leases running count, picker rows
   equal `tmux ls` count, orphan report before/after.
9. Absorb agent/term-session-memory (#791, same owner, reaped, blocked):
   claim-guard fails #797 on 4 shared files and #791's branch is unmergable
   whole (stale food divergence — untouched). Port ONLY its 5 picker/memory
   files' unique behaviors onto current main: agent labels
   (agentForArgv/deriveSessionAgent, `agent` on tmux/status rows, agent tags),
   bare-hide (filterBareRows + statusOk fail-open), bare memText
   (collectBareSessionMem, exclusive-backend only), pssKb:0 skip-unreadable.
   Product rule where they meet badges: a working/held badge wins the
   stateText over the static agent tag; hidden unmeasured bare rows badge
   nothing (the work still shows on the bot's `tty:` row). Port their tests
   with the code (tmux-session-mem.test additions, shell-session filter/
   apply/agent cases). Close #791 as absorbed with reason, never merged.
   Done when: full gate list green on the merged result + #791 closed.
10. Reverts declarations for the merge gate (no-undo): every cde8865d-owned
    line this PR supersedes (extended, not deleted) recorded as
    `Reverts:` lines in the PR body; rerun CI to green; squash-merge;
    verify on main; delete merged branches/worktrees; packet → specs/done.

## Test plan

```text
npx tsc --noEmit
npx vitest run scripts/lib/activity-hub.test.mjs scripts/lib/session-orphans.test.mjs src/miniapp/shell-session.test.ts
node scripts/assert-tui-gateway.test.mjs
node scripts/journey-guard.mjs bot-visibility-hub
```

## Audit plan

1. Scope vs ROADMAP: not a ROADMAP ID; allowed list only; hub-file edits
   wait for this packet's go. No comments inside the YAML lists (guard list
   parser). No-undo `Reverts:` lines in the PR body if prior owners' lines
   are superseded.
2. Doors unchanged: status readable by any valid token; kill stays
   `webop`-only; `/attach` starts no turn and spends no allowance; observer
   logs stay 0600 + redacted — hub shows headlines/last-events, never full
   content in shared surfaces.
3. Honest residual: Cline stays per-message threads (activity shows the
   turn, not the thread); remote far-machine detail limited to relayed
   events; interactive TUI turns never enter the observer system (presence
   only); `time_archived` sessions keep disk rows (DB file won't shrink
   without VACUUM — RAM is what matters). Node 9 absorbs #791's picker
   half only — its food-file divergence stays on its branch, untouched.

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: kill semantics, `/api/ttys` list shape, lane selection,
allowance ledger, translations, meal/biomarker/sync surfaces, live TUI
attach protocol (lease shape untouched — hub only reads).

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini
requested · Another open PR claims `scripts/bot-host.mjs` or
`scripts/tui-gateway.mjs` (claim-guard — one writer per hub file; note
agent/bot-held-fix #796 touches `bot-host.mjs`: sequence after it merges,
or rebase the builder onto it).
