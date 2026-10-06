# duckdns assumptions audit — what breaks when `health-tracker.is-a.dev` goes live

**Date:** 2026-10-05 · **Scope:** the Mac checkout `~/src/Health-tracker`, the OVH VPS
`51.254.217.163`, GitHub repo config, and the Mac's own cron/agents.
**Method:** repo-wide grep (excluding `node_modules`/`.git`), read-only `ssh` inspection,
`gh api` for webhooks. No root, no writes to the VPS, nothing restarted.

---

## Verdict

**Adding the new hostname breaks nothing.** The serving path is already host-agnostic.

The risk is the opposite direction: **if duckdns is ever retired**, the 12 rows in §2 —
9 operational entry points plus 3 agent-facing files — silently point at a dead host. They
break quietly, not loudly: an agent told to "curl the live site" keeps curling the blocked
name.

---

## 1. Host-agnostic — verified, no action needed

| Surface | Evidence | Why it is safe |
|---|---|---|
| App runtime | `server.ts:1307` `Access-Control-Allow-Origin: *`; routes use relative paths | No origin allowlist to extend |
| Internal calls | systemd unit sets `INTERNAL_BASE_URL=http://127.0.0.1:3000` | Loopback, not a public name |
| VPS `.env` | 15 keys, **zero** `duckdns` matches | Nothing to re-point |
| Deploy script | `scripts/deploy-prod.sh` — no host string, only `systemctl restart health-tracker` | Deploy is host-independent |
| Legal pages | `/srv/www-legal/{privacy,terms}.html` — **0** host references | No legal text change required |
| Cron / timers / units | VPS crontab + `/etc/systemd/system` — **0** `duckdns` matches | All jobs use local paths |
| Bug-snapshot URLs | `src/utils/bugSnapshot.ts:152` — comment: *"Never hardcode a host"* | Derives from the request |
| GitHub push webhook | → `https://health-tracking.duckdns.org/webhook/deploy` | **Stays valid** because the duckdns Caddy block stays |

**Don't be fooled by the wildcard.** `health-tracker.is-a.dev` *already* resolves today
(`104.18.4.103 / 104.18.5.103`) — as does any unclaimed name, e.g.
`zzzz-not-a-real-name-9931.is-a.dev`. It serves a Let's Encrypt cert `CN=*.is-a.dev`
(valid to 2026-11-16) and answers **HTTP 302**. "It resolves and has a valid cert" is
therefore *not* evidence of go-live; only `51.254.217.163` is.

## 2. Hardcoded duckdns — breaks only if duckdns is retired

| File:line | What it is | Failure mode if duckdns dies |
|---|---|---|
| `scripts/qa-runner.mjs:46` | default QA base URL | QA runs hit a dead host |
| `scripts/qa-auto-loop.mjs:183` | default test URL in the loop | loop fails / reports red |
| `scripts/phone-screenshot.mjs:45` | default screenshot target | phone-shot capture fails |
| `scripts/assert-tui-gateway-live.sh:12,165` | `TUI_BASE` default + prod `/health` probe | TUI gateway assertion fails |
| `scripts/bot-host.mjs:1424` | `OPENCODE_WEB_URL` default | bot host can't reach the web UI |
| `scripts/tui-gateway.mjs:363` | `OPENCODE_WEB_HOST` default | host-matching gate misroutes |
| `scripts/setup-hermes-global-soul.sh:193` | writes `PLAYWRIGHT_TEST_BASE_URL` into `~/.hermes/.env` | re-seeds the dead host into agent config |
| `scripts/mobile/start-vm-relay-tunnel.sh:16` | `ssh ubuntu@health-tracking.duckdns.org` | **relay tunnel cannot connect** |
| `scripts/mobile/start-phone-shot-tunnel.sh:23` | `SHOT_SSH_HOST` default | screenshot tunnel cannot connect |
| `scripts/skills/common/telegram-testing/SKILL.md:76,81,100,120` | agent instructions | future agents curl the blocked name |
| `scripts/skills/common/telegram-matrix/SKILL.md:33` | agent instruction | same |
| `scripts/fixtures/hermes-profiles/bug_ticket/memories/MEMORY.md:1` | seeded agent memory | new agents inherit the stale host |

Note the two SSH tunnels: they depend on the **hostname**, so they also inherit the
office-network block — a fleet operator on a banning network cannot open them.

## 3. Fixtures and stale copies — safe to ignore

- `src/utils/bugSnapshot.test.ts:225,227` — asserts the host is *preserved from input*; the
  production code is deliberately host-agnostic. No change needed.
- `tests/memory-stores.test.ts`, `scripts/assert-memory-stores.mjs:85` — fixture strings.
- `tmp/hg6/**`, `specs/checkpoints/**` — stale snapshot duplicates of docs.
- Docs only (no runtime effect): `PRIVACY.md`, `TERMS.md`, `plan/*`, `AI_HANDOVER.md`,
  `bots/soul.default.md`, `tasks/AGENT_HANDOFF.md`, `qa-evidence/*.json`.
- 71 files match `duckdns`; ~40 are `tmp/hg6/` duplicates or docs.

## 4. The duckdns subdomain fleet stays put

Caddy site blocks (all duckdns, all unchanged by this work):

```
1:  health-tracking.duckdns.org      ← the app; new is-a.dev block joins it
35: omb.health-tracking.duckdns.org
50: web.health-tracking.duckdns.org
56: tui.health-tracking.duckdns.org
155: tgtg.health-tracking.duckdns.org
```

Keeping the old block is deliberate: it preserves the deploy webhook, the fallback route,
and every hardcoded default in §2.

## 5. Out-of-scope findings (observed while auditing, not part of the task)

1. **Deploy webhook secret travels in the query string** of the hook URL
   (`…/webhook/deploy?secret=…`). Query strings land in proxy/access logs; a header-based
   secret would not. The value is deliberately not reproduced here.
2. **`webhook` (pid 1061) listens on `*:9000`** — publicly reachable, bypassing Caddy's
   TLS and host routing entirely.
3. **Node listens on `0.0.0.0:3000`** (`server.ts:3738`), so the app is also reachable as
   `http://51.254.217.163:3000` — plaintext, no HSTS. That path may well dodge
   hostname-based blocking, but it also exposes every response unencrypted; treat it as a
   security item, not a workaround.
4. A service is bound to a **Tailscale address** (`100.118.148.32:41510`), so a transport
   overlay is already part of this fleet — relevant background for the ranking in
   `BLOCK_RANKING.md`, not something to change here.

## 6. Minimal diff, only if duckdns is ever retired

1. Change the 9 defaults in §2 (or set `PLAYWRIGHT_TEST_BASE_URL` / `OPENCODE_WEB_URL` /
   `TUI_BASE` / `SHOT_SSH_HOST` in the environment instead of editing code).
2. Re-run `scripts/setup-hermes-global-soul.sh` so `~/.hermes/.env` and agent memories are
   re-seeded with the new host.
3. Update the 3 agent-facing files in §2 (2 skill docs + the seeded `MEMORY.md` fixture),
   or agents will keep curling the dead name.
4. Decide the webhook: leave it on duckdns (zero work) or repoint it — and if you repoint,
   move the secret out of the query string while you are there.
