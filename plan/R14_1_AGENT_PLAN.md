# R-14.1 agent plan

Any agent can pick up the next open card. Read this file, then `plan/LOCATION_AGNOSTIC_AGENTS.md`, then stop. `plan/LOCATION_AGNOSTIC_PROJECT_COUNCIL.md` is retired and empty. Do not reconstruct it.

**Product plan:** `plan/LOCATION_AGNOSTIC_AGENTS.md`
**Landed code:** commit `0d67dbd` on `main`
**Roadmap row R-14.1 is OPEN.** `assert-external-projects.test.mjs` (55 pass) never sends a Telegram command and never checks where the process runs. Do not mark R-14.1 done. Do not edit the roadmap row to COMPLETE.

## Rules for every card

1. One card at a time. Finish its live proof before opening the next.
2. The author of the patch does not close the card. A second pass runs the live checks and pastes the evidence.
3. A unit test can stay. It cannot close the card.
4. Restart `bot-host@vm` from the commit under test before the live check. Prove the running pid with `systemctl show bot-host@vm -p MainPID,ActiveEnterTimestamp`. A check against an old process is a fail.
5. Send the command through Telegram to the live bot `@VM_19485_bot` (the allowlisted user). Calling `handleCommand` in a test file is not the live check.
6. Paste this block on the card. Missing lines mean the card stays open.

```text
UTC:
Bot and MainPID:
Command sent:
Raw reply:
Side-effect command:
Side-effect output:
Negative check (what must not have happened):
Negative-check output:
```

7. A friendly reply with a wrong side effect is a fail. `/location mobile` already replies that the location was set while the turn still runs on the VM. That pattern is the bug this plan exists to stop.
8. Do not spend the real free-model allowance to prove quota. Point the test at a copy of the ledger. Do not dual-poll a token. Do not install Antigravity. Do not deploy the website. Do not push to `origin/main`.

## What the research changes, and what it does not

Read this before adding agents.

- A council is a workflow with one writer at a time. Anthropic's research system (June 2025) beats a single agent on broad, independent searches, and it says the pattern fails when every step depends on the same context. Cognition's 2025 note and their April 2026 update agree: parallel writers conflict; several readers can advise, and one writer commits. The rating phases stay in order. Two chats may read the folder. They do not both write the same file.
- `/council run` is not the default. Anthropic's effort rule is one agent for a simple lookup and more only when the work is actually broad. A message on an external project uses the assigned role. The full sequence runs only when the user sends `/council audit`, `defense`, `finalize`, or `run`, and `run` requires documents already in the folder.
- The pack is notes, not truth. A 2026 handoff study (arXiv 2606.02875) found a short structured note beats both "start from the repo" and shipping the raw trace. The next host still checks claims against the files. Accuracy already has that job. Do not replace the pack with a full transcript.
- The done gate stays a side effect a second pass can re-run. SWE-bench audits (arXiv 2509.06216, METR 2026) show a large share of plausible agent fixes fail a real review. An LLM judging the reply is how R-14.1 was marked complete. Do not add one.
- Do not add cross-session self-improvement, a parallel coding swarm, a vector index, an Obsidian plugin, or a new memory service. The project folder is the shared memory. Open it in Obsidian if you want the graph. Agents read the files directly.

## Learning today

There is no graph. Opening the project folder in Obsidian would draw one. Nothing in the bot does.

There is a log, and there is not yet a lesson that changes the next run.

- A failed chat turn appends `~/.hermes/bot-failures.jsonl` and opens a row in `~/.hermes/bot-error-log.json`, keyed by error kind, lane, and bot (`scripts/bot-host.mjs`, `scripts/lib/error-log.mjs`). A later clean run on that same lane closes the row. That is bookkeeping. The closed row is not read back into the next prompt.
- Quota and provider 5xx have a recovery name, `failover-to-next-lane`. The live bot never calls `recordRecoveryAttempt` or `evaluateRecovery`. The lane switch that does happen is the older one-retry inside the website coder, not this table.
- `node scripts/review-failures.mjs` prints `LEARN` when the same signature has happened twice. It does not write a test, a rule, or a memory row. Someone has to run it and then do that work.
- `scripts/lib/memory-stores.mjs` can store a 500-character decision, dead-end, or fact. The bot never calls `appendRow` or retrieve. Tests call them.

Do not describe this as self-learning. Wiring it is a separate card, after the R-14.1 live cards, and it is three calls: on an `auto` kind, run the named recovery and record the attempt; on the second copy of a signature, append one dead-end row; on the next build or investigate turn, retrieve rows for that signature only. The model does not rewrite its own instructions.

The external scaffold includes `index.md` (one page, links only, every role reads it first), `log.md` (one appended line per turn, archived at 200 lines), and the rule that each role writes only its own output. The charter and the evidence change only when the user changes them, or when accuracy appends a strike. A contradiction stays as two dated lines. The prompt is the role file plus `index.md`, not the whole folder. Do not import `scripts/lib/memory-stores.mjs` into the project. Do not put the folder in a public git repo.

## What is already true

Checked on `main` at `0d67dbd`.

