# TG long-term: Cline + Freebuff

## Goal
Make Telegram Cline and Freebuff durable: no bot crashes, Cline accepts short prompts, Freebuff either works via HTTP/one-shot or reports an honest blocked reason (not “never supported”).

## Files
- Router: `/home/box/.config/telegram-opencode/router/src/index.js` (+ optional `src/freebuff-http.js`)
- Creds (do not print secrets): `/home/box/.config/manicode/credentials.json`
- Report out: `/tmp/TG_CLINE_FREEBUFF_REPORT.md`
- Smoke: `/tmp/tg-fixes/smoke-cline.sh`

## Cline (ship)
Bug: `cline … Hi` → `Unknown command or unquoted prompt`. `cline … "Hi "` works.

In `runCline`:
1. If trimmed prompt has no whitespace, append a trailing space before argv.
2. Keep prompt as a single argv last; flags `-m` `-c` `--json` as used today.
3. Strip ANSI on errors; keep JSONL best-effort parse.
4. Keep Cline visible in `/freemodel` when auth OK.
5. Smoke script must prove `Hi` works with the same argv shape.
6. Restart router once after edit (single poller only).

## Freebuff (ship best available)
Known facts (re-verify while working):
- CLI help is TUI/`login` only — old `freebuff chat -m` / `fb -m` are gone; never `spawn fb` without PATH check (ENOENT crashed the bot).
- HTTP host that accepts the CLI Bearer token: `https://www.codebuff.com`
  - `GET /api/v1/me` → 200 `{"id":…}`
  - `POST /api/v1/agent-runs` body `{"action":"START","agentId":"base"}` → `{"runId":…}`
  - `POST /api/v1/chat/completions` → currently `{"message":"No runId found in request body"}` for several JSON shapes — continue spike (headers `x-freebuff-instance-id`, `x-freebuff-model`, `x-freebuff-acting-user-id`; admission `POST /api/v1/freebuff/session/admission`; usage `POST /api/v1/usage` with `{fingerprintId}`).
- Usage recently showed `remainingBalance: 0` — if still empty, TG must say credits/Freebucks empty + reset time when known.
- Incomplete `~/.config/manicode/.freebuff-*.part` downloads are not runnable.

Implement `runFreebuff`:
1. No unhandled spawn on missing binaries.
2. Prefer HTTP if you unlock a real assistant reply (document exact working request in the report).
3. Else clear Telegram text: signed-in?, balance/reset, use Muse/Token Harbor/Cline until one-shot works — do **not** imply Freebuff never worked on TG.
4. Freemodel: restore selectable Freebuff only if one-shot/HTTP works and quota allows; otherwise honest unavailable status.

## Out of scope
Grok workers; Health-tracker app code; paid Freebuff top-ups; burning Freebucks for this ticket if balance is 0.

## Done when
- Cline smoke `Hi` succeeds; freemodel still lists Cline.
- Freebuff: real TG reply **or** durable honest blocker + no crash.
- Report written at `/tmp/TG_CLINE_FREEBUFF_REPORT.md`.
