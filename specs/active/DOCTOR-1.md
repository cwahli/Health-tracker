---
id: DOCTOR-1
status: locked
class: UNCHECKED_CLAIMS
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/health/doctor.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/council-runner.mjs
  - scripts/lib/project-registry.mjs
  - scripts/lib/commands.mjs
  - scripts/bot-host.mjs
  - scripts/health-runner.mjs
  - scripts/assert-external-health.test.mjs
  - projects/external-health/roles/doctor.md
  - AI_HANDOVER.md
frozen_files:
  - scripts/lib/health/context.mjs
  - scripts/lib/health/docs.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/lib/health/reconcile.mjs
  - projects/external-health/soul.md
  - projects/external-health/roles/data_steward.md
  - projects/external-health/roles/health_analyst.md
  - projects/external-health/roles/test_planner.md
  - projects/external-health/roles/research_lead.md
  - projects/external-health/roles/safety_reviewer.md
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-external-health.test.mjs
  - node scripts/assert-external-projects.test.mjs
  - node scripts/assert-council-no-invented-case.test.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-auto-merge.test.mjs
  - node scripts/assert-main-verify.test.mjs
  - npx tsc --noEmit
---

# DOCTOR-1 — a seat that checks the other seats, and cannot be talked out of it

## Goal

Drop 1 made a seat able to see the data. This drop adds the seat whose whole job
is to say that a claim does not hold: the analyst writes claims, the Doctor
re-reads them, traces each one back to a receipt, and strikes the ones that do
not hold. It writes exactly one document — `result/doctor-report.md` — and never
touches the analyst's payload or the four published documents.

The failure mode it exists for is the one that reads as reassurance: **a PASS
with no receipt.** "Nothing contradicted it", "the data is consistent with this",
"no red flags" — a claim that nothing supports is as unpublishable as a claim
something contradicts, and it is harder to notice because it reads as diligence.
So the report is checked mechanically before it lands, and three shapes are
refused with **nothing written**: a report with no coverage header, a finding
with no receipt, and a PASS whose only evidence is an absence. A PASS that rests
on an open fix-list item is refused for the same reason — with eight items open
(H-1…H-8), most of what the analyst can honestly say today is **UNPROVEN**, and
that is the correct report, not a failed one.

## What changes

- **`projects/external-health/roles/doctor.md` (new).** The sixth seat: the
  report's output shape (coverage header, one numbered block per claim with six
  labels `Claim/Receipt/Status/Changes/Recommendation/Who`), the refusal rules
  quoted back to the model so it can comply, the no-diagnosis/no-dose guardrail,
  and the rule that makes the open gate readable — a header-only report is the
  honest one when there is no payload to review.
- **`scripts/lib/health/doctor.mjs` (new).** `validateDoctorReport(text, {
  analysis, gate })` returns `{ ok, error, report }` with the parsed coverage,
  the claims and the counts; the four refusals above are implemented as literal
  rules, including "Coverage is a count that is checked" (the number must match
  the blocks, 0 is only legal when there is no readable payload) and "a PASS
  needs a dated receipt". `renderDoctorReport` owns the bytes on disk. Pure: no
  filesystem, no clock, no model.
- **`scripts/lib/project-registry.mjs`.** The sixth entry in
  `HEALTH_PROJECT_ROLES` declares the two things a role markdown file cannot:
  `outputFile: 'doctor-report.md'` (the artifact the seat owns) and
  `validator: 'doctor'` (the checker that judges it) — both merged into the
  disk scan rather than lost to it. The scan now also preserves the **declared
  running order**, so the Doctor runs last — after the seats whose claims it
  checks — and the five seats a chat already numbers keep their numbers
  (`/council 2` is still the analyst). `doctor` joins the role aliases.
- **`scripts/health-runner.mjs`.** `runHealthDoctor({ projectId, env, paths,
  workspace, runGemini, now })` reads the same context pack every seat reads,
  refuses before the model when there is no credential (the refusal names the
  key and the file it goes in), takes one seat turn, checks the report, and only
  then writes `result/doctor-report.md` plus its own receipt
  `result/health-doctor.json` (coverage, counts, claims, gate). A model failure
  or a refused report returns `{ ok: false, stage }` having written nothing.
  `formatDoctorText` is the reply: counts, the gate, and the reminder that
  UNPROVEN is the honest verdict while an item is open. `--doctor` joins the
  CLI, exiting 3 on a refusal — the same "refused on purpose" code `--readiness`
  uses.
- **`scripts/council-runner.mjs`.** `getCouncilPhases` honours a seat's declared
  output file, so the writer and the reader agree on `doctor-report.md` (a
  numbered `06_doctor.md` transcript would be a second report). Both stage doors
  — `/council doctor` and `/council all` — now run a seat's declared checker
  before writing, so an unchecked report cannot land whichever door ran it. The
  facts the checker judges with come from the workspace (payload accepted /
  refused / absent, open item ids), never from the report.
