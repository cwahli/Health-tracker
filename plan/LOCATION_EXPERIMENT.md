# Location experiment — findings (2026-09-25)

How a Telegram session moves between the VM, mobile, collab and grok: what the
three candidate approaches cost, what was measured, and what is left.

Branch: `agent/session-key` (7187fd2 + 7b30f63, base `fde8f75` = old
`agent/r14-proof`). Experiment harness: `exp-switch.mjs` (sandboxed, **0 model
calls, 0 Telegram messages**), run as `node /tmp/exp-switch.mjs` for the live
code and `EXP_R14=/path/to/tree node /tmp/exp-switch.mjs` for a candidate.

## The three approaches

- **A — move the poller.** Chat, state and token move to the other machine.
- **B — move only the compute.** The poller stays where it is; the turn is
  handed to a worker over the relay and runs on that machine.
- **C — share the state store.** Nothing moves; both hosts read one store.

## Scores

| | before | after the session-key fix | after the B fix |
|---|---|---|---|
| A | 3/4 | 4/4 | 4/4 |
| B | 4/7 | 5/7 | **7/7** |
| C | 2/4 | 3/4 | 3/4 |
| KEY (identity) | 0/5 | 4/5 | 4/5 |

The one KEY cell that still fails is `tmux view target is location-independent`
(`work-vps` vs `work-collab`) — card 6c, deliberately out of scope here.

With the **VIEW** dimension below (does the tmux TUI follow the chat?) added to
the same run: **A 8/9, B 10/11, C 4/6, KEY 4/5** — the four failing cells are
A's missing swap, B's missing re-bind, and C's/KEY's shared view-location bug.

## What the key fix changed

`sessionKey` was `location|chat|workspace`, so a session could only be found on
the machine that created it: `vps|6218257274|/home/ubuntu/src/Health-tracker`
against `mobile|6218257274|/root/Health-tracker` — same chat, same checkout,
same project, and the key said otherwise. It is now `chat|project`
(`projectIdForWorkspace`), with `location` accepted and ignored so call sites
read unchanged. All six `sessionKey` and three `resolveSession` call sites in
`bot-host.mjs` pass the project explicitly.

**Consequence on deploy:** live rows are keyed with location and become
unreachable, so each chat's `/tx` and session view start fresh once. No
migration — decided deliberately.

## A — the payload, measured

On the live VM:

| what | size |
|---|---|
| `opencode.db` | 316 MB |
| snapshots (file history / undo) | 38 MB |
| tool-output | 19 MB |
| logs | 12 MB |
| **sum of all 84 session exports** | **27 MB** (3.6 KB empty → 4 MB real) |
| bot-host required state + token | ~56 KB |

So A does **not** have to move 300 MB: exports are the portable form and total
27 MB (or 4 KB–4 MB per chat, on demand). Copying the DB is the naive path and
also carries absolute paths from the source machine. Exports do *not* include
snapshots, so full fidelity is the big copy.

What size cannot fix for A: tmux sessions (`grok`, `health`, `work-vps`) and the
live poller process cannot move at all; an incomplete copy degrades silently;
and the token hand-off window is two pollers on one token (Telegram 409).

## B — fixed and proven (7b30f63)

Two gaps, both now closed:

1. **`sessionId` on the job.** `enqueueJob` carries it. `completeJob`'s result
   whitelist was dropping `sessionID` on the way back — that is why the id was
   never recorded; it now returns `sessionID`, `resumedFrom` and `workspace`.
   The worker resumes a session it already has, otherwise pulls
   `GET /sessions/<id>/export` from the relay and imports it.
2. **`workspace` as a machine path.** It now travels as a project id
   (`health-tracker`). `workspaceForId` resolves it on the device: this host's
   registry entry (only when it is the same project) → the project's path here
   → the id itself if it is already absolute → first that exists, else null and
   the worker runs in its own directory instead of spawning into a missing path.

Relay: `GET /sessions/<id>/export` is a **response** body — conversations run
3.6 KB–4 MB and the request-body limit is 256 KB. Unknown session 404,
malformed id 400, no opencode 503. A worker that cannot fetch one logs it and
runs blank rather than quietly using the wrong history.

