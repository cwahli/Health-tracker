# Overnight research: Coding tools ↔ Telegram (this Linux box)

**Written:** Wed 23 Sep 2026 ~00:51 BST (Europe/London)  
**Scope:** How each installed coding tool can be driven from Telegram; packages/bridges; auth presence (names only — **no secret values**); what is already running.  
**Box paths:** `/home/box/.config/telegram-opencode/` (this report + `.env` + logs)

---

## Executive summary

| Tool | TG path tonight | Auth on box | Ready? |
|------|-----------------|-------------|--------|
| **OpenCode** + `opencode-telegram-bot` (djannot **1.1.2**) | **Live** — long-poll bot → `127.0.0.1:4096`, model `opencode/muse-spark-1.3-contributor-free` | `TELEGRAM_BOT_TOKEN` + authorized user ID in `.env` and box-secrets | **Yes (basic)**; richer `/models` `/think` `/compact` `/mode` **not** native on this package |
| **Cline CLI** | **Native** `cline connect telegram` (polling); hub already on `:25463` | Needs its **own** bot token (or carefully shared); provider already `cline` / muse free | **Almost** — start connector; do **not** dual-poll same token as OpenCode bot |
| **Token Harbor** | No TG product; OpenAI-compatible `https://tokenharbor.ai/v1` — any bot/CLI can call DeepSeek | `TOKEN_HARBOR_API_KEY` **PRESENT** in box-secrets (+ injected into OpenCode TG bot process env) | **Yes as LLM backend** |
| **Freebuff** | Official CLI has **no** Telegram/remote bridge; third-party forks exist elsewhere | Logged-in (`manicode` credentials + `authToken` present); ads on; model deepseek-v4-flash | **Local only** unless custom wrapper |
| **Aider / Claude Code / Codex** | No first-party TG; wrap via headless CLI or OpenAI-compatible + custom bot | Aider env files present; Claude + Codex installed | Optional later |

**Bottom line:** Keep the running OpenCode TG bot for Muse-free chat; either upgrade to `@grinev/opencode-telegram-bot` (native controls) **or** rely on new custom tools under `~/.config/opencode/tools/` for session controls. Add **Cline** as a **second** Telegram bot (separate BotFather token) pointed at the existing hub. Use Token Harbor as the paid/DeepSeek provider behind OpenCode/Cline/aider — not as its own TG surface.

---

## 1. OpenCode + Telegram

### Status (verified ~00:51 BST)

- **`opencode serve`**: RUNNING — `127.0.0.1:4096` (pid observed). Log: *OPENCODE_SERVER_PASSWORD is not set; server is unsecured* (localhost-only bind mitigates, but password still recommended).
- **`opencode-telegram-bot`**: RUNNING via `npm exec` / npx cache — package **`opencode-telegram-bot@1.1.2`** (author djannot), args `--url http://127.0.0.1:4096 --model opencode/muse-spark-1.3-contributor-free`.
- Long-polling started; messages from authorized user already processed (session created under `/workspace`).
- OpenCode version: **1.1.x** (`opencode --version` reported in PATH). Config model: `opencode/muse-spark-1.3-contributor-free`.
- Discovered OpenCode commands at bot start: `init`, `review`, `customize-opencode`. Agents: `build`, `explore`, `general`, `plan`.

### TG path / packages

| Package | Version (npm) | Role |
|---------|---------------|------|
| **`opencode-telegram-bot`** (djannot) — **what's running** | 1.1.2 | Forward chat ↔ OpenCode SDK; sessions; permissions/questions as buttons |
| `@grinev/opencode-telegram-bot` | 0.25.3 | Richer: model picker, compact, settings/thinking toggles, projects, tasks, `/opencode_start|stop` |
| `@levra7/opencode-telegram-bot` | 0.20.7 | Fork with `/model`, `/variant`, `/compact`, `/settings`, etc. |
| Others (plugins/bridges) | various | `opencode-telegram-bridge`, `opencode-telegram-session-control`, notify-only plugins — secondary |

**Commands on running djannot 1.1.2** (from its README):  
`/start` `/new` `/sessions` `/title` `/export` `/verbose` `/model` `/agent` `/usage` `/help` + forwarded OpenCode commands.

