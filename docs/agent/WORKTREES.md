# Worktree isolation (multi-agent VPS)

**Why:** several agents (OpenCode, Cline, Grok, Antigravity) share this box and
`git push` triggers an auto-deploy that runs `git reset --hard`. Before this
split, the deploy reset the **dev checkout**, silently destroying uncommitted
work mid-task. Now the deploy resets only a **dedicated clone**.

## Reaching the box (from the Mac)

An agent working on the Mac is **not** on this box, so none of the paths above
exist locally. Reach it first:

```bash
ssh -o BatchMode=yes ubuntu@51.254.217.163
```

- Host `vps-0a61fae6`, user `ubuntu`, default key (`~/.ssh/id_ed25519`). No
  `~/.ssh/config` entry, no password, no sudo.
- `-o BatchMode=yes` fails fast instead of hanging on a key or host prompt, so
  testing the route costs about a second.
- One command on the box, through the same door (heredocs work too):

  ```bash
  ssh -o BatchMode=yes ubuntu@51.254.217.163 'uname -n; systemctl list-units "bot-host@*" --no-legend --state=running | wc -l'
  ```

- The helper `~/dev/new-worktree.sh` is **on the box**, not on the Mac; run it
  over ssh. The same is true of every `/home/ubuntu/...` path on this page.
- Some tools are missing on the box (there is no `timeout`); prefer plain
  commands.

**Never report the host as unreachable without running that command.** "No
route" is a claim about this machine's keys, and it has been made wrongly: on
2026-10-07 an agent told the user it had no route to the VM while the route had
been working all along, which turned a live defect that is only visible on the
box into "cannot be seen". A memory note does not hold — that is the lesson
`assert-bugctl-is-reachable.mjs` already records — so the mechanism is a check:

```bash
node scripts/assert-vm-route.mjs          # the record is still wired (offline)
node scripts/assert-vm-route.mjs --live   # the route answers, today
```

What is on the other side, when you are diagnosing the fleet:

| Read | Command |
|------|---------|
| Running bots | `systemctl list-units 'bot-host@*'` (9 running on 2026-10-07) |
| One bot's log | `journalctl -u bot-host@<id> -n 200 --no-pager` |
| A watcher's log | `journalctl -u ht-allowance-watch -n 50 --no-pager` |
| Per-bot state | `~/.local/state/bot-host/<bot>/...` |
| Shared watcher state | `~/.local/state/shared-free-lanes/` (state + `ht-allowance-watch.log`) |

Full host inventory: `plan/VPS2_MOBILE_DEV.md`.


## Layout

| Path | Role | Safe to edit? |
|------|------|---------------|
| `/home/ubuntu/deploy/Health-tracker` | **Deploy target.** systemd `WorkingDirectory`; `deploy.sh` resets/builds/restarts here. | **No** — a deploy will reset it |
| `/home/ubuntu/src/Health-tracker` | **Dev / worktree base.** Holds `git worktree` metadata and `.env`. | Yes (but prefer a worktree) |
| `/home/ubuntu/dev/<area>` | **Per-agent worktree**, branch `agent/<area>`. | Yes |

`deploy.sh` (webhook → `/home/ubuntu/deploy.sh`) does, and only does:

```
cd /home/ubuntu/deploy/Health-tracker
git fetch origin main && git reset --hard origin/main
npm ci && npm run build && systemctl restart health-tracker
```

It never touches `~/src` or `~/dev`.

**Deploy concurrency:** rapid pushes fire several webhook deploys at once; they
fight over git/npm/build (68 started vs 40 completed before the fix). `deploy.sh`
now takes an exclusive `flock` on `/home/ubuntu/.deploy.lock`, so overlapping
triggers **serialize** — a queued run re-fetches `origin/main`, so the last push
wins and each deploy is atomic.

## Create a worktree

```bash
~/dev/new-worktree.sh <area> [base-branch]
# e.g.  ~/dev/new-worktree.sh sync
#       ~/dev/new-worktree.sh meal main
cd /home/ubuntu/dev/<area>
npm ci          # deps are PER worktree (node_modules is not shared)
```

Each worktree gets its own `.env` copy. `node_modules` and `.env` are
git-ignored, so they are not in the repo.

## Rules (industry-standard multi-agent practice)

1. **One worktree per agent.** Never two agents in one directory.
2. **One file, one owner.** Do not let two agents edit the same file. Hub files
   (`server.ts`, `serverJobs.ts`, `server_routes_*.ts`, `AGENTS.md`,
   `plan/ROADMAP.md`, `specs/**`) are single-writer at any moment.
3. **Small, area-scoped branches.** If a task touches another area's files,
   sequence it instead.
4. **Commit + push at the end of each unit.** Uncommitted work is always at
   risk (editor crash, box reset); committed+pushed work is not.
5. **Merge sequentially.** Rebase each `agent/<area>` onto the new `main` and
   re-run checks; do not merge everything at once.
6. **Deploy is not a dev action.** To ship, push to `main` (or merge the PR);
   the webhook deploys. Do not run `deploy.sh` by hand to pick up local edits —
   it deploys `origin/main`, not your worktree.

## Remove a worktree

```bash
cd /home/ubuntu/src/Health-tracker
git worktree remove /home/ubuntu/dev/<area>
git branch -d agent/<area>      # after it is merged
```

## Verify isolation (one-time proof)

```bash
cd /home/ubuntu/dev/demo && echo x > UNCOMMITTED.txt
bash /home/ubuntu/deploy.sh
cat /home/ubuntu/dev/demo/UNCOMMITTED.txt   # still there → isolation works
```

## Backups taken during the cutover

- `/home/ubuntu/deploy.sh.bak.*`
- `/home/ubuntu/auto-deploy.sh.bak.*`
- `/home/ubuntu/health-tracker.service.bak.*`
- `/home/ubuntu/webhook.json.bak.*`

## Optional next tiers (not yet done)

- `.github/CODEOWNERS` (static ownership) + branch protection "Require review
  from Code Owners" for hub files.
- Rulesets → "Restrict file paths" for hard push blocks.
- A CI claim-guard that fails a PR touching a path another open PR claims
  ("open PR is the lock"). GitHub has no native temporary per-path lock.
