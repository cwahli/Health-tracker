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
sheet, and answers closed/open per item. Nothing is published from this folder
before the gate says so.

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
  verify artifacts in `result/`)
- **Drive**: `External-Personal-Health-Coach`, with the brief and the source
  spreadsheet in its `Brief` folder
- **Data**: the app's Cloudflare D1, read-only, via `scripts/lib/health/d1.mjs`
- **Cadence**: verify on demand; the Insights document renews monthly
