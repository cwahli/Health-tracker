# Domain Architecture & Production Endpoints

**Updated:** 2026-11-17

---

## 1. Primary Production Domain: `health-tracker.co.uk`

* **Apex Domain:** `health-tracker.co.uk`
* **WWW Domain:** `www.health-tracker.co.uk`
* **Registrar:** Cloudflare Registrar (owned directly by Chiwah).
* **Target Host:** `VM-0-6-ubuntu`, public IP `43.173.42.248`. It runs the
  dedicated deploy clone (`/home/ubuntu/deploy/Health-tracker`, unit
  `health-tracker.service`, Node `dist/server.cjs` on `:3000`) behind Caddy on
  `:80`, and publishes the whole domain fleet through a **Cloudflare Tunnel**
  (`cloudflared-id-vps`, tunnel `d9f81831-7d2b-4156-85ac-626f085d0cd3`, unit
  `cloudflared-id-vps.service`, config `/etc/cloudflared/config-id-vps.yml`).
  Ingress is `health-tracker.co.uk` + `*.health-tracker.co.uk` → `127.0.0.1:80`,
  so origin requests arrive from `127.0.0.1` and TLS terminates at the edge.
* **Outage 2026-11-17 (Cloudflare Error 1033), fixed.** The previous origin
  (`standar-c3r3a-1845`, `103.147.32.117`) went away around 11:22 UTC — SSH
  ports 22/20133 refused, and the provider re-assigned the IP to a shared
  "domain not connected" landing page. That box ran the only connector for
  `d9f81831`, so every hostname on it returned 530/1033 while DNS and the edge
  stayed healthy. The connector was re-established on `VM-0-6-ubuntu` (which
  already served the app and hosted `cloudflared-proto` /
  `cloudflared-studio-authority`) with 4 registered edge connections; no DNS
  record was changed. Detail: [INCIDENT_1033_20261117.md](./INCIDENT_1033_20261117.md).
* **Tunnel history (corrected 2026-11-16).** The tunnel named here before,
  `85b56df3-da06-4521-9b4d-d90c593e3846`, was **deleted 2026-11-12T06:45:35Z**;
  its unit (`cloudflared.service`) had no config file and had restarted 50k+
  times registering "Unauthorized: Tunnel not found". It is now stopped and
  disabled, and `ht-services-watchdog` watches `cloudflared-id-vps` instead.
  Two other stale units were retired the same day: `cloudflared-proto.service`
  on the app box (`~/.cloudflared/prod-config.yml` still named the deleted
  tunnel) and `~/.cloudflared/prod-config.yml` itself.
* **Retired tunnels (still down, still routed).** `746fb2e4` (`app`, `web`,
  `codebuddy`, `orca4`, `orca-v4`), `7fdb9cea` (`orca`), `3f01c7ae` (`colab`),
  `4406917c` (`figma`) and `3a03ac30` (`codebuddy` name) have zero connectors,
  so their hostnames answer 530. Restoring them is a separate decision from the
  apex; `dsh`, `mc`, `omb`, `tgtg`, `agenda`, `tui`, `web`, `app` all have a
  local Caddy block on `VM-0-6-ubuntu` and need a connector on a live tunnel.
* **TLS Certificate:** Cloudflare (edge). The origin Caddy serves plain HTTP on `:80`.
* **Access Logs:** `/var/log/caddy/health-tracker-couk-access.log` (JSON rolled log).

### Routes & Handlers
* `GET /` → Reverse proxy to Node/Express app `:3000`.
* `GET /api/status` → Health check returning runtime timestamp.
* `GET /photos/{key}` and `GET /api/r2/photos/{key}` → meal photo bytes from the
  private R2 bucket. Every R2 read is bounded by `R2_READ_TIMEOUT_MS` (5s
  default); a timed-out read answers **504 + `no-store`** rather than holding
  the request until Cloudflare's 524 (~125s).
* `POST /webhook/*` → Reverse proxy to deploy webhook `:9000` (auto-deploy on git push).
* `GET /privacy` & `GET /terms` → Static legal pages served from `/srv/www-legal/`.

---

## 2. Legacy Domain `health-tracking.duckdns.org` — RETIRED (2026-10-18)

* **Role:** none. The OVH host it pointed at (`51.254.217.163`, "vps-france") is
  retired: its Caddy stopped serving, and production was re-homed to the VM in
  §1. The bot/terminal subdomains below have no live origin and are superseded by
  the `*.health-tracker.co.uk` names.
* **Why Kept:** 
  1. The bot/terminal subdomain fleet:
     * `tui.health-tracking.duckdns.org` (Telegram PTY terminals `:8896`, `:8899`, `:8900`, `:18996`, etc.)
     * `web.health-tracking.duckdns.org` (OpenCode web UI `:8897`)
     * `omb.health-tracking.duckdns.org` (OpenMausBot `:8799`)
     * `tgtg.health-tracking.duckdns.org` (TooGoodToGo `:8892`)
     * **`mc.health-tracking.duckdns.org`** (MC Radar Mini App `:8080`) — no co.uk twin yet
     * **`agenda.health-tracking.duckdns.org`** (Agenda/Tax WebApp `:8895`) — no co.uk twin yet
     * *These last two have no `health-tracker.co.uk` twin and block duckdns retirement — plan: [MC_DOMAIN_CUTOVER.md](./MC_DOMAIN_CUTOVER.md), ledger rows 11–12 in [COUK_MIGRATION.md](./COUK_MIGRATION.md).*
  2. Fallback routing and internal agent scripts that default to DuckDNS.
* **Left (human):** delete the `health-tracking.duckdns.org` A record at the
  DuckDNS dashboard. Checked 2026-10-29: it still resolves to the dead OVH IP
  `51.254.217.163` and times out. This host has no DuckDNS token. `mc.` and
  `agenda.` answer on `health-tracker.co.uk` (agenda returns 401). `/privacy`
  and `/terms` return 200.

---

## 3. GitHub Deploy Webhook

* **Webhook ID:** `682068098`
* **Target URL:** `https://health-tracker.co.uk/webhook/deploy?secret=...`
* **Event:** `push`
* **Action:** Triggers `/scripts/deploy-prod.sh` on `VM-0-6-ubuntu` (via
  `/home/ubuntu/deploy.sh`), which `git reset --hard origin/main`, rebuilds, and
  restarts `health-tracker.service`. Verified end-to-end 2026-11-17 after the
  1033 recovery: a POST through the live edge logged `finished handling deploy`.

---

## 4. Authentication Allowlist

* **Google Sign-In (Firebase Auth):**
  * Firebase Project: `health-tracker-b04dd`
  * Authorized Domains: `health-tracker.co.uk`, `www.health-tracker.co.uk`, `health-tracking.duckdns.org`, `localhost`.
* **Email / Password:** Cloudflare D1 + Express backend (host-agnostic).
