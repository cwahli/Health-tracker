# `mc.` host cutover + the two things blocking duckdns retirement

**Date:** 2026-10-09 · **Scope:** `mc.health-tracking.duckdns.org` → `mc.health-tracker.co.uk`
(the MC Radar Mini App on this VPS), plus the retirement blockers it exposes.
**Status:** CUTOVER COMPLETE & VERIFIED LIVE (2026-10-09) — Cloudflare DNS-only A record active, Caddy block with access log serving HTTPS, mc-radar.service loopback bound to 127.0.0.1, app.py path traversal contained, and duckdns block removed.
**Owner:** whoever is on **V-17b** (Domain-01). Written by a second agent that was asked
"what still needs doing in `~/src/MC`?" and found this on the way.

---

## 1. What exists today

| Piece | Value |
|---|---|
| Public host | `https://mc.health-tracking.duckdns.org` |
| Caddy | `/etc/caddy/Caddyfile:315` → `reverse_proxy 127.0.0.1:8080` |
| Backend | `mc-radar.service` (user unit) → `.venv/bin/python app.py --port 8080 --host 0.0.0.0` |
| Repo | `github.com/cwahli/MC` (private), checkout `/home/ubuntu/src/MC` |
| DNS | `mc.health-tracking.duckdns.org` → `51.254.217.163` |

**The MC host is referenced nowhere else on the box.** A repo-wide grep for
`mc.health-tracking.duckdns.org` across `bot-host/`, `src/MC/`, `.config/`, `.hermes/`,
`.agents/`, `.claude/` returns **zero hits outside the Caddyfile itself**. No bot env, no
webhook, no test origin, no `README` link (MC's README says `localhost` only), and the
`mc` Telegram bot hands out no URL. **Unlike `tui`/`web`/`omb`/`tgtg`, there is nothing to
repoint in code — the move is DNS + Caddy.**

Verify it yourself:

```bash
grep -rn "mc\.health-tracking\.duckdns\.org" bot-host/ src/MC/ .config/ .hermes/ .agents/ .claude/ 2>/dev/null
```

## 2. Target

`https://mc.health-tracker.co.uk`, same DNS-only A record as the apex.

**The record does not exist yet.** Verified 2026-10-09: `health-tracker.co.uk`,
`tui.`, `web.`, `omb.` all resolve to `51.254.217.163`; **`mc.health-tracker.co.uk`
does not resolve at all** (no A record — Cloudflare has no wildcard).

## 3. The steps

1. **Human / Cloudflare DNS** — A record `mc` → `51.254.217.163`, proxy **OFF**
   (DNS-only, identical to the apex). Blocks everything below.
2. **Caddy** — add the twin block, *with a log* (see §4.1, the log is the point):

   ```
   mc.health-tracker.co.uk {
       log {
           output file /var/log/caddy/health-tracker-couk-access.log {
               roll_size 10mb
               roll_keep 5
           }
       }
       reverse_proxy 127.0.0.1:8080
   }
   ```

   Then, in this order: `sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)`
   → `caddy validate --config /etc/caddy/Caddyfile`
   → `sudo systemctl reload caddy` (**reload, never restart** — `COUK_MIGRATION.md` §4.3).
3. **Verify** — `curl -sI https://mc.health-tracker.co.uk/` → 200 and
   `curl -s https://mc.health-tracker.co.uk/api/users` → JSON with `"status": "ok"`.
   Also re-run the traversal probe of §5; it should be 404 once that fix lands.
4. **Soak, then retire** — keep the duckdns `mc` block during soak. Remove it only when
   §6's gate holds, then delete the hostname at the **DuckDNS dashboard** (human,
   `COUK_MIGRATION.md` §6.5). Rollback at any point: restore the dated backup + reload.

## 4. Two blockers the current retirement plan does not cover

### 4.1 `mc.` and `agenda.` were never added to the migration

`COUK_MIGRATION.md`'s target-layout table (§1) lists exactly four subdomains —
`tui`, `web`, `omb`, `tgtg`. Two more duckdns-only hosts exist and are **not in it**:

| Host | Backend | co.uk twin |
|---|---|---|
| `mc.health-tracking.duckdns.org` | `:8080` — `mc-radar.service` (MC Radar) | ❌ none |
| `agenda.health-tracking.duckdns.org` | `:8895` — `agenda-webapp.service` (Tax/Agenda WebApp) | ❌ none |

