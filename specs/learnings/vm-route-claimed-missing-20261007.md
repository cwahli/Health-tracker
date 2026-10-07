# A route was reported missing without being tested

**Date:** 2026-10-07
**Class:** asserted absence of capability (not a food/biomarker defect)
**Surface:** the fleet box (`vps-0a61fae6` / `51.254.217.163`)

## What happened

The user asked why the Cline Muse lane could not be seen from their bot. The
agent answered that it had **no route** to the VM the bots run on, and asked the
operator to re-drive it. The user pushed back — "Why do you have no route? You
have access to VM" — and they were right. `ssh -o BatchMode=yes
ubuntu@51.254.217.163` answered on the first try with the default key. It had
been working the whole time.

## Why it mattered more than one wrong sentence

The actual cause of the symptom — a free-lane hold being re-stamped indefinitely
by a probe that could never run (`ht-allowance-watch`, log line
`uncertain → re-stamped default TTL ... (cline: not installed)`) — exists **only
on the box**: in its ledgers and its service journal. A diagnosis that starts
from "I cannot reach it" cannot get there. So a live, fixable, fully-evidenced
defect was reported to the operator as something unseeable, and the next action
offered was a blind re-tap instead of the delivered bytes. This is exactly the
failure mode L18 forbids: never ask for blind re-taps — read the bytes.

## Why the old memory did not hold

`docs/infra/DUAL_SERVE_RUNBOOK.md` already contained
`ssh ubuntu@51.254.217.163`, twice. It was never read, because `docs/infra/**`
is not on the AGENTS.md load map, so an agent following the map has no path to
it. One contributing trap: the worktree doc's own helper
(`~/dev/new-worktree.sh`) exists **only on the box**, so following the
documented onboarding from a Mac fails locally and invites the conclusion that
the whole box is unreachable.

**And the durable-memory location itself was silently unwritable.**
`.gitignore` carried a bare `agent` line (from the "Antigravity & mobile
symlinks" block), and a bare pattern matches a directory of that name at *any*
depth — so `docs/agent/**`, the always-on process directory that AGENTS.md
points agents at, was refused by `git add`:

```
$ git add docs/agent/_probe.md
The following paths are ignored by one of your .gitignore files:
docs/agent
hint: Use -f if you really want to add them.
```

Already-tracked files kept working, which is why nobody noticed. A **new**
record dropped there looked added and never committed — so the obvious place to
write a durable memory was the one place that could not keep one. The fix is to
anchor the intent to the repo root (`/agent`), which is what "Antigravity &
mobile symlinks" meant.

This is the same lesson `assert-bugctl-is-reachable.mjs` already records — a
memory note is not a mechanism — reached from a different direction.

## The class

**Reporting a negative capability from memory.** "I have no route" / "I cannot
reach it" / "that tool is not available here" are claims about *this machine's
configuration*, and they are cheap to test and expensive to get wrong, because
they end the investigation. The rule: an absence claim must be produced by
running the test, in the same turn, and the test must be non-interactive so it
can be run every time.

## The sensor this leaves behind

- `scripts/assert-vm-route.mjs` — offline (deterministic, CI- and prepush-safe):
  asserts the route record is still wired, including that AGENTS.md §0 still
  points at the doc that holds it, and that the live command is non-interactive
  **by construction** (`BatchMode`, `ConnectTimeout`).
- `node scripts/assert-vm-route.mjs --live` — the only mode that judges
  reachability: opens the door and asserts the box answers, is the fleet box,
  and has running `bot-host@*` units. Live run 2026-10-07: 14 pass, 0 fail.
- Red-proved twice. Removing the doc's unreachable-claim rule from
  `docs/agent/WORKTREES.md` drops the offline run to 10 pass / 1 FAIL, exit 1.
  Restoring the bare `agent` pattern in `.gitignore` drops it to 11 pass / 1
  FAIL, exit 1 — the ignore check reproduces the real refusal rather than reading
  intent.
- The ignore check is EXECUTED, not grepped, and that matters: the first version
  used `git check-ignore`, which reports "not ignored" even when `git add` on a
  new file is refused (the tracked files inside keep the path readable). It
  passed in both states, i.e. it was decoration. The shipped check creates a file
  and dry-runs `git add -n` on it, which is the operation that actually failed.

## Where the durable record lives

`docs/agent/WORKTREES.md` gained a **Reaching the box (from the Mac)** section
(host, user, key, the non-interactive one-liner, what is on the other side, and
the explicit rule never to report the host as unreachable untested). It is
reachable from the always-on path because AGENTS.md §0 already points at that
doc for this box — no load-map edit was needed, and AGENTS.md is claimed by
another open PR, so none was made.

## Still open

- A load-map row in AGENTS.md §1 (e.g. "VM / fleet box → `docs/agent/WORKTREES.md`")
  would make the route task-discoverable, not just session-discoverable. It needs
  a turn when AGENTS.md is not claimed by another open PR.
- `docs/agent/standing.json` has not been grown with this: its shape is
  `{version, rule, journeys, features, sibling_pairs}`, and adding a row there
  belongs to a Reviewer/Learner turn rather than a drive-by.
- The check is not yet in `test:prepush`. `package.json` is claimed by the open
  #610, and the open PR is the lock, so `gate:vm-route` is a sequenced follow-up:
  add `"gate:vm-route": "node scripts/assert-vm-route.mjs"` beside
  `gate:bugctl-reachable` and put `&& npm run gate:vm-route` after it in the
  `test:prepush` chain (verified locally: the chain runs green with it in place).
