# R-16 live evidence — 2026-09-26 Telegram pass (appendix)

Serving tree for every capture below: `/home/ubuntu/bot-host-r14`
(production service `bot-host@vm`), unless noted. Chat 6218257274.
Single poller verified before and after (zero 409s).

## QS-2 + QS-10 live: full failover cascade in one turn (vps)

`Reply with the single word: ok` answered through four lanes, each announced:

- `🔀 cline:cline-free/deepseek-v4.1-flash failed (free limit hit (Retry in
  ~2h 16m.)) — switching to opencode/muse-spark-1.3-contributor-free…`
- `🔀 opencode/muse-spark-1.3-contributor-free failed (free limit hit) —
  switching to opencode/mimo-v2.6-flash-free…`
- `🔀 opencode/mimo-v2.6-flash-free failed (free limit hit) — switching to
  opencode/space-bunny-free…`
- `ok` + usage footer.

No raw JSON anywhere. Tier walk observed in the wild (coding lanes in
preference order, light fallback last). Cost, disclosed: the pass consumed
real daily free quota — DeepSeek V4.1 Flash depleted until 14:00Z, Muse 1.3
until ~12:00Z. Live proof spends quota; there is no free way to watch
failover fire.

## QS-2 tap path live: depleted-lane button

Tapping the ❌ Muse CL button (Telethon click on the live keyboard) replied:
`That lane is depleted (reset in 18m). Next up: cline:deepseek v4.1 flash
(free) (cline:cline-free/deepseek-v4.1-flash)` + refreshed tier-grouped
allowance table. Buttons carry tier words + bakeoff scores live (QS-6/7
visible in the keyboard itself).

## QS-6/7 live render

`/freemodel`: `Total: 30 · 28 usable`, `Coding-agent capable 11 · Light ·
docs/inventory 19` breakdown line; `/allowance`: same 30 rows in tier-grouped
monospace table with AA scores. Parity eyeball-matched.

## NEW DEFECT (found live, open): stale session row holds every remote turn

After the roam, every `/location mobile|collab|grok` turn holds at preflight:
`session ses_f227779acffeXj1OcLC4RXXWTW is not on this host`. Facts:
- The bot's sessions map (`~/.local/state/bot-host/vm/sessions.json`) points
  chat 6218257274 at `ses_f227…`.
- The relay's opencode store holds 64 sessions, but NOT `ses_f227…`.
- So a thread id outlived its conversation (created elsewhere / compacted /
  rotated), and the row now fails closed forever: no remote turn can pass
  preflight until the row is repaired (`/new` or equivalent). There is no
  self-healing path — fail-closed with no recovery is a hold that never clears.
- Proposed repair (not yet implemented): on session-404 at preflight, offer an
  explicit fresh start (`sessionId=''` + notice naming the lost thread) instead
  of holding indefinitely. Running blank *with* a notice is honest; holding
  forever on a ghost id is a stuck chat. Needs a product decision — it changes
  hold semantics owned by the turn path.

## Machine identity live

`/location <host>` now answers `worker: unknown machine` for the VPS-local
stand-ins, and canary settlement treats them accordingly. A real device will
be distinguishable by hostname on the record. No real device worker has ever
connected: QS-1/QS-3/QS-4/QS-9 stay red for exactly that reason.

## TUI step 1 pass, 2026-09-27 — rows S1/S2 partial, author-run

Serving tree `/home/ubuntu/bot-host-r14` at `32aa1b0`; `bot-host@vm` MainPID
2073855, `bot-host@vm2` MainPID 2073531 (both restarted onto that commit).
Chat 6218257274, driven by the Telethon user session
(`proto/tg-user-session/driver.py`) — no human in the loop for any capture
below. Shipped in #306 (S1 mechanism), #308 (defect found live), #309 (S2).

Rows are **not** marked. Author-of-the-patch rule applies; see *Not proven*.

### Shipped

- `tui-attach.sh` resolves the chat's own session: `TUI_CHAT_ID` →
  `tui-open.json` (written by `bot-host` on every `/tui`: chat, session,
  timestamp) → legacy first-session fallback, with the decision labelled
  (`explicit-hit` / `tui-open-hit` / `legacy-first`) and a `TUI_DRY_RUN=1`
  headless seam.
- `chatId` is `String()`-ed once at both entry points.
- A remote turn's result that lands after `/abort` is buried, not delivered.

### Live proof 1 — the attach names the chat that opened it

`/tui` sent on each bot, then the real attach script's dry-run seam:

