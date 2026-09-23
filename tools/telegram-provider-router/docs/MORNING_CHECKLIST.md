# Morning checklist — Telegram multi-provider

## Ready tonight (no login needed)
- [x] Bot token + your Telegram user ID stored (secrets)
- [x] OpenCode serve healthy on `:4096` with Muse free
- [x] Stock OpenCode TG bot was working (Muse replies)
- [x] Token Harbor API key present on box
- [x] Cline CLI + hub daemon present
- [x] Router package scaffolded under `~/.config/telegram-opencode/router`
- [x] Best-practice doc written

## Start router (replaces stock bot poller)
```bash
# stop stock OpenCode-only bot first
pkill -f opencode-telegram-bot || true
cd ~/.config/telegram-opencode/router && npm start
```

## Commands (router)
- `/switch` — show providers
- `/switch opencode|cline|tokenharbor|freebuff`
- `/model` — list free models for active provider
- `/model <id>` — select model
- `/status` — provider + model + session
- `/new` — fresh session on active provider
- plain text — send to active backend

## Needs you only if
- Freebuff DeepSeek: refill Freebucks / country verify on your phone
- OpenCode DeepSeek: buy Go credits if you want DeepSeek via OpenCode Zen
- Confirm Token Harbor free model id if list differs
