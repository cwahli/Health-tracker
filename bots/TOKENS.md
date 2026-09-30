# Bot tokens — where they live and how they propagate

> Secrets stay on hosts, never in git. This file maps the flow so any agent
> (or future-you) knows where to look. For the capability contract see
> `bots/capabilities.json`; for the feature pipeline see `plan/RELIABILITY.md` §14.

## The three layers

```
1. MASTER (the forge writes it)  ~/.config/bot-host/tokens.env   one KEY=value per bot
2. PROPAGATE (the forge runs it) node scripts/sync-bot-tokens.mjs [--check] [--restart]
3. LIVE (bots read these)        per-runtime env files (below) — never edit by hand
```

You do not hand-edit layer 1 to create a bot: the forge writes the master line
and runs the sync itself (below). Edit it by hand only to rotate one token.

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

**Add a bot (one tap, in Telegram):** on the master bot, `/forge` sends a Mini App
button. Type a name and Create — the page calls the gateway's `/forge/api/*`, and
the run mints or accepts the token, writes the registry row, adds the master
line, syncs the env files, generates and checks supervision, proves the token
with `getMe`, and enables the bot. Nothing is edited by hand. The token comes
from the userbot asking @BotFather when a session is configured; otherwise paste
the token @BotFather gave you into the page. (The page is served by the TUI
gateway at `/forge` behind the same initData door as `/tui` and `/bugs`.)

**Add a bot (one command):**

```bash
node scripts/bot-forge.mjs --create --name="VM3 Bot" --token=<token from @BotFather>
```

The forge is the one creation path: it validates the name/token, writes the thin
registry row through `add-bot.mjs`, adds the master token line, runs
`sync-bot-tokens.mjs`, generates the user-scope unit and checks that the unit's
`EnvironmentFile` is the file the sync just wrote, proves the token with `getMe`,
publishes the command menu, and only then flips `"enabled": true`. A step that
fails stops the pipeline and names itself, so a half-created bot is never
reported as created. `--dry-run` plans it and writes nothing.

With a userbot session it can also mint the token itself (`node
scripts/bot-forge.mjs --create --name="VM3 Bot"` with no `--token`), and
`node scripts/bot-forge.mjs --serve` puts the same pipeline behind a Mini App
page for a phone. Both are optional: the paste path above needs neither.

**Add a bot (by hand)** — the same steps, one at a time:

```bash
node scripts/add-bot.mjs --id=vm3 --name="VM3 Bot"   # thin row, dry-run with --dry-run
node scripts/assert-bot-clone.mjs                    # prove it is a clone of the master
```

Then BotFather → add `NAME_TOKEN=<value>` to master `tokens.env` →
`sync-bot-tokens.mjs --check`, then without it → `systemctl --user enable --now
bot-host@<id>` → prove one E2E reply → `node scripts/add-bot.mjs --enable=vm3`.

**Supervision (user scope).** The forge generates `bot-host@.service` into
`~/.config/systemd/user/` from the repo's own `systemd/bot-host@.service`, so the
live unit and the generated one cannot drift. One host-level step needs root,
once: `loginctl enable-linger <user>`. Without it a user unit stops when the
last session ends.

**A new bot is a thin row, never a copy.** `bots/registry.json` names a `master`
(`vm`) and `scripts/lib/registry.mjs` `applyMasterDefaults()` merges that master's
`agent` / `progress` / `session` onto every bot of the same runtime, resolving
`extends` all the way down a chain. So a row declares only what is genuinely its
own: `id`, `name`, `runtime`, `enabled`, `extends`, `telegram.tokenEnv`, and at
most a per-bot screenshot dir. Restating an inherited block is what makes a fleet
lose its features one bot at a time — the copy keeps the old value the day the
master moves, and nothing looks wrong. `scripts/assert-bot-clone.mjs` is the gate
that refuses it (run it before every registry change; CI runs it too), and
`scripts/assert-bot-clone.test.mjs` proves the gate still fires.

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