| bot | `tui-open.json` after `/tui` | dry-run resolution |
| --- | --- | --- |
| vm (`VM_19485_bot`) | `chatId 6218257274`, `sessionId ses_f227779acffeXj1OcLC4RXXWTW`, 10:04:51.811Z | `SID=ses_f227… SOURCE=tui-open-hit` |
| vm2 (`VM2_19485_bot`) | `chatId 6218257274`, `sessionId ses_f208cbf6cffepaoCKtcdzk8OeC`, 10:05:24.203Z | `SID=ses_f208… SOURCE=tui-open-hit` |

Two bots, two distinct threads, each resolved from its own state dir. Before
#306 the same script printed `ids[0]` — the first session in the map, with the
label hidden, which is how two chats silently shared one thread.

### Live proof 2 — session continuity across a restart (defect found live)

First `/tui` after #306 recorded `sessionId: null` while
`~/.local/state/bot-host/vm/sessions.json` held the entry. Root cause: turns
wrote the sessions `Map` with the raw Telegram id (a number) and
`saveMap`/`loadMap` stringify keys, so after **every** restart all
`sessions.get()` calls missed until that chat's next turn re-set them. It is
not a TUI bug — session continuity silently reset on each deploy, and the TUI
attach path inherited it.

After #308, `systemctl restart bot-host@vm` (pid 2062151) followed by `/tui`
with no prior turn in the new process:

```
{ "chatId": "6218257274", "sessionId": "ses_f227779acffeXj1OcLC4RXXWTW",
  "at": "2026-09-27T10:06:07.003Z" }
```

### Live proof 3 — Stop (S2): before and after

Before #309, one `/abort` on a remote (grok) turn, 2000-word essay requested:

```
(6862) 10:06:34 request sent
(6865) 10:06:5x /abort
(6866) 10:06:59 "Aborting the running request..."
(6867…6873) 10:07:25–10:07:26  all seven essay sections arrive
```

26 seconds **after** the ack, the whole cancelled answer landed. The local
delivery path consulted the aborted flag; `runRemoteTurn` → `renderer.finish`
never did.

After #309, same probe:

```
(6880) request sent
(6883) /abort
(6884) 10:24:56 "Aborting the running request..."
(6885) 10:25:06 "Aborted."
(nothing else at +90s)
```

Observer verdict on the `work-view` pane: `"type":"aborted"`. The turn's
provider was Cline (`cline:cline-free/deepseek-v4.1-flash`, 93s at the abort),
so this is not a fast-model artefact. Residual kept honest: the worker-side
kill is still best-effort (fire-and-forget relay flag + multi-second poll), so
a model that finishes before it sees the flag still burns its own work — its
answer just cannot reach the chat any more.

### Not proven / open

- **Rows S1 and S2 as written are not satisfied.** Both require the injected
  Mini App page: Stop-and-type as a button, the event feed staying up, and the
  PTY. That page does not exist yet (step 1's second half, step 4). What is
  proven is the mechanism underneath plus the `/abort` command path.
- **Two chats on one bot, live: no second reachable chat exists.** The only
  other chat in vm2's sessions map is `-5208347201` "Case review", and the bot
  is no longer in it: `get_participants` returns exactly 1 (the user), the last
  thing the bot said there was 2026-09-26 22:56:27Z, and a `/tui` sent into
  that group at 10:27:04Z got no reply and no journal entry on
  `bot-host@vm2` — a bot outside a chat receives no updates for it. I did not
  add the bot to a group or create a group in the user's account to
  manufacture one. Two-chat coverage is therefore sensor-level for now
  (`assert-tui-chat-select` drives two chats in one map with the non-first
  order that broke the old code) plus the two live per-bot captures above.
  **A human adding a bot to a chat, or a second DM, is what unblocks the live
  half of S1.**
- **Ghost chat row (new finding, no code change).** `-5208347201` stays in
  vm2's `sessions.json` with a live-looking `ses_` id for a chat the bot was
  removed from. Harmless as long as no turn runs there, but it is the kind of
  row that makes a future "which chat is this?" question unanswerable. It also
  means the earlier roam evidence that used that row measured a chat that no
  longer exists.
- **`tui-gateway.service` was crash-looping during this pass** —
  `EADDRINUSE 127.0.0.1:8897`, `NRestarts` 7 at 10:28Z. The holder was
  `node /tmp/tuigw/tui-gateway.mjs` (pid 2077326, started 10:27:58), a
  hand-started debug copy from a live interactive SSH session, differing from
  the serving file only by added fingerprint logging on the landing/refused
  paths. Left running on purpose: it is someone's in-flight debugging, and the
  managed service takes 8897 back the moment that copy stops
  (`sudo systemctl start tui-gateway`).
