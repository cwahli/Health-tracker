# Bot tokens — where they live and how they propagate

> Secrets stay on hosts, never in git. This file maps the flow so any agent
> (or future-you) knows where to look. For the capability contract see
> `bots/capabilities.json`; for the feature pipeline see `plan/RELIABILITY.md` §14.

## The three layers

```
1. MASTER (edit this)      ~/.config/bot-host/tokens.env      one KEY=value per bot
2. PROPAGATE (run this)    node scripts/sync-bot-tokens.mjs [--check] [--restart]
3. LIVE (bots read these)  per-runtime env files (below) — never edit by hand
```

The master file is **never read by a running bot**. Services load only layer 3
via systemd `EnvironmentFile` (`bot-host@.service` reads `common.env` + `<id>.env`).

## Where each runtime reads its token

| Runtime | Live file | Written by sync? |
|---|---|---|
| `bot-host` / `collab` | `~/.config/bot-host/<id>.env` (e.g. `vm.env` holds `VM_BOT_TOKEN=…`) | yes |
| `hermes` | `~/.hermes/.env` or `~/.hermes/profiles/<profile>/.env` (`TELEGRAM_BOT_TOKEN` line only, rest untouched) | yes |
| `device` (phone) | on the phone itself (`~/.config/opencode-bot/*.env`) | **no — phone owns it**, sync prints `device-owned — not synced` |
| foreign (e.g. `tg-provider-router`) | on its own host (`~/.config/telegram-opencode/router/`) | no |

## Registry link

`bots/registry.json` → each bot's `telegram.tokenEnv` names the master key
(e.g. `vm` → `VM_BOT_TOKEN`, `mobile` → `MOBILE_BOT_TOKEN`, `vm2` → `VM2_BOT_TOKEN`).
`loadRegistry` enforces one token per poller (BOT-5): duplicate `tokenEnv` fails fast.

## Procedures

**Add a bot:** BotFather → new token → append `NAME_TOKEN=<value>` to master
`tokens.env` → add registry entry (`tokenEnv` must match) → `sync-bot-tokens.mjs --check`
→ run without `--check` (add `--restart` for live bot-host bots) → prove one E2E reply.

**Rotate a token:** replace the value in master → sync → restart that service only.
Never restart hosts that don't own the token.

**Retire a bot (BOT-10):** prove the replacement answers → delete the master line →
remove the registry entry → `rm ~/.config/bot-host/<id>.env` → stop/disable its service.

**Check state (no writes):** `node scripts/sync-bot-tokens.mjs --list` prints every
bot with `hasToken yes/no` — a `no` means the master line is missing (today: `vm2`).

## Troubleshooting

| Symptom | Look at |
|---|---|
| Service crash-loops at boot | `journalctl -u bot-host@<id>` — registry validation errors print here, not in chat |
| Bot silent, service active | wrong token in `<id>.env` (another bot answers instead) or webhook set — `getMe` check |
| `device-owned — not synced` | expected: paste the token on the phone, VPS never holds it |
| New registry bot not starting | `tokenEnv` must exist in master AND entry needs `agent.kind` unless foreign runtime |
