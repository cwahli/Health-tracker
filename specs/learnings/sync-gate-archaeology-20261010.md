# Gate archaeology: Sync-08 (`sync:grok-vps`) + Sync-09 (`spec:github-sync`) prose gates unrunnable as written (2026-10-10)

Role: gate-archaeology, REPORT ONLY. Worktree `/home/ubuntu/dev/wave5-sync`,
branch `agent/wave5-sync`, base `main @ adfeb83b`. No code changed, no live
sync runs (`sync.py` / `skills.py sync` / `sheet_row.rb` writes never invoked
except the two mandated Work-done appends), no status changes (both rows stay
`Assigned`, never review/Done). One file added (this note); one Work-done line
appended per row. Sibling overlap checked first:
`gh pr list --state open` shows no PR owning Sync-08/Sync-09
(branches present: `agent/wave5-fleet09`, `agent/wave5-gates`,
`agent/health10` — all other rows; stayed out).

## Verdict up front

- **Sync-08** (`sync:grok-vps`, gate `GitHub fully into sync both ways, PM
  sheet run recorded`): **no safe hermetic runnable form exists from any box
  except grok-vps itself** — and even there the verbatim run mutates. Local
  dry-run proves the wrong box. Closest safe form is the Sync-09 suite run ON
  grok-vps by its owner (exact command in §1, UNTESTED from here).
- **Sync-09** (`spec:github-sync`, gate `All checkouts current or correctly
  held; pushes only when safe; relay current`): **safe dry-run form EXISTS**,
  tested exit 0 here (§2). PROPOSAL for human approval, not an edit.

## 0. What the prose gates actually claim (read 2026-10-10 via sheet export + `sheet_dump.rb`)

- Sync-08: the grok-vps standing row (SKILL.md step 8: one `sync:<location>`
  row per location). Claims grok-vps checkouts + GitHub are fully synced both
  ways AND the run is recorded on the PM sheet. Last reality on row:
  2026-10-06 sync `e6ca19ca -> 720fdee5` (dirty, push skipped), relay
  `eead57f`; gate-sweep 10 oct already marked UNVERIFIABLE, left Assigned.
- Sync-09: the spec row for the shared routine itself. Claims every checkout
  is current-or-held, nothing pushes unless safe, relay current. Last reality:
  2026-10-02 mac sync at `3dde40ff`, relay `8a776b4`; gate-sweep 10 oct
  already marked UNVERIFIABLE, left Assigned.

## 1. Sync-08 — why unrunnable, and the only safe form

Why-unrunnable in one line: the property is about **grok-vps's filesystem**,
but the only runnable sync (`~/.agents/skills/do-github-sync/scripts/sync.py`)
operates on **per-box local paths** (`HEALTH_CHECKOUTS`, `~/projects/`) —
running it here would mutate vps-france checkouts, proving nothing about
grok-vps while changing three external systems.

What verbatim would mutate: `git fetch` + `pull --ff-only` moves local
branches (`sync.py: fast_forward`); `git push` updates GitHub refs (fires
CI/auto-merge); `gh repo clone` creates `~/projects/external-*`;
`skills.py sync` commits/pushes the agent-skills relay and rewrites tool
links; `sheet_row.rb` archives the old row version and writes a new row on
top of `current`; `assert-domain-canonical --fix` rewrites bot-host envs.
Creds/env/live counterpart needed: grok-vps box live + its `gh` auth as
`cwahli` + network to github.com + its Google OAuth (sheet write) +
`AGENT_AUTHOR` for signed relay commits. This box is `vps-france`
(`~/.agents/location`), so grok-vps state is unobservable from here
(`skills.py list` confirms grok-vps is an "other machine").

Draft (PROPOSAL, non-hermetic — human approves whether to adopt):
run the §2 suite ON grok-vps, in `~/src/Health-tracker`, with the last
`grep -q` swapped to `sync:grok-vps`:

    test -z "$(git status --porcelain --untracked-files=no)" && test "$(timeout 30 git ls-remote origin main | awk '{print $1}')" = "$(git rev-parse origin/main)" && timeout 30 git push --dry-run origin HEAD && test -z "$(git -C ~/.agents status --porcelain --untracked-files=no)" && test "$(timeout 30 git -C ~/.agents ls-remote origin main | awk '{print $1}')" = "$(git -C ~/.agents rev-parse HEAD)" && timeout 60 node scripts/assert-domain-canonical.mjs && timeout 60 ruby ~/.agents/skills/do-github-sync/scripts/sheet_dump.rb --tab current | grep -q "sync:grok-vps"

  Expected there: exit 0, push dry-run prints `To https://github.com/cwahli/Health-tracker.git`
  with no error, domain prints `0 drift — canonical`, grep matches the
  Sync-08 row. UNTESTED from here by design (contacting grok-vps live would
  itself need the live counterpart); grok-vps owner runs it, or human holds
  the standing row gateless. As a repo/CI gate it is therefore IMPOSSIBLE:
  no hermetic command on any single box proves another box's filesystem.
  Human approves: (a) adopt owner-box gate above, (b) keep standing row
  gateless, or (c) authorize a remote `ssh grok-vps` read-only probe
  (same suite over ssh — still needs grok-vps live + ssh creds, not hermetic).