- **`scripts/bot-host.mjs`, `scripts/lib/commands.mjs`.** `/health doctor`, with
  the running-guard the other work commands have, and the command list and help
  text updated.
- **`scripts/assert-external-health.test.mjs`.** 321 → 382 checks: a new
  section 13 (the checker on literal reports, the runner end to end with the
  `runGemini` seam, the Docs-untouched invariant, the CLI refusal, and the
  council-stage door) plus the five-seat pins renumbered to six.
- **`scripts/lib/health/readiness.mjs`.** One finding's wording: the missing
  payload is the analyst's to write and the Doctor's to review, not the other
  way round. No new checks.

## Evidence (measured on this box, 2026-10-01)

- `node scripts/assert-external-health.test.mjs` → **382 pass, 0 fail** (321
  before this drop).
- **The run, on a copy of the real workspace** (`/tmp/doctor-copy`, 23 files
  copied from `~/projects/external-health-coach`), driven through the `runGemini`
  seam: `runHealthDoctor` wrote `result/doctor-report.md` +
  `result/health-doctor.json` and nothing else. A recursive before/after hash of
  every file shows `added: result/doctor-report.md, result/health-doctor.json`
  and `changed: (none)` — the Docs registry hash and all published-doc bytes
  unchanged. The real folder re-hashed afterwards: 23 files, no
  `result/doctor-report.md`, `result/health-docs.json` still 4932 bytes.
- **The absent-payload report, live.** The real workspace holds no payload, so
  the seat's report is header-only by design: `Coverage: 0 claim(s) reviewed …`,
  `Not seen: result/health-analysis.json …`, `Gate: OPEN (H-1 … H-8)`,
  `Payload: not present` — and the checker accepts exactly that shape.
- **The payload case, live.** With the 11 analysis sections written into the
  copy, a claim with a dated receipt reads `1 PASS · 0 STRIKE · 0 UNPROVEN`; the
  same claim with `Receipt: not measured — nothing contradicted it` is refused by
  name (`claim 1 PASSes on an absence … the verdict is UNPROVEN`) with the
  report on disk unchanged; the same absence told honestly as `UNPROVEN (H-4)` is
  accepted.
- **The refusals, live.** A model answer with no coverage header →
  `{ ok: false, stage: 'report' }`, nothing written; no credential →
  `stage: 'credential'`, nothing written; no brief → `stage: 'context'`;
  `node scripts/health-runner.mjs --doctor --json` → **exit 3**, refusal in JSON
  on stdout.
- **Both doors.** `/council doctor` on the copy wrote
  `result/doctor-report.md` (not `06_doctor.md`), and
  `getCouncilStatus('external-health')` now reports `pipeline roles · phases 6 ·
  deliverables 6` with the doctor last and its own report as the deliverable; a
  malformed report on that door throws and writes nothing.
- **Red proofs** (each sabotage restored; 382/0 again after each):
  the coverage-header refusal removed → `a report with no coverage header is
  refused` FAILs; the receipt rule removed → `a finding with no receipt is
  refused` FAILs; the absence phrase bank emptied → `a PASS on an absence is
  refused` FAILs; the declared output file ignored → 7 checks FAIL
  (`the stage door writes the declared report, not a numbered transcript`, the
  phase numbering, the status read-back …); the `health-doctor.json` write
  redirected onto `health-docs.json` → `every pre-existing byte is unchanged
  (the Docs registry included)` FAILs; the declared running order removed → 7
  checks FAIL (the doctor's position and the existing seats' numbering).
- Gates: `assert-external-health` 382/0, `assert-external-projects` 55/0,
  `assert-council-no-invented-case` 21/0, `assert-command-scope` OK (28 commands),
  `assert-auto-merge`, `assert-main-verify`, `tsc --noEmit`,
  `assert-spec-diff DOCTOR-1` (patch, allowed, frozen), `no-undo` over
  `origin/main..HEAD`.

## Left

- **No live model call.** `GEMINI_API_KEY` is absent from
  `~/.config/bot-host/common.env` on this box, so the seat turn is proven
  through the `runGemini` seam and the refusal path is proven live. The
  credential is the user's to add.
- **The first report on the real workspace will be a header-only report — 0
  claims, `Not seen: result/health-analysis.json`.** No payload exists yet and
  the gate is open, so the report says exactly that, by design. It becomes a
  claim-by-claim review when the analyst writes the payload.
- **3 — `research_lead`'s search lane with fetch-verified citations, and the
  publisher's staleness rule** remain from the approved plan.
- **The Doctor does not gate publishing yet.** Its report is an artifact; wiring
  it into `/health refresh` (strikes block a publish) is a later drop, not this
  one.