Probes that made B safe to build:

- `opencode export → import` works across machines and **rebinds `directory` to
  the importing cwd** — the path problem solves itself;
- a session that does not exist fails closed: `Error: Session not found`
  (vs a model error when the session *is* there).

Sensor: `scripts/assert-worker-relay.test.mjs` (31 pass / 0 fail) imports the
fixture conversation into the **relay's HOME only**, so the device cannot read
it off disk and has to fetch it — result `resumedFrom=relay`,
`workspace=<this checkout>`, not the VM path.

## C — not an option as the mover

`3/4`. It passes shared project/role/prefs and work-session reads across hosts,
but the offset race is inherent: two pollers on one token, last writer wins
(Telegram 409 is the loud version). You cannot code around a shared single-
consumer stream — C needs A or B to own the single writer, at which point C is
the thing that made A/B cheap. Use it as a foundation, not a destination.

## VIEW — the tmux TUI follows the chat (measured)

The state scores could not answer: when a chat moves from A to B, does the
*view* move too? The pane runs `opencode attach <server> --dir <ws> --session
<id>` (`tuiAttachCommand`), and its target is `work-<location>:<window>` — the
tmux session name is derived from `session.location` (`tmuxSessionFor`), so a
moved chat looks for its TUI in a session that does not exist on the host that
still has the pane.

Measured with **two isolated tmux servers** (`TMUX_TMPDIR` per host), two real
`opencode serve` processes (sandbox HOMEs), real `opencode attach` panes and a
real `opencode export → import` — still **0 model calls, 0 Telegram messages**:

| approach | check | result |
|---|---|---|
| B | the chat has a live TUI pane on the host that owns the state | PASS |
| B | that pane really runs the opencode TUI | PASS (`pane_current_command=opencode`) |
| B | the view target resolves from the attach hint | PASS (`tmux attach -t work-vps:ws-…`) |
| B | the pane re-binds when a handoff returns a new session id | **FAIL** — record says `sess_handed_back`, pane still binds the old one |
| C | moving the chat in a shared store does not hide its pane | **FAIL** — target `work-collab:…`, the pane lives in `work-vps` |
| C | a separate view-location keeps the pane findable | PASS |
| A | after the move the new host can find the chat's TUI (no swap in current code) | **FAIL** — `work-collab:…` has no pane there |
| A | with the swap the new host finds the chat's TUI | PASS |
| A | the new pane binds the conversation on the NEW host's opencode | PASS (old `:39033` → new `:45623`) |
| A | the old pane is retired (no ghost TUI left behind) | PASS |
| A | the new opencode with its TUI is what the pane shows | PASS (`GET /session/… → 200`) |

Scores with VIEW included: **A 8/9, B 10/11, C 4/6, KEY 4/5**.

Findings:

1. **`export → import` preserves the session id.** The conversation arrives on
   the new host under the *same* id, so the TUI can re-bind to it directly;
   only the `serverUrl` (`127.0.0.1:oldport`) has to be rebuilt. The stored
   `viewCommand` is machine-local: copying it is wrong, rebuilding it from the
   new host's server + the carried id is right.
2. **The swap works — nobody performs it.** Current code derives the target
   from `session.location` and nothing recreates the pane after a move, so the
   new host gets an empty target while the old host keeps an orphan pane bound
   to a dead server. Working recipe: retire the old pane
   (`disableTmuxObserver`) → `opencode export → import` on the new host →
   rebuild `viewCommand` against the new host's server → `ensureTmuxWorkView`.
3. **A tmux client cannot cross machines.** The attached client on the old host
   detaches with the pane, so `/tx status` must print the new
   `tmux attach -t` target for the new location: the view moves, the human
   terminal does not.
4. **B needs no swap** (state never moves) but its view does not follow a
   changed session id: `reconcileWorkViewForLane` early-returns whenever
   `viewMode === 'tui' && serverUrl && opencodeSessionId`, and only an explicit
   `/tx on` rebuilds `viewCommand`. After a handoff the pane can stay bound to
   the pre-handoff session.
5. **C shares the same defect as A**: the tmux session name encodes the chat's
   location, so any location change hides the pane. Storing the *view* location
   separately (card 6c) makes C's pane findable without any swap — the one C
   check that passes once the policy is applied.