## 2. Sync-09 — why unrunnable, and the tested safe form

Why-unrunnable in one line: the gate names end-states (`current`, `safe`,
`relay current`) with no command — the only command that produces those
states (`sync.py` + `skills.py sync` + `sheet_row.rb` write) **mutates**
checkouts, GitHub, relay, and sheet, so verification-by-running is
indistinguishable from doing the sync.

Same mutation/creds list as §1, minus the wrong-box problem (this gate is
box-generic, so a local dry-run IS the property for this box).
Deliberately excluded from the draft: the `sheet_row.rb` write half of
"recorded" — a gate that must write to check cannot verify; readability via
`sheet_dump.rb` (read-only, never `batch_update`) is the checkable half.

Draft (PROPOSAL — tested exit 0 on this worktree 10 oct, `main @ adfeb83b`;
human approves adoption as the row's gate):

    test -z "$(git status --porcelain --untracked-files=no)" && test "$(timeout 30 git ls-remote origin main | awk '{print $1}')" = "$(git rev-parse origin/main)" && timeout 30 git push --dry-run origin HEAD && test -z "$(git -C ~/.agents status --porcelain --untracked-files=no)" && test "$(timeout 30 git -C ~/.agents ls-remote origin main | awk '{print $1}')" = "$(git -C ~/.agents rev-parse HEAD)" && timeout 60 node scripts/assert-domain-canonical.mjs && timeout 60 ruby ~/.agents/skills/do-github-sync/scripts/sheet_dump.rb --tab current | grep -q "spec:github-sync"

  Expected exit/output: exit 0; `git ls-remote origin main` ==
  `git rev-parse origin/main` (`adfeb83b…` both, MATCH observed);
  `git push --dry-run` prints `To https://github.com/cwahli/Health-tracker.git`
  + branch line, no error (proves push-safe without pushing);
  relay `ls-remote` == `rev-parse HEAD` (`b09d9ff…` both, MATCH observed);
  `assert-domain-canonical.mjs` exit 0 ending `0 drift — canonical`
  (69 checks, read-only sweep step 6b without `--fix`); `sheet_dump.rb`
  exit 0 with `spec:github-sync` matched (36 `Ref:` rows dumped).
  Non-empty `git status` output = HELD (names blocking files; holder records
  the one blocking fact on-row, stays Assigned) — it fails the strict gate
  by design; "correctly held" is a human judgment on that output, not a pass.
  Human approves: adopt the command above as Sync-09's gate (or amended),
  or reject with the reason (then the row stays prose-gated, Assigned).

## Evidence (all read-only)

- Sheet: Drive export of `10oPI9AsHaKpb9xRR8XcTm6JyH1gYyykUFBNqeqg2SM0` to CSV
  + `ruby sheet_dump.rb --tab current` (exit 0; Sync-08 = row 33, Sync-09 =
  row 24; full gate/note/todo quoted above from live read).
- Sync semantics: `~/.agents/skills/do-github-sync/SKILL.md` steps 0–9
  (pull `--ff-only`, push rules, worktree plan, relay, domain sweep 6b,
  `sheet_row.rb` record) + `scripts/sync.py` (`fast_forward`, `push_branch`,
  `sync_health`/`sync_external` over HOME-local paths, `relay_changed`,
  `sync_skills`, `report_worktrees`).
- Read-only counterparts verified: `git status --porcelain
  --untracked-files=no` (empty, exit 0), `git fetch origin --dry-run`
  (exit 0, no ref update), `git ls-remote origin main/HEAD` (exit 0),
  `git push --dry-run origin HEAD` (exit 0), `git -C ~/.agents status` +
  `ls-remote` (MATCH), `python3 ~/.agents/skills.py list` (exit 0, relay
  `b09d9ff`, this machine `vps-france`), `node
  scripts/assert-domain-canonical.mjs` (exit 0, `0 drift — canonical`),
  `sheet_dump.rb` (exit 0, both rows present).
- History: `git log --grep sync` shows only queue-sync/domain/fleet-tab work
  (no prior gate command for either row); `~/.agents` relay at `b09d9ff`.

## What the human approves (per row)

- Sync-08: no hermetic gate possible — approve (a) owner-box gate (§1
  command run on grok-vps), (b) standing row stays prose-gated/Assigned, or
  (c) ssh read-only probe. Nothing here edits the gate.
- Sync-09: approve adopting the §2 dry-run command as the gate (or amend
  it). Nothing here edits the gate.
