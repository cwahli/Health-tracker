# Telegram tool surface

Handoff for a cold agent. Open this file and start at Milestone 0. Do not start a later milestone while the current evidence file is a fail.

Written 2026-10-04 against `bot-host-r14` commit `36a4555` on `main`. Search for the symbols named below. Line numbers drift.

## What the operator needs

Telegram has to be enough to direct and watch the tool, in place of the OpenCode viewer.

That means all of the following, not only `/compact`:

- A message posted in Telegram reaches the session the terminal is showing, without a long wait.
- A second message sent while a turn is running is kept and run in that same session.
- While the tool works, Telegram shows the tools, their targets, how long the current tool has been running, and one current thinking line.
- Skills the operator types, including `/do-verify`, `/do-check-source`, `/do-github-sync`, and `/do-plan-handoff`, reach the tool.
- `/thinking` sets the level the next run actually uses.
- The same behavior holds across lanes (OpenCode, Token Harbor through OpenCode, Cline, Gemini, Freebuff) and across locations (`vps`, `vm2`, `mobile`, `collab`, `grok`, and the VM poller).
- The operator does not retype a scenario to find out whether it works. The agent runs it, compares Telegram with the tool, and fixes it until the written checklist passes.

## Decisions already made

- Keep the session id. `/compact` calls OpenCode `session.compact`. It does not delete the chat's session row. A second command during compaction is refused. This is already in `scripts/lib/compact-session.mjs` and the `compact` case in `scripts/bot-host.mjs`.
- The compact reply must be a short handoff: message counts, tokens, session id, goal, decisions, files, next step, and one sentence that the summary can omit decisions and tool output. The full summary stays available with `/export` in the TUI. Do not spend a second model call to rewrite the summary.
- Thinking on Telegram is one line, recomputed from the accumulated reasoning, capped at `progress.maxChars` (220 on the `vm` row). The full chain of thought stays in the terminal. Do not stream the raw chain of thought into the chat.
- Tool progress is a ledger of the last six tools, not one overwritten line. Each line has name, status, target, and a duration that starts when that tool starts. Repeated calls of the same tool replace that tool's line. Identical consecutive calls collapse to one line with a count. The settled bubble keeps the list.
- Keep the 2.5 second edit gap (`progress.editIntervalMs`). Do not freeze the bubble when `progress.maxEdits` (120 on the `vm` row) is spent. Coalesce to the latest body. Tool changes and the 12 second heartbeat still paint. The final answer is a separate send and is never dropped because the edit count was reached. Skipping an intermediate edit is how Telegram flood control is handled. Rewriting the same message every few hundred milliseconds is what earns flood waits.
- A stale `tx: true` observer work session must not boot a private `opencode serve` on an ordinary message. `ensureOpencodeTui` waits up to 15 seconds for a server `opencode run` does not use. Call `reconcileWorkViewForLane` on the message path only when `viewMode === 'tui'` and both `serverUrl` and `opencodeSessionId` are set. `/tx on` may still ensure a view.
- Pass `--session` once, via `runOpencode`'s `sessionId`. `buildOpencodeArgs` in `scripts/lib/agent-opencode.mjs` already appends `--session` when `sessionId` is set. The turn path also does `extraArgs.push('--session', turnSessionId)` when `workSession.viewMode !== 'tui'`. Remove that extra push.
- Text that starts with `/` and is not a bot command is forwarded to the tool as the user prompt. Bot commands still win. Telegram's menu cannot register a hyphen, so `/do-*` skills are typed, not menu buttons. Add a `/skills` reply that lists them.
- Freebuff stays terminal-only. Do not start a headless Freebuff turn from chat.
- Cline does not share a session with a headless resume (`scripts/lib/tui-surface.mjs`, `sharedSession: false`). Gemini has no terminal. For those lanes, compare Telegram with that tool's own record, and say in chat when the terminal is not this thread.
- A dry lane or an unreachable host is one recorded refusal. Do not retry it in a loop.
- Live proof is an evidence file, not a unit-test pass. Unit tests are necessary and do not close a milestone.
- One writer at a time on `scripts/bot-host.mjs`, `scripts/lib/free-lanes.mjs`, and `scripts/lib/work-session.mjs`.
- Do not commit unrelated dirty files. Do not push to `main`. Do not restart a poller that has a running turn. Do not run a second `getUpdates` poller on a bot token.

