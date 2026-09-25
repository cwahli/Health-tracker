# R-14.1 agent plan

Any agent can pick up the next open card. Read this file and stop. Do not read the long design draft.

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

### Card 6 — Quota stays on the location until that list is empty

**Change.** On a depleted lane, the next run uses the next equivalent row in that host's `/allowance` list (OpenCode, Cline, Token Harbor). Freebuff is not a Telegram substitute. When every equivalent row on that host is depleted, pack project, role, and the short log, and continue on the next connected host that still has a row. If none do, stop. Do not ask, and do not jump location while a local row remains.

**Live proof.** Use a copy of the ledger mounted only for this test. Stamp every lane except one on `vps`. Send a message. The reply names that remaining lane and the host stays `vps`. Then stamp that last lane. The reply names the next connected host, or says no location has quota. Paste the allowance list you stamped and both replies. The real user ledger is untouched: `stat` its mtime before and after.

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

Run cards 1 through 8's live proofs again, in order, on one restarted `bot-host@vm`, and paste one evidence block per card. The author of any of those patches does not run this pass.

The feature is ready for the user only when all nine evidence blocks are in the ticket and every negative check passed. Until then the user-facing status is: not ready to test.

Drive stays the local folder until the user names the Google account. Do not open that work in these cards.
