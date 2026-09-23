# TG-ROUTER-SELFHEAL — completion report

- Date: 2026-09-24
- Router: `/home/box/.config/telegram-opencode/router/src/index.js` (2937 lines)
- State: `/home/box/.config/telegram-opencode/router/state/session.json`
- Log: `/home/box/.config/telegram-opencode/router/logs/router.out.log`
- Run dir: `/home/box/.config/telegram-opencode/router/run/` (`router.lock` present/held; the router writes `router.pid` here)
- Runner: `cline -m cline-free/deepseek-v4.1-flash --thinking high` (no Muse, no Freebuff, no OpenCode Muse). Bot token never printed.

This job was verification + report only. The surgical self-heal code was already present; the
whole router was **not** rewritten. No token was printed and no Freebuff/Muse route was used.

---

## DONE / NOT-DONE checklist

| # | Ticket item | Status | Evidence |
|---|-------------|--------|----------|
| 1 | (A) Exclusive single-poller lock on startup (flock + pidfile) | **DONE** | index.js L17–20, 345–467; startup call L2867 |
| 2 | (A) Second start exits `another router owns the token` | **DONE** | live 2nd start prints `another router owns the token (flock held); exiting`, exit 0; `flock -n` probe exit 1 |
| 3 | (A) Stale pidfile removed / taken over | **DONE** | L374–395; log shows `removing stale pidfile … (pid 999999 dead)` |
| 4 | (A) 409 does not spin forever as a 2nd poller; exits after N | **DONE** | L41–44, 2899–2937 (exit after `ROUTER_MAX_409`=3, prints restart doc) |
| 5 | (B) Cline timeout default ≥ 20 min (`CLINE_TIMEOUT_MS`, default 1200000) | **DONE** | L40, used at L1255 |
| 6 | (B) Track child PID on dispatch (`state.clinePid` + memory) | **DONE** | L46, L1193–1197 |
| 7 | (B) Timeout/abort/`/unlock` SIGTERM→SIGKILL the Cline PID tree | **DONE** | `killPidTree` L504–518, `reapClineChild` L519–528, timeout path L1207–1216, `/unlock`+watchdog L550/2824/2896 |
| 8 | (B) Never report timeout while child alive (reap dry check) | **DONE** | live non-destructive test: spawned test child 1804365 (`sleep 300`) killed; `after pidAlive: false` |
| 9 | (C) Failover re-dispatches the *same* user prompt on the new lane | **DONE** | L1433 (`dispatchOnce(prompt)` per route), banner L1447–1461 |
| 10 | (C) `⚡ Auto-switched…` banner + greeting-only is only allowed for greeting w/o prior task | **DONE** | L1437–1453; dry test on shipped gates |
| 11 | (C) Failover target selection across providers (muse → cline) | **DONE** | dry test: `nextFailoverRoutes(opencode/muse-spark-1.3-contributor-free)` → cline muse lane |
| 12 | (D) `lastReceivedText` on every receipt; `lastUserText` only when dispatch starts | **DONE** | L2651–2654 (received), L2679 (handled), status L1506–1508 / L1761–1763 |
| 13 | (E) Persist `state.quota[key]={depletedUntil,lastError}`; skip depleted routes; `/allowance` lists them | **DONE** | L469–501, skip L1411–1412, mark L1468/1475, `/allowance` L2243–2247 |
| 14 | Only ONE `node src/index.js` poller left running | **DONE** | `EXACT_COUNT=1` (pid 1792790) |
| 15 | Single poller running with `think` in the command list | **DONE** | source L2802; live log line 79 `bot commands registered: … think …` |
| 16 | Report written to `/tmp/TG_ROUTER_SELFHEAL_REPORT.md` | **DONE** | this file |

Nothing in the ticket's scope is NOT-DONE. See "Residual notes" for two honest caveats.

---

## Code changes (surgical, already in tree — pointers)

