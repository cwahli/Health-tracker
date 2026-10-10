# Noise triage: Sync-06 (`sync:vps-france`) + Sync-07 (`sync:mac`) + Sync-04 (`sync:2026-10-03-mac-fledge`) (2026-10-10)

Role: noise-triage, ARCHAEOLOGY ONLY. Worktree `/home/ubuntu/dev/t10c-sync`,
branch `agent/t10c-sync`, base `main @ adfeb83b`. No code changed, no live
sync runs (`sync.py` / `skills.py sync` never invoked; only read-only probes:
`git status`, `git ls-remote`, `git push --dry-run`, `git -C ~/.agents`
status/ls-remote, `assert-domain-canonical.mjs` without `--fix`,
`sheet_dump.rb` on `current` + `archive_done`, read-only `gh pr view`).
No status flips to review/Done (Sync-06/07 stay `Assigned`; Sync-04 goes
`state=closed_noise`, status stays `Assigned` — the wave-2 phantom
convention, never Done). One file added (this note); one Work-done line
appended per row via `sheet_row.rb`, all other cells merged-unchanged
(`sheet_row.rb` merges partial updates; `last_activity` auto-refreshes in
UK shape, no hand-passed stamps). Sibling overlap checked first:
`gh pr list --state open` owns Sync-08/09 (agent/wave5-sync),
Fleet-06/Spec-01/Req-12/Sheet-04 (agent/wave5-gates), Fleet-09, Health-10,
meals, phantoms — none owns Sync-04/06/07; stayed out. Builds on the
Sync-08/09 finding (prose sync gates unrunnable verbatim; NOT re-investigated).

## Verdicts up front

- **Sync-06** (`sync:vps-france`): **LIVE** — standing row for this box
  (vps-france), actively synced 2026-10-09/10. Safe dry-run gate PROPOSED
  below (§1); read-only probes pass on this box (this note, UNTESTED as a
  gate — needs human approval).
- **Sync-07** (`sync:mac`): **LIVE** — standing row for mac, "3rd sync"
  2026-10-10. Same prose-gate family; no hermetic form provable from here
  (wrong box — same argument as Sync-08 §1). Owner-box variant PROPOSED
  (§2, UNTESTED from here).
- **Sync-04** (`sync:2026-10-03-mac-fledge`): **NOISE** — one-off dated-key
  mac sync from Oct 3, frozen since, blockers merged same day, routine
  carried forward by the standing Sync-07 row. `state=closed_noise` with
  reasoning on-row; row kept for audit (§3).

## 0. What the rows actually claim (read 2026-10-10 via `sheet_dump.rb --tab current`)

