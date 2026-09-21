# VPS-2 mobile → VM → live site

**Status:** LIVE & CUTOVER (V-0 through V-16 COMPLETE). Phase 6 (V-19…V-26) COMPLETE. **Open work: V-27** (phone terminal survives a Wi-Fi change).  
**Replaces:** [plan/GCP_FREE_TIER_MIGRATION.md](./GCP_FREE_TIER_MIGRATION.md) (Cloud Run `min-instances=0`).  
**Execute index:** [ROADMAP.md](./ROADMAP.md) **Track V / R-13.1**. Next mobile ID is **V-27** below. Do not redo V-0…V-26.  
**Current Phase:** Phase 7 (V-27 OPEN). Phase 5 (V-17 Render deletion) stays on its own soak clock and is not this task.  

---

## Destination

Phone instructs one coding agent on an always-on **OVH VPS-2**. That agent edits, builds, and commits Health-tracker (and later other repos). When that loop is boring and reliable, the **same VM** becomes the live website (`node dist/server.cjs` behind Caddy). Then Render is deleted.

```text
Phone ──instruct──► VPS-2 (one CLI: grok | agy | opencode)
                      │
                      ├─ git push → GitHub (source of truth)
                      ├─ Phase 1: no public site; Render still live
                      └─ Phase 2: Caddy → node dist/server.cjs (always on)
                                      │
                                      ├─ Gemini (meal vision)
                                      ├─ Cloudflare R2 (photos) + D1 (SQL; Track D)
                                      └─ Firebase (login)
```

The LLM stays at xAI / Google. The VM does files, git, npm, and the Node server. No GPU.

---

## Hardware (locked)

| | |
|---|---|
| **Buy** | OVH **VPS-2 2027**, monthly (not 24-month) |
| **Size** | 4 vCPU / **8 GB** / 75 GB NVMe |
| **OS** | Ubuntu **24.04** LTS (not 26.04) |
| **Arch** | x86_64 |
| **Price** | about **$8.50 / month** (region list price) |
| **Region** | **Human pick at V-0.** Near the phone, not a default Singapore checkbox. APAC (SG) = 1 TB/month then 10 Mbps. EU = unmetered. UK files on the Mac argue EU; Indonesian use argues SG. |

VPS-1 (4 GB / 40 GB) is not this plan. Cloud Run free (`min-instances=0`) is not this plan — it still sleeps. Cloud Run always-on + a second box costs more than VPS-2.

**RAM budget (one agent + later the site):** OS+Caddy+Tailscale+idle Node ~1–1.5 GB; one CLI ~0.3–0.8 GB; `npm`/`vite` spike ~1 GB. 8 GB is enough if Playwright browsers stay off the box.

**Disk:** clone + `npm ci` on the VM. Do not scp Mac `node_modules` (560 MB, Darwin binaries). Site visitors still only get `dist/` (~5 MB). `lucide-react` 43 MB on disk is npm’s full icon pack; the browser already tree-shakes to ~50 KB.

---

## Phone paths (what each one is for)

Use **two** paths, not six. Everything else is backup.

| Path | Role | When |
|---|---|---|
| **A. Telegram → Hermes** | **Instruct.** Type a task on the phone; Hermes on the VM runs `grok` / `agy` / `opencode` and streams tool progress back into the chat. This is the “grok bot” loop: you see work happen in the message thread. Mac already has Hermes with a `telegram` toolset — **reinstall a slim gateway on the VM**, do not rsync `~/.hermes` (it is huge). | Daily |
| **B. Termius → Mosh → tmux `health`** | **Watch and steer.** Attach to the live TUI (`grok`, Agy, OpenCode) in tmux session `health`. The session lives on the VM, so a phone drop does not kill the turn. Mosh talks to the public hostname and reconnects after Wi-Fi ↔ cellular. **V-27 is this path. It is not built yet.** Until V-27 is done, Termius still comes in over Tailscale SSH and dies on a network change. | When you need the real TUI, a stuck job, or to type into the CLI |
| C. Hermes **web UI** on Tailscale only | Browser view of Hermes (sessions, progress) without a desktop. Bind `127.0.0.1` + Tailscale MagicDNS. Never public. | Optional after A works |
| D. Termux (Android) | SSH/mosh client, or a local shell that ssh’s. Not a second agent runtime. | If the phone is Android |
| E. Screenshare / remote desktop (RustDesk, VNC, XFCE) | Full graphical desktop. **Out of scope on 8 GB.** Skip unless A–C fail. | Do not start |
| F. Public ttyd / code-server / Funnel | Web IDE on the open internet. **No.** | Do not start |