### A) Single-poller lock — `run/router.lock` + `run/router.pid`
- L16–20: `RUN_DIR`, `LOCK_PATH=run/router.lock`, `PID_PATH=run/router.pid`, legacy `/tmp/tg-router.pid`.
- L345–358: `pidAlive(pid)`, `readPidFile(p)`.
- L362–370: `lockHeldByOther()` — non-blocking `flock -n "$LOCK_PATH" -c true` probe.
- L371–467: `acquireSinglePollerLock()`:
  - L376–380 exit if live pidfile + lock held → `another router owns the token (pid N alive); exiting`;
  - L381–395 stale pidfile cleanup (+ legacy pid cleanup);
  - L404–410 `TG_ROUTER_LOCKED=1` path (launched under an outer `flock`);
  - L411–452 self-managed path: `setsid flock -n "$LOCK_PATH" sleep …` daemon holder + waiter that frees the lock when the router dies; exit L416–419 / L448–451 → `another router owns the token (flock held); exiting`.
- L2866–2868: startup call, then `single-poller lock ok: …`.
- 409 self-heal: L41–44 (`ROUTER_MAX_409`=3, `ROUTER_409_RETRY_MS`=45000); L2899–2937 `startPollingWithRetry()` — on 3 consecutive `409/Conflict` it logs and `process.exit(0)` (never a second long-poller).

### B) Cline timeout without orphans
- L40: `const CLINE_TIMEOUT_MS = Number(process.env.CLINE_TIMEOUT_MS || 1200000);` (20 min default).
- L46: `let activeClinePid = null;` (plus persisted `state.clinePid`).
- L1180–1238 `runCmd()`: L1193–1197 store `activeClinePid`/`state.clinePid`; L1207–1216 timeout handler calls `killPidTree(pid,"runCmd timeout")` + `child.kill(SIGTERM)` then SIGKILL; clears tracking.
- L504–518 `killPidTree()`: SIGTERM to the process group + pid, `pkill -TERM -P`, then a 3 s SIGKILL escalation.
- L519–528 `reapClineChild()` / L529–532 `clearClineTracking()`.
- L1255: `runCline` calls `runCmd("cline", args, { timeoutMs: CLINE_TIMEOUT_MS, trackClinePid: true })`.
- Reap on `/unlock`/cancel (L550 `clearBusyLock`), watchdog idle reap (L2822–2825), startup reap (L2896).

### C) Failover re-dispatch (same prompt, one shot)
- L154–193 `FREE_FAMILIES` (cross-provider free chains), L115–148 `freeFamilyKey`, L231–245 `nextFailoverRoutes`.
- L1398–1481 `dispatch()`: builds routes = current + failover (L1402), skips depleted (L1411–1412), and for each route calls `dispatchOnce(prompt, opts)` — **the same `prompt`** — L1433. On success from a failover route (i>0) it returns `⚡ Auto-switched free lane after quota/limit.` + `Now:` + `Tried:` + the lane's answer (L1455–1461). If the new lane only greets on a non-greeting prompt, it still surfaces the banner + an echo of the user task (L1443–1453). Greeting-only welcome is only returned when the original was greeting-only with no prior task (L1437,1442).

### D) Progress honesty
- L2651–2654: every incoming text stored as `state.lastReceivedText` immediately.
- L2677–2683: `state.lastUserText` set only when the dispatch actually starts.
- L1506–1508 (`statusPingReply`) and L1761–1763 (`statusText`) show `Last handled:` and, if different, `Last received:`.

### E) Light quota memory
- L469–501: `QUOTA_TTL_MS` (default 6 h), `markDepleted`, `isDepleted` (auto-expire), `quotaLines`.
- L1411–1412: depleted routes filtered out of the failover chain.
- L1468/1475: mark depleted on soft/thrown quota errors; L2243–2247 `/allowance` prints `depleted until <ISO>` lines.


---

## Verification evidence (executed, raw output)

### (1) `node --check`
```
=== (1) node --check ===
SYNTAX_OK exit=0
```

