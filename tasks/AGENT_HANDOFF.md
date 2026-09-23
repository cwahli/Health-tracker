# Agent handoff — 2026-09-23 (refresh)

Prior packet (Telegram consolidation / Cline) is fully closed out. State below is live.

## Already done / closed
- **Open PRs: 0. Open issues: 0.**
- **CI on `main`: green** — latest success `81bdcde` (run `35913553241`, `tsc + named gates` PASS).
  - Root cause of the F-8.12 red was **not** lockfile drift: `brand_menu_items_local.json` was archived as scratch in `7bf673b`. CI has no D1 credentials, so `server_brand_match` F-8.12 hard-failed on `matched=false`. Restored in `2c8c76d`.
- **PR #51** closed (byte-identical content landed via #52).
- **PR #52** merged — humanized timeout copy (`humanizeRunError` / `isTimeoutError`) in bot-host.
- **PR #39** merged — R-13.2 SSE ping keepalive.
- **PR #53** merged — handoff packet + `public/capability-matrix.html` + `GET /capability-matrix`.
- **PRs #46 / #48** closed (obsolete targets / content already on main).
- **Merged remote branches deleted:** `docs/q-11-finish-ladder`, `fix/saved-meal-images`, `journey/case12-t2-fixes`, `journey/q-11-restore-auth-profile`, `journey/r-13.1`, `journey/r-13-2`, `meal-audit-turnkey-fix` (content already via #37).
- **`notebooks/colab_worker.py`** committed as `367eed7` (interactive getpass token prompt when Colab Secrets missing).
- **`.gitignore`** now ignores `__pycache__/` + `*.py[cod]` (`2589851`).
- **meal-audit skill path fix** re-applied on main (`55b3906`) — absolute path + `foodLogs` source-of-truth in `scripts/skills/common/meal-audit-engine/SKILL.md`.
- **VPS** `health-tracking.duckdns.org` deploy at `81bdcde`; services `health-tracker`, `bot-host@opencode`, `bot-host@vm` all **active**.

## Remaining remote branches (not merged — do not delete blindly)
| Branch | Notes |
|---|---|
| `fix/portion-wrong-basis` | Tip `6118be6` (Sep 11). Diverged; core WRONG_BASIS / 9.2 kcal/g guards **are** on main. Large file diffs vs main — review before delete or leave. |
| `wip/index-7128b23`, `wip/index-f2715d3` | Old index snapshots |
| `wip/stash-0-untracked-prototypes`, `wip/stash-1-applet-bugqueue`, `wip/stash-2-biomarker-lifecycle` | Old stash snapshots |

## Open work (from `plan/ROADMAP.md` — not started this session)
- **F-13.2** — blocked (needs live T2 `per_100g` lock capture).
- **V-27** phone check — `blocked_human`.
- **Track D D-1** unpaid Supabase probe (~24 Sep), **D-3 / D-5 / D-6 / D-10** — `blocked_human`.
- **L-5** locale — human must name a locale first.
- Meal-audit ledger: ~69 open rows (mostly `W2-OAT-01`, 48 with `actual=null`) — investigate only if asked.

## Repo / deploy
- Repo: `https://github.com/cwahli/Health-tracker.git` (was `Health-tracker-2` in older notes).
- Local working copy: `/root/Health-tracker` under `proot-distro login ubuntu`.
- Deploy: `/home/ubuntu/deploy/Health-tracker`; webhook `/home/ubuntu/deploy.sh` (flock + no-op guard; ends with `scripts/sync-hermes-skills.sh`).
- Hermes skills are **symlinks** into the repo (`scripts/skills/common/…`) — edit in-repo, then deploy; do not hand-edit `~/.hermes` paths.
- Local Termux vitest often `Bus error` under proot — run gates on the VPS or rely on CI.

## Do not
- Re-introduce global `~/.hermes/dispatch_lock` (use per-file `file-locks.mjs`).
- Dual-poll one Telegram token (VPS + phone).
- Start `bot-host@android` on the VPS (phone owns that token).
- Delete unmerged `wip/*` / `fix/portion-wrong-basis` without a content review.