## Where the code runs

Read `systemctl cat bot-host@<id>` before assuming a tree. On 2026-10-04:

- The template `/etc/systemd/system/bot-host@.service` runs `/usr/bin/node /home/ubuntu/bot-host-r14/scripts/bot-host.mjs --id=%i` with `WorkingDirectory=/home/ubuntu/bot-host-r14`.
- `bot-host@vm` is overridden to `/home/ubuntu/deploy/Health-tracker/scripts/bot-host.mjs`. VM2, vm3, vm4, vm5, vm6, android, and opencode were on the template.
- Prove the work on VM2 first. Port the same diff to `~/deploy/Health-tracker` only in Milestone 5, after the VM2 evidence file is a pass, and run it once against `@VM_19485_bot`.
- Reload a unit only when `pgrep -P <MainPID>` shows no turn child. Re-read `MainPID` at that moment. The VM2 pid at the time this plan was written was 528252 and will be stale.

Registry: `/home/ubuntu/bot-host-r14/bots/registry.json`. VM2 extends `vm`. Progress inherited from `vm`: `editIntervalMs` 2500, `maxEdits` 120, `maxChars` 220. `progress.mode: concise` is stored and is not what `ProgressRenderer` branches on.

Hosts: `KNOWN_HOSTS` in `scripts/lib/worker-presence.mjs` is `vps`, `vm2`, `mobile`, `collab`, `grok`. `vps` is this machine. `grok` is a worker location, not a second copy of the VM poller.

State for a bot id: `/home/ubuntu/.local/state/bot-host/<id>/` (`sessions.json`, `prefs.json`). OpenCode messages: `/home/ubuntu/.local/share/opencode/opencode.db`, table `session_message`. The `sqlite3` CLI may be missing. Use Node `node:sqlite` `DatabaseSync` read-only, or Python's sqlite3. Session keys are `<workspace>\u0000<sessionId>`.

Operator allowlist user id in the registry is `6218257274`.

Skills on disk at the time of writing, under `/home/ubuntu/.agents/skills/`: `do-check-source`, `do-github-sync`, `do-plan-handoff`, `do-verify`. Inventory that directory again, plus the bot's `agent.sharedSkills`, before listing them. The canonical copy is `~/.agents/skills`.

## The bug that blocks skills

`parseCommand` in `scripts/lib/commands.mjs` treats every message that starts with `/` as a bot command. `handleCommand` in `scripts/bot-host.mjs` answers an unknown name with `Unknown command` and the help menu. `/do-verify` never becomes the tool prompt.

`/thinking` already stores `prefs.variant`. `buildOpencodeArgs` sends it as `-m <model>#<variant>`. The live check is that the child command and the headline show the level that was set.

Follow-up drain is already in the `finally` of the turn: `activeRole` is declared before the `try`, and one queued follow-up is run after the turn. Do not rebuild that. Prove it in Milestone 1.

The working headline is already posted at turn start via `ProgressRenderer.announce`. Keep it.

## How a milestone passes

Build one driver, `scripts/prove-tg-surface.mjs`, in Milestone 0, and use it for every later milestone.

The driver:

1. Refuses to start if the target poller has a turn child.
2. Copies the chat's `sessions.json` and `prefs.json` bindings aside.
3. Binds a new disposable OpenCode session for the proof. Does not compact, delete, or reuse the session that was bound.
4. Sends the scripted text through the existing Telegram user client (`~/.config/bot-host/tg-user.session`, the forge user session). It does not call `getUpdates` on the bot token.
5. Reads the bot's replies from that user client.
6. Reads the disposable session in `session_message`.
7. When the tool has a shared terminal, reads `tmux capture-pane` for that pane. When it does not, the evidence says which record was used instead.
8. Writes `/home/ubuntu/.local/state/bot-host/proof/<milestone>-<utc>.md` with UTC, host, lane, session id, the text sent, the Telegram transcript, the tool transcript, and a checklist of pass or fail lines.
9. Restores the saved session binding and prefs, and the evidence file says that restore happened.