Both are in the Caddyfile (`:315` and `:311`) and both resolve only on duckdns.
**duckdns cannot retire while either is present.** This doc covers `mc.`; `agenda.`
needs the same three moves (DNS record + Caddy twin + soak) and is called out in
`COUK_MIGRATION.md` so it is not discovered on the day of retirement.

### 4.2 The §5 soak gate is blind to both of them

`COUK_MIGRATION.md` §5.2 gates retirement on "`/var/log/caddy/duckdns-access.log` shows
no traffic". **Only the apex block has a `log` directive.** Measured 2026-10-09: the log
holds 910 lines, **100% of them `host = health-tracking.duckdns.org`** — the `mc.` and
`agenda.` blocks do not log, so their traffic can never appear there.

The gate therefore proves nothing about them. Either (a) add a `log` block to every
remaining duckdns site (recommended — this plan's `mc.` block includes one), or (b) drop
that clause and gate on something that actually observes the host. Do not retire on a
quiet log that never could have been noisy.

```bash
# what the retirement gate can and cannot see
python3 - <<'EOF'
import json, collections
c = collections.Counter()
for line in open('/var/log/caddy/duckdns-access.log', errors='replace'):
    try: c[json.loads(line)['request']['host']] += 1
    except Exception: pass
print(c)   # today: only the apex
EOF
grep -n "log {" /etc/caddy/Caddyfile   # today: apex + co.uk apex only
```

## 5. Fix before the new host goes live (security)

MC Radar is unauthenticated and currently exposes secrets through the public URL. A
confirmed path traversal in `app.py`'s `do_GET` `/data/` branch
(`BASE_DIR / path.lstrip("/")`, no `resolve()` containment):

```bash
# as measured 2026-10-09 against the live host — all returned HTTP 200
curl -s --path-as-is "https://mc.health-tracking.duckdns.org/data/../../../../../etc/passwd"   # /etc/passwd
curl -s --path-as-is "https://mc.health-tracking.duckdns.org/data/../.env"                     # Telegram token, Gemini key, Discord webhook
curl -s --path-as-is "https://mc.health-tracking.duckdns.org/data/../data/session.json"        # MiChat SKey session
```

Fix, in `app.py` where the `/data/` branch builds the path:

```python
file_path = (BASE_DIR / path.lstrip("/")).resolve()
if not file_path.is_relative_to(BASE_DIR.resolve()):
    self.send_error(404, "File not found"); return
if file_path.is_file():
    ...
```

Two related items in the same pass:

- **No auth anywhere in `app.py`** — anyone with the URL can read every profile and fire
  `POST /api/scan` (burns the session and rate limit). Minimum for a public hostname:
  Caddy `basic_auth` on the block, or keep it loopback/Tailscale-only.
- **`mc-radar.service` binds `--host 0.0.0.0`** — once Caddy fronts it there is no reason
  to listen on all interfaces (only `ufw` keeps it off the internet today). Change
  `ExecStart` to `--host 127.0.0.1`, then
  `systemctl --user daemon-reload && systemctl --user restart mc-radar`.

## 6. Definition of done

- [x] Cloudflare A `mc` → `51.254.217.163`, DNS-only (verified live 2026-10-09)
- [x] `mc.health-tracker.co.uk` block in Caddyfile **with a `log`**, validated, reloaded (active, TLS cert provisioned)
- [x] `/` and `/api/users` answer 200 on the new host; traversal probe answers 404 (verified live 2026-10-09)
- [x] `mc-radar.service` bound to `127.0.0.1`; unit restarted and still serving (active PID on 127.0.0.1:8080)
- [x] DuckDNS `mc` block removed from Caddyfile (retired 2026-10-09)
- [ ] Same three moves done for `agenda.` (its own plan, same shape)
- [ ] DuckDNS hostname deleted at the dashboard (human)

## 7. Coordination

`/etc/caddy/Caddyfile` is root-owned and **not under version control** — there is no git
history to recover from, and two agents editing it concurrently will clobber each other.
Whoever works on this:

1. `grep -n "health-tracker.co.uk" /etc/caddy/Caddyfile` **first** to see what already landed.
2. Take a dated backup before every edit; `caddy validate` before every reload.
3. `reload`, never `restart`.
4. One writer at a time — say so on the V-17b row / `AI_HANDOVER.md` before editing.

The `/home/ubuntu/src/MC` repo has its own separate backlog (dirty generated report in
git, no scheduled scans, stale README) — that is tracked in that repo, not here. Nothing
in it needs to change for this domain move apart from §5.
