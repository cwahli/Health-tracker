# Full migration to `health-tracker.co.uk` — plan + record

**Goal:** every public surface serves from `health-tracker.co.uk` (apex + `www` +
service subdomains) so the legacy `health-tracking.duckdns.org` host and its
subdomain fleet can be removed. Supersedes the `is-a.dev`-era dual-serve runbook
(PR #578, branch `agent/infra-health-tracker-domain`, never merged): the domain
is owned (Cloudflare Registrar), the apex is already live on the VPS, and this
doc covers what that plan left out — the TG bot buttons, the TUI/web gateway
hosts, and the retirement sequence.

**Status ledger (updated as steps land):**

| # | Step | State |
|---|---|---|
| 0 | Apex + www live on Caddy (`health-tracker.co.uk`, Let's Encrypt) | DONE (pre-existing) |
| 1 | GitHub push webhook → `https://health-tracker.co.uk/webhook/deploy` | DONE (pre-existing, hook `682068098`) |
| 2 | Repo defaults point at co.uk (QA, screenshots, skills, tunnels, gateway defaults) | DONE — branch `agent/domain-couk-full` |
| 3 | DNS: `tui`/`web`/`omb`/`tgtg` A records → `51.254.217.163` (DNS-only) | HUMAN (Cloudflare dashboard) |
| 4 | Caddy blocks for the four co.uk subdomains | STAGED (`~/caddy-couk-subdomains.snippet`), activates after step 3 |
| 5 | Bot envs: `TUI_GATEWAY_URL` → `https://tui.health-tracker.co.uk` (vm, vm2, vm3) + `OPENCODE_WEB_HOST` → `web.health-tracker.co.uk` | after step 3, then restart bot/gateway services |
| 6 | Live verification (site, TUI proof script, bot buttons, sub-services) | after step 5 |
| 7 | Console checks: Supabase redirect allowlist, Google OAuth consent links, Health Connect callback | HUMAN (dashboards) |
| 8 | Retirement: remove duckdns Caddy blocks after access logs go quiet | after step 6 + soak |

## 1. Target layout

| Host | Serves | Backend |
|---|---|---|
| `health-tracker.co.uk`, `www.health-tracker.co.uk` | web app + `/webhook/*` + `/privacy` + `/terms` | `:3000` / `:9000` / `/srv/www-legal` (live) |
| `tui.health-tracker.co.uk` | TUI gateway (Telegram-initData-gated ttyd farm) | `:8897` + `:8896,8899–8904,18996` (moved) |
| `web.health-tracker.co.uk` | OpenCode web UI for the TG Mini App (`/web` button) | `:8897` (moved) |
| `omb.health-tracker.co.uk` | OpenMausBot | `:8799` (moved) |
| `tgtg.health-tracker.co.uk` | TooGoodToGo bot | `:8892` (moved) |

## 2. Why the code changes are safe before DNS exists

- Bots read `TUI_GATEWAY_URL` from their env files, which still pin the duckdns
  host until step 5 — the new code defaults are inert until then.
- `readWebUiUrl` returns `''` for anything that is not a bare `https://` origin,
  so callers hide the button instead of handing out a dead one.
- The app runtime is host-agnostic (relative assets, no cookies, request-derived
  origins — verified in the PR #578 audit).

## 3. TG bot move (no Telegram-side reconfiguration)

Bots long-poll; Telegram never calls us inbound, so there is no webhook URL to
re-register. The only domain the bots hand out is in `web_app` buttons:

- `/tui` → `${TUI_GATEWAY_URL}/?bot=<id>` (env, step 5)
- `/web` → personal link off `readWebUiUrl` default (code, step 2) or
  `OPENCODE_WEB_URL` env override
- bug board + forge buttons → same gateway host as `/tui`

After step 5, `/tui` in the vm bot must open `tui.health-tracker.co.uk`.

## 4. TUI + web gateway move

1. Add the four Caddy blocks (copy the duckdns blocks verbatim, new names).
2. `caddy validate`, then `systemctl reload caddy` (never restart).
3. Set `OPENCODE_WEB_HOST=web.health-tracker.co.uk` for `tui-gateway.service`
   (currently unset → old default) and reload the unit.
4. Run `TUI_BASE=https://tui.health-tracker.co.uk bash scripts/assert-tui-gateway-live.sh`.

## 5. Retirement gate (duckdns blocks removed only when ALL hold)

1. `tui`/`web`/`omb`/`tgtg` answer on co.uk (steps 4–6 green).
2. `/var/log/caddy/duckdns-access.log` shows no traffic except the deploy
   webhook (already repointed — expect zero) and known devices, over a soak.
3. Phone Termius/SSH profiles switched to `health-tracker.co.uk` (SSH bypasses
   Caddy, but the name must resolve — it does — and the old DNS entry is what
   finally gets deleted at the DuckDNS dashboard, a human step).
4. Rollback at any point: `sudo cp /etc/caddy/Caddyfile.bak-<date> /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

## 6. Human console steps (cannot be done from the VPS)

1. **Cloudflare DNS** — A records `tui`, `web`, `omb`, `tgtg` → `51.254.217.163`,
   proxy OFF (DNS-only, same as the apex).
2. **Supabase → Authentication → URL Configuration** — confirm
   `https://health-tracker.co.uk/**` is allowlisted (sign-in uses
   `redirectTo: window.location.origin`).
3. **Google OAuth consent screen** — links already point at `/privacy` (served on
   co.uk since step 0); no change, verify only.
4. **Firebase Authorized Domains** (`health-tracker-b04dd`) — co.uk apex + www
   already added; add the four subdomains only if a Google-popup login is ever
   served from them (today: no).
5. **DuckDNS dashboard** — final deletion of the old hostname, after step 5's
   gate stays green for a few days.
