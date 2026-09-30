---
id: external-health-publish
status: locked
skill: data-plane
edit_mode: rewrite
allowed_files:
  - scripts/lib/health/docs.mjs
  - scripts/health-runner.mjs
  - scripts/lib/commands.mjs
  - scripts/bot-host.mjs
  - scripts/lib/google-store.mjs
  - scripts/assert-external-health.test.mjs
  - projects/external-health/**
  - specs/active/external-health-publish.md
frozen_files:
  - AGENTS.md
  - docs/agent/**
  - plan/ROADMAP.md
  - src/**
  - tests/**
gate:
  - node scripts/assert-external-health.test.mjs
  - node scripts/assert-google-store.test.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-project-registry-parity.mjs
  - node scripts/assert-spec-diff.mjs external-health-publish
  - npx vitest run tests/bot-host.test.ts
  - npx tsc --noEmit
---

# Packet: external-health-publish — the four documents actually exist

Human mission (2026-09-30, second pass): the gate landed, the delivery half did
not. Nothing in the repo could create or update a Google Doc, so the four
documents the brief promises had no producer, and the templates under
`projects/external-health/` were scaffolding with nobody to read them. This
packet is the producer, and the refusal that keeps it honest while the data gate
is still open (8 items, all user-owned).

## Journey

The first pass moved the reconcile loop into the repo and made the read-only
guarantee a gate. What it could not do is finish: `/health refresh` did not
exist, `result/health-verify.json` had no consumer, and the only answer `/health
status` could give about the documents was the hardcoded line "publish after the
data gate closes". A project whose whole purpose is four living documents had
zero of them.

`edit_mode: rewrite` is deliberate: `scripts/health-runner.mjs` is this
project's by-hand CLI, and the delivery half is a second command surface on it
(refresh + analyze + their two formatters and three loaders) — 51% of its lines,
against a packet that could not be satisfied by a smaller edit without splitting
a command surface across two files. Every other file in `allowed_files` is a
patch-sized change; the sensor, not this field, is what pins them.

The risk this pass had to avoid is the opposite failure: publishing analysis
from data the gate has not cleared. Twelve of the four templates' seventeen
sections are analysis (candidate conditions, orders of business, citations);
the other five are dated facts about the sheet and the app copy.

## Findings (do not redo)

- **A malformed analysis payload published itself into the documents — and into
  Drive.** `loadAnalysisFile` read `parsed?.sections || {}` with no shape check
  and `renderSection` coerced a non-array through `String(text)`. A section
  value that was an object stringified to `[object Object]`, a number became a
  bare `42` reading as a measurement, and a nested array was spliced in raw —
  each indistinguishable from a real claim to the reader. Reverting only the
  loader wiring shows the cost: the refresh made **five Drive writes** instead
  of refusing. `validateAnalysisSections` now refuses at the door
  (`{sections: {knownKey: string[]}}`: sections must be a plain object, every
  key a real `analysis.*` source, every value an array of strings) and the run
  stops at `stage: 'analysis'` having written nothing — the same fail-closed
  shape as a template that will not render, because publishing three good
  documents while substituting "awaiting" for a broken claim is the silent drop
  this module exists to refuse. A misspelt key (`analysis.condition`) is a
  refusal, not a silently withheld section. Claim *wording* is deliberately not
  judged here: striking a diagnosis or a dose is the safety reviewer's seat, and
  a blocklist that guessed would block honest prose ("what is not settled by the
  literature") as surely as it blocked "you have".
- **`alt=media` cannot read a Google Doc.**

- **`alt=media` cannot read a Google Doc.** Drive answers
  `403 Only files with binary content can be downloaded. Use Export with Docs
  Editors files.` The read-back (the only proof a publish landed) goes through
  `files/{id}/export?mimeType=text/plain`, and the sensor pins the endpoint.
  Found by the live run, not by a render.
- **`replaceDocContent` is the in-place update path.** `createDocWithContent`
  (Drive conversion of a `text/plain` part into a Doc) is the create path;
  `updateFileContent` belongs to the sync mirror and stays out of this module
  (`assert-google-store` pins that). The store's caller comment now names this
  module as the second honest caller of the replacement path.
- **A renewal log built from run history rewrites every document on every run.**
  The log is one immutable row per day (first write that day wins), projected
  before it is stored, so a same-day rerun renders byte-identical text and the
  document is skipped. Without this, "idempotent" would have been a lie that
  looked fine in a single run.
- **`###` is a sub-heading, not a section.** The Insights template's
  `### [Marker] — value, date` is a repeatable block inside "By marker". Treating
  it as a section refused the whole document; `sectionPlan` now splits on `##`
  only. An unknown `##` heading, or a template with no sections at all, is a
  refusal rather than a quietly shorter document.
- **The project folder is `External-Personal-Health-Coach`
  (`1EqUkUPZmF4RAejJdMwxdZ8zvgRpMoL7T`), and `Brief` is a subfolder of it.** The
  documents land beside `Brief`, never inside it; `HEALTH_DOCS_FOLDER` names it,
  and the store's `GOOGLE_FOLDER_EXTERNAL_HEALTH` map is the fallback.
- **`ci.yml` is claimed.** #396 and #398 both change it, so the new sensor is
  reached through `npm run gate:external-health` inside `npm run test:prepush`
  (the required `tsc + named gates` job) — the same route the gate pass used.

## What this packet ships

1. `scripts/lib/health/docs.mjs`: the renderer (header with an explicit
   pending-gate banner and dated provenance, five data sections computed from the
   verify artifact, a renewal log that is history) and the gate policy
   (`gateFromArtifact`, `refusalText`). `renderSection` refuses analysis while
   the gate is open — the payload is not rendered, and the section says why.
2. `planPublish` + `publishDocs`: pure create/update/skip planning against the
   doc-id registry (`result/health-docs.json`), executed through an injectable
   store. Idempotent by doc id; a doc deleted in Drive is recreated; a registry
   that lost its ids adopts the doc that already exists instead of minting twins.
3. `/health refresh` (verify → plan → publish, `--dry-run`, `--force`,
   `--docs=`, `--analysis=`) and `/health analyze` (the analysis entry point:
   refuses with every open item and its title, or names the role, the payload
   file and the inputs when the gate is closed), both wired into bot-host and
   the help text like `/health verify`.
4. `scripts/assert-external-health.test.mjs`: 195 checks (was 109), including the
   refusal (no analysis string reaches an open-gate document, and the same
   payload renders once the gate closes), the four actions (create / skip /
   update-in-place / recreate), adoption, the fail-closed paths (no folder, a
   template that cannot render, a broken analysis file), and the read-back's
   export endpoint.
5. `projects/external-health/charter.md` records the draft-and-refusal policy so
   the repo's prose and the code say the same thing.

## Out of scope, deliberately

- **The analysis pass itself.** Nothing here writes a finding, a candidate
  condition, a citation or a dose. Doc 2 and Doc 3 publish refusals today;
  `/health analyze` names the payload the analyst pass must write
  (`result/health-analysis.json`) and the four documents it will update.
- **Rich Doc formatting.** Bodies are plain text through the proven Drive
  conversion path; headings are not styled. Styling is a separate concern from
  "the document exists and says the truth".
- **A dedicated CI step** (see Findings — the file is claimed; the sensor still
  runs inside the required check).
- **Closing the data gate.** All eight items are the user's to fix in the app.

## Evidence (live, 2026-09-30, read-only against the app)

- `--refresh --dry-run` planned four creates and withheld 11 analysis sections.
- `--refresh` created four Docs in the project folder (folder went from 1 child
  to 5): Health Snapshot `1TflAjj_8TSHizIrVKSgZKfr-VlDR36S14Q8E8pEFqa8`,
  Conditions & Actions `1vkRNFmXX906kBfpHta46bg3fCCeLIqpcCyDenjnU2pc`,
  Test Plan `13yK0FbxG7L0EkcGtPv1nWkRlJWNiJx1Jyne-vyshsTY`, Medical Insights
  `14nhy08ntFRADl4rCYVCBsng2QdnMl3GqD8sWnzgJsy8`.
- Re-read through Drive: the Snapshot carries the banner
  `DRAFT — the data gate is OPEN (8 items: H-1…H-8)`, the provenance table
  (sheet snapshot `medical-test-results-chiwah_2026-09-30_19-32-41.json`, 140
  rows / 14 dates, profile `hiJun2hTdDTk2igwerun2LKvwb42`, 0 closed · 8 open)
  and the verified matches; Conditions & Actions carries four refusal sentences
  and no derived claim.
- A second `--refresh` skipped all four (0 created, 4 skipped, no Drive writes
  beyond the listing); `--refresh --force` updated all four **in place** — same
  ids, modifiedTime advanced; the folder still holds exactly four documents
  after three refreshes.
- `--analyze` refuses with exit 3 and all eight items with their titles;
  `--status` now answers `Docs: 4 published (last refresh …) — drafts: data gate
  open, analysis withheld` plus the four ids.
