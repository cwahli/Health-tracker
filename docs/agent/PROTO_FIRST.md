# Proto-first workflow — iterate on proto, ship to dev only after approval

**Why:** Stakeholders see the **dev site** (`https://health-tracker.co.uk`). Work-in-progress must never land there before the human has seen it on the **prototype stage** (`https://proto.health-tracker.co.uk`). This doc is the one canonical process for every surface (Grok, Gemini/Antigravity, AI Studio, OpenCode, Cline). `AGENTS.md` points here; `JOURNEY.md`, `GITHUB_WORKFLOW.md`, and the CI sensor (`assert-proto-first`) enforce it.

---

## 1. The two stages

| Stage | URL | Audience | How it gets code | Branch |
|---|---|---|---|---|
| **Proto (iteration)** | `https://proto.health-tracker.co.uk/` | You (human) + agent | `agent/<area>` branch, built preview | Feature branch |
| **Dev (stakeholder)** | `https://health-tracker.co.uk/` | Stakeholders, public | `main` only, via auto-deploy (`deploy.sh`) | Merged PR |

- **Proto** is private iteration. It is the only place an agent may preview WIP.
- **Dev** is stakeholder-visible (L18 live proof, Drive screenshots). Agents **never** push WIP there.
- The existing Sage-prototypes Pages site also lives under `proto.health-tracker.co.uk/` (Caddy → `127.0.0.1:8790`). Health-tracker previews run at `https://proto.health-tracker.co.uk/ht/<branch-ref>/` (Caddy → `127.0.0.1:3100`, `ht-proto-preview` service, `Base path: /ht/`). The `/ht/` prefix keeps the two apps on one subdomain without clobbering each other. If you are working on Sage prototypes (Pages `functions/`), use the wiki `AGENTS.md` in that checkout — this file governs Health-tracker.
- A **proto approval** is the human saying **`go for dev`** (or `proto approved`) on the PR/chat after seeing the proto URL + screenshot. No other agent can approve on the human's behalf. The approval is recorded in the PR body (`## Proto` → `Approved: go for dev <date>`) and in `AI_HANDOVER.md` when relevant.

## 2. The flow (Builder + Guard + you)

```text
1. PLAN      Planner packet (JOURNEY.md). Files locked in specs/active/<ID>.md.
2. BUILD     Builder edits only allowed_files in worktree agent/<area>.
3. PROTO     Builder deploys the branch to proto:
             node scripts/proto-deploy.mjs
             → builds (vite build), serves preview on 127.0.0.1:3100 (/ht/),
               curls health, prints:
               Proto: https://proto.health-tracker.co.uk/ht/<sha>/
             On the VPS, the same build is the ht-proto-preview service.
4. PROOF     Builder captures live proof on proto (L18): populated screen,
             screenshot per proof point (Drive “Work done”), served-bytes check.
             PR body gains the required section:

               ## Proto
               URL: https://proto.health-tracker.co.uk/ht/<sha>/
               SHA: <full sha>
               Proof: <Drive screenshot id / path> + <what it shows>
               Status: awaiting approval

5. GUARD     journey-guard.mjs + assert-proto-first.mjs.
             CI fails a PR touching user-visible code (src/, server*.ts,
             index.html, app.html) unless ## Proto names a URL + SHA.
             Docs/process-only, registry-only, or queue-sync PRs may write
             Proto: exempt (see §4) — the sensor verifies the exemption claim.
6. YOU       You open the proto URL. Reply:
               go for dev          → approve, promote to dev
               no, change X        → back to Builder (new hypothesis, §L17)
             Nothing merges without your `go for dev`.
7. PROMOTE   Only with `go for dev` in the chat/PR: flip PR body to
               Status: Approved — go for dev <date>
             merge the PR (squash, title+body preserved, GITHUB_WORKFLOW §4.7).
             deploy.sh auto-deploys main → dev site (health-tracker.co.uk).
             Agents never hand-edit the dev site or run deploy.sh for a branch.
```

**One writer per area** (WORKTREES.md §Rules): two agents never write the same files. If a PR claims a file another open PR claims, `claim-guard` fails — sequence, do not widen scope.