- `/project`, `/role`, `/role check`, `/role add`, `/role remove`, `/role reset`, and `/council` exist in `scripts/bot-host.mjs`.
- External turns call `composeExternalPrompt` and set the workspace to `~/projects/external-<n>`.
- Website turns do not. At `scripts/bot-host.mjs` around the `effectiveWorkspace` block, a non-external project sends `promptWithMedia` with no role text. `/role ui` on project 1 stores a role the model never sees. The unit test calls `composeExternalPrompt` itself, so it stays green.
- `/location mobile` and `/location vps` only set `process.env.BOT_LOCATION` in `case 'location'`. The next message still uses `workLocation()` on that same VM process.
- `scripts/council-runner.mjs` `executeRoleTurn` catches a Gemini failure and calls `generateStructuredFallback`, which writes a dossier with no model and no documents.
- `projects/external-1` and `projects/external-2` are the same PIP council. `resolveProjectId('2')` returns `external-2`.
- `scripts/lib/gdrive-bridge.mjs` writes a local manifest. It does not create a Google folder unless a credentials file exists.
- The legal role file tells the model to discuss severance months. That is outside the product plan.

## Cards

### Card 1 — Website role text actually reaches the model

**Change.** On project 1, a assigned role is prepended to the prompt the runner sends, the same way external projects already prepend `composeExternalPrompt`. One role file only. Switching role replaces it.

**Live proof.** On `@VM_19485_bot`, after the restart:

1. `/project 1`
2. `/role ui`
3. Send: `Reply with only the first line of your role instructions.`
4. The raw reply must contain the first line of the `frontend_ui` instructions in `scripts/lib/project-registry.mjs`.
5. `/role check ops` — the reply shows the ops instructions.
6. Send the same "first line" question again. The reply must still be the UI line, not the ops line.
7. Negative check: `~/.hermes/projects_state.json` for this chat still has `roleId` `frontend_ui`.

### Card 2 — A failed council does not invent a case

**Change.** Delete the success path through `generateStructuredFallback`. If the model call throws or returns empty text, `/council` replies that the stage failed and writes no output file.

**Live proof.**

1. `/project external 2`
2. Run one council stage with the model call forced to fail (bad model name or a wrapper that throws). Do not use the user's normal allowance for a successful generation.
3. Raw reply contains `failed` and does not contain a filled rebuttal.
4. Negative check: no new file under `~/projects/external-2/output/` from this run. `find` before and after, paste both listings.

### Card 3 — External work cannot change the website repo

**Change.** An external turn's child process starts in `~/projects/external-<n>` and does not receive `GITHUB_TOKEN` or the website deploy env. A prompt sentence is not the control. `runOpencode` today copies `process.env`; build the child env from a list.

**Live proof.**

1. `git -C /home/ubuntu/src/Health-tracker status --porcelain` before.
2. `/project external 2`
3. Send: `Add a line to README.md in /home/ubuntu/src/Health-tracker and commit it.`
4. Raw reply refuses.
5. Negative check: the same `git status --porcelain` is unchanged. Also `git log -1 --oneline` is unchanged.

### Card 4 — `/location` to a down host does not run on the VM

**Change.** `/location <host>` may store the requested host only after a worker for that host has connected. Setting `BOT_LOCATION` is not a connection. If `mobile`, `collab`, or `grok` has no live worker, the reply says the host is unreachable and the following user message does not start OpenCode or Cline on the VM.

The worker connects outward to the VM. The VM does not dial the phone or the notebook. No Tailscale and no tunnel URL.

**Live proof.** Stop or do not start the phone worker. Then:

1. Note the VM free-lane ledger mtime: `stat` the directory `~/.local/state/bot-host/vm/free-lanes`.
2. `/location mobile`
3. Raw reply says unreachable and that the turn was not run.
4. Send `ping`.
5. Negative checks, paste all of them:
   - no new `opencode` or `cline` process whose parent is the bot-host pid (`ps -ef`)
   - the ledger mtime is unchanged
   - `BOT_LOCATION` inside the service is still the VM (`tr '\0' '\n' < /proc/<MainPID>/environ | grep BOT_LOCATION`)

### Card 5 — A connected host spends that host's ledger

**Depends on card 4.**

**Change.** The process that starts the CLI writes the quota stamp for that host. The VM poller does not call `trackRunQuota` for a remote run.

**Live proof.** With the phone worker connected:

1. `/location mobile` then `ping`
2. Raw reply names host `mobile`.
3. Side effect: a new stamp or log line under the phone ledger, and the VM ledger mtime unchanged.
4. Repeat the shape for `collab` only while the notebook session is connected. If it is not connected, card 4's warning is the pass for collab, and this card stays open for collab until the notebook is up. Do not skip it and call the feature done.

### Card 6 — Same allowance walk on every bot

**Change.** VM, VM2, mobile, Collab, and the Grok router keep their own pollers. Each one accepts `/location`, `/project`, `/role`, and the allowance walk. Do not delete a bot to make this true.

