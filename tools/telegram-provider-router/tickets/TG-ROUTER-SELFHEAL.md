# TG-ROUTER-SELFHEAL — stop the Telegram mess without human babysitting

## Repo / files
`/home/box/.config/telegram-opencode/router/src/index.js`
State: `state/session.json`
Logs: `logs/router.out.log`
Report: `/tmp/TG_ROUTER_SELFHEAL_REPORT.md`

## Current breakage (reproduced 2026-09-24)
1. **409 getUpdates conflict** loops forever (retry 45s) — another poller holds the token; router does **not** take exclusive ownership (pidfile `/tmp/tg-router.pid` may be stale; OpenCode tickets keep spawning extra `node src/index.js`).
2. **Cline hard timeout 240s** → Telegram shows `Cline error: Timed out after 240s`, clears busy, but **child Cline keeps running** (orphan) and edits the wrong files on a vague prompt.
3. **Failover greeting** after OpenCode quota: switches to Cline and answers with “Hi I’m Cline…” instead of **re-running the same user prompt** on the new lane (user has to re-paste).
4. **Sticky `/status` last task** stays on old short text (`Hi`) when longer follow-ups fail to run during 409 storms.
5. Busy watchdog exists for OpenCode idle/orphan, but **does not reap orphaned `cline` child PIDs** after Telegram timeout.

Existing partial self-heal (keep): busy unlock buttons, startup sticky-busy clear, OpenCode free_tier fail-fast ~45s, FREE_FAMILIES failover, `/think` for Cline (already shipped).

## Ship these fixes (surgical)

### A) Single poller lock (must)
- On startup: exclusive `flock` or pidfile under the router dir (e.g. `run/router.lock` + `run/router.pid`).
- If lock held by live PID → exit 0 with log “another router owns the token”.
- If pidfile stale → remove and take lock.
- On 409: do **not** spin forever as a second poller; log clearly, optional one `getUpdates?timeout=0` drain is OK, but **never** leave two long-pollers.
- Document restart: `pkill -f 'node src/index.js'` then start **one** under flock.

### B) Cline timeout without orphans (must)
- Raise default Cline Telegram timeout to **≥ 20 minutes** (env `CLINE_TIMEOUT_MS`, default 1200000).
- Track `child.pid` for the Cline spawn on `state` / in-memory.
- On abort/timeout/`/unlock`: **SIGTERM then SIGKILL** the tracked Cline PID tree (and clear busy).
- Never report timeout to Telegram while leaving the child alive.

### C) Failover re-dispatch (must)
- When auto-switching free lane after quota/limit, **retry the same user text** on the new provider (one shot), prefixing the reply with the existing `⚡ Auto-switched…` banner — do **not** invent a fresh “Hi I’m Cline” welcome as the only reply.
- If the user message was only a greeting and there is no prior task, welcome is OK.

### D) Progress honesty (should)
- Busy card / `/status` `lastUserText` must update when a new message actually starts dispatch.
- If 409 prevented handling, do not claim Idle with a stale “Last task: Hi” after the user sent a long task (or say “last handled: …” vs “last received”).

### E) Light quota memory (should, small)
- Persist `state.quota[provider/model] = { depletedUntil, lastError }` when parsing rolling-period / free allowance errors (Token Harbor / OpenCode free).
- Skip depleted routes in FREE_FAMILIES until `depletedUntil`.
- `/allowance` can list depletedUntil lines.

## Out of scope
Health-tracker app PRs; Freebuff Freebucks burn; Grok workers; rewriting the whole router.

## Done when
Write `/tmp/TG_ROUTER_SELFHEAL_REPORT.md` with:
- code changes
- proof: only one `node src/index.js` after restart; flock blocks a second start
- proof: killing/timeout path terminates Cline child (ps before/after)
- proof: failover path would re-dispatch (code pointer + short dry logic test OK)
- single poller left running with `think` in command list

## Constraints
Cline Muse free only. No Freebuff. No OpenCode Muse (depleted). Do not print bot tokens. One router instance at end.