**Missing vs chiwah’s wish-list (`/models` `/think` `/compact` `/mode`):**

| Wanted | On djannot 1.1.2 | Notes |
|--------|------------------|-------|
| `/models` | Partial — **`/model`** (search/switch) exists; not a `/models` catalog command | Upgrade to grinev/levra7 for fuller picker |
| `/think` | No dedicated slash — **`/verbose`** shows thinking text | Thinking *level* not exposed as bot command |
| `/compact` | **Absent** | Present on grinev/levra7; or custom tool |
| `/mode` | Partial — **`/agent`** switches plan/build/explore/general | Closest equivalent |

### Custom tools path (agent tools)

Per [OpenCode custom tools docs](https://opencode.ai/docs/custom-tools/):

- Global: **`~/.config/opencode/tools/`**
- Per-project: **`.opencode/tools/`**

**Tonight on this box:**

- Dir exists: `/home/box/.config/opencode/tools/`
- Contains `session-controls.ts` + README mapping desired slash semantics to tools (`list_models`, `set_model`, `set_think`, `set_mode`, `compact_session`) against `http://127.0.0.1:4096`.
- These are **LLM-callable tools**, not automatic Telegram slash handlers unless the bot/OpenCode command layer also registers them. Expect the agent to invoke them when asked in natural language, or after wiring slash → tool.

### Auth needed from user

Already present (values **not** recorded here):

- `TELEGRAM_BOT_TOKEN` — in `/home/box/.config/telegram-opencode/.env` and box-secrets card
- `AUTHORIZED_TELEGRAM_USER_ID` / `TELEGRAM_USER_ID` — set in `.env`
- OpenCode Muse free — no separate API key for current model

**Gaps / hardening:**

- Set `OPENCODE_SERVER_PASSWORD` (and matching bot/server auth) — currently unset.
- If upgrading bot package, re-check env var names (`OPENCODE_API_URL` vs `--url`, etc.).

### Recommended architecture (OpenCode)

1. **Short term:** Keep djannot bot + Muse free; use `/model` `/agent` `/verbose`; use custom tools for think/compact/mode where the agent cooperates.
2. **Better UX:** Migrate to **`@grinev/opencode-telegram-bot`** (same token, stop old bot first — Telegram allows only one long-poller per token).
3. Point OpenCode provider at Token Harbor when leaving free Muse (see §3).

---

## 2. Cline CLI (`~/.cline`)

### Status

- Binary: `/home/box/.local/bin/cline` — version **3.0.62**
- Hub daemon: **RUNNING** — `127.0.0.1:25463` (`--cline-hub-daemon`)
- Provider: `cline` / model `cline-free/muse-spark-1.3-contributor`
- Data: `~/.cline/data/` (sessions, settings, logs)

### TG path

**First-party:** `cline connect telegram`

```text
cline connect telegram -k <TELEGRAM_BOT_TOKEN> \
  --allowed-user-id <id> \
  --cwd /path/to/repo \
  --enable-tools \
  --rpc-address 127.0.0.1:25463
```

- Uses **polling** (no public URL).
- Docs also: Discord, Slack, GChat, WhatsApp, Linear (most need public HTTPS webhook).
- Headless remote tasks without TG: `cline -y --json "task"`, or `cline -z` (zen / hub session).

**No separate “cline-telegram” npm package required** — connector ships in the CLI.

### Auth needed from user

- **Separate BotFather token strongly recommended** if OpenCode bot keeps current token (two processes cannot both long-poll one token reliably).
- `--allowed-user-id` (same Telegram user as OpenCode allowlist).
- Optional: Token Harbor / other provider via `cline auth` (`-p` `-k` `-m` `-b`) for non-free models.

### Recommended architecture (Cline)

- Second TG bot: “Cline box” → `cline connect telegram` → existing hub.
- Restrict with `--allowed-user-id` and optionally `--hook-command`.
- Use for act/plan + toolful repo work; keep OpenCode bot for Muse/OpenCode-specific workflows.

---

## 3. Token Harbor

### Status

- **API-based** OpenAI-compatible gateway: `https://tokenharbor.ai/v1` (Anthropic-style base: `https://tokenharbor.ai`).
- DeepSeek example model IDs: `deepseek-v4-flash` / catalog variants (confirm live via `GET /v1/models`).
- **`TOKEN_HARBOR_API_KEY`**: **PRESENT** in `/home/box/sand-data/box-secrets.json` card (prefix shape `thk_liv…` only — value not written here). Also seen as env name on the OpenCode Telegram bot process.

### Can a TG bot call Token Harbor DeepSeek?

**Yes.** Any bot or CLI that speaks OpenAI chat completions can:

1. `base_url=https://tokenharbor.ai/v1`
2. `api_key=$TOKEN_HARBOR_API_KEY`
3. `model=<deepseek id from catalog>`

Patterns:

- Configure **OpenCode** / **Cline** / **aider** provider to Token Harbor, keep existing TG frontends.
- Or a thin custom Telegraf/grammY bot that only proxies chat → Harbor (no coding tools) — usually worse than wiring Harbor behind OpenCode/Cline.

### Auth needed from user

- Key already on box. User may need dashboard top-up / confirm free-tier vs paid model IDs for overnight jobs.
- Do **not** paste the key into Telegram chats or into this markdown.

### Recommended architecture

Treat Harbor as **shared LLM backend**, not a third TG bot.

---

## 4. Freebuff / Codebuff

### Status

- CLI: `/home/box/.local/bin/freebuff` — **0.0.176** (`codebuff` not in PATH; Freebuff is the free Codebuff-line product).
- Config under `~/.config/manicode/`:
  - `credentials.json` — account + **`authToken` PRESENT** (logged in as configured user)
  - `settings.json` — `mode=DEFAULT`, **`adsEnabled=true`**, `freebuffModel=deepseek/deepseek-v4-flash`
- Binary blob also at `~/.config/manicode/freebuff`.
- CLI surface: interactive + `login` + `--continue` / `--cwd` — **no** `--server`, Telegram, or Discord flags.

### Freebucks / credits

- No readable “Freebucks balance” file found under manicode settings.
- Readable non-secret status: **ads enabled**, default mode, DeepSeek V4 Flash selected, first prompt already submitted.
- Full quota/bucks likely only via Freebuff product UI/account — **blocked on human login** to freebuff.com if a live balance is required.

### TG / remote integration

- **Official:** none.
- **Unofficial:** third-party “FreeBuff Telegram bot” PRs exist on unrelated repos (NVIDIA NIM / self-host) — **not installed** here; not the npm `freebuff` CLI.
- Practical remote drive: wrap `freebuff` in a custom bot that shells out (fragile TTY), or skip and use OpenCode/Cline + Harbor DeepSeek instead.

### Auth needed from user

- Already logged in. Re-`freebuff login` if token expires.
- Confirm region/VPN “limited mode” rules if sessions get capped.

---

## 5. Other installed coding CLIs (brief)

| CLI | Version / path | TG? | Notes |
|-----|----------------|-----|-------|
| **aider** | 0.86.2 — `~/.local/bin/aider` | No | OpenAI-compatible; env files under `~/.config/aider/` (`dashscope*.env`, `gemini.env`, `vertex.env`) with API key **names** present. Wire Harbor via `--openai-api-base` + key env. Custom TG wrapper possible. |
| **claude** (Claude Code) | 2.1.258 | No first-party TG | Can use Harbor Anthropic-compatible base; remote usually via their own channels / headless. |
| **codex** | 0.152.1 | No | Same pattern — provider redirect or custom bridge. |
| goose / amp / continue / openhands | not installed | — | Skip unless chiwah wants them. |

---

## Proposed unified architecture

### Option A — **Two bots, clear roles** (recommended)

```
Telegram user (allowlisted)
    │
    ├─ Bot A "OpenCode" ──long poll──► opencode-telegram-bot ──► opencode serve :4096
    │                                      │
    │                                      └─ models: Muse free now; Token Harbor later
    │
    └─ Bot B "Cline" ──long poll──► cline connect telegram ──► hub :25463
                                       │
                                       └─ cwd = active project; --enable-tools
```

- **Pros:** No token fight; failure domains isolated; matches installed software.
- **Cons:** Two BotFather bots to manage.

### Option B — **One router bot** (more build)

```
Single TG bot → small router (slash or prefix)
    /oc …  → OpenCode HTTP/SDK
    /cl …  → cline CLI/hub RPC
    /th …  → Token Harbor chat-only (optional)
    /fb …  → freebuff subprocess (optional, low priority)
```

- Empty placeholder dir exists: `/home/box/.config/telegram-opencode/router/` (no code yet).
- **Pros:** One chat. **Cons:** Must stop current OpenCode bot or merge into router; more code to maintain; careful session mapping.

### Option C — Upgrade OpenCode bot only

- Replace djannot with `@grinev/opencode-telegram-bot` for native compact/model/settings.
- Add Cline later as second bot when needed.

**Recommendation tonight → morning:** Stay on **Option A**; optionally schedule Option C for OpenCode UX; defer Option B unless chiwah wants one inbox.

**Critical rule:** Never run two long-pollers on the **same** `TELEGRAM_BOT_TOKEN`.

---

## Morning checklist for chiwah

1. **Ping OpenCode bot** in Telegram — confirm still replies after overnight.
2. Decide: keep djannot **or** upgrade to `@grinev/opencode-telegram-bot` for `/compact` + richer model UI.
3. **Create second BotFather bot** for Cline (recommended) → store token in box-secrets / a dedicated env file (not this report).
4. Start:  
   `cline connect telegram -k "$CLINE_TG_TOKEN" --allowed-user-id "$TELEGRAM_USER_ID" --cwd <project> --enable-tools`
5. Set **`OPENCODE_SERVER_PASSWORD`** and restart `opencode serve` + TG bot with matching auth.
6. Smoke-test **Token Harbor**: one OpenAI-compatible completion with DeepSeek (from shell or OpenCode provider) — confirm billing/free tier expectations.
7. Try custom tools: ask OpenCode (via TG) to list models / set think / compact — verify `session-controls.ts` loads after serve restart if needed.
8. Freebuff: only if needed — open freebuff.com for bucks/quota; else prefer Harbor DeepSeek via OpenCode/Cline.
9. Security: ensure bots remain allowlisted; do not expose `:4096` or `:25463` beyond localhost without auth.

---

## What was verified tonight vs blocked on human login

### Verified on box (no human)

- Processes: OpenCode serve, OpenCode TG bot, Cline hub — all **running**.
- Ports: `127.0.0.1:4096`, `127.0.0.1:25463`.
- Package identities/versions for OpenCode bot, Cline, Freebuff, aider, claude, codex.
- Credential **presence** (not values): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID` / `AUTHORIZED_TELEGRAM_USER_ID`, `TOKEN_HARBOR_API_KEY`, Freebuff `authToken`, Cline provider config, aider env key **names**.
- Command surfaces: `cline connect telegram`, Freebuff help (no remote), OpenCode custom tools paths + existing `session-controls.ts`.
- Official vs richer OpenCode TG packages on npm.
- Token Harbor public API shape (base URL + DeepSeek via Harbor).
- `OPENCODE_SERVER_PASSWORD` **not** set.
- Freebuff ads/model/settings readable; **no** Freebucks numeric balance file.

### Blocked / needs human

- Creating a **second** Telegram bot (BotFather) for Cline.
- Choosing upgrade to `@grinev/...` vs custom-tools workaround.
- Token Harbor **dashboard** balance / which DeepSeek IDs are free vs paid right now.
- Freebuff **Freebucks / session quota** live status (account UI).
- Setting server password and any non-localhost exposure decisions.
- Approving dual-bot vs single-router product direction.

---

## Secrets policy (this file)

- **No** bot tokens, API keys, or auth token values are written in this document.
- Presence confirmed via key **names** and boolean PRESENT/MISSING only.
- Logs under `logs/` may contain Telegram user IDs and prompts — treat as sensitive; do not commit.

---

*End of overnight report.*
