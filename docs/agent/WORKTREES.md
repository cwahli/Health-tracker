# Worktree isolation (multi-agent VPS)

**Why:** several agents (OpenCode, Cline, Grok, Antigravity) share this box and
`git push` triggers an auto-deploy that runs `git reset --hard`. Before this
split, the deploy reset the **dev checkout**, silently destroying uncommitted
work mid-task. Now the deploy resets only a **dedicated clone**.

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
