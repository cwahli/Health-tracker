# Noise triage: Bug-01, Sheet-03, Board-02 (2026-10-10)

All three rows verdict LIVE. No code changes (triage-only). Sheet writes:
append-only to the three rows' Work-done cells + last_activity stamps;
states, owners, proofs, gates untouched.

## Bug-01 (spec:bug-board-parity, locked) — LIVE

- PR #381 (`adc1e41e` bug-board parity: canonical read projection + live
  L1–L5 PASS) is an ancestor of HEAD — the merged code is live.
- The packet itself is still `specs/active/bug-board-parity.md`, status
  locked (not moved to specs/done), so the row's reason-to-live stands.
- Gate `npx vitest run tests/client_import_boundary.test.ts
  tests/bug-board-fingerprint.test.ts` re-verified 7/7 GREEN on the
  sibling `/home/ubuntu/src/Health-tracker` checkout (which contains #381).
  Caveat: the `/home/ubuntu/dev/t10a-board` checkout has NO node_modules,
  so the gate is env-blocked there (missing @tailwindcss/vite at startup) —
  an environment gap, not a code failure. Do not read the t10a-board
  startup error as a red gate.
- Completion proof cell holds a spec id (`spec:bug-board-miniapp`), no
  PNG/link; the PNGs claimed in Work-done are not in the repo.
- Human check: re-run the gate where deps exist + file a proof link
  before any review claim.

## Board-02 (spec:dispatch-cli-flag, locked) — LIVE

- Fix is live: `170d9915` (nine packets to specs/done) is an ancestor of
  HEAD; the packet sits at `specs/done/dispatch-cli-flag.md`, status done;
  the `opencode run` invocation line carries no `--dir` (grep-verified),
  while the project's own Node helpers keep their `--dir=` flags as intended.
- Gate `bash -n scripts/run-coding-dispatch.sh` run GREEN 2026-10-10.
- Still owed: a live e2e proof link — the 8 oct review-sweep returned this
  row to Assigned for a missing screenshot. Gate green but no proof, so no
  review claimed here.
- Human check: file the PNG/Drive proof, then review. (Not closed as noise:
  completed work awaiting closeout must not be misfiled as noise.)

## Sheet-03 (task:vm5-ping-loop, open) — LIVE

- Open process-oversight task, still relevant: `agent/vm5-failover` is
  active (`168f08e4` go-plan/OG rows); `review-notify.timer` present.
- Staleness found: Work-done said "PR #606 open" — #606
  (fix(pm): machine board writes fleet tab + meal live-proof process)
  MERGED 2026-10-08. Noted on the row.
- Proof Drive folder (`1Qye_0Gr8m6W7PG1LvsXE_pR5x_RfVXCG`) exists but holds
  only one PNG from 3 oct — nothing evidencing the 7 oct loop iteration.
- Gate (DONE → verified → next-or-iterate sent via TG, visible from bot)
  not yet evidenced; TG-visibility was the human's original complaint.
- Human check: confirm one TG-visible DONE→next cycle, then close the gate.

## Rule notes for next triagers

- A merged fix commit as ancestor of HEAD does NOT alone make a row noise:
  check whether the packet/row still owns undone closeout (proof, Done
  move, gate re-run). Board-02 is the template case.
- A vitest startup failure from missing node_modules is env-blocked, not
  red. Re-verify on a checkout with deps and label the evidence.
- `gh pr list --state open` showed no sibling branch touching these three
  keys; overlap check passed before any sheet write.