If the user client cannot send, stop. Do not invent a second poller. Report the blocker in the evidence file.

Acceptable is the checklist in the milestone, written before the run. On a fail, fix and rerun the same script at most twice. A third fail stops. The evidence file the operator receives includes the earlier fails and what changed. The operator is not asked to retype the scenario.

An unreachable host or a dry lane is a named skip, not a fail, and is not retried.

Before any mutating command, follow `/home/ubuntu/.agents/skills/do-verify/SKILL.md`. Do not commit on `main`.

## Milestone 0 — Proof driver

**Objective.** Later milestones can be judged without the operator repeating them.

**Work.** Add `scripts/prove-tg-surface.mjs` and a unit test that checks the checklist writer with fixture transcripts. The first live run is a disposable ping on VM2, lane OpenCode, location `vps`.

**Acceptable.**

- The evidence file contains the ping in the Telegram transcript.
- The same text is a user message on the disposable session.
- The session id in the file is that disposable id.
- The operator's previous binding is restored, and the file says so.

**Next.** Stop until that file is a pass.

## Milestone 1 — The message arrives in the watched session

**Objective.** Posting in Telegram reaches the OpenCode session the terminal is showing, without the private-server detour.

**Work.** In `handleMessage`, call `reconcileWorkViewForLane` only for an already-live TUI view. Remove the duplicate `extraArgs` `--session` push. Leave the follow-up drain in place.

**Acceptable.**

- Time from the Telegram send to the disposable session row is under 5 seconds before the model starts.
- The child argv contains `--session` once, and the value is the disposable id.
- A second message sent while the first turn is running appears in that same session after the first turn.
- A shared terminal attached to the chat is on that id.

## Milestone 2 — Telegram shows the work the terminal shows

**Objective.** A person reading only Telegram can see the tools and the current thinking.

**Work.** In `ProgressRenderer` (`scripts/bot-host.mjs`):

- Keep the last six tools. Each line is name, status, target, and duration. Duration does not reset on a later event for the same tool.
- Show them under `So far:` when more than one exists.
- One `Result:` line, about 140 characters, cleared when the next tool has no output.
- One `Thinking:` line from `createReasoningReducer` (`scripts/lib/reasoning-compress.mjs`), capped at 220 characters, moving past the opening sentence.
- Coalesce edits to the latest body at the 2.5 second gap. Tool changes and the heartbeat still paint after the reasoning edit budget. `deliver()` of the final answer stays ungated.
- On settle, the bubble is `✓ Done`, `Stopped`, or `Aborted`, the elapsed time, and the same step list.

**Acceptable.** The diff in the evidence file lists every tool the parent session ran. Each appears on the Telegram bubble with its target. The running tool has a duration. The thinking line is a single line of at most 220 characters and is not stuck on the opening sentence when a later decision sentence exists. The final answer is its own Telegram message. The terminal and the bubble name the same tools.

## Milestone 3 — Skills, thinking level, and the other tool commands

**Objective.** A function available in the tool is available from Telegram, and Telegram says what happened.

**Work.**

- Forward a leading `/` that is not in `BOT_COMMANDS`, `HIDDEN_COMMANDS`, or `COMMAND_ALIASES` to the tool as the prompt.
- Add `/skills`, published in `scripts/lib/commands.mjs`, listing the `/do-*` skill names found on disk and in `agent.sharedSkills`.
- `/thinking <level>` remains the chat pref and is the variant on the next `-m` argument. A level the model does not offer is one refusal and no turn.
- `formatCompactReceipt` leads with counts, tokens, the short session id, and a handoff clipped to about 800 characters: goal, decisions, files, next step. End with the omission sentence and `/export`. No second model call. Failure copy still says the session was left unchanged.
- `/model`, `/agent`, `/build`, `/plan`, `/new`, and `/handoff` change the pref the next run uses. Update the `/compact` menu description, which still says "start fresh".

**Acceptable.** One live sequence on the disposable session, in this order:

1. `/thinking` set to a level that model offers. The next child command contains `#` plus that level. The headline and `/status` show it.
2. `/do-check-source` plus a one-line fixture. The session contains that text. The tool transcript shows the skill started. The Milestone 2 ledger covers the turn.
3. `/compact` while idle. The reply has the handoff. The session id is unchanged. The next ping is on that id.
4. `/new`. The following ping is on a different id, and Telegram says so.

## Milestone 4 — Other lanes

**Objective.** Switching lane does not drop a skill, a thinking level, or the progress report.

Run one section per lane. A dry or unavailable lane is a named skip.

- **OpenCode, including a Token Harbor model OpenCode runs.** Repeat the Milestone 3 sequence when the lane has allowance.
- **Cline.** `/thinking` uses `CLINE_THINKING_LEVELS` and the next Cline invocation carries that level. A `/do-*` message is sent when Cline can load the skill. When it cannot, Telegram says so in one reply and does not spend the turn. Telegram says the Cline screen is not this chat's thread. Compare with Cline's own session record.
- **Gemini.** `/thinking` replies once that this model has no levels. A normal prompt returns its answer in Telegram. A `/do-*` message is either run or refused in one reply. There is no terminal to compare.
- **Freebuff.** The model keyboard does not start a headless turn. Asking for it replies that it runs in the terminal. No session is burned.

**Acceptable.** Every section is a pass, a single clear refusal, or a recorded dry or unavailable. No section is a timeout, an unknown command, or a new session the chat did not name.

## Milestone 5 — Other machines

**Objective.** A location change moves the turn. The chat still shows the work and keeps the session for that place.

**Work.** For each name in `KNOWN_HOSTS`, call `workerStatus` first. Unreachable is one evidence section and is not retried. For each reachable host: `/location <host>`, one disposable ping, the `/thinking` level, and one `/do-check-source` fixture. The ledger still meets Milestone 2. The following message on that host uses the session id that came back.

`vps` is local. `grok` is included when its worker is connected.

After the VM2 evidence is a pass, port the same diff to `/home/ubuntu/deploy/Health-tracker` and run Milestones 1 to 3 once on `bot-host@vm`. Then run the VM2 script once each on `bot-host@vm4`, `bot-host@vm5`, and `bot-host@vm6`, only while that unit is idle. Re-read `systemctl cat` first. Skip a unit whose tree is not the tree you edited.

**Acceptable.** Every reachable host's Telegram footer names that host, the tool record was written there, and the thinking level and skill text arrived. Every unreachable host says the turn did not run. The VM section exists only after VM2 passed. The VM2 binding saved in Milestone 0's manner is restored at the end.

## Milestone 6 — One crossing run

**Objective.** The pieces work as one session.

**Work.** No new feature. One script: location `vps`, OpenCode, set thinking, send `/do-check-source` with a fixture, switch to the next reachable lane that can run a turn, switch to `grok` if it is up, then one more ping. Restore the original location, lane, thinking level, and session binding.

**Acceptable.** One evidence file and one pass. Session ids, thinking level, skill text, and the tool list agree between Telegram and the tool record at each hop. A skipped hop names the reason.

## Milestone T — The terminal opens

**Objective.** `/tui` is a working terminal, not a button to nowhere. The operator killed the `VM-tui-vm2` tmux session by hand on 2026-10-04 and `/tui on` after that opened nothing: no attach attempt ever reached `tui-attach.sh` (no log line), and `/tui status` answered nothing at all (a temporal-dead-zone ReferenceError, fixed and sensor-pinned). A terminal the operator can delete out from under the system must come back on the next open.

**Work.**

