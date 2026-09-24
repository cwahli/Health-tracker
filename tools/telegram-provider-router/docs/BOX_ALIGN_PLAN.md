# Grok Box Alignment Plan — pick up from here

Box agent: this is your checklist for staying in line with the other agents
(VPS bot-host family, mobile, collab). Work it top to bottom, tick boxes,
report back in chat when done. All paths below are in the Health-tracker
repo unless marked `box:`.

## 0. Ground rules (do not break these)

- `main` is the only truth. `git pull --ff-only origin main` before anything.
- One poller per token (BOT-5 law). Never run two pollers on the same token.
- Tokens live in env files, never in git, never in chat.
- Shared code is single-source: `scripts/lib/` is canonical. The router holds
  only vendored mirrors — never edit a `.vendor.mjs` by hand.

## 1. Pick up the shared working headline (ready now, needs box deploy)

Repo commit `805369a` (merged as `main` ≥ 2026-09-24):

- Canonical framework: `scripts/lib/tg-progress.mjs`
  (`formatWorkingHeadline`, `formatTokenCount`, `ctxLimitFor`,
  `KNOWN_CTX_LIMITS`). Change the status-line format here and it lands
  everywhere — that is the whole point.
- Router change: `tools/telegram-provider-router/src/index.js` now imports
  `./tg-progress.vendor.mjs` instead of its own local copies (deleted:
  `formatTokenCount`, `formatWorkingHeadline`, `KNOWN_CTX_LIMITS`).
- Sync script: `scripts/sync-router-vendor.mjs` regenerates the vendor mirror.
- Gate: `scripts/check-capability-propagation.mjs` FAILS on vendor drift.

Your steps:

- [ ] `git pull --ff-only origin main` (need ≥ `805369a`)
- [ ] `bash <shared-pack>/bin/sync-from-repo.sh` (refresh box pack from repo)
- [ ] Verify the deploy script copies **all** of `src/*.mjs` to
      `box:~/.config/telegram-opencode/router/` — `tg-progress.vendor.mjs`
      is a NEW file; a hardcoded file list will silently drop it. Fix the
      list if so.
- [ ] `bash <shared-pack>/bin/deploy-to-live.sh`, restart the router
- [ ] Live-proof: send any prompt, confirm the progress line reads
      `⏳ {Provider} {model} … working… {N}s - {used}/{limit} ({pct}%)`
      (same shape as before — behavior unchanged, code now shared)
- [ ] Report back: headline OK + `node scripts/check-capability-propagation.mjs`
      output from the repo checkout (want: 21 caps, 0 failures)

## 2. Table rendering on the router (your lane differs — by design)

The router sends plain text (no `parse_mode`), so the bot-host `<pre>`
table-aligner does NOT apply to Grok TG — padded spaces don't align in a
proportional font and fences would show literally. Your path is the
JSON→HTML→`MEDIA:` pipeline (`telegram-tables` skill + `extractMedia`, which
the router already supports). Do NOT port the pre-block code.

- [ ] Confirm the `telegram-tables` skill text on the box matches
      `scripts/skills/common/telegram-tables/SKILL.md` on `main`
- [ ] If you want aligned text tables later, that needs an HTML-parse_mode
      send path in the router first — propose, don't improvise (Case H ladder,
      plan/RELIABILITY.md §14.6)

## 3. Known gap you share: conversation history

Audited 2026-09-24 (see `session-continuity` in `bots/capabilities.json`):

- Router: single GLOBAL opencode session (`state.sessions.opencode`) — all
  chats share one history. Works, but cross-chat bleed. Per-chat sessions
  is the open item, not a fire.
- bot-host cline lane: NO session at all (`sessionID: null` hardcoded,
  `--id` never passed) — every message starts fresh. This is the user-visible
  "can't read previous message" on cline-model bots. Fix lands in
  `scripts/lib/agent-cline.mjs` + `scripts/bot-host.mjs` (repo side); no box
  action until announced.
- TG reply-quoting (`reply_to_message`) is dropped repo-wide — same deal,
  repo-side fix, no box action yet.

No action for you here — listed so you don't "fix" it box-side and fork.

## 4. Standing open items (yours if you want them)

- Box tickets in `tools/telegram-provider-router/tickets/` — close or refile
  anything the headline/table work supersedes.
- `/compact` + 60/75% context warnings now come free with the headline —
  confirm they make sense for the shared-session model.

## Done = reply with

`HEAD=<sha> headline=<ok> vendor=<in-sync> smoke=<one prompt, headline + reply received>`
