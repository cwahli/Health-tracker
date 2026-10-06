---
id: sheets-oauth-read-promote
status: draft
skill: debug-contract
edit_mode: patch
allowed_files:
  - docs/agent/standing.json
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
gate:
  - node scripts/journey-guard.mjs sheets-oauth-read-promote
---

# Packet: remember private Sheets read (promote)

Agent fills this. Human replies: go | stop | one comment.

## Journey
Next session reads a private Google Sheet without repeating the anonymous-fetch failure. Better = Planner names the OAuth user-creds refresh flow first, Guard keeps it.

## Findings (do not redo)
- Anonymous `export`/`gviz`/`pub`/`view` on both Sheet IDs → 401 login HTML (~9.1k).
- gcloud tokens → 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`; SA impersonation denied.
- Working path: refresh grant via `GOOGLE_USER_CREDENTIALS_JSON` (`~/.config/bot-host/common.env` → `google-user-credentials.json`, scopes `documents,drive,spreadsheets`) + Sheets v4 + UA `fleet-store/1.0`. Proved: `META-OK`, wrote `Test plan!I2:I13 UPDATED 12`.
- Learning: `specs/learnings/sheets-oauth-read-20261004.md`. Rejected: `specs/rejected/sheets-oauth-read-20261004.json`.

## Plan
1. Add one `features` row `google_sheets_oauth_read` to `docs/agent/standing.json` (add only, no other edits). Done when: `node scripts/journey-guard.mjs sheets-oauth-read-promote` passes and `git diff --name-only` shows only `docs/agent/standing.json`.
2. Row content (exact):
   - id `google_sheets_oauth_read`, label `Private Google Sheets read via repo OAuth user-creds refresh flow, Sheets v4`, asked `repeated`
   - `files_must_contain`: `scripts/lib/google-store.mjs` → [`sheets.googleapis.com/v4/spreadsheets`, `fleet-store/1.0`]; `scripts/lib/health/sheet.mjs` → [`sheets.googleapis.com/v4/spreadsheets`]
   - Markers already exist in both files (verified this session), so Guard passes without product-code edits.

## Test plan
```text
node scripts/journey-guard.mjs sheets-oauth-read-promote
```

## Audit plan
1. Scope vs ROADMAP (no silent extra IDs)
2. Standing diff is add-only, one row
3. Honest residual: skill-line deltas stay proposed in learning, not applied here

## Blast radius
Allowed / Frozen are the YAML lists above.
Out of scope: product code, skills, Guard scripts, Sheet contents.

## Stop and come back
Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
