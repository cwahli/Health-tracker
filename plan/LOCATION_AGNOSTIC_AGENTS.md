# Final plan: location, project, and role

**Status:** merged 2026-09-25 from the landed GitHub plan (`plan/LOCATION_AGNOSTIC_PROJECT_COUNCIL.md`, commit `0d67dbd`) and the decisions already made in this chat.
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

## Quota

Read the allowance list for the location that is actually running the turn.

1. If the current lane is depleted, take the next equivalent lane on that same location. Equivalent means a selectable tool lane (OpenCode, Cline, or Token Harbor), in the order `/allowance` already shows. Freebuff stays terminal-only. The reply names the lane it switched to.
2. When every equivalent lane on that location is depleted, pack the chat (project, role, instruction file, and the short turn log) and continue on the next location whose worker is connected and whose allowance list still has a lane.
3. If no location has a lane, say so and stop.

The pack is the continuity. An OpenCode session on the VM does not reopen on the phone.

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
