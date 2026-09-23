# Shared root (all agents on this computer)

Canonical cross-agent pack:

`/home/box/agent-data/shared/telegram-capabilities/`

- `registry.json` — live vs planned (matrix, photo-intake, …)
- `bin/sync-from-repo.sh` — refresh shared pack from this git folder
- `bin/deploy-to-live.sh` — push code to `~/.config/telegram-opencode/router/`

This git tree is the versioned source; the shared pack is what every Grok agent should open first.
