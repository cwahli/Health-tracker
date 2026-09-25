# Final plan: location, project, and role

**Status:** the plan an agent executes. The old council draft has been removed from `plan/LOCATION_AGNOSTIC_PROJECT_COUNCIL.md`. Do not look for it.
**Registry tests:** `node scripts/assert-external-projects.test.mjs` — 55 pass, 0 fail. Those tests cover names, role files, and prompt text. They are not the live done gate.

## What is already on GitHub

`/project`, `/role`, and `/council` run in `scripts/bot-host.mjs`.

- `/project 1` is the Health-tracker checkout. `/project external 2` (also `2` or `pip`) opens the rating council. `/project external 3` creates the next project from the same scaffold.
- Roles are markdown files. `/role` lists them. `/role check <name>` prints that role's instructions and does not switch. `/role <name>` assigns the role and later turns load that file. `/role add`, `/role remove`, and `/role reset` change the catalog. Adding a file adds a council phase.
- `/council audit`, `/council defense`, `/council finalize`, and `/council run` walk the phases. Output is written under the project workspace. The three deliverable templates are a 1:1 talking-points sheet, a point-by-point rebuttal, and a 30/60/90 plan.
- Drive today is a local folder plus a manifest. A live Google connection starts when `~/.hermes/gdrive_credentials.json` exists. The folder name is `[External-N-…]`.
- Website work stays on the existing ticket path: bug card, `run-coding-dispatch.sh`, one coder, QA. Optional website lenses (`ui`, `backend`, `qa`, `ops`, `arch`) only change the prompt. They do not get their own bots.

## What this plan keeps from Gemini

The file layout, the role commands, the staged council, and the three deliverable templates. A role is a file, not a new bot. Any chat can wear any role in the current project. Two chats can wear two roles against the same folder.

The rebuttal template is the right shape: quote the review, then the record, then the evidence, then a forward plan. The 30/60/90 plan is the measurable ask. The 1:1 sheet is the short version you actually say.

## What this plan does not keep

- Antigravity. It is not a location and it is not installed from this plan.
- `/location mobile` as it exists today. It sets `BOT_LOCATION` on the VM process. The turn still runs on the VM and still spends the VM allowance. That is a label, not a location switch.
- A silent hop to Zen, Cloudflare, or Gemini when the phone or the notebook is off. The chat gets a warning and the turn does not run.
- Jumping location at the first depleted model. The allowance list on the current location is used first.
- The council's local fallback that writes a dossier when the model call fails. A failed lane stops and says so. It does not invent the case.
- Treating the legal role as a lawyer. It checks the company's own policy: was the standard vague, was there prior notice, what should be asked in writing. It does not name severance months, and it does not send anything to the manager.
- A second copy of the PIP case as "project 2" and "project 1 external". `external-2` is the rating case. A new number gets a blank charter, empty evidence, and the same role files. The goal is whatever the charter says.

## Commands

| Command | Effect |
| --- | --- |
| `/location` | Shows where this process is running, the active lane, and which other hosts have a live worker connection. |
| `/location <host>` | Uses that host for the next run. Hosts: `vps`, `mobile`, `collab`, `grok`. |
| `/project 1` | Health-tracker checkout and website instructions. |
| `/project external <n>` | External project n. Creates it if it does not exist. |
| `/role` | Lists roles for the current project. |
| `/role check <name>` | Shows that role's instruction file. Does not switch. |
| `/role <name>` | Assigns the role. It stays until another `/role`, `/role reset`, or a project switch that does not have that role. |
| `/council …` | External projects only. Staged, or `run` for the full sequence. |

If the phone or the notebook is not connected, the reply is that the host is unreachable and the turn was not run. The VM does not take the turn.

Collab has no inbound address. The notebook connects outward to the VM and keeps that session open. There is no Tailscale hop and no public tunnel to register. The phone uses the same outward connection.

## What stays a place

The VM bot, the VM2 bot, the mobile bot, the Collab bot, and the Grok router each keep their own token and stay on the machine that already polls it. Those pollers are not deleted and they are not merged into one bot. What becomes the same on every one of them is the chat commands: `/location`, `/project`, `/role`, and the allowance walk below. Asking the phone bot to run the next turn on the VM is the same command as asking the VM bot to run the next turn on the phone. The poller that receives the command does not move.

## Quota

Use the sequence the Grok router already runs. Do not invent a second ledger. `markDepleted`, `isDepleted`, and `nextFailoverRoutes` in `tools/telegram-provider-router/src/index.js` are the behavior. Bot-host writes the same facts through `stampDepleted` in `scripts/lib/free-lanes.mjs`. A shared bucket (OpenCode Zen free) is one allowance: marking one model in that bucket marks the siblings. A per-model route marks only itself. A help page or a status table is not a quota error and must not stamp anything.

`/allowance` on the bot you are talking to shows the list for the worker that will run the turn, in preference order, with depleted rows and their reset time.

When a real provider error is a quota or rate limit:

1. The same process that saw the error writes `depletedUntil` before the reply is sent. Nobody types the stamp by hand.
2. The reply names the failed lane and the next lane `nextFailoverRoutes` returns on that same worker. Freebuff is shown and is not chosen.
3. The following message uses that next lane. Repeat down the list.
4. When that worker's selectable list is empty, continue on the next connected worker whose own list still has a lane. The reply names that worker.
5. When every connected worker is empty, say so and stop. Do not call the lane that just failed.