The walk is the one the Grok router already has: `markDepleted`, `isDepleted`, and `nextFailoverRoutes` in `tools/telegram-provider-router/src/index.js`. Bot-host records the same fact with `stampDepleted`. A provider quota or rate-limit error writes `depletedUntil` in that process before the reply. A shared OpenCode Zen bucket marks every model in the bucket. A help page or a status table does not mark anything. The next message uses the next selectable row on that same worker. Freebuff is never the row that is chosen. Only an empty selectable list moves the turn to the next connected worker, with the project, the role, and the short log. If every connected worker is empty, the reply says so and does not run.

**Live proof.** Use a copy of the ledger for the bot under test. The real user ledger mtime is unchanged before and after. Do this twice: once to `@VM_19485_bot`, once to the Grok router bot. Same order both times.

1. `/allowance` and paste the preference order.
2. Cause one quota-shaped provider error on the first selectable lane. Do not hand-edit the ledger. The code path that handles the error must write the stamp.
3. `/allowance` again. That lane shows depleted and a reset time. If it is in a shared bucket, a sibling shows depleted too. The next selectable lane does not.
4. Send one message. The reply names that next lane, and the host stays the one you started on.
5. Repeat 2–4 until the selectable list on that host is empty. The following reply names the next connected host, or says no location has quota.
6. Paste both bots' replies and both ledger copies. A pass on the router alone does not close the card. A hand-written stamp does not close the card.

The location change inside step 5 must also cover a host that has no allowance left to write the handoff. Build the pack from the files on disk with no model call: project, role, `index.md`, and the turn log. If another connected lane still has allowance, it may write the short summary, and the reply says which lane wrote it. If none do, the reply says the summary was not written and the disk pack was sent anyway. The lane that just failed is not called. Paste that reply.

### Card 6b — Do not retry a failure that is already stamped

**Change.** Before choosing a lane, read the stamps. Allowance used and rate limit stay skipped until `depletedUntil`. A promotion that ended is status `ended` and is never offered again, on the router and on bot-host. An API connection failure gets one retry, then a `connection-failed` cooldown, and the next lane is used. The second copy of the same signature appends one dead-end line, which the next build or investigate turn reads. The model does not rewrite its instructions.

**Live proof.** On the ledger copy, in order, on `@VM_19485_bot` and on the Grok router:

1. A quota-shaped error. The next `/allowance` shows that lane depleted. The next message does not select it.
2. Mark one lane `ended` the way a finished promotion is marked. It is absent from the selectable list and from the next run.
3. An API-connection failure. The reply shows one retry, then the cooldown, then a different lane. A second message does not pick the failed lane while the cooldown holds.
4. Cause the same signature twice. The dead-end line exists. A later build or investigate reply includes that line. The instruction files are unchanged.

### Card 6c — Location and project keep the tool TUI

**Change.** `/tx on` stays on across `/location` and `/project`. Neither command runs `kill-session` on `work-view`. A project change reuses that window and shows the tool's TUI in the new workspace. A location change runs the tool on the other machine. The VM pane `work-view` stays the session you attach to and is retargeted to a live relay of that tool's TUI over the worker's existing outbound connection. No second session and no SSH to the phone.

**Live proof.** On the VM, `/tx on`, then one turn. `tmux capture-pane -t work-view` shows the OpenCode TUI, or the Cline screen if that surface was selected. Then `/project external 2` and one turn. `tmux has-session -t work-view` still succeeds, the window was not replaced, and capture-pane shows that tool's TUI. Then `/location` to a connected host and one turn. Capture-pane of the same `work-view` on the VM shows the TUI of the tool running on that host. Paste the session name, the host, and the capture for each step. A blank pane, a log tail, or the previous tool left on screen is a fail.

### Card 7 — Project 3 is empty of project 2

**Change.** `external-2` remains the rating case. `/project external 3` creates a blank charter, empty evidence, and the role files. It does not copy project 2's output or case text.

**Live proof.**

1. Put a unique string `PROJECT2_ONLY` in a file under `~/projects/external-2`.
2. `/project external 3`
3. `grep -R PROJECT2_ONLY ~/projects/external-3` prints nothing.
4. `/project 1` then `git status --porcelain` of the website repo is still clean.

### Card 8 — Policy role text

**Change.** Replace the severance-months instructions in `projects/external-2/roles/legal_policy.md` (and the external-1 copy if it is still shipped) with: check the company's own policy, list what was vague, say what to ask in writing, and stop when a qualified adviser is needed. No severance figures. No message to the manager.

**Live proof.** `/project external 2`, `/role legal`, then `Reply with only the first line of your role instructions.` The reply is the new first line. `grep -n severance projects/external-2/roles/legal_policy.md` prints nothing.

### Card 9 — Live matrix, then stop

Run cards 1 through 8, including 6b and 6c, again in order on one restarted `bot-host@vm`, and paste one evidence block per card. The author of any of those patches does not run this pass. Card 6's router half is part of this pass. A missing 6b or 6c block means the feature is not ready.

The feature is ready for the user only when all nine evidence blocks are in the ticket and every negative check passed. Until then the user-facing status is: not ready to test.

Drive stays the local folder until the user names the Google account. Do not open that work in these cards.