**Watching the VM in real time**

- Chat stream (A) = what Hermes/Telegram already does: tool lines and the final answer. Good enough for “build this, tell me when green.”
- Live TUI (B) = `tmux new -A -s health` over Mosh, after V-27. You see the same pane you left, including a turn that was still running. `grok --resume` only reloads the transcript after the process has already died. It does not finish a killed turn.
- Do not install a Linux desktop to screenshare it.

**Messaging rules**

- One in-flight coding CLI. Telegram may *queue* a second message; it must not start a second `grok` while the first still holds the repo.
- V-1 locked public :22 shut and Tailscale as the only SSH door. **V-27 supersedes that for the phone terminal**, and only after password SSH is off. Tailscale stays installed for other machines. Do not add a second WireGuard VPN on the phone.
- Secrets stay in `/home/.../.env` on the VM and in Telegram bot token files with `0600`. Never git. Never print a bot token or an SSH private key.

---

## Phases and milestones

Human does V-0 and every login/DNS/Firebase click. An agent on the Mac may draft unit files **after** V-0 exists and the human pastes the Tailscale name. Agents must not buy, pay, or open the OVH console.

### Phase 0 — Own the box

| ID | What | Done when | Do not |
|---|---|---|---|
| **V-0** | Order OVH VPS-2 monthly, Ubuntu 24.04, region chosen, SSH key in the order, optional +backup. Record IPv4 + panel URL. | You can SSH as a sudo user from the Mac with a key. | Ubuntu 26.04; VPS-1; 24-month; password login |

### Phase 1 — Development environment (no public site)

Render stays the live website. The VM is only a build machine.

| ID | What | Done when | Do not |
|---|---|---|---|
| **V-1** | Harden: `ufw`, unattended-upgrades, disable password SSH, Tailscale, MagicDNS, sudo user (not daily-root). | `tailscale status` from phone and Mac shows the VM. Public nmap :22 closed (Tailscale SSH or :22 on tailnet only). | Public :22 “just for now” |
| **V-2** | Packages: git, curl, build-essential, `nodejs` **20**, Caddy (installed, not serving prod yet). tmux, `fail2ban` optional. | `node -v` is v20.x; `tmux -V` works. | Docker, Coolify, Portainer, snap Node |
| **V-3** | Clone `github.com/cwahli/Health-tracker` to `~/src/Health-tracker`. `npm ci`. Prove `npx tsc --noEmit` (or the named lint the repo already uses). | Clone exists; tsc exits 0. | scp Mac `node_modules`; `npm install` as root |
| **V-4** | tmux session `dev` starts on boot (`tmux new -s dev` in a user systemd user-unit **or** a documented `tmux attach` habit). Phone SSH (Termius/Blink/Termux) attaches and you see a shell. | From the phone: attach, `hostname`, `pwd` is the repo. **First mobile → VM working.** | Skipping phone proof because “Mac SSH is enough” |

### Phase 2 — See the VM, then talk to it

| ID | What | Done when | Do not |
|---|---|---|---|
| **V-5** | Live watch: document `tmux ls` / `tmux attach -t grok`. Optional: Hermes web UI on Tailscale only. | Phone can attach and watch a running process for 2 minutes without disconnect. | XFCE, VNC, RustDesk, public ttyd |
| **V-6** | Slim Hermes **on the VM** (CLI + Telegram gateway only). Pair **your** Telegram id. Test: send `hostname` / a read-only question; reply comes back. | Phone Telegram message → VM process → Telegram answer. Mac Hermes can stay; do not require both. | Rsync entire `~/.hermes`; open Telegram webhook on `0.0.0.0` without Tailscale/allowlist |
| **V-7** | Pick **primary instruct = Telegram**, **primary watch = tmux**. Write 10 lines in this file’s “Runbook” (below) after it is true. Discord/WhatsApp stay off until Telegram is boring. | Runbook filled with the actual hostnames/commands. | Enabling every Hermes channel |

