# Observer: Bug-2 refix run (2026-10-10)

Fix agent: background subagent ses_edb4c14c2ffedhjN1c2NPQ9hwL,
worktree /home/ubuntu/dev/bug2-refix (agent/bug2-refix).
Baseline snapshot: /tmp/opencode/bug2-baseline/ (packet + proof-folder
listing, 2026-10-10). Parent verifies on completion; human reviews in
/review. This file is the learning record. Standing/guard changes are
PROPOSALS here — they need a `promote` before anyone touches
docs/agent/standing.json or journey-guard.

## Instruments (how the run is watched without disturbing it)

- Liveness: ~/.local/state/bot-host/agent-heartbeat/agent-bug2-refix.json
  (heartbeat beat correctly from the start) + `git status` on the worktree.
  Never message the agent for status.
- Correctness on completion: assert-sheet-proof + assert-sheet-canonical-parity
  re-run (row 43 must pass proof; parity must show sheet == canonical),
  draft PR diff read, proof-folder listing diffed against baseline.

## Observations so far

- O1 (caught pre-dispatch): the governed reader `mapReviewRow`
  (scripts/lib/review-status.mjs) does not project `state`. Both new
  sensors first used `item.state` — always undefined — and went blind to
  every `done` row while fixtures stayed green. Fixed with `cellByName`
  + regression fixtures. Lesson: sensors must read raw rows for any
  column the projection doesn't carry; fixture-green is not live-proven.
- O2 (caught pre-dispatch): sheet keys carry a `card:` prefix bugctl ids
  lack. First parity version reported all 12 card rows missing. Fixed
  with prefix strip + fixture.
- O3: the live sheet mutates mid-audit (Meal rows changed cell-width
  between reads minutes apart — active meal-qa agents). Audits are
  timestamped snapshots; re-run before verdicts, never quote stale reads.
- O4: specs/bug-journal/<public_n>.jsonl is stale-prone — journal/2.jsonl
  belongs to a previous card that reused public_n 2. The fix brief had
  to warn the agent off it explicitly.
- O5: heartbeat compliance worked first try — the one instruction the
  agent followed perfectly was the machine-checked one (hygiene reads
  the file). Unchecked instructions (pack-first, no-Done) are exactly
  what failed on the original Bug-2 run. Mechanism beats prose.

## Proposed rule deltas (NOT applied — for promote)

- P1: approve-guard in review-status.mjs — refuse approve with zero
  proof images (policy-kind exception). Closes "approve with no shots".
- P2: Status/state dropdown validation on `current` (tolerant read,
  strict write path in sheet_row.rb).
- P3: bug journal keyed by tag_id (or namespaced), public_n is reusable.
- P4: wire assert-sheet-proof + assert-sheet-canonical-parity into the
  prepush/CI chain once they go green — today they are red by design.
- P5: single-writer archive_done (review-app Done rows only;
  version-archivals to a history tab with source markers).

## Outcome (filled 2026-10-10 ~07:45 UTC)

- Order held: pack (`--check` green) → repro confirmed exit 1 → plan
  (hypothesis + 2 files + 3 named gates) → implement → gates green.
  No burned hypotheses, no loops, no painted fixtures. Zero deviations.
- Instructions followed: heartbeat from the start, Drive per-key folder,
  strays moved to a new Bug-53 folder, sheet honest throughout (never
  Done; Status=review only at gate). The machine-checked items held;
  this time the prose ones did too — difference from the original run:
  the brief named exact commands (`pack --check`, repro bundle shape)
  instead of phase names.
- Verifier (parent, independent): sensor test 2/2, aggregation+food_db
  39/39, bugAutoSpot.food 15/15, tsc clean — all re-run, all green.
  `bugctl verify` posted green with command + evidence → card #2 done.
  Sensors re-run: Bug-2 row passes proof + parity (approve-window rule
  added for canonical-done/sheet-review with fixtures).
