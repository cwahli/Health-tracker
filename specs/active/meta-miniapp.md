---
id: meta-miniapp
status: locked
auto_go: true
skill: sync-jobs
edit_mode: patch
allowed_files:
  - src/miniapp/miniapp-registry.ts
  - src/miniapp/app.tsx
  - app.html
  - vite.config.ts
  - scripts/lib/tg-oauth.mjs
  - scripts/tui-gateway.mjs
  - scripts/bot-host.mjs
  - scripts/lib/commands.mjs
  - scripts/lib/tui-surface.mjs
  - src/miniapp/bugs.tsx
  - src/miniapp/fleet.html
  - src/miniapp/review.html
  - plan/ROADMAP.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - bots/registry.json
gate:
  - npx tsc --noEmit
  - node scripts/assert-tui-gateway.test.mjs
  - node scripts/assert-fleet-miniapp.test.mjs
  - node scripts/assert-review-miniapp.test.mjs
---

# Packet: meta mini-app — one shell, ten toggleable TG apps

**Go recorded 2026-10-09. Do not ask the user.** R-14.1 is closed, which was this packet's own gate. R-16, BOT-24, and BOT-26 are cleared and are not a sequencing stop. An open PR on `plan/ROADMAP.md` blocks that file only.

This go is **P1 only**: create `src/miniapp/miniapp-registry.ts` and `scripts/lib/tg-oauth.mjs`. Zero hub edits. Zero behavior change. The other paths in `allowed_files` are the later phases. Do not edit `scripts/bot-host.mjs`, `scripts/lib/free-lanes.mjs`, `scripts/lib/work-session.mjs`, `scripts/tui-gateway.mjs`, `vite.config.ts`, or the existing mini-app pages in this go.

## Journey

Today there are N Telegram surfaces on N hosts/ports with N duplicated
`telegram-web-app.js` bootstraps: bug-board (`/bugs`), fleet (`/fleet`),
review (`/review`), TUI terminal (`/tui`, per-bot ttyd), TGTG audit (`:8892`,
VPS-only), agenda/calendar/stays (spec `STAYS_AGENDA_SCOUT.md`, unbuilt `:8895`),
forge (`/forge`), opencode web (`web.health-tracker.co.uk :4096`, external).
All use Telegram `initData` HMAC; Google OAuth refuses embedded WebViews
(`specs/active/bug-board-miniapp.md:41`). Better means: one host
(`app.health-tracker.co.uk`), one shell with burger nav + `?bot=&tab=`
deep-links, one `initData→htk` exchange, each app toggleable in one line, each
tab live, webview never fails silently, TUI browsable per chat session.

## Findings (do not redo)

- Auth precedent: `/tui` `web_app` button (`scripts/bot-host.mjs:2522`);
  gateway HMAC `WebAppData`, `auth_date` 5m+60s skew, `__Host-tui_session`
  cookie + `?token=` fallback (`TUI_TG_AUTH_TRAIL.md:16-33`,
  `TG_Tui_Proposal1.md:17`). Accept BOTH sig shapes (pairs / pairsWithSig).
- Validation rules (outside sources, verified 2026-10-09): exclude `hash`
  AND `signature`, sort alpha, join `\n`, secret = `HMAC(WebAppData, token)`
  with token as message (not Login-Widget scheme), `compare_digest`,
  `auth_date` window enforced locally, swap for short-lived session at once.
  Refs: `https://core.telegram.org/bots/webapps`,
  `https://charliemorrison.dev/blog/telegram-mini-app-initdata-validation/`.