### Phase 3 — Coding agents on the VM (still not production)

Install **Grok first**, prove a real commit, then Agy, then OpenCode. Same repo. One at a time.

| ID | What | Done when | Do not |
|---|---|---|---|
| **V-8** | Install Grok Build CLI. `grok login --device-auth` (open the URL on the phone). | `grok -p "Reply with only: pong"` prints `pong`. | Pasting xAI cookies into chat |
| **V-9** | Grok **builds from the VM.** In `~/src/Health-tracker`, tmux session `grok`: a small allowed change (README line **or** a locked packet if you explicitly say go). `git push` to a branch. Watch via tmux **and** (if V-6 is up) Telegram progress. | PR or branch on GitHub authored from the VM. Mac was not required for that commit. | Pushing straight to `main`; editing Render; `--yolo` on first run |
| **V-10** | Install Agy. Device/API auth. One read-then-edit task in the same repo, then stop it. | `agy` (or its equivalent) completes one task; process is not left idle. | Leaving Agy + Grok both running |
| **V-11** | Install OpenCode. Auth. One task, then stop it. | Same as V-10 for OpenCode. | OpenCode web UI on a public port |
| **V-12** | House rules on the VM: one CLI; `systemd` `MemoryMax` for agent units if they are services; no `npx playwright install` unless a later ID. Optional 1–2 GB zram (not 8 GB disk swap). | `htop` during a Grok run stays under ~6 GB. | Playwright Chromium “for completeness” |

**Phase 3 complete** = you can sit on a phone, tell Grok (and, when you choose, Agy or OpenCode) to change Health-tracker on the VM, watch it, and see the commit on GitHub. The **website is still Render.**

### Phase 4 — Move the website onto the VM (R-13.1)

Do not start until Phase 3 is complete. Render stays up until V-16.

Production shape (no Docker):

```text
Internet → (optional Cloudflare orange-cloud DNS)
        → Caddy :443 (HTTPS)
        → 127.0.0.1:3000  node dist/server.cjs   (systemd Restart=always)
```

Env on the VM: `NODE_ENV=production`, `PORT=3000`, `INTERNAL_BASE_URL=http://127.0.0.1:3000`, Gemini, R2, D1, Firebase — copy from Render, never into git. Supabase env is leftover (Track D); not a second source of truth. Do not install SQLite as production in Track V — that is [DATA_PLANE.md](./DATA_PLANE.md) **D-5** after V-16.

| ID | What | Done when | Do not |
|---|---|---|---|
| **V-13** | Staging only: Caddy + systemd `health-tracker.service`. Reachable as `http://<tailscale-name>:3000` or `https://<magicdns>`. `GET /api/status` 200. | You open the **staging** app from the phone on Tailscale. Render unchanged. | Pointing the public domain yet |
| **V-14** | Staging meal: Google login on the **exact** staging host (Firebase Authorized Domains + OAuth client). Submit a meal photo → poll → D1 row + R2 image. | One real meal on staging. | Using Render’s hostname in Firebase for this test only and calling it done |
| **V-15** | Public hostname chosen (custom domain). Caddy obtains certs. Firebase Authorized Domains + OAuth + R2 CORS include the **exact** host. GitHub Action **or** documented `git pull && npm ci && npm run build && systemctl restart` on the VM. | `GET https://<host>/api/status` 200 from a network that is not Tailscale. | Two public origins both claiming to be prod |
| **V-16** | **Cutover.** DNS to the VPS. Watch meals and login for a day. Keep Render running but unused. | Phone on cellular (not Tailscale) loads the site with **no Render splash**, signs in, logs a meal. | Deleting Render on the same day as DNS |

**R-13.1 done-when** is V-16, not Cloudflare Containers and not Cloud Run.

### Phase 5 — Cleanup

