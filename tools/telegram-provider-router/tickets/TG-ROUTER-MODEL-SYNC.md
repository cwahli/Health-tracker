# TG-ROUTER: model label sync + free-tier retry fail-fast (root cause)

## Repo
`/home/box/.config/telegram-opencode/router/src/index.js`
State: `/home/box/.config/telegram-opencode/router/state/session.json`
OpenCode server: `http://127.0.0.1:4096` workspace `/workspace/biomarker-and-nutrient-tracker`

## Bugs to fix (all of them — not manual unlock)

### A) Sticky Muse vs MiMo labels (prior)
Busy card / status can disagree because router `state.models.opencode` ≠ live OpenCode session model.
- On `/freemodel` or `/model` (and Token Harbor→OpenCode taps): **set live session model** or create new session with that model; save sid.
- Busy headline + `/status` Model line must use **live** session model.
- Context %: same limit as `/status` (no fake 1.0M).
- Don’t dump raw session JSON as the user reply.

### B) ROOT CAUSE of multi-minute hangs (user 22:33–22:40) — MUST FIX
OpenCode session status becomes:
```json
{"type":"retry","message":"Free usage exceeded, subscribe to Go","action":{"reason":"free_tier_limit",...}}
```
Current `waitOcIdle` treats `retry` like work: keeps looping, refreshes typing, and **activity fingerprints can reset the idle timer**, so the user waits minutes (184s+) until 15m idle / 2h max. Failover in `dispatch()` never runs because no error is thrown.

**Required behavior:**
1. In `waitOcIdle` (and any similar waiter): if status is `retry` AND message/action matches free-tier / Go subscribe / `free_tier_limit` / `Free usage exceeded` → **immediately** `ocAbort(sid)`, then `throw` an Error whose text matches `isQuotaOrLimitError` (include `Free usage exceeded` / `free_tier_limit`).
2. Do **not** treat quota `retry` as activity that extends idle wait.
3. Cap any non-quota `retry` to ~45s then abort+throw (don’t sit for 15m).
4. Ensure `dispatch()` failover chain then runs (MiMo free → Token Harbor MiMo free → other family lanes; for Muse family use Muse/Cline). After switch, update Telegram progress: `⚡ Free limit on X — switched to Y`.
5. On abort/unlock/quota throw: stop typing pulse, set `busy=false`, save state.
6. Single poller: pidfile or exit if getUpdates 409 persists; kill duplicate `node -e import(router)` patterns in docs/startup.

### C) Manual unlock is not acceptable
Do not document “just /unlock”. The bot must self-heal on free_tier_limit within a few seconds.

## Done when
Write `/tmp/TG_MODEL_SYNC_REPORT.md` with:
- root cause
- code changes (functions/lines)
- how verified (or exact curl/status simulation)
- restart note for router (`node src/index.js` one instance only)

Smoke (preferred):
1. Simulate or trigger retry free_tier_limit → waiter aborts <10s, failover message, busy cleared.
2. `/freemodel` Muse then `hi` → busy card model matches `/status`.
3. Typing … stops when idle.

## Constraints
Surgical patch; don’t rewrite router. Keep progress cards. Freebuff stays Telegram-unavailable (terminal only).
