# Dual-serve runbook — new URL alongside the old, then retire on evidence

**Goal:** `health-tracker.is-a.dev` and `health-tracking.duckdns.org` serve the same app
simultaneously, then the old one is removed **only when measured traffic says it is safe**.

**Principle: the old block never moves.** The new site is added; nothing about the old one
changes. Rollback is therefore deleting one block, not restoring a backup.

---

## Phase A — the app layer already does this (verified, no changes)

Both hostnames were driven through the running process on the VPS, with the `Host` header
swapped and no DNS or Caddy involvement:

| Probe | `health-tracking.duckdns.org` | `health-tracker.is-a.dev` |
|---|---|---|
| `GET /` | HTTP 200 | HTTP 200 |
| `GET /api/status` | `{"startTime":1791209198934}` | `{"startTime":1791209198934}` |

Why nothing needs changing:

- **No cookies at all** — no `Set-Cookie`/`res.cookie` in `server*.ts` and no
  `document.cookie` in `src/`, so there is no cookie domain to pin. Sessions live in
  **localStorage**: `src/utils/supabaseClient.ts` is the only `createClient` call site and
  sets no `storageKey`/`persistSession`/`auth:` override, so Supabase JS defaults apply.
  localStorage is per-origin, so a user signed in on the old URL signs in **once** on the
  new one — an expectation to set, not a breakage. `detectSessionInUrl` defaults to on, so
  the OAuth return works on either origin *provided that origin is in the Supabase
  redirect allowlist* (see the manual list below).
- **No absolute URLs in the served HTML** — a grep of the response for `https?://…`
  returns nothing; every asset and API path is relative.
- **No service worker / `manifest.json`** — no per-origin cache or install state to split.
- **Request-derived URLs** — `src/utils/bugSnapshot.ts` ("Never hardcode a host") and the
  Health Connect redirect both derive from the request `Host`.

## Phase B — light up the second URL (gated on DNS, root required)

**Gate:** `dig +short health-tracker.is-a.dev @1.1.1.1` must print `51.254.217.163`.
Until then it prints `104.18.x.x` from the `*.is-a.dev` wildcard, and Caddy's ACME
challenge would hit Cloudflare instead of the VPS.

```bash
ssh ubuntu@51.254.217.163
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)          # rollback point
sudo tee -a /etc/caddy/Caddyfile < ~/caddy-health-tracker-is-a-dev.snippet > /dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile      # must say Valid configuration
sudo systemctl reload caddy
```

The snippet is already staged and **already validated** as part of the merged config
(live + snippet = 190 lines, 6 sites → `Valid configuration`). `reload`, not `restart`:
the other four sites stay up.

**Verify with** `bash ~/isadev/go-live-check.sh` — it now enforces the dual-serve
invariant in both directions: the new host must answer, **and the old host must still
answer** (a regression there is a failure, not a warning).

## Phase C — measure before you remove anything (do this now, it needs no DNS)

Caddy currently writes **no access logs** — `/var/log/caddy` is empty and there is no `log`
directive in the Caddyfile, so today's duckdns usage is invisible and the retirement date
would be a guess. Add logging to the old site block; the patched config is already proven
(`Valid configuration`, exit 0) and `/var/log/caddy` is owned by `caddy:caddy`, so the
service can write it.

```bash
ssh ubuntu@51.254.217.163
# regenerate from the CURRENT live config, validate, then swap atomically
awk 'NR==1{print;print "\tlog {";print "\t\toutput file /var/log/caddy/duckdns-access.log {";print "\t\t\troll_size 10mb";print "\t\t\troll_keep 5";print "\t\t}";print "\t}";next}{print}' \
  /etc/caddy/Caddyfile | sudo tee /etc/caddy/Caddyfile.new >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile \
  && sudo mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile \
  && sudo systemctl reload caddy
```

A pre-generated, already-validated copy sits at `~/Caddyfile.with-logging` for reference —
regenerate rather than reuse it if the live file has changed since.

**Summaries** (pipelines tested against real Caddy JSON log shape on the VPS; `jq 1.8.1`):

```bash
# who still uses the old host — this is the retirement signal
jq -r '.request.host' /var/log/caddy/duckdns-access.log | sort | uniq -c | sort -rn

# which routes on the old host
jq -r '.request.uri'  /var/log/caddy/duckdns-access.log | sort | uniq -c | sort -rn | head -20

# which callers (expect: the GitHub webhook's IP range + your own devices)
jq -r '.request.remote_ip' /var/log/caddy/duckdns-access.log | sort | uniq -c | sort -rn | head -20
```

Sanity-check the field path on the first real line before trusting the counts:
`head -1 /var/log/caddy/duckdns-access.log | jq .request.host`

## Phase D — migrate the consumers in this order

Migration order is deliberate: lowest-blast-radius first, the deploy path last.

| Order | Consumer | Where | Change |
|---|---|---|---|
| 1 | Agent skills / instructions | `scripts/skills/common/telegram-testing/SKILL.md:76,81,100,120`, `telegram-matrix/SKILL.md:33` | point at the new host |
| 2 | Agent memory seed + hermes env | `scripts/fixtures/hermes-profiles/bug_ticket/memories/MEMORY.md:1`, `scripts/setup-hermes-global-soul.sh:39,59,69,77,193` | re-seed after editing |
| 3 | QA / screenshot defaults | `qa-runner.mjs:46`, `qa-auto-loop.mjs:183`, `phone-screenshot.mjs:45` | change the default, or set `PLAYWRIGHT_TEST_BASE_URL` |
| 4 | Gateway defaults | `bot-host.mjs:1424`, `tui-gateway.mjs:363` | these point at `web.` — see Out of scope |
| 5 | SSH tunnels | `mobile/start-vm-relay-tunnel.sh:16`, `mobile/start-phone-shot-tunnel.sh:23` | new host (they are also office-blocked today) |
| 6 | Your own bookmarks / devices | browsers, phone | manually |
| 7 | **GitHub push webhook last** | repo settings → `…/webhook/deploy` | repoint only at the end; it is the deploy path |

## Phase E — retire the old URL

Remove the duckdns site block only when **all** hold:

1. The log shows **no traffic to the old host** except the webhook and your own devices.
2. The webhook has already been repointed (step 7) or you accept losing auto-deploy — do not
   remove the old block while the webhook still targets it.
3. `bash ~/isadev/go-live-check.sh` is green, and has stayed green for a few days.
4. You have decided about the duckdns subdomains in "Out of scope" below.

**Rollback at any phase:** `sudo cp /etc/caddy/Caddyfile.bak-<date> /etc/caddy/Caddyfile && sudo systemctl reload caddy`

## Out of scope — these stay on duckdns

`omb.`, `web.`, `tui.`, `tgtg.` are **separate services on separate duckdns names**
(Caddy blocks at lines 35/50/56/155, ports 9000/8891/8892). They are not part of this
migration, and "removing the old URL" does not include them: is-a.dev issues you one name,
so each would need its own registration with its own reachability story.

## Manual, cannot be automated from here

- **Supabase → Authentication → URL Configuration**: allow **both** origins while
  dual-serving — `https://health-tracker.is-a.dev/**` **and** the existing duckdns entry.
  Sign-in uses `redirectTo: window.location.origin`, so whichever origin the user starts on
  must be allowlisted.
- **Health Connect** (if used): also add
  `https://health-tracker.is-a.dev/health-connect/callback` in Google Cloud Console.
- **Office Wi-Fi test** on the new host — the reason this whole migration exists.