### (2) Single poller — a second start must be refused
Live extra-start (uses the on-disk, latest code; no Telegram call is made before the lock):
```
=== (2) second start must exit another-router-owns ===
second_start_exit=0
--- second-start output ---
◇ injected env (0) from .env
tg-provider-router starting; allowlist=<redacted>; default=cline
another router owns the token (flock held); exiting
```
Direct flock probe on the same lock file (exit≠0 ⇒ held by another):
```
=== flock direct probe (exit!=0 means held) ===
LOCK_HELD_BY_OTHER exit=1
```
Historical log proof the running instance itself refuses siblings (`logs/router.out.log`, 1-based lines):
```
40:another router owns the token (flock held); exiting
43:another router owns the token (flock held); exiting
46:another router owns the token (flock held); exiting
49:another router owns the token (flock held); exiting
57:removing stale pidfile .../run/router.pid (pid 999999 dead)
58:another router owns the token (flock held); exiting
66:another router owns the token (flock held); exiting
74:another router owns the token (flock held); exiting
```
Live lock holder that owns `run/router.lock` for the running router:
```
1792803  53  Ss  flock -n /home/box/.config/telegram-opencode/router/run/router.lock sh -c echo $$; exec sh -c "while kill -0 1792790 2>/dev/null; do sleep 1; done"
```

### (3) Timeout / reap path (code + non-destructive dry check)
Code pointer: `runCmd` timeout L1207–1216 → `killPidTree` L504–518; tracked pid L1193–1197; `/unlock`/watchdog reaps L550/2824/2896.
Non-destructive test (`/tmp/tg-selfheal/killpidtree-check.mjs`) — it slices the **exact shipped** `pidAlive`/`killPidTree` source and kills only a spawned `sleep`:
```
=== (3) killPidTree non-destructive dry check ===
sliced killPidTree bytes: 25 lines
invalid-pid no-op outputs: false false false
spawned test child pid: 1804365
before ps: PID STAT CMD
1804365 Ss   sleep 300
killPidTree(1804365, dry check) signalled
killPidTree returned: true
after pidAlive: false
after ps: (no such process)
KILLPIDTREE_DRY_CHECK: PASS
kill_check_exit=0
```
No router/Cline child was touched — only the test `sleep`.

### (4) Failover re-dispatch (code pointer + dry logic test)
Code pointer: L1433 `dispatchOnce(prompt, …)` reuses the original prompt on each failover lane; L1455–1461 prepends the `⚡ Auto-switched…` banner.
Dry test (`/tmp/tg-selfheal/failover-check.mjs`) slices the shipped `nextFailoverRoutes`/`freeFamilyKey`/`FREE_FAMILIES`/greeting gates:
```
=== (4) failover re-dispatch dry logic test ===
nextFailoverRoutes(opencode/muse-spark-1.3-contributor-free) = [{"provider":"cline","model":"cline-free/muse-spark-1.3-contributor"}]
ok - quota on opencode/muse lane re-targets the cline muse lane
ok - opencode + cline muse ids map to the same failover family
ok - 'Hi' is greeting-only
ok - a real task is not greeting-only
ok - detects a Cline greeting-only reply
ok - does not flag a real answer
FAILOVER_DRY_CHECK: PASS
failover_check_exit=0
```

### (5) Exactly one poller left running, with `think` registered
```
=== final exact poller count ===
1792790 node src/index.js
EXACT_COUNT=1
```
`think` is in the live command list:
- source: `src/index.js:2802  { command: "think", … }`
- live log: `logs/router.out.log:79  bot commands registered: start, help, status, think, allowance, compact, switch, model, freemodel, unlock, new`

---

## Restart procedure (documented)
```
pkill -f 'node src/index.js'                 # stop the (single) poller
cd /home/box/.config/telegram-opencode/router
flock -n run/router.lock node src/index.js   # or just: node src/index.js
```
Either form is safe: the router self-acquires `run/router.lock` and writes `run/router.pid`; any
second start exits with `another router owns the token`.

---

## Residual notes (honest caveats)
1. The live poller (pid 1792790) was launched by the harness at 03:15; `src/index.js` was last written
   03:17. The on-disk/latest code is what got `node --check` + the second-start and failover dry tests,
   and the live instance independently enforces the same lock (holder 1792803). A fresh `flock`-guarded
   restart would load the exact on-disk revision; it was deliberately **not** performed mid-verification
   because there is **no supervisor** for this router and a kill/restart opens a brief window with zero
   pollers. The `pkill … && start ONE` procedure above is the documented, safe restart.
2. The scripts under `/tmp/tg-selfheal/*.mjs` are throwaway verification harnesses; they are not part of
   the router and don't affect it.