- Residuals for the human (all disclosed, none blocking the verdict):
  live food-history shot shows the app, not the oat item's micros
  in-app; vitamins D/B12/C/A still 0 (dairy-merge follow-up, agent
  disclosed); trial-balance line deliberately unpacked for a follow-up
  card; exact-meal re-file impossible (no photo_urls at intake — G2
  photos + verbatim prompt used instead).
- O5 refined: checkable instructions hold. The sensor fixes (cellByName,
  prefix strip, approve window) each arrived with a regression fixture —
  that discipline is what kept verifier trust.

## Rework round (human verdict → agent → verifier, 2026-10-10 ~08:30 UTC)

- Human answered via the comment path (text-only, no upload — mechanics
  verified: stamp, append-only, last_activity refresh, queue retention).
- Same agent reworked in the same branch (additive commit 4baaa839,
  docs-only, no code — canonical artifacts untouched, parent verify
  stands). Proof-only rework done right: no attempt row, no self-verify.
- All three demands met and independently seen: job number heads the
  revised panels; exact meal re-filed live (PROOF #54, G2 photos +
  verbatim prompt, 509 kcal, zero residue, folded duplicate_of #2);
  analysis-view shots show the fixed nutrients in-app (Mg 65.1, Ca 169.5,
  Fe 2, Zn 1, Se 4.1, B6/B1/B2/B3 nonzero). Folder 5 → 12 files, zero
  deletions. Sensors: Bug-2 passes both.
- Nits for the next loop (not verdict-blockers): the micros table shots
  are horizontally cropped with dead gray space — values visible but
  ugly; implementer appends didn't refresh last_activity (still the
  human's 08:53 stamp); commit author name reads QA Bot (trailer, the
  CI-checked part, is correct).
- O5 holds again: the verdict's three numbered demands got three
  evidenced answers. Checkable orders produce checkable work.

## Round 2 (curate + full flow, 2026-10-10 ~11:15 UTC)

- Same agent, additive commit 98226634, docs-only again. Folder 12 → 9
  top-level + `superseded/` (4 moved, zero deleted, verified by id);
  no other-ticket files found. Entry shot PERFORMED pre-submit (both G2
  thumbnails + verbatim text visible, nothing sent). Gate now cites the
  full meal-proof contract — the sensor's meal checks fired live on
  Bug-2 for the first time and passed (input + output + job all green).
- Nits (not blockers): agent misreported the subfolder id in its
  summary (Drive reality verified correct); last_activity written
  lowercase `(uk)` vs sheet convention `(UK)`; entry text field
  scrolled but readable. Your stamps untouched (count verified: 2).
- Standing row + sensor + doc from the previous turn did their job:
  round 2's gate text opted the row into the stricter checks, which
  then passed on real evidence. Repeat-yourself loop closed.

## Round 3 (dedupe, 2026-10-10 ~11:45 UTC)

- Same agent, additive commit 48786de5, docs-only. Folder 9 → 7
  top-level + 6 in `superseded/`, zero deleted, verified by id.
- Verifier recomputed dhashes independently (8x8): mg-ca/fe-zn = 1,
  mg-ca/bvitamins = 2, fe-zn/bvitamins = 1 (moved, correct);
  before/after-job = 10 (kept pair, values visibly differ);
  micros-vs-panels = 31-35 (distinct). Agent's absolute numbers
  differ (different hash size) but every keep/move verdict agrees.
- Single-shot attempt failed clean on layout evidence (max-w-md
  column always h-scrolls) — documented, one setup try only. Right
  call: stop after decisive negative evidence, not after N retries.
- Sensors green on row 43 (meal contract still passing on 7 files).
  Nits: lowercase `(uk)` again; agent's subfolder-id typo (round 2).

## Promote recommendation

- P1 (approve-guard) EARNED: the run proved proof-present review works;
  approve with zero shots should now refuse. Small, safe, propose it.
- P4 (wire the two sensors into prepush/CI) EARNED with the approve-window
  refinement: parity is no longer red on legitimate transients.
- P3 (tag-keyed journal) EARNED: journal/2.jsonl nearly misled the run.
- P2 (dropdowns) and P5 (single-writer archive) PROPOSED but unproven by
  this run — keep for a later promote with their own evidence.
