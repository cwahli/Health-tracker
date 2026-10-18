# Domain Architecture & Production Endpoints

**Updated:** 2026-10-18

---

## 1. Primary Production Domain: `health-tracker.co.uk`

* **Apex Domain:** `health-tracker.co.uk`
* **WWW Domain:** `www.health-tracker.co.uk`
* **Registrar:** Cloudflare Registrar (owned directly by Chiwah).
* **Target Host:** the re-homed production VM (`standar-c3r3a-1845`, public IP
  `103.147.32.117`). No OVH host serves the site any more. It is published
  through a **Cloudflare Tunnel** (`cloudflared`, tunnel
  `85b56df3-da06-4521-9b4d-d90c593e3846`, ingress `health-tracker.co.uk` +
  `*.health-tracker.co.uk` → `127.0.0.1:80`), so origin requests arrive from
  `127.0.0.1` and TLS terminates at the Cloudflare edge.
* **TLS Certificate:** Cloudflare (edge). The origin Caddy serves plain HTTP on `:80`.
* **Access Logs:** `/var/log/caddy/health-tracker-couk-access.log` (JSON rolled log).

### Routes & Handlers
* `GET /` → Reverse proxy to Node/Express app `:3000`.
* `GET /api/status` → Health check returning runtime timestamp.
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
  DuckDNS dashboard; it still resolves to the dead OVH IP `51.254.217.163`.

---

## 3. GitHub Deploy Webhook

* **Webhook ID:** `682068098`
* **Target URL:** `https://health-tracker.co.uk/webhook/deploy?secret=...`
* **Event:** `push`
* **Action:** Triggers `/scripts/deploy-prod.sh` on the VPS. Verified with HTTP 200 delivery.

---

## 4. Authentication Allowlist

* **Google Sign-In (Firebase Auth):**
  * Firebase Project: `health-tracker-b04dd`
  * Authorized Domains: `health-tracker.co.uk`, `www.health-tracker.co.uk`, `health-tracking.duckdns.org`, `localhost`.
* **Email / Password:** Cloudflare D1 + Express backend (host-agnostic).
