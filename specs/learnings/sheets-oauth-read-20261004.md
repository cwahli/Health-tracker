---
slug: sheets-oauth-read-20261004
date: 2026-10-04
class: PROCESS_GAP
node: Builder
status: draft
---

# Learning: private Sheets need repo OAuth user-creds, not anonymous fetch

## What happened
- Anonymous `webfetch`/`fetch` on `export`, `gviz/tq`, `pub`, `view` for `10oPI...` and `1leiH...` → 401 login HTML (~9.1k bytes), 5 attempts.
- `gcloud auth print-access-token` (both accounts) → 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` on `sheets.googleapis.com`.
- Impersonate `doc-api@food-search-502514...` → `PERMISSION_DENIED` no `serviceAccountTokenCreator`.
- Success: refresh grant with `/Users/chiwah/.config/bot-host/google-user-credentials.json` (scopes `documents,drive,spreadsheets`) → Sheets v4 `META-OK`, wrote `Test plan!I2:I13 UPDATED 12`.

## What the user asked
"How can you make sure you can remember it? Because just a day ago you knew how to do it and suddenly you forgot"

## Keep
- Private Sheet read = OAuth user-creds refresh flow + Sheets v4 + `fleet-store/1.0` UA. Never anonymous export.
- Cred path: `GOOGLE_USER_CREDENTIALS_JSON` in `~/.config/bot-host/common.env` → `/Users/chiwah/.config/bot-host/google-user-credentials.json`.

## Propose standing (add only)
```json
{
  "id": "google_sheets_oauth_read",
  "label": "Private Google Sheets read via repo OAuth user-creds refresh flow, Sheets v4",
  "asked": "repeated",
  "files_must_contain": {
    "scripts/lib/google-store.mjs": [
      "sheets.googleapis.com/v4/spreadsheets",
      "fleet-store/1.0"
    ],
    "scripts/lib/health/sheet.mjs": [
      "sheets.googleapis.com/v4/spreadsheets"
    ]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: Private Sheet → packet must name OAuth user-creds refresh flow; forbid anonymous export as plan step.
- builder: Refresh `google-user-credentials.json`, call Sheets v4, never log tokens; verify with `META-OK` before values.
- guard: Flag new anonymous `export?format=csv`/`gviz` Sheet readers without OAuth.

## Do not
- Delete standing rows
- Merge journey packs
- Edit Guard scripts in this file’s promote
