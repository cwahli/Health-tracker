# T10b-links: Auto-01 + Domain-01 cross-link triage (2026-10-10, report-only)

Scope: two PM-sheet rows only. Archaeology; no application code touched.
Worktree `/home/ubuntu/dev/t10b-links`, branch `agent/t10b-links`, base `main`.
Overlap check first: `gh pr list --state open` shows no PR touching these two
rows or this branch (open items are wave2/4/5, bug2/3/53, sheet-cleanup
observer, unified-model-switch, deploy-version-bump). Worktree `git status`
clean except this note.

## 1. Auto-01 — `auto:vps-france:pid_768896` — verdict NOISE

Full row read 2026-10-10 (Ref Auto-01, Owner
`muse-spark-1.3-contributor-free (opencode) @ vps-france`, Status Assigned,
state was `open`, rung `Buffy (Codebuff) (high) Mac 2026-10-02`).
Goal is an auto-watcher stub from 2 Oct: probable ticket
`spec:health-snapshot-clean` from branch `agent/health-snapshot-clean`,
"NO such row exists; create it to claim", proc 768896, sha 3ce86b4c.

Trace (all read-only, nothing invented):
- PID 768896 is dead (`ps -p 768896` empty). Watcher note itself says no
  session progress since 2026-10-03T11:00:06Z; 8 days unclaimed.
- Branch `agent/health-snapshot-clean` exists at 3ce86b4c but no
  `spec:health-snapshot-clean` row exists on `current` (full-tab search) nor
  in `archive_done` — the ticket was never filed.
- Proof cell held `https://drive.google.com/drive/folders/10wvYQNcGMWsGdrZnLWj7NwICN1dVXzYs`.
  Verified by listing: folder name is exactly the **Fleet-06 key**
  `req:ses_f018a4f90ffe0wTzFyLM5UeHef:msg_1012ff11e001bH27UjjwEqyWMr`
  (matches Fleet-06 row key byte-for-byte), parent is Work done
  `1G7dhvqRy7iOmRg7AfN9a6g8cbIhz14yS`, single child `e2e-pr-coord-demo.png`
  (2026-10-03) — the Fleet-06 PR-coordination demo. It belongs to Fleet-06.
- No Drive folder named `auto:vps-france:pid_768896` exists (search 0 hits),
  so this row has NO own evidence. No Drive file moved, renamed, or deleted.

Action applied on the sheet (this row only): pre-existing Work-done text kept
byte-intact, triage note appended with `21:29 - 10 oct (UK)` stamp; proof cell
cleared (re-point only); `state` set to `closed_noise`; Status left Assigned
(never review/Done — Done/archival is human-only). Row stays for audit;
pre-update content preserved at `archive_done` row 1012
(`archived_at 21:29 - 10 oct (UK)`).

## 2. Domain-01 — `task:domain-couk-full` — verdict LIVE

Full row read 2026-10-10 (Ref Domain-01, Owner `Muse Spark @ vps-france`,
Status Assigned, empty `state`, same 2026-10-02 rung). Goal is the human live
ask: move everything to `https://health-tracker.co.uk/` (TG bot, TUI, web).

Trace:
- Audit claim verified in-repo: PR #583 `agent/domain-couk-audit` MERGED
  2026-10-06 (`675d423`), plus #579/#578 in the same chain. The sweep part of
  the row is real.
- Remaining todo is real pending work, not noise: multi-day log soak, console
  checks, Termius switch, then removing duckdns Caddy blocks. Gate restates
  the same condition. Nothing on the row shows that retirement done.
- Proof cell held `https://drive.google.com/drive/folders/1g89ffU0aGUqTRPdKL74jwYyL-msDE2Qx`.
  Verified by listing: folder name is `spec:github-sync` (the live
  `spec:github-sync` row's folder), single child `vps-france-sync.png`
  (2026-10-02 sync shot). It belongs to the github-sync row, not this one.
- No Drive folder named `task:domain-couk-full` exists (search 0 hits), so
  this row has NO own evidence filed. Nothing moved or deleted.

Action applied on the sheet (this row only): Work-done text kept byte-intact,
triage note appended (`21:29 - 10 oct (UK)`); proof cell cleared pending
owner-filed co.uk evidence; Status left Assigned, `state` left empty (left as
prior waves left it — no factual value to fill from this box). Row stays open.

## 3. Concurrent-writer duplicate (left untouched, needs human/sweeper collapse)

After both writes verified present, `current` shows TWO rows for
`auto:vps-france:pid_768896`: the fixed row (state `closed_noise`, proof
empty, `21:29` stamps) and a stale copy with byte-identical pre-update
content (state `open`, wrong proof link, `20:30` stamps). Our update ran when
exactly one such row existed (`sheet_row` archived 1 row), so a concurrent
upsert interleaved and resurrected the stale copy; the sheet is actively
written by sibling sweepers (new rows landed at top during this run).
Per no-deletion / audit rules I deleted nothing: the stale copy's content is
preserved at `archive_done` row 1012, and `sheet_row` will refuse further
writes to that key until the stale copy is collapsed by hand. The stale copy
keeps exhibiting the old cross-link until then.

## Human checks

1. Auto-01: confirm nobody wants to claim the snapshot ticket; if agreed
   noise, human taps Done/archival. Collapse the stale duplicate (content
   already at `archive_done` row 1012).
2. Domain-01: finish duckdns retirement (log soak + console + Termius +
   Caddy removal with zero breakage); file co.uk proof screenshots under a
   folder named for this key; only then consider Done.
3. Cross-link sensors should go quiet on Domain-01 immediately; Auto-01 stays
   flagged until the stale duplicate is collapsed.
