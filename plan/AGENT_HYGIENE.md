# Agent hygiene — why 18 PRs piled up, and the cleaner that stops it happening again

**Status:** DIAGNOSIS + MECHANISM (2026-09-26). The cleaner below runs daily without a
human; this file is what it enforces and why.

## How it happened (measured, not guessed)

On 2026-09-26 the box held **45 remote branches**, **~23 worktrees**, and **18 open
PRs** — with exactly one live agent (working `~/projects/external-2`) and two live
bots. Five mechanisms combined to produce that:

1. **Branch-per-task with no retirement step.** Every agent opens a branch and a PR,
   but "done" was never defined. An agent that finishes (or dies) leaves both behind.
   Nothing in the workflow says who closes a PR, so nobody does.
2. **Squash merges orphan branches.** A squash merge lands the content under a new
   SHA, so the source branch is never an ancestor of main and never looks "merged"
   to a naive check. GitHub only auto-deletes if the repo enables it; here it does
   not, so every landed PR left its branch standing.
3. **No liveness signal.** Nothing distinguishes "an agent is working on this branch"
   from "the agent died two days ago". The box has presence for *workers* and leases
   for *pollers*, but branches — the things that accumulate — have no heartbeat.
4. **Gates that block but never clean.** `no-overlap` correctly fails when 18 branches
   touch the same files, and `Workers Builds` fails repo-wide. A failing gate stops a
   merge; it does not retire the PR. So blocked PRs pile up instead of either landing
   or leaving.
5. **The deploy clone as a second source of truth.** Unmerged work was deployed
   straight to `/home/ubuntu/bot-host-r14` (the 13:41 build), so live behavior
   diverged from git. The next git-driven deploy then looked like a revert, which
   made everyone afraid to touch the deploy — freezing the pile in place.

My own work contributed (six `agent/gstore-*` branches in three days). The cleaner
below applies to those first.

## The mechanism: tiers, heartbeat, timer

`scripts/agent-hygiene.mjs` runs the tiers in order. Every action is appended to
`~/.local/state/bot-host/agent-hygiene/audit.jsonl`, and nothing in Tier 2/3 runs
without `--apply` (the timer passes it; a human run defaults to dry-run).

**Tier 1 — provably safe.** The content is in main, so deleting the pointer loses
nothing: a merged PR's head branch, or any branch whose tip is reachable from main.
No judgment, no grace period.

**Tier 2 — abandoned.** ALL of these must hold: the PR is open; the head branch has
no commits in the last 48h; no live heartbeat names the branch; no running process
holds a worktree on that branch as its cwd; and the PR is failing a gate, dirty, or
older than 7 days. Then: comment (linking this file and the audit line) + close.
The branch itself is kept.

**Tier 3 — branch reaping.** A branch whose PR was closed by Tier 2 (or which never
had one), untouched for 7 more days, with no heartbeat and no process → delete.
Restorable for 90 days via GitHub's restore, and the commits never leave the object
store until gc — but the default horizon means a returning agent finds a clean tree,
not a graveyard.

**Heartbeat (prevention, not just cure).** `scripts/agent-heartbeat.mjs` writes
`~/.local/state/bot-host/agent-heartbeat/<branch-slug>.json` (`{pid, branch,
updatedAt, note}`). Live means updated within 6h *and* the pid still runs. Any
long-lived agent is expected to heartbeat; the cleaner treats a heartbeat as a veto
that no other signal overrides. This is the piece that would have prevented the
pile: liveness becomes a fact instead of a guess.

**Timer.** `agent-hygiene.timer` runs the cleaner daily. No human in the loop by
design — the audit log is the accountability, not an approval click.

## What ran on 2026-09-26 (the first self-clean)

Tier 1 deleted branches of already-merged PRs (content verified in main first).
Tier 2 closed the open PRs whose agents were gone — verified per-PR against commits,
heartbeats, processes and CI before closing, with the audit line in the close
comment. The operator's declaration ("only the external-project agent is live") was
the tiebreaker where signals were ambiguous, and it is recorded as such; the rules
above are what run unattended from here on.