- Sync-06 (row 12): standing `sync:vps-france` row. Owner
  `MiMo Flash @ vps-france`. Work-done: 2026-10-09/10 sync —
  `src [agent/meal-qa-queue] 7cb94f51` current+clean (push n/a, behind
  origin/main by 20, PR #654 merged); `deploy [main] 4e52f33c` current
  (git-version dirt moved to `agent/deploy-version-bump 6f424379`, pushed);
  external-2 `963309a` identical to origin ref; external-4 in sync;
  11 landed worktrees closed; domain 0 drift, caddy legacy fully retired;
  relay already `b09d9ff`. Gate: `every checkout pulled-or-reported,
  pushes safe-only, skills relay checked`. `last_activity: 00:39 - 10 oct (UK)`.
- Sync-07 (row 13): standing `sync:mac` row. Owner `Muse Spark 1.3 @ mac`.
  Work-done: 3rd sync 2026-10-10 — `status-all` ff `75728496->4e52f33c`
  (#676 on main); src parked clean on `agent/roadmap-clear`;
  external-2/4 personal non-git folders, untouched; 0 close worktree rows;
  domain 0 drift; skills unchanged. Todo: phone proof of #676 owed;
  shell-smoke running at sync time. Gate: `checkouts synced, close-out
  empty, row Assigned`. `last_activity: 00:29 - 10 oct (UK)`.
- Sync-04 (row 33): dated `sync:2026-10-03-mac-fledge` row. Owner
  `Muse Spark 1.3 Free (none) @ mac`. Work-done: one Oct-3 `sync.py` run —
  src `[agent/bot-chat-copy] 0365477f` current+clean; external-2/4 skipped
  (not cwahli checkouts); relay `fdf512d -> 562fb16`. Todo: PRs #491/#495
  blocking #500. Gate: `sync.py completes clean and the sync run row is
  recorded on the PM sheet`. `last_activity: 11:17 - 3 oct (UK)` — frozen
  7 days. No `state:` line (state empty pre-triage).

## 1. Sync-06 — LIVE, safe dry-run gate proposal

Origin: a `/do-github-sync` run ON vps-france (this box — `~/.agents/location`
reads `vps-france`) by MiMo Flash. Boxes/checkouts named on-row (src +
deploy + external-2/4 + relay) match SKILL.md step 3's per-box local paths;
`~/src/Health-tracker` here is still parked clean on `agent/meal-qa-queue`
(read-only `git status` empty 10 oct), consistent with the row.

Why LIVE, one line: it is the standing `sync:<location>` row SKILL.md step 8
mandates (one per location, updated per run, never a dated key), and it is
fresh — worked 00:39 today with merged-PRs evidence (#654 merged
2026-10-09, #676 merged 2026-10-09; both verified MERGED via read-only
`gh pr view`).

Why-unrunnable verbatim (inherits Sync-08/09): the gate is prose with no
command, and the only command producing those end-states (`sync.py` +
`skills.py sync` + `sheet_row.rb` write) mutates checkouts, GitHub, relay,
sheet. Deliberately excluded from the draft: the `sheet_row.rb` write half
of "recorded" — a gate that must write to check cannot verify; readability
via `sheet_dump.rb` is the checkable half. Worktree-close state
(`agent-worktree.mjs plan`) is likewise excluded — it enumerates live
worktrees, not a pass/fail.

Draft (PROPOSAL — read-only probes pass on this box 10 oct, `main @
adfeb83b`; human approves adoption as the row's gate):

    test -z "$(git -C ~/src/Health-tracker status --porcelain --untracked-files=no)" && test -z "$(git -C ~/deploy/Health-tracker status --porcelain --untracked-files=no)" && test "$(timeout 30 git -C ~/src/Health-tracker ls-remote origin main | awk '{print $1}')" = "$(git -C ~/src/Health-tracker rev-parse origin/main)" && timeout 30 git -C ~/src/Health-tracker push --dry-run origin HEAD && test -z "$(git -C ~/.agents status --porcelain --untracked-files=no)" && test "$(timeout 30 git -C ~/.agents ls-remote origin main | awk '{print $1}')" = "$(git -C ~/.agents rev-parse HEAD)" && timeout 60 node scripts/assert-domain-canonical.mjs && timeout 60 ruby ~/.agents/skills/do-github-sync/scripts/sheet_dump.rb --tab current | grep -q "sync:vps-france"

  Observed here (read-only, not a sync): src tree clean (empty status,
  exit 0); this worktree clean with `ls-remote origin main` ==
  `rev-parse origin/main` (`adfeb83b…` both, MATCH); `push --dry-run`
  exit 0 (`To https://github.com/cwahli/Health-tracker.git`,
  `[new branch] HEAD -> agent/t10c-sync`, nothing pushed); relay
  `ls-remote` == `rev-parse HEAD` (`b09d9ff…` both, MATCH);
  `assert-domain-canonical.mjs` exit 0 ending `0 drift — canonical`
  (legacy fully retired); `sheet_dump.rb` exit 0, `sync:vps-france`
  matched. Non-covered by design: external-2/4 (personal-folder vs
  checkout judgment per SKILL.md step 3 — human reads the script line),
  dirty-tree commit/push routing (step 5 — that IS a sync, never gated),
  "correctly held" (human judgment on the status output, not a pass).
  Human approves: adopt (or amend) as Sync-06's gate, or reject with reason
  (row stays prose-gated, Assigned). Nothing here edits the gate.

## 2. Sync-07 — LIVE, owner-box gate proposal (untestable from here)

Origin: a `/do-github-sync` run ON mac by Muse Spark 1.3. Mac-only paths
on-row (`~/dev/status-all` — absent on this box, verified `ls` miss;
`agent/roadmap-clear` src parking) confirm the owner box; `skills.py list`
here confirms mac is an "other machine".

Why LIVE, one line: standing `sync:mac` row, "3rd sync" continuity, worked
00:29 today (#676 ff `75728496->4e52f33c` verified MERGED 2026-10-09).

Why no local proof (same argument as Sync-08 §1): the property is about
mac's filesystem; `sync.py` operates on per-box local paths, so running
anything here proves vps-france, not mac, while touching three external
systems. Draft (PROPOSAL, non-hermetic — mac owner runs it in
`~/src/Health-tracker` or `~/dev/status-all`): the §1 suite with the two
checkout paths swapped to mac's (`~/src/Health-tracker`,
`~/dev/status-all`) and the final `grep -q` swapped to `sync:mac`.
UNTESTED from here by design (contacting mac live would itself need the
live counterpart + ssh creds). Human approves: (a) adopt owner-box gate,
(b) keep standing row prose-gated/Assigned, or (c) authorize a remote
`ssh mac` read-only probe. Nothing here edits the gate.

## 3. Sync-04 — NOISE, closed with reasoning

Origin: a one-off Oct-3 `/do-github-sync` on mac (fledge session) by
Muse Spark 1.3 Free. Evidence of noise, four independent legs (no records
invented — all read live 10 oct):

1. Dated per-run key breaks the standing convention: SKILL.md step 8 —
   locations keep ONE `sync:<location>` row; `A dated per-run key
   (sync:2026-10-03-…) is a new ticket — refused by convention`. mac's
   standing row exists (Sync-07 `sync:mac`, "3rd sync" 2026-10-10) and
   carries the same routine forward.
2. One-off event long past: `last_activity` frozen at `11:17 - 3 oct (UK)`,
   untouched 7 days; relay pointer `562fb16` predates the current `b09d9ff`
   by several relays.
3. Its own todo is resolved elsewhere: `What's left to do` names only
   `PRs #491/#495 keep #500 blocked` — all three verified MERGED
   2026-10-03 (`gh pr view`: #491 + #495 merged 13:07Z, #500 merged
   14:41Z, hours after the sync). Nothing on-row is still actionable.
4. No lineage worth preserving beyond audit: `archive_done` (199 rows,
   dumped read-only) holds zero prior versions of this or any `sync:*`
   key — the row was written once, never updated; closing keeps it on
   `current` for audit per append-only rules.

Disposal: `state=closed_noise` with the reasoning appended to Work-done
(wave-2 phantom convention); Status stays `Assigned` (never Done/review);
gate/goal/owner/proof cells untouched; row kept, never deleted. Sibling
rows untouched (Sync-08/09 left to agent/wave5-sync).

## Evidence (all read-only)

- Sheet: `sheet_dump.rb --tab current` (exit 0; Sync-06 = row 12, Sync-07
  = row 13, Sync-04 = row 33; gates/notes/todos/owners/stamps quoted from
  live read) + `--tab archive_done` (exit 0, 199 rows, zero `sync:*` keys).
- PR states (read-only `gh pr view`): #491/#495/#500 MERGED 2026-10-03;
  #654 MERGED 2026-10-09; #676 MERGED 2026-10-09.
- Local box (read-only): `~/.agents/location` = `vps-france`; `~/src` +
  `~/deploy` Health-tracker checkouts present, `~/dev/status-all` absent
  (mac-only); src parked clean on `agent/meal-qa-queue`;
  `git status --porcelain --untracked-files=no` empty (worktree + src);
  `git ls-remote origin main` == `rev-parse origin/main` (`adfeb83b…`);
  `git push --dry-run origin HEAD` exit 0 (new-branch line, no push);
  relay clean + MATCH (`b09d9ff…`); `assert-domain-canonical.mjs` exit 0
  (`0 drift — canonical`, legacy retired); `skills.py list` relay
  `b09d9ff`, mac an other machine.
- History: `git log --grep sync -i` shows only queue-sync/domain/fleet-tab
  work (no prior gate command for these rows).
- Overlap: `gh pr list --state open` — no PR owns Sync-04/06/07.

## What the human checks (per row)

- Sync-06: approve adopting the §1 dry-run command as the gate (or amend
  it). Row stays Assigned either way.
- Sync-07: approve (a) owner-box gate (§2, run on mac), (b) standing row
  stays prose-gated/Assigned, or (c) ssh read-only probe.
- Sync-04: confirm `closed_noise` disposal is correct (row remains for
  audit; nothing actionable lost — blockers merged, routine lives on
  Sync-07). Reopen only if a dated per-run mac record is still wanted.
