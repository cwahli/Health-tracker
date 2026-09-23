# TG: Cline `/think` on Telegram router

## Repo
`/home/box/.config/telegram-opencode/router/src/index.js`
State: `/home/box/.config/telegram-opencode/router/state/session.json`

## Goal
Wire thinking effort for **Cline** the same way users expect from OpenCode.

Cline CLI already supports:
```
--thinking <none|low|medium|high|xhigh>
```
Bare `--thinking` = medium. Omitted = provider default.

Telegram `runCline` currently only passes:
```
cline -m <model> -c <WORKSPACE> --json <prompt>
```
No `--thinking`, no `/think` command, `/status` says thinking is OpenCode-only.

## Required changes
1. Persist `state.thinking.cline` (or `state.thinking` shared with a per-provider map). Default `medium` or leave unset = CLI default; prefer explicit `medium` once user sets it.
2. Add bot command `/think [level]`:
   - no arg → show current Cline (and OpenCode if any) thinking + allowed levels
   - with arg → set for **active provider** if supported; for Cline validate against none|low|medium|high|xhigh
   - reject unknown levels with a short help line
3. In `runCline`, when a level is set, insert `--thinking <level>` into argv (before the prompt). Flag order must stay valid (`-m`, `-c`, `--thinking`, `--json`, prompt last — match CLI help).
4. `/status` when provider is `cline`: show `Thinking: <level>` (or `default` if unset). Remove/soften the “only when opencode” note when Cline thinking is settable.
5. `/help` + Telegram command menu: add `think`.
6. Busy opener card for Cline: include `(high)` style thinkBit if level is set (reuse existing `thinkBit` helper if present).

## Out of scope
- Freebuff Telegram chat path
- OpenCode variant APIs (leave as-is unless a one-line status consistency is trivial)
- Do not burn Freebuff Freebucks

## Done when
Write `/tmp/TG_CLINE_THINK_REPORT.md` with:
- code changes (functions)
- how `/think high` then a short Cline “Hi ” run includes `--thinking high` (show argv or log proof)
- router restart note (single poller)

Smoke:
1. `/switch cline` (or already on cline)
2. `/think high` → ack
3. `/status` shows Thinking: high
4. Send `Hi ` → Cline replies; process argv or debug log shows `--thinking high`

## Constraints
Surgical patch. One router instance after restart. Do not print tokens.
