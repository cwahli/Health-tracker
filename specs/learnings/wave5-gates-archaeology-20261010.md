# Gate archaeology: Fleet-06, Spec-01, Req-12, Sheet-04 (2026-10-10)

Report-only wave on `agent/wave5-gates`. No code changes, no live
phone/Telegram actions, no status flips (all four rows stay Assigned).
Every verdict below is a PROPOSAL for human approval. Overlap check first:
`gh pr list --state open` shows no PR touching these four rows (prior
gate-sweep PR #705 flipped Merge-01/Main-01/Forge-01 only; sibling branches
`agent/wave5-fleet09`, `agent/wave5-health10`, `agent/wave5-sync` own other
rows — untouched).

## 1. Fleet-06 — verdict: CLOSE-AS-NOISE (evidence chain)

Key correction: the brief's key suffix `...msg_1012ff11e001YP9CkYcqHKVfCh`
does NOT exist on `current` (all 37 rows scanned). The real row is Ref
Fleet-06, key `req:ses_f018a4f90ffe0wTzFyLM5UeHef:msg_1012ff11e001bH27UjjwEqyWMr`
(ROW24). Its gate: "Sheet shows PR->owner->session for #491/#495/#500;
session links refresh automatically; #491 owner pinged".

Evidence the gated condition is gone (all measured 2026-10-10 on this box):

- `gh pr view` 491/495/500 → state MERGED, mergedAt 2026-10-03T13:07:08Z,
  2026-10-03T13:07:46Z, 2026-10-03T14:41:36Z; merge commits 8c63dd84,
  f990b6ae, 1c201d52.
- `git merge-base --is-ancestor <each-merge-commit> HEAD` → YES for all
  three against HEAD adfeb83b. The "OPEN red" premise from the 3-Oct demo
  has been false for a week.
- `gh pr list --state open` contains none of #491/#495/#500. There is no
  open-PR coordination issue left for this row to gate.

The row's two asks are absorbed, not abandoned:

- PR→owner→session on the sheet is now standing convention: the `github`
  column (`sheet_row.rb --github`), heartbeat-derived agent_branch, and
  Session/Session-id columns. This row's own github cell already reads
  "PR #491, PR #495, PR #500".
- "Session links refresh automatically" is real infrastructure:
  `session_link.rb --apply` runs every 30 min via cron (plus the
  blocking-PR drill, do-github-sync SKILL step 45, as standing process).
- "session_link steady-state 0 rows" was a 3-Oct demo observation with no
  runnable re-check command — nothing to re-run.

No runnable gate exists against three merged PRs; a rewrite would gate
standing infrastructure, not this ticket. Recommend close-as-noise.

Human approves: confirm noise ("Fleet-06 done/archive" → Done + 
`--move-to-archive`), or reject and dictate a rewritten gate.

## 2. Spec-01 (`spec:status-all`) — verdict: DRAFT-GATE (proposal, no live actions)

Blockers verified merged (not just claimed):

- #491 seat-model-agnostic → 8c63dd84, 2026-10-03T13:07:08Z, ancestor of HEAD.
- #495 bot-chat-copy → f990b6ae, 2026-10-03T13:07:46Z, ancestor of HEAD.
- Own PR #500 agent/status-all → 1c201d52, 2026-10-03T14:41:36Z, ancestor
  of HEAD. The row's todo ("rebase once #491/#495 land, merge #500") is
  moot — all three contents are already on main; no rebase is needed, only
  live proof.
- Feature live in tree: `scripts/lib/commands.mjs:15` (autocomplete entry
  `status_all`), `:95` (help text), `:307` (`parseCommand` returns
  `{name:'status_all', args:'all'}`).

Proposed runnable gate (nobody has run this yet — live Telegram + phone
shot are human-side surfaces this box must not fake):

1. `git fetch origin && git merge-base --is-ancestor 1c201d52 HEAD`
   (expected: true — already verified 2026-10-10).
2. Restart vm bots on current main so the merged parser is the running one.
3. In Telegram, type `/status` and confirm autocomplete offers `/status_all`.
4. Run `/status_all`; confirm the fleet-wide status table reply.
5. Phone screenshot → Drive `Work done/spec:status-all/` →
   `ruby sheet_row.rb --key spec:status-all --proof "spec:status-all"
   --proof-url "https://..." --todo "" --status Assigned`, then wait.
