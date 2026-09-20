# GitHub workflow for multiple agents (Tier 1 + Tier 2)

**Goal:** several agents work the same repo without stepping on each other, and
every change lands through evidence, not a bare push.

This builds on `docs/agent/WORKTREES.md` (local isolation). GitHub adds the
*shared* coordination layer: ownership, claim locks, and a merge gate.

---

## 1. The shape

```
agent worktree (agent/<area>)  ──push──►  PR to main
                                           │
                                           ├─ ci (tsc + named gates)     ← required
                                           └─ claim-guard (no-overlap)   ← required
                                           │
                                           ▼
                                   CODEOWNERS review (required for hubs)
                                           │
                                           ▼
                                        merge → auto-deploy
```

- **The open PR is the lock.** A PR *claims* the files it changes.
  `claim-guard` fails if another open PR already changes the same file.
  The claim releases automatically on merge/close.
- **CODEOWNERS** is static ownership for hub files; with branch protection it
  forces the owner's review on those paths.
- **ci** runs the repo's own fast gates so a merge has evidence.

GitHub has **no native temporary per-path lock** — this is the standard
workaround (open-PR-as-lock + CI guard + CODEOWNERS).

---

## 2. Files in this change

| File | Role |
|---|---|
| `.github/CODEOWNERS` | static owners for hub/process paths |
| `.github/workflows/claim-guard.yml` | fails a PR that overlaps another open PR |
| `.github/workflows/ci.yml` | tsc + named gates on PRs and `main` |

---

## 3. Repository settings to toggle (owner-only, no code)

These are **UI/API only** — a committed file cannot turn them on. Repository
`cwahli/Health-tracker`, Settings:

### 3a. Ruleset on `main` (Settings → Rules → Rulesets → New branch ruleset)
- Target: `main`
- ✅ **Require a pull request before merging**
  - Required approvals: **1**
  - ✅ **Require review from Code Owners**
  - ✅ **Dismiss stale approvals when new commits are pushed**
- ✅ **Require status checks to pass**
  - Add: **`ci / tsc + named gates`** and **`claim-guard / no-overlap`**
  - ✅ Require branches to be up to date before merging
- ✅ **Block force pushes**
- Bypass list: the repo owner (so hotfixes are still possible).

### 3b. Optional hard block on hub paths
- Same ruleset → **Restrict file paths** → add the hub paths
  (`/server.ts`, `/serverJobs.ts`, `/server_routes_*.ts`, `/AGENTS.md`,
  `/plan/ROADMAP.md`, `/specs/**`) with **allowed exceptions** for the owner
  if desired. This *prevents any push* touching those paths, for everyone.

### 3c. Verify
- Open a test PR that touches a hub file → expect a CODEOWNERS review request,
  `ci` running, and `claim-guard` green.
- Open two PRs touching the same file → the second should show
  **`claim-guard / no-overlap` red** naming the first PR.

> Note: branch protection / rulesets need the repo to be **public** or on
> **GitHub Pro** for private repos. If the buttons are greyed out, that is why.

---

## 4. Agent rules (always-on, mirror of AGENTS.md §0)

1. Work in a worktree (`~/dev/new-worktree.sh <area>`), branch `agent/<area>`.
2. **Never push directly to `main`.** Open a PR.
3. **One area per PR.** If it needs a hub file another agent is using, sequence.
4. Before pushing, **rebase on `origin/main`** and re-run the gates locally:
   `npm run lint && npm run test:prepush && npm run test:sync`.
5. When `claim-guard` is red, do not "fix" it by widening scope — read the
   other PR, coordinate, and reduce your PR to its area.
6. Merge **sequentially**: one PR at a time, rebase the rest.

---

## 5. What is *not* solved by GitHub

- The local shared-checkout problem → fixed by worktrees
  (`docs/agent/WORKTREES.md`), not by GitHub.
- **Semantic** conflicts (different files, incompatible assumptions) → only an
  integration test / verifier catches these. Keep the `verifier` step: run the
  tests and read the diff; do not merge on a green check alone.