- `/tui status` and `/tui off` answer on every lane. The session id they report on is resolved before the branches that use it (the TDZ sensor in `tests/bot-host.test.ts` pins the order).
- `/tui` (open) delivers a fresh `web_app` button for this bot's gateway URL and records `tui-open.json` for the chat's lane and session. A missing URL is one honest reply, never a dead button.
- Tapping the button reaches the gateway (an `/authz` line for a good tap, a named refusal otherwise), runs `tui-attach.sh`, and creates (or reuses) the `VM-tui-<id>` tmux session plus a live `tui-lease.json`. Killing the tmux session by hand must not block the next open: no live lease, no live pane, next tap rebuilds both.
- Closing works detached too: the attach script publishes the pane name to `tui-pane` on every run, so `/tui off` kills a kept pane with no lease (verified kill) and `/tui status` tells kept apart from none. A stale name reads as already gone.
- The Mini App shows the tool for the chat's lane (OpenCode shared session, Cline last thread — never an API-only lane, which is refused with `/freemodel` as the way out).
- Sync follows the lane contract, and the chat says which it is on every turn with an open terminal: an OpenCode terminal shares the session, so a turn here appears there; a Cline terminal shows the last thread the terminal itself started, because Cline cannot resume a thread headlessly and every new message starts a fresh one (proven live 2026-10-04: the "hi" turn ran on `1791118459904_jw1vq` while the terminal stayed on `1791117231407_ud50p`). A chat stuck on the Cline lane by ledger displacement is told so in chat. Cross-lane "the terminal shows my turn" is not promised on Cline — the way to a synced terminal is an OpenCode lane plus a reopen.
- Bare greetings run exact-echo ping turns: "hi" is the operator's connectivity check, so it exercises the real turn path (session, model, reply) rewritten to `reply with exactly PONG, no tools` — cheap, checkable, and visible in the session and the TUI. A canned auto-reply was tried and reverted: it proved nothing about the chain.
- Failproof sync (2026-10-04): `/new` verified-kills the published pane (an open terminal otherwise keeps showing the old session), and `/tui refresh|reopen|reload|resync` is the manual resync for stuck boots and post-failover staleness — kill verified-dead, then a fresh tap rebuilds via attach-time resolution. Reopening always needs a fresh tap: ttyd only runs the attach on a new client.
- Three-at-once (2026-10-04, live): gateway admitted vm+vm2+vm3 concurrently with isolated routes (`/tty/`, `/tty2/`, `/tty3/` → 8896/8899/8900, token-bound per bot in code); all three tmux sessions coexist; two simultaneous viewers on one pane confirmed via lease `clients:2`. One WebView at a time per Telegram client — the others persist in tmux. Caveat: the vm chat sits on the Cline lane, so `VM-tui` shows the last Cline thread and new answers never appear there; a synced terminal needs an OpenCode lane.

**Acceptable.** One live tap witnessed end to end: the Telegram transcript (button reply, no silent miss), a gateway `/authz` line, a `tui-attach.log` decision line, `tmux ls` showing the session, a live lease, and the tool visible in the Mini App (operator screenshot for the last step — phone rendering is witnessed on-device only). A failed tap names which link broke (button, gateway auth, attach refusal, dead pane).

**Network note (2026-10-04).** The operator's network answers the Mini App with a FortiGuard block: category *Dynamic DNS* kills every `*.duckdns.org` hostname before the page loads, so no tap can ever reach the gateway from that network. "Works" therefore includes reachability from the operator's networks: either a non-dynamic-DNS hostname for the TUI (a real domain with an A record; Caddy mints the cert) or a documented unfiltered path (mobile data while the WiFi filters). Until one of those holds, Milestone T cannot pass no matter how green the server side is.

## Order

0, then 1, then 2, then 3, on VM2 local OpenCode. Then 4, then 5, then 6. **T runs after 4** (the terminal follows the chat's lane, so lane behavior must be known first) **and must pass before the VM port step in Milestone 5.** Do not open the next milestone on a failed evidence file.

## Tests

Add or extend tests next to the code you change:

- `tests/bot-host.test.ts` for the forwarded slash prompt, the single `--session`, and the ledger.
- `scripts/lib/compact-session.test.mjs` for the handoff receipt.
- A driver test with fixture transcripts.

Run those tests. They do not replace the evidence file.

## Out of scope

- Rewriting the `/do-*` skill bodies.
- Making Cline or Gemini share an OpenCode session.
- Compacting or deleting the operator's existing long sessions.
- A second poller on any bot token.
- Committing or pushing anything other than this plan unless the operator asks.
- Editing `bots/registry.json` chair assignments.
