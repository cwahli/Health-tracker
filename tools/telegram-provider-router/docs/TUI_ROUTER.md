# `/tui` on the standalone router

The router serves `/tui` the same way bot-host does: it hands out a Telegram
Mini App button that points at the **gateway**, and the gateway does the
`initData` HMAC against *this bot's* token. The router holds no terminal
credential and runs no ttyd — it only publishes the URL and records which chat
opened it, so the gateway-side attach can land on that chat's session.

Commit `86e284f` declared this impossible ("the router has no session/chat
model and no ttyd"). The first half was wrong — the router has kept a per-chat
OpenCode session map since BOT-22 (`src/chat-sessions.js`). The second half was
a statement about the deployment, not about the bot. This is the correction,
and `scripts/assert-command-scope.mjs` now enforces both halves.

## What the router does

| Subcommand | Behaviour |
|-----------|-----------|
| `/tui` | Validates `TUI_GATEWAY_URL`, records `state/tui-open.json`, replies with an `Open the TUI` `web_app` button at `<gateway>/?bot=<botId>` |
| `/tui status` | The recorded chat/lane/session/age, the active provider + model, whether it has a terminal, plus the configured gateway and the bot id |
| `/tui off` | Clears the local record and says plainly that the pane lives on the gateway host, not here |

`botId` is the numeric left half of `TELEGRAM_BOT_TOKEN`. The token itself is
never put in a URL, a log line, or a state file.

### The terminal matches the ACTIVE provider

`/tui` opens the conversation the chat is actually using, not always OpenCode.
Since 2026-09-30 the provider decides the door (`src/tui-provider.js`):

| Provider | Terminal |
|----------|----------|
| `opencode` | `opencode attach <url> --dir <ws> -s <ses_…>` — the chat's OpenCode session |
| `cline` | `cline -i --id <task> -m <model> -c <ws>` — resumes the chat's Cline task |
| `freebuff`, `tokenharbor`, `commandcode` | none — the router says which provider is answering and offers buttons to switch to one with a terminal |

The box attach script (`box/tui-attach-router.sh`) mirrors that mapping, and
`scripts/test-tui-provider.mjs` pins it (including the mismatch where the chat's
provider is Cline but the terminal used to run `opencode attach …`).

### Cline turns share one task

The router used to run `cline --json "<prompt>"` for every Telegram turn, which
starts a **new** Cline task each time — so the chat had no conversation to
resume. Cline's CLI cannot resume one-shot (`--id` forces an interactive TTY),
so the router speaks **ACP** (`cline --acp`, `src/cline-acp.js`): `session/new`
returns the task id, `session/load` continues it, and the id is stored per chat
(`src/provider-sessions.js`). Telegram turns and the TUI therefore land in the
the same task, in both directions.

## What the deployment does

1. **Serve a ttyd for this bot.** It is a distinct ttyd because a distinct
   agent owns a distinct session map: the attach script reads *this* router's
   `state/session.json`, and two bots on one ttyd would attach every chat to the
   wrong conversation.

   ```ini
   # tui-ttyd-router.service (or the box's equivalent)
   Environment=TUI_TMUX_NAME=router-tui
   ```

2. **Register the route and the token on the gateway.** The gateway reads the
   route table from the env instead of hardcoding a third path, and derives the
   socket-token route from it so the two cannot drift:

   ```ini
   TUI_ROUTE_GROK_COMPUTER_BOT_PATH=/ttyr/      # the bot id, upper-cased
   TUI_BOT_TOKEN_GROK_COMPUTER_BOT=…            # same token the router polls with
   TUI_TTYD_URL_GROK_COMPUTER_BOT=http://127.0.0.1:8898
   ```

3. **Point the router at the gateway.**

   ```ini
   TUI_GATEWAY_URL=https://tui.example.org      # a bare https origin, no path
   ```

Then `/tui` opens a terminal. Until step 3 is set, `/tui` answers with what is
missing instead of handing out a dead button, and `/tui status` says the
gateway is unconfigured.

Verify without Telegram:

```bash
cd tools/telegram-provider-router
node scripts/test-tui-miniapp.mjs               # the URL contract + the record
node ../../scripts/assert-tui-gateway.test.mjs # the gateway half (routes, auth)
node ../../scripts/assert-command-scope.mjs    # popup == handlers == declared
```

## Not the router's job

* Closing the pane. bot-host owns a tmux lease and can kill it; the router does
  not read the gateway host's tmux, so `/tui off` clears its record and says so
  rather than reporting a kill it did not perform.
* The gateway's own hostname, TLS, and Caddy wiring — see
  `plan/TUI_IMPLEMENTATION.md` step 2.
