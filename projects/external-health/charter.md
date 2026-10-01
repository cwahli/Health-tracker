# Project Charter: external-health — Personal Health Coach

## Mission

Make the brief real: four living Google Docs that stay current, built only from
data that has been verified against the lab reports, renewed on a monthly
cadence, and managed from Telegram.

## The four documents

| # | Document | Question it answers |
|---|---|---|
| 1 | Health Snapshot | What is true about my health right now, on verified data? |
| 2 | Conditions & Actions | What could be developing, and what do I do about each one? |
| 3 | Test Plan | Which tests confirm or renew that picture, and when are they due? |
| 4 | Medical Insights | What does the current literature say for this profile? (monthly) |

Every document carries its own provenance: the sheet snapshot it was built from,
the date, and the fix-list items still open. A document built on data with open
items says so in its header — it never reads as if the data were clean.

## The data gate

The analysis pass does not open until the fix list is closed or explicitly
waived. `/health verify` is the gate: it re-reads the app, diffs it against the
sheet, and answers closed/open per item.

**Drafts are allowed; analysis is not.** While an item is open, `/health refresh`
publishes the documents as drafts: the header carries the banner and the open
item ids, the data sections carry the dated facts, and every analysis section
carries a refusal naming the items instead of a claim. `/health analyze` refuses
outright. When the last item closes, the same command publishes the analysis.

**Three more ways an analysis section is withheld, and they are not the gate.**
The publisher also checks the clock, the reviewer and the literature. A verify
artifact past the monthly renewal window withholds every analysis section (the
header says STALE). A `STRIKE` in the Doctor's report (`/health doctor`) withholds
them too, naming the struck claims until the analyst rewrites them and the Doctor
re-checks. And document 4 refuses any line citing a link the literature lane
never fetched (`/health research`) — an unverified link is not a link. In every
case the data sections still publish as a draft, and the refusal says which rule
acted.

**Idempotence.** The documents are updated in place, by doc id, recorded in
`result/health-docs.json`. A refresh that changes nothing writes nothing, and a
document is never duplicated — a rerun on a new machine adopts the document
that already exists.

## Ground rules

1. The sheet is the source of truth; the app is a copy that has been wrong.
2. Read-only: the app's database and the sheet are never written from here.
3. Receipts over rhetoric — a date and a value, or a citation with a date.
4. A missing test is a finding, not a hole to fill.
5. Not a clinic: no diagnosis, no doses; urgent findings go to a GP.
6. Total website isolation — nothing in this folder touches the Health-tracker
   repository.

## Operational boundary

- **Workspace**: ~/projects/external-health-coach (sources banked in `sources/`,
  verify artifacts, the doc-id registry and the refresh receipts in `result/`)
- **Drive**: `External-Personal-Health-Coach` — the four documents live beside
  the `Brief` folder, which holds the brief and the source spreadsheet
- **Commands**: `/health verify` (the gate) · `/health ingest` (the Brief folder) ·
  `/health refresh` (publish or update the four documents) · `/health research
  "<query>"` (fetch and record citations) · `/health analyze` (write the analysis
  payload) · `/health doctor` (re-check its claims) · `/health readiness` (what a
  seat still needs) · `/health status`
- **Data**: the app's Cloudflare D1, read-only, via `scripts/lib/health/d1.mjs`
- **Cadence**: verify on demand; the Insights document renews monthly
