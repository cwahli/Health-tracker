# Direct relay route — one uniform solution for mobile / collab / grok

Status: code + sensor on `agent/r16-scorecard`, staging live (see below), production rollout pending. The live
relay still binds loopback with no token; nothing below has touched it.

## Why this shape

Workers dial out, so every host uses the same URL shape and the VM opens
nothing inbound to any device:

```
https://health-tracking.duckdns.org/relay/*  →  Caddy  →  127.0.0.1:8890
```

SSH can be public because it has key auth. The relay has no auth of its own,
and it serves session exports (whole conversations) and pack contents — so the
public route must never serve anonymously. Auth is a bearer token checked by
the relay itself (`WORKER_RELAY_TOKEN`), the same on every host; `/health`
stays open for monitoring. No token configured = old loopback behavior,
unchanged (sensor-proven backward compatible).

## Code (on `agent/r16-scorecard`, sensor `assert-relay-auth` 12/0)

- `scripts/worker-relay.mjs`: `WORKER_RELAY_TOKEN` / `--relay-token`; every
  route except `GET /health` answers 401 without it (timing-safe compare,
  checked before routing, body parsing, or any opencode call).
- `scripts/worker-agent.mjs`: `--relay-token` / `WORKER_RELAY_TOKEN`, sent on
  connect, heartbeat, jobs/next, result post, session export fetch, pack fetch.
- `scripts/lib/swap-guards.mjs`: token threaded through the session check
  (401 becomes a named `auth` failure — never retried, never silent);
  `classifyWorkerFailure` knows the auth class.
- `scripts/bot-host.mjs` `runOnWorker`: `relayToken` param (env default) for
  the pack PUT.

## Staging is LIVE (2026-09-26, no production touched)

A token-guarded staging relay already answers the public internet, proven end
to end, for devices to onboard against today:

- Relay: `/home/ubuntu/dev/relay-auth` @ `agent/r16-scorecard`, port **8891**,
  loopback-bound, `WORKER_RELAY_TOKEN` from `~/.config/bot-host/relay.env`
  (0600). Own store (`/tmp/relay-staging-home`) — shares nothing with the
  production relay on 8890.
- Public route: `https://health-tracking.duckdns.org/relay-staging/*` → Caddy
  → 127.0.0.1:8891 (Caddyfile validated + reloaded; main site verified 200).
- Proven 2026-09-26: anonymous → 401 on every guarded route; health → 200;
  a worker over **public HTTPS + token** registered with real machine identity;
  a full job roundtrip came back with the worker's own ledger. Test workers
  removed afterwards; presence clean.
- Device start lines (token handed out of band, never in chat):
  `node <repo>/scripts/worker-agent.mjs --host=<mobile|collab|grok>
  --relay=https://health-tracking.duckdns.org/relay-staging
  --relay-token=$WORKER_RELAY_TOKEN`
  (branch `agent/r16-scorecard`).

## Production rollout (atomic — do not do half of it)

Half-rolled-out is worse than not started: a public route without a token
exposes session exports; a token without restarted workers 401s the live
stand-ins. Do all of these in one window, announced:

1. `export WORKER_RELAY_TOKEN=$(openssl rand -hex 32)` — store in
   `~/.config/bot-host/relay.env`, mode 600. Never paste it anywhere else.
2. Add to the `bot-host@vm`/`vm2`/`collab`/`mobile`/`grok` service envs (or
   export before manual runs) on every machine that calls the relay.
3. Caddy (`/etc/caddy/Caddyfile`, inside the duckdns site block; backup first,
   `caddy validate`, then `caddy reload`):
   ```
       handle /relay/* {
           uri strip_prefix /relay
           reverse_proxy 127.0.0.1:8890
       }
   ```
   (Validated 2026-09-26 against the live file; reverted after validation —
   the live file has no relay route today.)
4. `systemctl restart worker-relay` (or the manual relay) **with** the token
   in its environment.
5. Restart every worker with the token the moment the relay restarts
   (stand-ins included — a tokenless worker reads as dead after step 4).
