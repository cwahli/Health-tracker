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

## Verdict

**B > A > C.** B keeps state where it is and now carries both the conversation
and the workspace id; A is the fallback for a host with no relay (27 MB, plus
tmux/live state it cannot move); C is an accelerator for either.

## Gates on `agent/session-key`

| gate | result |
|---|---|
| `scripts/assert-work-session.mjs` | 47 pass / 0 fail |
| `scripts/assert-session-key.test.mjs` (new) | 24 pass / 0 fail |
| `scripts/assert-worker-relay.test.mjs` | 31 pass / 0 fail |
| `tests/work-session.test.ts` + `tests/bot-host.test.ts` (vitest) | 176 pass / 0 fail |
| master scorecard | 947 pass / 4 fail — all 4 pre-existing (scout retry backoff ×2, journey-guard spec ambiguity, biomarker M31), none touching sessions |

Test-meaning changes made with this work (disclosed): protected
`scripts/assert-work-session.mjs:127` now pins `qa_meal|health-tracker`; the two
vitest expectations that pinned the old id shape now pin the new one; one new
cross-location identity test added.

## Still open

1. **Card 6c** — `work-view` is still location-bound (`tmuxSessionFor` →
   `work-vps` / `work-collab`). Last KEY cell.
2. **Live proof on Telegram** — the sensors above are process-level; the plan's
   live proof is still owed.
3. **Rebase** — `agent/session-key` sits on old `agent/r14-proof` (`fde8f75`),
   which is not in `origin/main`; main has 6 newer commits (R-14.1 card 3 PRs
   #178/#179/#184/#185, R-15 prep #181, router re-vendor #183) and the two
   lines diverge in `scripts/bot-host.mjs`, `free-lanes.mjs` and others.