| ID | What | Done when | Do not |
|---|---|---|---|
| **V-17** | Delete the Render service. Remove Render URL from Firebase Authorized Domains, R2 CORS, scorecard `live_origin`, any hardcoded `onrender.com`. | `https://health-tracker-backend-64gt.onrender.com` is dead; docs and gates use the VPS host. | Leaving Render “as backup” forever |
| **V-18** | Confirm Cloudflare extra URL / Containers still parked. Do not buy Workers Paid. Mac can stay as a laptop; it is no longer the agent host. Optional: snapshot / OVH backup verified. | This file’s Runbook matches production. GCP Cloud Run plan stays superseded. | Starting Cloud Run “as well” |

### Phase 6 — Autonomous Journey QA Fleet & Orchestrator Self-Healing Loop

| ID | What | Done when | Status |
|---|---|---|---|
| **V-19** | **Screenshot Forwarding (Gap 1)**: Pass `--screenshot=${bugData.screenshot}` in `qa-auto-loop.mjs` dispatch call. | Coding agents inspect visual screenshot before writing code. | **COMPLETE** |
| **V-20** | **Manual Bug Report Re-Test Loop (Gap 2)**: Automate QA re-verification after Workflow B dispatch & webhook deploy. | User reporting a UI bug in Telegram automatically gets verification screenshot. | **COMPLETE** |
| **V-21** | **Profile-Aware Telegram Routing (Gap 3)**: `telegram-send.sh` accepts `--profile=<name>` to source matching token/chat. | Multi-bot messages never route to wrong profile or thread. | **COMPLETE** |
| **V-22** | **Autonomous Escalation Retry Loop (Gap 4)**: `qa-auto-loop.mjs` retry loop (`MAX_RETRIES=2`) with Cline high-thinking escalation. | Second attempt tries high reasoning before human escalation. | **COMPLETE** |
| **V-23** | **Heartbeat Process Lifecycle (Gap 5)**: Add `trap stop_heartbeat EXIT INT TERM` in `run-coding-dispatch.sh`. | Telegram ping background loop cleanly exits with the parent script. | **COMPLETE** |
| **V-24** | **Dispatch Concurrency Lock (Gap 6)**: Write `~/.hermes/dispatch_lock` with active `BUG_ID`. | Concurrent QA runs prevented from conflicting in the same git working tree. | **COMPLETE** |
| **V-25** | **Global DuckDNS Test Origin (Gap 7)**: Seed `PLAYWRIGHT_TEST_BASE_URL=https://health-tracking.duckdns.org` in `~/.hermes/.env`. | Headless tests across all profiles default to live site. | **COMPLETE** |
| **V-26** | **Orchestrator Post-Deploy Re-Verify (Gap 8)**: Orchestrator `/fix` triggers automated `qa-runner.mjs` after deploy sleep. | Orchestrator self-verifies resolution end-to-end. | **COMPLETE** |

### Phase 7 — Phone terminal survives a network change (OPEN)

**ID: V-27. Do this next. Do not redo Phase 6.**

The VM staying up is not enough. Termius on the Pixel owns the SSH session. Android destroys the Tailscale VPN interface when Wi-Fi drops or the phone changes network, which kills every TCP session on it. The Tailscale app on the phone then fails its coordination-server key refresh and shows a WireGuard authentication error. Recovery today is force-stop, clear cache, and airplane mode, often 5–10 minutes. Clearing the Tailscale cache deletes the node login and is what makes the outage long. This is a known Android Tailscale failure (control-key fetch cancelled until the radio state is refreshed). It is not a bad password and not a dead VM.

Measured on 2026-09-21, re-check before changing anything:

| Fact | Value |
|---|---|
| Phone | Pixel 9 Pro XL, tailnet `pixel-9-pro-xl`, `100.83.130.60`, account `chiwah.liu@` |
| VM Tailscale | `vps-0a61fae6`, `100.118.148.32`, Tailscale 1.102.4, `RunSSH true` |
| Public address | `51.254.217.163`, name `health-tracking.duckdns.org` |
| Firewall | `ufw` default deny. Allowed: anything on `tailscale0`, `80/tcp`, `443/tcp`. **Public :22 is closed.** sshd still listens on `0.0.0.0:22`. |
| sshd | `PasswordAuthentication yes`, `PubkeyAuthentication yes`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password` |
| Mosh | **Not installed.** |
| tmux | 3.6 at `/usr/bin/tmux`. Runbook session name is `dev`. V-27 uses a new session `health` and does not destroy `dev`. |
| fail2ban | Installed-or-not: **inactive**. |
| WireGuard app | No `wg-quick@wg0`. Do not add one. Android runs one VPN; a second tunnel replaces Tailscale and still kills SSH on a network change. |

Tailscale SSH is why the reconnect shows an authentication error rather than a timeout. A connection to the `100.x` address is authenticated by the tailnet node, not by the SSH key stored in Termius. While the phone is stuck refreshing its control key, Termius reports auth failure.

**Agent steps, in order.** Stop if a step would lock out the current Tailscale session. Prove the next login before closing the old one.

1. Confirm `/home/ubuntu/.ssh/authorized_keys` has a key the phone already uses. On a **second** Tailscale SSH session, `ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no localhost` must succeed. Only then set `PasswordAuthentication no` and `KbdInteractiveAuthentication no` in `/etc/ssh/sshd_config` (or a file under `sshd_config.d/`). `PermitRootLogin` stays `prohibit-password`. Reload sshd. Do not disconnect the session you are working in until the second session has logged in with the key.
2. `sudo apt-get install -y mosh fail2ban`. Enable the sshd jail. `ignoreip` must include `127.0.0.1/8` and the tailnet `100.64.0.0/10` so a Tailscale reconnect cannot ban the phone. Start fail2ban.
3. Open the public door: `ufw allow 22/tcp` and `ufw allow 60000:61000/udp` (mosh). Leave the existing tailscale0 / 80 / 443 rules. Do this only after step 1 has reloaded sshd with passwords off. `sshd -T` must still show `passwordauthentication no`.
4. Create tmux session `health` with working directory `/home/ubuntu/src/Health-tracker`: `tmux new-session -d -s health -c /home/ubuntu/src/Health-tracker`. Add a **user** systemd unit so that session is recreated on boot if it is missing (`Type=forking`, `ExecStart=/usr/bin/tmux new-session -d -s health -c /home/ubuntu/src/Health-tracker`, do not kill an existing session). `loginctl enable-linger ubuntu` only if linger is not already on for Hermes. Do **not** put `tmux attach` in `.bashrc` — that breaks `scp`, `rsync`, and deploy SSH.
5. After a key login to `ubuntu@health-tracking.duckdns.org` works from off the tailnet (the phone, or any host that is not using Tailscale), run `tailscale set --ssh=false`. Until that off-tailnet login works, leave Tailscale SSH on. Do not uninstall Tailscale.
6. Update the Runbook in this file to the commands that are actually true. Fill the Termius block below into the Runbook. Do not mark V-27 COMPLETE until the human phone check passes.

**Human, once, on the phone.** The agent cannot do this.

- Termius host: `health-tracking.duckdns.org` (not `100.118.148.32`). Protocol **Mosh**. User `ubuntu`. Key auth. Startup command: `tmux new -A -s health`.
- Forget the old Tailscale SSH host for daily use, or leave it unused.
- Do not force-stop Tailscale or clear its cache. Tailscale may stay installed. If it wedges, airplane mode for about ten seconds, or toggle the Tailscale switch. Cache clear forces a full login.

**Done when**

- `sshd -T` reports `passwordauthentication no`. A password login is rejected.
- `ufw status` shows `22/tcp` and `60000:61000/udp` allowed from Anywhere, and 80/443/tailscale0 unchanged.
- `mosh-server` exists. `tmux has-session -t health` succeeds, cwd is the repo, and session `dev` is untouched if it was present.
- fail2ban is active with an sshd jail.
- From the phone, on Mosh: switch Wi-Fi ↔ cellular (or toggle airplane mode briefly). Termius is back in the **same** `health` pane within a few seconds, and a process that was running inside that pane is still running. No Tailscale cache clear.

**Do not**

- Do not open public :22 while `PasswordAuthentication` is still `yes`.
- Do not install WireGuard (`wg-quick`) beside Tailscale, and do not tell the user to import a Tailscale config into the WireGuard app.
- Do not edit `~/.hermes/**/.env`, bot tokens, or `~/.config/opencode-bot/opencode.env`. Do not restart `hermes-gateway` (that posts “Hermes is shutting down” into Telegram). Hermes tasks already run as a service and do not use this Termius session.
- Do not restart `health-tracker.service` or change Caddy. This ID is the phone door, not the website.
- Do not `git reset --hard` a dirty tree. Do not commit secrets. Do not change `src/` for V-27.
- Do not treat `grok --resume` as the fix. The live process has to stay inside tmux.

---

## Runbook (Production Live)

```text
VPS:           OVH VPS-2 (vps-0a61fae6) / 51.254.217.163
Region:        EU (Gravelines / Lille, France)
Tailscale:     100.118.148.32 (vps-0a61fae6)
SSH today:     Tailscale SSH only (ufw denies public :22). PasswordAuthentication is still yes — V-27 turns it off before opening :22.
tmux today:    Termius → Tailscale SSH → tmux attach -t dev
tmux target:   Termius → Mosh ubuntu@health-tracking.duckdns.org → tmux new -A -s health
               (V-27 OPEN. Do not pretend this door exists until the phone check passes.)