6. Verify: unauthenticated `curl` to `/relay/jobs/next` → 401;
   `/relay/health` → 200; one worker presence fresh; one canary turn per host.

## Per-host challenges (same protocol, different boxes)

- **mobile (phone, proot):** needs node + repo checkout + opencode/Cline
  binaries + provider creds on the phone itself — verify before promising
  turns. Cline on ARM is omitted (BOT-24), so expect opencode-only lanes.
  Android kills background processes: Termux wakelock + a persistent proot
  session, or the worker dies quietly (presence TTL + claim lease already
  cover this; flaky-network retries are in `tg-api.mjs` and the agent loop).
  Start: `node ~/Health-tracker/scripts/worker-agent.mjs --host=mobile
  --relay=https://health-tracking.duckdns.org/relay
  --relay-token=$WORKER_RELAY_TOKEN` (token via env file, never chat).
- **collab (notebook):** ephemeral runtime — every start needs install node,
  clone branch, creds, start worker; dies on idle (~12h). Keep secrets in
  Colab secrets, never in cells. Same start command with `--host=collab`.
  Expect to re-run setup each session; presence going stale is normal, not an
  incident. Prerequisite: the relay rollout above must be live first (the
  worker has nothing to dial until the public `/relay` route exists).
  Paste-ready cells (run after the rollout; token from Colab Secrets):
  ```bash
  %%bash
  # cell 1 — runtime: node, repo, worker
  command -v node >/dev/null || (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs)
  node --version
  [ -d ~/Health-tracker ] || git clone --branch agent/r16-scorecard --depth 1 https://github.com/cwahli/Health-tracker.git ~/Health-tracker
  cd ~/Health-tracker && git pull --ff-only origin agent/r16-scorecard 2>/dev/null || true
  command -v opencode >/dev/null || { curl -fsSL https://opencode.ai/install | bash; export PATH="$HOME/.opencode/bin:$PATH"; }
  opencode --version
  ```
  ```python
  # cell 2 — secrets (Sidebar → Secrets: WORKER_RELAY_TOKEN), then launch
  from google.colab import userdata
  import os, subprocess, time, urllib.request, json
  os.environ['WORKER_RELAY_TOKEN'] = userdata.get('WORKER_RELAY_TOKEN')
  relay = 'https://health-tracking.duckdns.org/relay'
  log = open('/tmp/worker-collab.log', 'ab', buffering=0)
  p = subprocess.Popen(['node', os.path.expanduser('~/Health-tracker/scripts/worker-agent.mjs'),
                        '--host=collab', f'--relay={relay}'],
                       env={**os.environ}, stdout=log, stderr=subprocess.STDOUT,
                       start_new_session=True)
  print('worker pid:', p.pid)
  ```
  ```python
  # cell 3 — verify (presence must show collab fresh, machine = the Colab box)
  import urllib.request, json
  h = json.load(urllib.request.urlopen('https://health-tracking.duckdns.org/relay/health', timeout=20))
  print([(w['host'], w['reachable']) for w in h['workers'] if w['host'] in ('collab',)])
  ```
  Notes: model turns need the same opencode auth the notebook already uses for
  its Colab engines; Qwen/vLLM lanes stay under the notebook's own `/switch`
  system (the worker only runs opencode/cline turns). Re-run cells 1–2 every
  fresh runtime; cell 3 anytime to check in.
- **grok (location TBD):** whichever box runs the Grok side gets the identical
  client bundle (`--host=grok`, same relay URL + token). First open question
  is placement — answer that, the rest is copy-paste.
- **All hosts:** per-host ledgers isolate quota Blast radius; `checkWorkerMachine`
  tells stand-ins apart from real devices by hostname — a VPS-local worker
  proves the protocol, never a move.

## What this unblocks when live

QS-1/QS-3/QS-4/QS-9 evidence with real off-box workers: roam turns naming
hosts, per-host ledgers, packs applied remotely, chain hops on dry hosts.
Until then those rows stay red no matter what the sensors say.
