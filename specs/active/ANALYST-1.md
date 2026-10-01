---
id: ANALYST-1
status: locked
class: NO_PAYLOAD_PRODUCER
edit_mode: patch
skill: data-plane
auto_go: false
allowed_files:
  - scripts/health-runner.mjs
  - scripts/bot-host.mjs
  - scripts/assert-external-health.test.mjs
  - projects/external-health/roles/health_analyst.md
  - AI_HANDOVER.md
frozen_files:
  - scripts/lib/health/docs.mjs
  - scripts/lib/health/context.mjs
  - scripts/lib/health/readiness.mjs
  - scripts/lib/health/doctor.mjs
  - scripts/lib/health/research.mjs
  - scripts/lib/health/d1.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/lib/health/reconcile.mjs
  - scripts/council-runner.mjs
  - scripts/lib/project-registry.mjs
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

# ANALYST-1 — the analysis producer

## Goal

Every pass since the publisher landed has ended on the same sentence: nothing
writes `result/health-analysis.json`. `/health analyze` named the payload file,
the eleven sections and the inputs, and stopped there, so the four documents'
analysis sections could only ever read *"awaiting the analysis pass"*, the
citation contract had nothing to check, and the Doctor's checker had no live
payload to re-check. This pass makes the command a producer: one analyst seat
turn, the answer judged before anything lands, and the payload written.

## What it does now

`runHealthAnalyze` is async and takes the same shape as the Doctor's run:

1. **The gate, first.** No verify artifact → `stage: 'verify'`; any open item →
   `stage: 'gate'` with every open item and its title, exactly the refusal the
   command already gave. Analysis on unverified data is how a wrong date becomes
   a wrong risk score.
2. **The pack.** `buildHealthContext` — a refused pack (no workspace, no brief)
   is a refusal, not an empty prompt.
3. **The credential, answered not discovered.** `GEMINI_API_KEY` (or the
   `runGemini` seam); nothing is written without it.
4. **One seat turn**, `roleId: 'health_analyst'`, with a mandate that names every
   key and the citation rule.
5. **The answer judged before it lands.** `extractAnalysisPayload` finds the
   object (fenced block or bare object, `sections` or a bare map of analysis
   keys); `validateAnalysisSections` is the judge — unknown keys, non-arrays and
   non-string lines are refused, and a refused payload is not saved.
6. **The citation contract, as a receipt.** Document 4's four sections are
   checked against `result/health-research.json`; a section that cites a link
   nobody fetched is recorded in `citations.withheld` and named in the reply.
7. **One artifact.** `result/health-analysis.json` is payload *and* receipt:
   the `sections` and `at` the publisher's loader reads, plus the gate it was
   written under, the citation tally and the counts. A second receipt file would
   be a second thing to keep in step.

## Findings (the decisions worth not re-deriving)

- **The shape refusal writes nothing.** A malformed payload does not fail
  loudly, it fails *into the document* — `[object Object]`, a bare `42` reading
  as a measurement — which is why the check is closed and why a refused payload
  is never saved under a weaker name.
- **Citations are recorded, not enforced by dropping.** An uncitable document-4
  section could have been omitted from the payload, but an omitted section
  renders as *"awaiting the analysis pass"*: a quiet withholding, and exactly
  the failure the publisher's module exists to refuse. The producer writes the
  payload, the publisher refuses that section **by name** at render time with
  *"an unverified link is not a link"*, and the receipt says which sections and
  why. Documents 2 and 3 keep the claims they can carry.
- **The parser is permissive, the judge is not.** The seat writes prose around
  JSON as often as not; finding the object is the parser's whole job, and
  `validateAnalysisSections` decides what is a payload.
- **The gate refusal keeps its exact shape** (stage, open items, titles,
  `nextAction`), so the drafts and the refusal a user reads are unchanged; the
  only new behavior is what happens once the gate closes.
- **The producer took the Doctor's mold** — `paths`/`workspace`, context,
  credential, `runGemini` seam, judge, write, receipt, formatter, and the
  `--readiness`-style exit 3 — because two seat-runners with different shapes
  would be one more thing future passes have to reconcile.

## What changes

- **`scripts/health-runner.mjs`.** `runHealthAnalyze` becomes the producer
  (above) and `extractAnalysisPayload` is exported for the sensor; the mandate
  is a named constant; `formatAnalyzeText` gets the written-payload reply and
  the refusal reply; `--analyze` awaits, prints its refusal to stdout like
  `--doctor`/`--research`, and exits 3 on every refusal; `ANALYSIS_FILE` is
  exported and used by the refresh path and the Doctor's receipt.
- **`scripts/bot-host.mjs`.** `/health analyze` holds the running-guard the
  other seat commands hold, posts a progress line (it takes a model turn), and
  awaits the producer.
- **`projects/external-health/roles/health_analyst.md`.** The seat is finally
  told *what to hand back*: the JSON object, the eleven keys, and the citation
  rule for document 4.
- **`scripts/assert-external-health.test.mjs`.** Section 17 (49 checks): the
  gate/pack/credential refusals writing nothing; the payload written from a
  fenced answer with prose around it; the publisher's own loader accepting it;
  the four document-4 sections withheld as `unverified`; the reply; exactly one
  file added with every pre-existing byte unchanged; then the downstream proof
  — `planPublish` refuses those four sections by name over the *produced*
  payload while publishing documents 2 and 3, and publishes document 4 once the
  link is in the fetch log; the seat pack shows `shape: accepted`; readiness
  stops reporting the payload missing; five kinds of non-payload answer and a
  failed model call each refuse and write nothing; the extractor's own contract;
  and the CLI's exit 3.

## How it was proved

- `assert-external-health`: **596 → 641 checks, 0 fail**; every earlier section
  untouched (the four call sites that were sync now await).
- **Red four ways**, each sabotage restored and 641/0 again: the shape check
  made non-refusing → **6 FAIL** (a misspelt key and a non-string claim both
  land on disk); the data gate bypassed → **4 FAIL**; the citation receipt
  dropped → **3 FAIL**; the payload's gate record falsified → **1 FAIL**.
- **Live, on a copy of the user's real workspace**: the producer refuses the
  real open gate — `stage: 'gate'`, H-1…H-8, **exit 3**, nothing written; with
  the gate closed *in the copy*, a fixture model produced the payload (11
  sections), the publisher's loader accepted it, the prompt carried the real
  profile uid and sheet snapshot name, the four document-4 sections were
  recorded as withheld (`unverified`), and `planPublish` over that payload
  decided four updates with document 4 carrying the refusal text and documents
  2/3 carrying the claims. The user's folder was hashed before and after:
  **23 files, byte-identical**.
- Gates: `assert-external-projects` 55/0, `assert-council-no-invented-case`
  21/0, `assert-command-scope` OK (28 canonical), `assert-auto-merge`,
  `assert-main-verify`, `vitest run tests/bot-host.test.ts`,
  `tsc --noEmit` 0, `assert-spec-diff ANALYST-1`, `no-undo`,
  `npm run test:prepush` exit 0.

## Left

- **No live model call has run**: the producer is proven through the `runGemini`
  seam, and the payload becomes real on the host that sets `GEMINI_API_KEY`.
- **Document 4's citations still need the literature lane**: with no search
  credential, every produced payload's four insights sections are withheld as
  unfetched — run `/health research` first, then `/health analyze` again.
- **The Doctor does not gate publishing yet** — its strikes are still an
  artifact, not a publish block.
- **The data gate is open (H-1…H-8)** and stays the user's to fix in the app;
  until it closes, the producer refuses by design.
