---
id: DOCTOR-2
status: locked
class: UNENFORCED_REVIEW
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health/docs.mjs
  - scripts/health-runner.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/tui-stranded-exceptions.txt
  - scripts/assert-external-health.test.mjs
  - projects/external-health/roles/doctor.md
  - AI_HANDOVER.md
frozen_files:
  - scripts/lib/health/doctor.mjs
  - scripts/lib/health/context.mjs
  - scripts/lib/health/research.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/lib/health/reconcile.mjs
  - scripts/lib/health/d1.mjs
  - scripts/council-runner.mjs
  - scripts/lib/project-registry.mjs
  - scripts/lib/commands.mjs
  - scripts/bot-host.mjs
  - projects/external-health/soul.md
  - projects/external-health/templates
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-external-health.test.mjs
  - node scripts/assert-external-projects.test.mjs
  - node scripts/assert-council-no-invented-case.test.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-auto-merge.test.mjs
  - node scripts/assert-main-verify.test.mjs
  - npx vitest run tests/bot-host.test.ts
  - npx tsc --noEmit
---

# DOCTOR-2 — the review that gated nothing now gates the publish

## Goal

DOCTOR-1 ended with the same sentence its packet was honest about: *the Doctor
does not gate publishing yet — its strikes are an artifact, not a publish block.*
The seat could strike a claim and `/health refresh` would publish it anyway, on
the next run, as if the review had passed. That is the failure mode this drop
closes: **a `STRIKE` on the receipt now withholds every analysis section**, names
the struck claims in the refusal, and the data sections still publish as a
draft — exactly the rule the open gate and the stale snapshot already follow.

## What changes

- **`scripts/lib/health/docs.mjs` — the reviewer's veto, as one more question
  the publisher asks.** `doctorReview(report)` reads the receipt
  (`result/health-doctor.json`) into `{ read, at, strikes, counts, blocked,
  unreadable }`, with three different answers: no receipt at all is *not* a
  strike (nothing changes — the boundary this pass keeps); a receipt that reads
  blocks when it carries any `STRIKE`, and a strike-free receipt — `UNPROVEN`
  included — does not; a receipt that cannot be read fails closed, because a
  review that cannot be shown to be clean is not a clean review. The internal
  `withDoctor()` folds it into the gate object, so `analysisAllowed` stays the
  single answer to "may analysis publish?" and the header, the sections and the
  plan's mode cannot disagree. `renderHeader` gains the strike banner (naming
  the claims) and a `Doctor's review` provenance row when a receipt reads;
  `renderSection` refuses analysis with `doctorRefusalText` after the gate and
  the clock; `planPublish`/`renderDoc` take `doctor = null`, so every existing
  caller — and the whole sensor before this section — is unchanged. The receipt
  file name `DOCTOR_ARTIFACT` moves here, because the publisher is now a reader
  and two literals would be two things to keep in step.
- **`scripts/health-runner.mjs` — `/health refresh` reads the receipt.** It
  loads `result/health-doctor.json` when present (a file that does not parse is
  handed to the publisher as `{ unreadable }`, not as "no strike"), passes it to
  `planPublish`, writes the review into `health-refresh.json` (under `gate`),
  and `formatRefreshText`/`renderRefreshLog` keep the fourth reason apart from
  the other three — the gate, the clock, the strike — and say what clears it.
- **`scripts/lib/health/readiness.mjs` — the strike is visible where the
  operator looks.** A missing report, a strike, and an unreadable receipt are
  three different findings; a strike-free review is `ok` with its counts. The
  failure mode this prevents is a review that only exists in a file nobody reads.
- **`projects/external-health/roles/doctor.md` — the seat is told its verdict
  has teeth.** While the receipt carries a strike, `/health refresh` withholds
  the analysis; `UNPROVEN` alone does not block. So strike honestly, and never
  soften one into a pass to make a publish possible.
- **`scripts/assert-external-health.test.mjs` — section 18 (49 checks):** the
  review reader's three states; the publisher pure (mode, refusal text naming
  the claim, banner, provenance row, no leaked claim, data document still a
  draft with no section refused, precedence of the gate and the clock over the
  strike); then end to end through `runHealthRefresh` with a real workspace and
  a receipt on disk (draft, every analysis heading withheld, the reply and the
  run log naming the claim, the raw boundary with no receipt, the unreadable
  receipt, the cleared receipt, readiness), the repair path
  (`runHealthAnalyze` still writes while a strike is on file), and the loop
  closing on the receipt `runHealthDoctor` itself writes.

## Findings (the decisions worth not re-deriving)