Telegram:      @Health-tracker-bot (Hermes Telegram Gateway with Profile Multiplexer)
Repo on VM:    /home/ubuntu/src/Health-tracker
Prod URL:      https://health-tracking.duckdns.org (Caddy :443 -> 127.0.0.1:3000)
systemd:       health-tracker.service (node dist/server.cjs)
Deploy:        GitHub Webhook -> Caddy (/webhook/*) -> 127.0.0.1:9000 -> /home/ubuntu/deploy.sh
Firebase host: health-tracking.duckdns.org (Authorized Domain in Firebase Console)
Database:      Cloudflare D1 + Supabase + Cloudflare R2 (photos)
Watchdog:      /home/ubuntu/scripts/watchdog.sh (every 10 hours via cron)
QA Runner:     node scripts/qa-runner.mjs --journey={meal|biomarker|onboarding}
```

---

## Invariants

1. GitHub is source of truth. The VM is a working tree + (later) the Node origin.
2. Cloudflare stays **R2 + D1 + optional DNS** until Track D D-6 says otherwise. It does not run meal analyze (`sharp`, in-memory jobs, loopback SSE).
3. Gemini stays the vision model. Firebase stays login. SQL stays D1 for the whole of Track V.
4. One coding CLI at a time. Hermes may wrap it; Hermes is not a second writer in the same tree.
5. No Docker for the site. Dockerfile remains for history / a future host; systemd runs `node dist/server.cjs`.
6. `npm run dev` on a laptop/AI Studio stays Vite on 3000. Production is `dist/`.
7. Do not co-host unrestricted agents as root with the live process. After V-13, agent user may be the same unix user but must not `kill` Caddy/`health-tracker` as a habit; restart is `systemctl`.
8. In-memory job maps ⇒ **one** Node process. Do not put a load balancer with two app workers.
9. Playwright/e2e against the live host is QA-fleet only (Phase 6+ `qa-runner.mjs`); no ad-hoc e2e runs on the VPS.
10. Track V does not mix with Q-11 / F-13 application packets in the same working tree.

---

## Why not the old hosts

| Old plan | Why it is not Track V |
|---|---|
| Render free | Sleeps ~15 min; ~50s splash. User rejected. |
| Cloud Run `min-instances=0` | Still a first-hit pause; in-memory jobs die. |
| Cloud Run `min-instances=1` + VPS-1 | Two bills; 4 GB agent box still tight; more moving parts. |
| Cloudflare Workers / Pages Functions | Cannot run this API (`sharp`, loopback, job Maps). |
| Cloudflare Containers extra URL | Parked (token/permissions). Not required if VPS is the origin. |

---

## Suggested first human actions

1. Pick region (EU vs SG).
2. Order VPS-2 monthly, Ubuntu 24.04, your SSH public key.
3. Reply with the Tailscale name once V-1 is up — then an agent can help with V-2/V-3 unit files (Caddyfile, systemd) without touching `src/`.
