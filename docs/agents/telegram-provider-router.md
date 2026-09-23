# Telegram provider router (shareable)

**Canonical package:** [`tools/telegram-provider-router/`](../../tools/telegram-provider-router/README.md)

That tree is the multi-provider Telegram system (OpenCode / Cline / Token Harbor / Cloudflare / Freebuff), including:

- Shared vs per-model free-allowance buckets and `/allowance`
- Single-poller flock, sticky Busy self-heal, hang unlock, work-so-far reports
- Failover that re-dispatches the user prompt

Live runtime on the shared box is still `~/.config/telegram-opencode/router/` (secrets stay there). Sync code from git into that path; never commit secrets.

Older typing / multi-bot standards: [`telegram_work.md`](./telegram_work.md). Bot registry for `bot-host`: [`bots/registry.json`](../../bots/registry.json).