The move in step 4 must not depend on the depleted lane having allowance left to write a summary. Build the pack with no model call from the files already on disk: project, role, `index.md`, and the turn log. If that log is long and some other connected lane still has allowance, that lane may write the short pack. If no lane has allowance, send the disk pack anyway and say the summary was not written. A depleted model is never asked to summarize itself.

These are separate stamps, and the chooser reads them before every attempt so the same failure is not tried again:

- Allowance used, or a rate limit: `depletedUntil`. Skip until that time.
- Promotion ended: status `ended`. Never offer that lane again. The router already drops `ended` lanes. Bot-host must do the same.
- API connection failed: one retry, then a cooldown stamp `connection-failed`. Skip until the cooldown ends, and take the next lane.
- A help page or a status table is still not a stamp.

The second time the same signature is recorded, append one dead-end line. The next build or investigate turn reads that line. The model does not rewrite its own instructions.

## Tmux

`/tx on` stays on across `/location` and `/project`. Neither command kills the session you are watching.

A project change stays on the same machine. The same tmux window is reused, and the TUI on screen is the tool now running in the new workspace.

A location change runs the tool on the other machine. That process cannot live inside the VM's tmux. The workaround is one stable session on the VM, `work-view`, which is the only session you attach to. When the location changes, that same pane is pointed at a live relay of the tool's TUI, carried over the worker's existing outbound connection. You do not open a second session and you do not SSH to the phone. `tmux capture-pane -t work-view` on the VM shows the OpenCode screen, or the Cline screen when that tool was selected, including after `/location mobile`. A log tail, a blank pane, or the previous tool left on screen is a failure. The reply still names the host that is running the turn.

## External project boundary

The working directory is `~/projects/external-<n>`, not the Health-tracker checkout. Git commit and push to the website repo are refused. Deploy of the website is refused.

Tables, photos, reply quotes, `/model`, and `/allowance` stay. Cloudflare and Firebase stay available only for a resource that belongs to this external project. They are not a path back to the Health-tracker worker, D1, R2, or Firebase project.

The shared folder is the collaboration point. It is plain markdown, so you can open `~/projects/external-<n>` in Obsidian and see the same files the bots read. No Obsidian plugin, no embedding index, and no second memory service. Drive, when you name the account, syncs this folder. It does not get its own copy of the truth.

Each role writes only its own output file. The charter and the evidence files change only when you change them, or when accuracy appends a strike. A disagreement stays as two dated lines. It is not overwritten.

Three short files keep the folder from becoming a transcript:

- `index.md` is the one page every role reads first. It links the evidence and the latest output of each role. A file that is not linked here is not in play.
- `log.md` is one appended line per turn: role, file written, date. It is cut at 200 lines by moving the old lines to `log-archive.md`.
- The claim list stays append-only. A claim is kept only when its quote appears in a file in the folder. Accuracy can strike a claim. A later role cannot restore it. The final documents are built only from claims the arbiter kept.

The prompt carries the role file plus `index.md`. It does not carry the whole folder. The Hermes memory stores from earlier bot work stay as they are. They are not copied into this folder.

## Research constraint

Multi-agent work here is a staged workflow. One role writes at a time. The others read the same folder. A full six-phase run happens only when you ask for it, and only after documents are in the folder. The handoff between machines is a short pack, and the next role checks it against the files. A model does not get to declare the card done.

## Rating council

Order:

1. Accuracy — inventory the uploaded documents and mark anything with no source.
2. Case review — one row per review point: their words, the record, what was outside your control, a measurable standard where theirs is vague.
3. Manager simulation — the strongest fair objection to each row. It may not invent facts about the manager.
4. Policy — what to ask, what to leave out, when to stop and talk to a qualified adviser.
5. Arbiter — keeps or drops rows and names the ask you already chose: a corrected rating, a measurable plan, or a role change you would accept.
6. Builder — fills the three templates from the arbiter's file only.

`/council audit` is step 1. `/council defense` is steps 2 and 3. `/council finalize` is steps 4 to 6. You can also `/role accuracy` on one chat and `/role builder` on another. Both use the same folder.

This organizes a record you already have. It is not legal advice. Country and company policy go in the charter before any role writes, because the procedure is not universal.

## Done

The feature is done when these live checks pass on a real chat. The 55 registry tests stay required and are not enough.

1. On one project, one chat runs a turn on `vps`, then `mobile`, then `grok`, then `collab`, on OpenCode and on Cline where that host has them. Each turn's ledger stamp is on that host, not on the VM.
2. A depleted lane on the VM switches to the next allowance-list lane on the VM. After every equivalent VM lane is depleted, the same chat continues on a location that still has quota, with the same project and the same role.
3. `/location mobile` with the phone disconnected warns and does not run the turn on the VM. Asking for Freebuff, or for Cline on the phone, names the surface it used instead.
4. `/project external 2` loads the council soul and refuses a website commit. `/project 1` restores the website checkout. `/project external 3` does not contain project 2's case files.
5. `/role accuracy` puts the accuracy file in the prompt. `/role builder` replaces it. `/role check case` shows the case file and leaves the assigned role unchanged.
