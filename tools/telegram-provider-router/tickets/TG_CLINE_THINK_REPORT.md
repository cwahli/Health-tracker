# TG Cline /think — implementation report

Date (UTC): 2026-09-24
Scope: `/home/box/.config/telegram-opencode/router` only. No Freebuff path touched. No tokens printed.

## Code changes (`src/index.js`)

1. `loadState()` — added `thinking: { cline: "" }` to fresh default state; backfills
   older state files (`""` = unset = CLI provider default; invalid values reset to `""`).
2. New helpers (after `loadState`):
   - `CLINE_THINK_LEVELS = ["none","low","medium","high","xhigh"]`
   - `normalizeClineThinking(v)` — lowercase/trim + allowlist (returns `""` when invalid/unset)
   - `clineThinkingLevel()` — effective level (`""` when unset)
   - `clineThinkingDisplay()` — `clineThinkingLevel() || "default"` for status/cards
3. `runCline()` — builds argv as `-m <model> -c <WORKSPACE> [--thinking <level>] --json <prompt>`
   (prompt last, per `cline --help`); added `runCline argv:` console log with `<prompt>`
   placeholder instead of prompt text.
4. `headlineFromState()` — passes `clineThinkingDisplay()` as `thinking` when provider
   is `cline`, so the busy opener reuses the existing `thinkBit` helper and renders
   e.g. `⏳ Cline … (high) working… 3s` (`none`/`default` render no bit, as before).
5. `headlineFromLive()` — same Cline `thinking` for live headline path.
6. `statusText()` — new `cline` branch: `Thinking: <level|default>`; note reworded to
   `Note: live usage details are shown when provider is opencode.` (old
   "only when opencode" note kept for other providers).
7. New `bot.command("think", …)` (registered before `model`):
   - no arg → `Thinking effort:` + Cline level/allowed levels + OpenCode model-driven note.
   - bad arg → `Unknown thinking level. Use: none|low|medium|high|xhigh` + usage.
   - valid arg on non-cline provider → stays unset, tells user to `/switch cline` first.
   - valid arg on cline → persists `state.thinking.cline`, acks
     ``Cline thinking set to `<level>`. Applies as `--thinking <level>` on the next run.``
8. `/start`, `/help`, `BOT_COMMANDS` — added `think`
   (`setMyCommands` picks it up on next poller start).

## Smoke: `/think high` then short Cline "Hi " run

State before smoke: `provider=cline`, no `thinking` key (pre-patch file).
Smoke set `state.thinking.cline=high` exactly as `/think high` does
(`/tmp/session.json.bak-tg-think` holds the pre-smoke backup).

- `/think` (no arg) logic → `Cline: high (levels: none|low|medium|high|xhigh)`
- `/status` (cline) logic → `Thinking: high`
- `runCline` argv (same builder as patched code, real state file + real `WORKSPACE`):

  `cline -m cline-free/muse-spark-1.3-contributor -c /workspace/biomarker-and-nutrient-tracker --thinking high --json <prompt:Hi+space>`

- Flag-order assertion `-m < -c < --thinking < --json < prompt`: PASS
- Unknown level (`bogus`) inserts no `--thinking`: PASS; unset omits flag: PASS
- Busy opener sample: `⏳ Cline cline free muse spark 1.3 contributor (high) working… 3s`
- Offline `cline --help` confirms `--thinking <level>: none|low|medium|high|xhigh; bare
  --thinking = medium; omitted = provider default` — matches ticket semantics.
- Live CLI proof (free lane only, tiny prompt, `timeout 100`):
  `cline -m cline-free/muse-spark-1.3-contributor -c /workspace --thinking high --json "Hi "`
  exited 0 and streamed `agent_event` JSON (cost 0). No Freebuff used.
- Live router proof: after restart, a real Telegram `Hi`-class turn logged:

  `runCline argv: cline -m cline-free/muse-spark-1.3-contributor -c /workspace/biomarker-and-nutrient-tracker --thinking high --json <prompt>`

  (`logs/router.out.log`; prompt redacted by the new log line).

## Router restart (single poller)

- Old poller PID 1706437 (`node src/index.js`, cwd router) `kill`ed; looped until
  `node src/index.js` count = 0.
- Started one instance from `/home/box/.config/telegram-opencode/router`:
  `nohup node src/index.js >> logs/router.out.log 2>&1 &` → PID 1777704.
- Verified: exactly 1× `node src/index.js`; log shows
  `bot commands registered: start, help, status, think, allowance, compact, switch, model, freemodel, unlock, new`.
- Note: `logs/router.out.log` also shows older `409 conflict: another getUpdates poller`
  lines from before the restart (a second poller existed pre-change); after the restart
  only the single new poller remains and it registers `think`.
- Final `state/session.json`: `provider=cline`, `thinking.cline=high` (persisted by smoke).