6. Human Done + `--move-to-archive`.

Human approves: the gate text above, and who runs steps 2–5 (owner is
Mac-side Fledge Alpha Free @ mac; this VPS box cannot take phone shots).

## 3. Req-12 (`req:ses_f0b7c6105ffeTg3OdRXnIoCQPa:msg_0fed19cd6001VQo0nDlw2plO2s`) — verdict: CLOSE-AS-NOISE (with reasons)

Origin trace (all from the row + repo, nothing guessed):

- Hand-filed from a Cline "Greeting" session (Session `Greeting`, Session
  id `ses_f0b7c6105f…`, Owner `Cline (none) @ vps-france`, built 21:30 -
  4 oct). Cline has no ticket-inbox hook (skill: other terminals "file
  those rows by hand"), consistent with a manual stub.
- Source `Inbox leftover: Fruit Salad + Croissant + 3 more` — the same
  inbox batch as Sheet-04's source; a triage leftover, not a work packet.
- Goal is a verbatim aside, "Can you look at the sheet again?" — a
  conversational nudge with no deliverable. Work-done `card` = row
  creation only. Gate `0` = never-filled placeholder (`sheet_row.rb` has
  no default that yields `0`; it was filer-typed, then never replaced).
- `git log --all -S "ses_f0b7c6105ffeTg3OdRXnIoCQPa"` → zero hits. No
  packet, no branch, no PR, no session artifact references this key.
- Idle since filing (sweeper 2719m on 4 Oct; untouched since except sweep
  notes). It was meant to gate nothing — there is no work behind it.

A "real gate" alternative would be self-referential (gating the row's own
read-back) and is not recommended. Standing policy already covers this
shape: a message needing no work → Done with a one-line reason, archive
immediately. Recommend close-as-noise.

Human approves: confirm noise (Done + archive), or assign an actual
deliverable + gate if the 4-Oct ask is remembered to mean something.

## 4. Sheet-04 (`task:pm-sheet-cleanup`) — verdict: DRAFT-GATE (mechanical 90% + stays-owner tail)

Current gate prose, mapped to checks (proposal — not yet run):

- "A-G complete on all rows": every `current` row carries Ref, verbatim
  goal, note, todo-or-cleared, owner, Status in enum, proof-or-recorded
  reason, non-trivial gate. Verify by live read-back
  (`getFleetTickets({refresh:true})` — the same projection the fleet app
  renders), asserting per row; `node scripts/assert-sheet-proof.mjs`
  covers proof resolvability (rules: review/done rows must resolve to a
  per-key folder with ≥1 image; proof URLs must name their own key).
- "Owner normalized": every owner matches `<identity> @ <location>`
  (`sheet_row.rb` usage line; no author column).
- "Status enum live": enforced in code (`sheet_row.rb` STATUSES + abort
  on unknown status) — verify by `grep STATUSES` + one rejected dry-run?
  No dry-run flag exists; enum check is read-back (all Status values ∈
  Pending|Assigned|In progress|review|Done).
- "UK timestamps": `uk_stamp()` in `sheet_row.rb`; verify
  last_activity/built_at match `\d{2}:\d{2} - \d{1,2} [a-z]{3} \(UK\)`.
- "sheet_row + skill updated, tested, relay-synced": `ruby -c` the
  script, `git log` the skill relay state, relay sync per do-github-sync
  step 6–7.

Proposed gate text (exact commands, to be approved before anyone runs it):

```
node scripts/assert-sheet-proof.mjs  # exit 0
node -e "…getFleetTickets read-back asserting Ref/goal/note/owner/Status-enum/UK-stamp/gate-nontrivial on every current row…"  # exit 0
ruby -c ~/.agents/skills/do-github-sync/scripts/sheet_row.rb  # Syntax OK
```

What must stay owner-verified: the tail of the todo ("User verifies;
set Done after user confirms") — Done is human-only by rule, and the
sheet itself is a human surface. The mechanical checks above can go
GREEN, but only the human's read of the sheet closes the row.

Human approves: the gate text (edit as wanted), then any agent runs it;
human keeps the final Done.