**Hotfix escape hatch (narrow):** A production outage (site down, data loss) may skip the proto wait **only** if the human says `hotfix, skip proto` in the same message, and the PR body records it under `## Proto → Hotfix: human skipped proto <date>`. Hotfix is for downtime/data loss, not for “the screenshot was slow.” The sensor requires that exact line; a missing exemption line + `src/` change = red CI.

## 3. Agent rules (mirrored in AGENTS.md §0, JOURNEY.md, GITHUB_WORKFLOW.md)

1. **Never merge to `main` without a `## Proto` section** (when the PR touches user-visible code). Docs-only, `docs/agent/**`-only, registry-only, and `[queue-sync]` PRs are exempt — and must *say* so in `## Proto` (`Proto: exempt — <reason>`).
2. **Never claim COMPLETE / "all done" before proto proof exists** (L18 + this file). A screenshot of localhost, a green tsc alone, or “it loads” is not proto proof.
3. **Never deploy to dev by hand.** `deploy.sh` deploys `origin/main` (`git reset --hard origin/main` in `/home/ubuntu/deploy/Health-tracker`). Pushing your branch does **not** ship to dev; merging an approved PR does.
4. **Worktree isolation holds for proto too:** `/home/ubuntu/src/Health-tracker` is never the deploy target; `~/dev/<area>` is the only place agents edit.
5. **Two Guard fails → Reviewer** (JOURNEY.md). Do not iterate on proto by re-deploying variants of the same hypothesis. Fork clean, revert dirty (L17).
6. **Same graph on every surface.** Antigravity/Gemini read `AGENTS.md` + `GEMINI.md` + `.agents/rules/journey.md`; AI Studio mounts `AGENTS.md`. This file is the argument they must not re-derive. Edit it only with the human’s before→after (AGENTS.md §3).

## 4. Exemptions (must be written, not assumed)

| PR kind | `## Proto` content |
|---|---|
| `src/`, `server*.ts`, `index.html`, `app.html`, `agents/` user-visible | `URL: https://proto.health-tracker.co.uk/ht/<sha>/` + `SHA:` + `Proof:` + `Status: awaiting approval` (then `Approved`) |
| Docs / `docs/agent/**` / `AGENTS.md` process-only (this PR is one) | `Proto: exempt — docs/process only, no user-visible surface <date>` |
| `[queue-sync]` generated commits | `assert-proto-first` passes silently (same exemption as `assert-pr-summary`) |
| Hotfix (downtime/data loss) | `Hotfix: human skipped proto <date>` — human-typed, not agent-typed |

Any other exemption claim fails `assert-proto-first`.

## 5. How to run proto locally (Mac or VPS dev worktree)

```bash
node scripts/proto-deploy.mjs              # build + serve on :3100 + curl health
# prints: Proto: http://127.0.0.1:3100/ht/<sha>/  (local preview root)
# On the VPS, the same build is served by ht-proto-preview behind
# https://proto.health-tracker.co.uk/ht/<sha>/ (see scripts/proto/ Caddy snippet)
```

`proto-deploy.mjs` never touches `/home/ubuntu/deploy/Health-tracker`, never restarts `health-tracker` (the dev service), and never writes to `main`. It writes only to the preview slot (`/tmp/ht-proto-preview` or `dist/proto-preview/`) and a loopback-only server.

## 6. Files that enforce this

| File | Role |
|---|---|
| `docs/agent/PROTO_FIRST.md` (this file) | Canonical process |
| `scripts/assert-proto-first.mjs` + `.test.mjs` | CI sensor (PR body + doc wiring, fails closed) |
| `scripts/proto-deploy.mjs` | Local/VPS preview deploy (health + URL print) |
| `scripts/proto/caddy-ht.snippet` | Caddy `handle /ht/*` snippet for the VPS (`127.0.0.1:3100`) |
| `docs/agent/standing.json` → `proto_first_gate` | Standing row (Guard enforces the docs never drift) |
| `.github/workflows/ci.yml` → `Proto-first gate` step | Blocks merge without proto evidence |
| `docs/agent/JOURNEY.md`, `AGENTS.md`, `GITHUB_WORKFLOW.md`, `README.md`, `GEMINI.md`, `.agents/rules/journey.md` | Pointers so **every** agent reads the same rule |

Cross-surface propagation: after editing `AGENTS.md`/`docs/agent/**` on a VM session, run `python3 ~/.agents/skills.py sync` (session-start). On the Mac, `git push` carries the files to every surface — git is shared memory, not chat.