- **The refusal is per payload, not per claim, because a claim is not a
  section.** The Doctor's blocks are claims in payload order, not keys; mapping
  a strike to the one section it belongs to would be a guess dressed as
  precision. The honest unit is the payload: one struck claim withholds the
  analysis, the refusal names *which* claims, and the repair is the loop the
  seat files already prescribe — analyst rewrites, Doctor re-checks.
- **Absence is not a strike.** A review that has not run leaves publishing
  exactly as it was before this gate existed. "No review, no publish" is a
  stronger rule and a later drop; it would change the default workflow and wants
  the payload to carry its own review receipt first. The boundary is pinned in
  the sensor rather than left to prose.
- **Unreadable fails closed.** A corrupt `health-doctor.json` is not an excuse
  to publish unreviewed; it blocks with the parse failure named. `doctorReview`
  is the one reader for both the publisher and readiness, so the two cannot
  disagree about what a strike means.
- **The review does not pin the payload it read (no hash).** A strike therefore
  blocks until the Doctor re-runs, even if the payload changed after the review
  — fail closed, and the refusal text says the whole loop (`/health analyze`,
  then `/health doctor`) because that is what clears it. A payload hash on the
  receipt is a later refinement.
- **The proof found one real defect in the sensor**: with the receipt-loading
  line sabotaged, a check dereferenced `counts.reviewed` off a null and the
  whole section crashed instead of reporting red. The check now uses optional
  chaining — a sabotage must produce FAILs, not an exception.
- **One repo-wide repair was needed to land this pass, and it is not lane
  work.** The required `tsc + named gates` job was red before this branch
  existed: the TUI fixes-landed ratchet watched `origin/agent/forge-one-click`
  (`1ea00d23`, PR #373 merged 2026-09-30 as `a9c6ad72`), and its
  "landed by another route" check compares watched files byte-for-byte — main
  moved those files on after the merge (`2ead5aa3`, `d18568f6`, `eca9ed2c`), so
  the branch could never clear itself. A dated waiver was added to
  `scripts/tui-stranded-exceptions.txt`; deleting the branch lets the line be
  deleted with it.

## Evidence (measured on this box, 2026-10-01)

- `node scripts/assert-external-health.test.mjs` → **690 pass, 0 fail** (641
  before this pass). No earlier check changed.
- **Red five ways**, each sabotage restored and 690/0 again: the strike ignored
  (`blocked: false` for a readable receipt) → **18 FAIL**; an unreadable receipt
  treated as clear → **8 FAIL**; the runner stops loading the receipt → **13
  FAIL**; the refusal loses the struck claims' names → **3 FAIL**; readiness
  reports a strike as `ok` → **1 FAIL**.
- **Live, on a copy of the user's real workspace** (`/tmp`, 23 files copied,
  real verify artifact, real registry, real templates, real runner functions;
  model seams in place of the credential this box lacks, `planPublish` as the
  decision function, no Drive call, no live model call): the real open gate
  refuses the producer (`stage: 'gate'`, H-1…H-8); with the gate closed *in the
  copy*, the producer wrote the payload, the Doctor's own writer left a receipt
  with one strike, and the publisher decided **draft** with all 11 analysis
  headings withheld, the document carrying *"Not published while the Doctor's
  report carries 1 STRIKE(s): claim 1 (HbA1c trend)…"* and no analysis claim;
  the data document still published with the strike banner in its header. After
  a clean re-check the same workspace published in **analysis** mode with
  documents 2 and 3 rendered and document 4 still refusing its four uncitable
  sections (no research log on that folder — the literature lane has not run).
  The real folder was hashed before and after: **23 files, hash `fee172449f6907fa`
  both times**.
- Gates: `assert-external-projects` 55/0, `assert-council-no-invented-case`
  21/0, `assert-command-scope` OK (28 canonical), `assert-auto-merge`,
  `assert-main-verify`, `vitest run tests/bot-host.test.ts` (162/162),
  `tsc --noEmit` 0, `assert-spec-diff DOCTOR-2`, `no-undo`, `npm run test:prepush`
  exit 0 — and the CI ratchet that had been red for a reason outside this diff
  now finds nothing stranded (`origin/agent/forge-one-click` waived by name).

## Left

- **No live model call has run.** The receipt's producer is proven through the
  `runGemini` seam; on the host that sets `GEMINI_API_KEY` the loop
  `/health analyze` → `/health doctor` → `/health refresh` is real end to end.
- **A review that has not run does not block** — the boundary this pass keeps
  deliberately. "No review, no publish" would be a later drop, and it wants the
  receipt to pin the payload it read first.
- **The strike survives a payload rewrite by design** (no hash on the receipt):
  the loop is re-run the Doctor, not wait it out; the refusal says so.
- **Document 4's citations still need the literature lane**, and the real gate
  is still open (H-1…H-8) — the user's to fix in the app; until it closes, the
  producer refuses by design and the Doctor's bill is the user's.