- Google-in-WebView is `disallowed_useragent` (SO 79228560/78612568, tdlib
  #681): OAuth must `openLink` to system browser; `tg://` redirect never
  returns — callback is `https://app…/oauth/callback`, re-enter via
  `startapp` deep-link.
- TUI truth: per-bot tmux (`VM-tui`, `VM-tui-vm2`), resolution
  `TUI_CHAT_ID > tui-open.json > ids[0]` (`scripts/mobile/tui-attach.sh:139-156`);
  lanes `tui-surface.mjs:32-36` (opencode shared / cline last-thread-only /
  gemini no-terminal). Two chats on one bot collide today
  (`TUI_TG_AUTH_TRAIL.md:508-509`).
- Web truth: same-origin proxy, static `/_assets/,/icons/,/sw.js` ungated,
  shell/API/SSE gated, Basic injected upstream
  (`scripts/tui-gateway.mjs:348-394`); phone failures are Basic-in-WebView +
  `localStorage` project list + tunnel churn (`scripts/bot-host.mjs:3531-3537`).
- Fleet live contract to preserve: SSE + 15s visible poll + `?refresh=1`,
  15m stale/offline/multi-claim (`specs/active/fleet-miniapp.md:138-147`,
  `src/miniapp/fleet.html:380-468`).

## Plan

### P0 — freeze (no code)

Record gateway URLs, `?bot=` set, `:8892/:8895/:8897` owners. Confirm
canonical `src/Health-tracker/src/miniapp/{bugs.tsx,fleet.html,review.html}`;
`fleet.html` missing in some worktrees — start from canonical only.

### P1 — auth + registry (new files only)

- New `src/miniapp/miniapp-registry.ts`: `MiniAppDef
  {id,title,icon,route,kind:native|tty|external,enabled,scopes,health}` for
  `bugs,fleet,review,tgtg,calendar,agenda,stays,tui,forge,web`. Shell burger +
  gateway allowlist + `commands.mjs` help derive from it. Add = 1 line,
  remove = `enabled:false`. (Name avoids `bots/registry.json` collision.)
- New `scripts/lib/tg-oauth.mjs`: extract `validateInitData` + htk
  issue/verify (`server_auth.ts:34-58` shape). Keep `__Host-tui_session`
  name/shape, extend binding to `(bot,chat,tab)`. Store htk in
  `SecureStorage`, not `localStorage` (Bot API 9.0).
- Done when: `tsc` 0, `assert-tui-gateway` green, old routes byte-identical.

### P2 — shell (new files + one vite entry)

- New `src/miniapp/app.tsx` + `app.html`; `vite.config.ts:32-36` gains `app`
  entry. Header `☰` drawer, `?bot=&tab=` routing, `ready/expand/
  disableVerticalSwipes` (`TUI_TG_AUTH_TRAIL.md:180-184`), `BackButton`.
  `tty→TtyFrame`, `external→openLink` (user tap only), never iframe.
- Done when: `tsc` 0, boundary test + `assert-shell-smoke` green.

### P3 — migrate, one PR per tab (verbatim adapters, no logic forks)

1. **bugs**: keep `useBugBoard` fingerprint poll (20-30s, visible-only);
   fix `BOOTSTRAP_BUGS` (`tui-gateway.mjs:402-449`) to stop re-sending raw
   `initData` after exchange. Gate: L1-L5 parity (`bug-board-miniapp.md:89-97`).
2. **fleet**: keep SSE + poll + refresh; add swipes-lock; close SSE hidden.
3. **review**: add missing SSE/poll; optimistic approve/comment + rollback;
   proof URLs keep token. Gate: `assert-review-miniapp`.
4. **tgtg**: port cards/palette (`STAYS_AGENDA_SCOUT.md:32-48`); 30s poll +
   refresh; image proxy with token; `credentials.json 600` server-side only.
5. **calendar/agenda/stays** (new, 3 entries, one Google bind):
   `GET /api/calendar|agenda|stays/state`, 60s cache; Male/Mixed filter
   server-side; `ValueScore=Price+Dist*0.8`; sort/filter as query params.
6. **tui**: per-chat tmux `tui-<bot>-<chatHash>` (`--max-clients 0`,
   `aggressive-resize on`, `status off`); drop `ids[0]` legacy-first fallback.
   New native browser tab from `sessions.json + cline-sessions.json +
   tui-open.json` (chat/surface/model/workspace/updatedAt/lease/pane); tap
   writes `tui-open.json` (`bot-host.mjs:3628-3640`) + opens `?bot=&chat=`.
   Enforce lane honesty: cline last-thread-only, gemini refused with
   `/tx` + `/model_free` pointer. Keep `/tui status|off|refresh`.
7. **forge**: native tab, same door, allowlist + audit log. 401 anonymous.
8. **web**: `kind:external`, `enabled:false` default. Pre-flight upstream
   `:4096`; down → honest offline card + `/tx on`; up → fresh 15-min
   `personalWebUiLink` (`bot-host.mjs:3648-3657`) via `openLink` +
   stale-tunnel warning (`:3560-3565`).

### P4 — single host

New Caddy `app.health-tracker.co.uk` → one gateway port; `/app/*` static +
`/api/*` + `/tty/*` + `/forge/*`. Bot buttons `web_app {url:
app…?bot=<id>&tab=<id>}` (mirrors `/tui` precedent). Old hosts 302 → new.
Needs: DNS A record + Caddy block (not yet existent — provision in P4).

### P5 — decommission

Delete old blocks + per-bot ttyd dupes only after live phone proof (both
opencode+cline lanes) + stale/forged/cross-bot negatives + yesterday-button
check (`TUI_IMPLEMENTATION.md:59-60`). Second person marks green
(`TG_Tui_Proposal1.md:65`).

## Test plan

```text
npx tsc --noEmit
node scripts/assert-tui-gateway.test.mjs
node scripts/assert-fleet-miniapp.test.mjs
node scripts/assert-review-miniapp.test.mjs
node scripts/journey-guard.mjs meta-miniapp   # once locked
(live, pre-COMPLETE) phone proof per P5 + per-tab health refusal cards
```

Never `npm test`. Docs-only changes run nothing.

## Blast radius

Allowed: YAML list above. Out of scope: food/biomarker pipelines,
endpoint unification (`bug-board-miniapp.md:40` — separate packet),
`App.tsx`/`LogChat.tsx`/`JobStore.ts`, table redesign. The one-line roadmap entry is in PR #647, which already owns `plan/ROADMAP.md`. Do not open a second edit of that file. Do not wait for that PR before creating the two P1 files.

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini
requested · A diff that touches a hub file under this P1 go.
