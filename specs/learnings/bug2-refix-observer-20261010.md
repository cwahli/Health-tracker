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

## Bug-3 pack repair verified (2026-10-10 ~13:00 UTC)

- Different agent, fresh worktree agent/bug3-pack, draft PR #695.
  Canonical: ONE defect, class OPENING_DRIFT (own, sensor-derived —
  Bug-2's framing deliberately not reused), state packed. Row: id
  fixed #2→#3, state→packed, stamp intact, Status review with a
  genuinely-met pack gate. Folder: 2 fresh shots, old ones DELETED.
  Sensors: Bug-3 passes both (proof + parity agree).
- Gap 1 (rule breach): the 2 stale PNGs were DELETED, not moved to
  `superseded/`. Standing curation says nothing is deleted. Damage is
  low (shots of an unperformed pack; this observer's baseline listings
  preserve what was there) but the letter was broken — recorded so the
  next curation brief states move-not-delete explicitly.
- Gap 2 (evidence at risk → rescued): #3's pack op is journaled NOWHERE
  on disk (P1 A+D wants the git mirror), and #54's create+duplicate
  trail sat uncommitted in the auto-deploy tree (reset-wipe risk).
  Rescued 54.jsonl verbatim into agent/bug2-refix (pushed). #3's pack
  line still needs a proper journal write — flagged, not fabricated.
- Standing P3 (tag-keyed journal) upgraded from proposed to URGENT:
  journal/2.jsonl AND journal/3.jsonl both carry dead cards' history
  under live public numbers, and the shim resolves REPO_ROOT into the
  deploy tree, scattering uncommitted lines where reset eats them.

## Bug-3 full resolution verified (2026-10-10 ~15:30 UTC)

- Same agent, worktree agent/bug3-pack, draft PR #695. Repro confirmed
  pre-fix (exit 1, root cause named before code), fix in labelEnergy.ts
  (5 kcal + 2% dual gate), sensor 3/3 + labelEnergy 11/11 re-run green
  by verifier, tsc clean. No overlap with #686. No verify posted by
  implementer — parent posted green → card #3 done.
- Live proof meets the standing rules: job cited on panels, entry shot
  (full verbatim text readable this time), live 629 kcal refile,
  before/after from real pipeline runs. Folder 6 files, all #3's,
  nothing deleted. PROOF #55 folded. Sheet: stamps intact, Status
  review, gate cites meal contract.
- Adjudication (flagged tension): agent mirrored canonical `packed`
  against the brief's `in_fix`. Agent was RIGHT — the sheet must never
  declare a state the store doesn't derive (the original design sin).
  Parity sensor agrees (packed==packed, PASS). Standing holds.
- Residuals: live meal carries no OCR panel (gate inert there by
  design — disclosed); full-breakdown shot skipped to avoid showing
  Bug-2's still-open micros defect (correct scoping).
- Side observation: Bug-53's mislinked proof cell got fixed by an
  unseen hand — proof sensor dropped from 4 fails to 3. Remaining:
  Auto-01, Domain-01 cross-links, Meal-36 done-no-proof.

## Batch cleanup protocol (standing process, 2026-10-10)

10 card rows (Meal-35/36/37, Stew-01, Bug-59/58/57/56/55/53) triaged by
parent BEFORE dispatch: 9 phantom (absent from bugctl), 1 live (#53),
1 invalid done (Meal-36), 2 proof folders (Meal-35 terminal-only,
Bug-53 fresh). Wave stockage: max 2 concurrent fix agents, separate
worktrees/branches, non-overlapping defect areas (claim-guard checked
up front), rest queued explicitly. Manager loop per ticket: brief with
exact commands + standing rules → agent runs → parent verifies
(canonical + gates + PNGs seen + sensors) → human reviews in /review.
Violations iterate with the rule cited, then the rule gets encoded
(sensor/standing) so the next ticket can't repeat it. Sheet writes by
agents: append-only, stamps byte-intact, never Done, last_activity
UK-fresh. Phantom handling: investigate-then-file-or-close with
recorded reasoning — never invent canonical records, never claim done.
Wave 1: agent/bug53-fix (full pipeline, ses_ed968b77) +
agent/meal35-redo (live-proof redo, ses_ed968b75).

## Meal-35 redo verified: REFUSAL HOLDS (2026-10-10 ~16:25 UTC)

- Claim TRUE. Verifier reproduced the exact combination (new code +
  audited bundle): exit 1, outcome ungrounded_no_cards, null tickets.
  Evidence genuine (qa-evidence matches real run shape; panel states
  the full command). Sensor 12/12, journal 35.jsonl exists, sheet
  honest (Assigned, no Done), folder 6 files nothing deleted, branch
  clean, PR #699 draft. Refusal holds on current main — no bug, no fix.
- F1 (new rule): the learnings' "re-run the one command" FAILS in the
  agent's own tree (needs_audit — its bundle lacks meal_result.json).
  Proof depended on another tree's audited data without saying so.
  Rule from here: every proof run states code-tree + data-path +
  verbatim command, and the re-run instruction must work verbatim
  where stated. Reproducibility is part of proof.
- F2 (LIVE RISK, escalated not touched): agent/meal-qa-remaining runs
  pre-beb82e09 loop code (0 grounding matches; version 0c7d5b0d).
  Verifier dry-run there: tickets.posted 24. A live run from that
  tree files ungrounded cards — the Meal-35 failure recurring. Dirty
  active tree, another area: report, don't enter. Owner must rebase
  past beb82e09 or stop running the loop there.
- Recommendation: Meal-35's redo satisfies its gate (refusal proven
  live with PNGs). Human moves it to review → approve, closing the
  7-Oct stall_reason for good.

## Bug-53 full cycle closed (2026-10-10 ~evening UTC)

- Pack → fix → gates (18/18 re-run green) → proof failed verifier on
  loading-state pixels → recapture with load asserts → failed again on
  evidence-subject indistinguishability → fresh-content re-file through
  the genuine CLI path → human-distinguishable render verified by
  verifier eyes → verify posted green → card #53 done. Each round
  narrowed the gap: process → technique → subject.
- #56 (fresh-content PROOF card) folded duplicate_of #53, same as
  #54→#2 and #55→#3. The duplicate command prints a STOP/advisory
  wrapper but lands the fold — verified in packet, not assumed.
- Sensors: Bug-53 passes both (parity via approve window). Proof fails
  now only the 3 pre-existing debts.
- Standing earned: loaded-content rule already encoded from this run;
  folded-PROOF-card convention (#54/#55/#56) works — propose it as the
  documented PROOF-card lifecycle (file live → fold into parent →
  never standalone-close).

## Wave 2 dispatched (2026-10-10, review queue at zero)

- User asked for 10 in review with 0 legitimately reviewable (Bug-53
  approved; Meal-35 missing job citation — verified in C2, sensor
  would fail it). Refused to relabel: review means gate-met +
  proof-present, else the queue becomes the original sin again.
- Sensor learned the refusal-proof shape (output markers + fixture)
  instead of bending. Meal-35's job citation is wave-2 item one.
- Wave 2: agent/wave2-meals (Meal-35 job cite→review, Meal-36 reopen,
  Meal-37 triage) + agent/wave2-phantoms (Stew-01, Bug-59/58/57/56/55
  investigate-file-or-close). Max 2 concurrent, non-overlapping areas.

## Wave 3: gate-sweep (2026-10-10, user challenged the refusal)

- User listed 24 Assigned rows asking why a subagent can't clean them
  into review. Answer: it can — by earning, not marking. Dispatched
  agent/gate-sweep (ses_ed909b45) for the 15 non-card rows: run each
  Completion gate verbatim → capture → per-key folder → flip ONLY on
  green. Code changes forbidden (RED = finding for later wave).
  Wave-2 card agents already own the other 9. All 24 covered, zero
  overlap by construction.
- Stated expectation: rows with meaningless gates (Req-12 "0", vague
  sync prose) CANNOT go to review and will come back honestly blocked.
  Review count grows by evidence, not by request.

## Wave 2 closed (2026-10-10)

- Meals agent (agent/wave2-meals, PR #704 draft): Meal-35 genuinely
  green after the loophole fix (replay-target, not denial prose) —
  recommend approve. Meal-36 reopened Assigned/in_fix with trace
  (journal #20, card aged out, gates claimed 44/44, proof still owed —
  stays open). Meal-37 traced (journal #19, PR #441 merged, missing
  gate test named) — stays open. No code touched, diff is one
  learnings note.
- Phantoms agent (agent/wave2-phantoms, PR #703 draft): all six
  closed-as-noise with per-ticket origin + reasoning on rows, no rows
  deleted, no Done, no review claims, no bugctl writes (count 14 =
  pre-existing growth), no Drive moves. Bug-55's fix verified in
  history (e68acc71). Rows stay for audit; parity still flags the
  missing keys, which is accurate.
- Rule earned mid-wave: denial prose ("no job") is not citation;
  replay-target (bundle + comparison) is. Sensor + doc + standing
  updated same turn, fixtures both directions.

## Wave 3 closed (2026-10-10, verifier pass ~19:15 UTC)

- Gate-sweep agent (agent/gate-sweep, PR #705 draft): diff is one
  learnings note, tree clean, no code touched. Verifier re-checked:
  rows 22/23/26 review with per-key folders, sensor PASS on all
  three, one proof PNG per row viewed by verifier eyes (captioned
  command + EXIT:0, loaded content, no spinners).
- Review queue now 4 (Meal-35 + Merge-01 + Main-01 + Forge-01).
- 12 rows honestly held back: 4 RED with named causes, 8
  UNVERIFIABLE with reasons. Later-wave findings, no action taken:
  bot-host vitest non-hermetic (blocks Health-02/09/10);
  assert-google-store no-PUT assertion contradicts merged #510
  (Health-10); Fleet-09 guard spec_not_locked (spec completed on
  main, guard wants locked); Fleet-06 premise stale (#491/#495/#500
  merged 10-03); Req-12 gate is literally "0".
- Sheet-04 state cell repaired (note moved to Work-done, state=open).

## Wave 4 dispatched (2026-10-10, all 4 approvals archived Done)

- Archive confirmed: Meal-35 + Merge-01 + Main-01 + Forge-01 all Done
  via review-miniapp. Review queue back to zero.
- Next 10 named: Health-02, Health-09, Health-10, Fleet-09, Meal-36,
  Meal-37 (agent-advancing now) + Sync-08, Sync-09, Fleet-06,
  Spec-01 (need owner calls first). Deferred: Req-12, Req-18
  (phone), Health-01 (creds), Sheet-04 (owner prose).
- Wave 4: agent/wave4-hermetic (bot-host hermeticity fix → Health-02/
  09 green; Health-10 bot-host half only, no flip) +
  agent/wave4-mealproof (Meal-36/37 full 6-step live proof, prior
  44/44 claim re-run not trusted). Max 2 concurrent, disjoint areas.

## Wave 4 meals closed (2026-10-10, verifier pass ~20:10 UTC)

- Meal agent (agent/wave4-mealproof, PR #707 draft): diff is one
  learnings note, tree clean, zero code touched. Prior 44/44 claim
  re-run (44/44 green) and 8/8 gate re-run — trusted nothing.
- Meal-36 REVIEW-READY: live re-file job_1791658212211_v4rx3al2v on
  zero-diff dev server, both ledger rows carry boxes. Proof seen:
  input panel labels the entry reconstructed (originals aged out),
  output shows both dishes rendered, job on every strip.
- Meal-37 REVIEW-READY with stated gap: same class-level re-file,
  panel + row both state scoutToLedgerDishDrop.test.ts was never
  landed and not invented. Gap disclosed, not hidden.
- Sensors: rows 3 + 26 PASS. Recommend approve on both; Meal-37's
  Done additionally needs the human's call on the absent test file.
- Side observation: Health-02 (R18) + Health-09 (R21) already flipped
  to review by the still-running hermetic agent, sensors green —
  final verification (PNGs seen, branch/PR) waits for its report.

## Wave 5: wide investigations, narrow flips (2026-10-10)

- User asked for 10 at once. Answer given honestly: review-flipping
  work stays max-2 (rate limits already bitten; verification is the
  binding constraint — ten simultaneous landings is the original sin).
  Report-only investigations can't pollute the queue, so they go
  wide: 4 agents, 8 rows, disjoint scopes, no status flips allowed.
- agent/wave5-health10 (PUT both-sides, change nothing),
  agent/wave5-fleet09 (spec_not_locked paths, change nothing),
  agent/wave5-sync (Sync-08/09 why-unrunnable + dry-run drafts),
  agent/wave5-gates (Fleet-06/Spec-01/Req-12/Sheet-04 verdicts).
  Concurrent with wave4-hermetic = 5 running. All findings come back
  as proposals for human approval, never edits.

## Promote recommendation

- P1 (approve-guard) EARNED: the run proved proof-present review works;
  approve with zero shots should now refuse. Small, safe, propose it.
- P4 (wire the two sensors into prepush/CI) EARNED with the approve-window
  refinement: parity is no longer red on legitimate transients.
- P3 (tag-keyed journal) EARNED: journal/2.jsonl nearly misled the run.
- P2 (dropdowns) and P5 (single-writer archive) PROPOSED but unproven by
  this run — keep for a later promote with their own evidence.