Answer to "does the swap work for all of them?": yes, once the view location is
split from the chat location — A performs the full swap (retire + import +
rebuild), B only re-binds, C does nothing. What no approach moves is the tmux
*client*: `grok`, `health` and `work-vps` on the live VM hold attached clients
and cannot migrate at all.

## Verdict

**B > A > C.** B keeps state where it is and now carries both the conversation
and the workspace id; A is the fallback for a host with no relay (27 MB, plus
tmux/live state it cannot move); C is an accelerator for either. With VIEW
measured, none of the three shows its chat's TUI after a move today — the fix is
the same for all of them (split the view location from the chat location), and
only A additionally needs the swap itself.

## Gates on `agent/session-key`

| gate | result |
|---|---|
| `scripts/assert-work-session.mjs` | 50 pass / 0 fail (view-lifecycle expectations moved `work-vps` → `work-view`) |
| `scripts/assert-work-view.test.mjs` (new, guard 11) | 13 pass / 0 fail |
| `scripts/assert-session-key.test.mjs` (new) | 24 pass / 0 fail on a host-shaped checkout (2 env-coupled fails on foreign checkouts: no `external-2` folder, no VM path) |
| `scripts/assert-worker-relay.test.mjs` | 31 pass / 0 fail |
| `scripts/assert-swap-guards.test.mjs` (new, guards 4–8) | 64 pass / 0 fail |
| `scripts/assert-swap-pack.test.mjs` (new, guard 9) | 35 pass / 0 fail |
| `scripts/assert-poller-lease.test.mjs` (new, guard 10) | 21 pass / 0 fail |
| `tests/work-session.test.ts` + `tests/bot-host.test.ts` (vitest) | 176 pass / 0 fail |
| master scorecard | 947 pass / 4 fail — all 4 pre-existing (scout retry backoff ×2, journey-guard spec ambiguity, biomarker M31), none touching sessions |

Test-meaning changes made with this work (disclosed): protected
`scripts/assert-work-session.mjs:127` now pins `qa_meal|health-tracker`; the two
vitest expectations that pinned the old id shape now pin the new one; one new
cross-location identity test added.

## Still open

1. **Card 6c — split the view location from the chat location.** Store a
   `viewLocation` on the work session (where the pane lives) and derive
   `tmuxSessionFor` from it instead of `session.location`; rebuild
   `viewCommand` against the host that owns the pane. The VIEW section is the
   sensor: its two failing cells (C's hidden pane, KEY's `work-vps` vs
   `work-collab`) go green with that policy, and A's swap needs it too.
2. **Card 6c — the swap and the re-bind.** A's recipe (retire the old pane →
   `opencode export → import` on the new host → rebuild `viewCommand` →
   `ensureTmuxWorkView`) is proven in the harness but nothing in the product
   performs it. B's `reconcileWorkViewForLane` must rebuild `viewCommand` when
   `opencodeSessionId` changes, not only when `viewMode`/`lane` change.
   Status 2026-09-26: the library half landed (`WORK_VIEW_SESSION`,
   `workViewTarget`, `repointWorkView`, `sessionName` override in
   `scripts/lib/work-session.mjs`, sensors 50/0 + 13/0) — the product wiring
   half is still open.
5. **Guard 11 mechanism decision (open).** This doc prescribes a
   `viewLocation` field with `tmuxSessionFor` derived from it; the landed
   library instead fixes the swap view at `work-view` with an opt-in
   `sessionName` override. Both split the view location from the chat
   location — pick exactly one before writing the wiring in item 2, or the
   two mechanisms will fight. Recommendation: the fixed name (smaller,
   sensor-proven, no store-shape change); the `viewLocation` field only if a
   second concurrent view per chat is ever needed.
3. **Live proof on Telegram** — the sensors above are process-level; the plan's
   live proof is still owed.
4. **Rebase — done.** `agent/session-key` is now `origin/main` (`18cbd58`) plus
   the two commits plus this document, force-pushed at `4db8df1`. The remote
   branch disappeared once between the first push and verification (the repo is
   being pruned) and was re-pushed — verify the ref before opening the PR.
