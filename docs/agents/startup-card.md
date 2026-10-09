# Startup card

Run `node scripts/startup-card.mjs` from the Health-tracker checkout you are editing.

The card prints every Current-work row in `plan/ROADMAP.md` whose label says COMPLETE. Those rows are closed. Do not reopen one because a plan header, a card procedure, or an `AI_HANDOVER.md` bullet still says it is open.

On a VM session, the first action is `python3 ~/.agents/skills.py sync`, then this card. The card prints the machine, the sheet writer, and the last commits on `origin/main`. Sheet writes go only through `ruby ~/.agents/skills/do-github-sync/scripts/sheet_row.rb`. Agents never set Status to Done.

`node scripts/sheet-watcher.mjs` is print-only. `--write` creates one temporary row after the same dirty fingerprint has sat for 20 minutes. It does not write that key again, because `sheet_row.rb` archives the previous row.

Code goes in a worktree from current `origin/main`: `node scripts/agent-worktree.mjs new <slug>`.
