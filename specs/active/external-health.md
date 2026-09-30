---
id: external-health
status: locked
skill: data-plane
edit_mode: patch
allowed_files:
  - scripts/lib/health/d1.mjs
  - scripts/lib/health/values.mjs
  - scripts/lib/health/sheet.mjs
  - scripts/lib/health/reconcile.mjs
  - scripts/health-runner.mjs
  - scripts/assert-external-health.test.mjs
  - scripts/lib/project-registry.mjs
  - scripts/lib/commands.mjs
  - scripts/bot-host.mjs
  - scripts/assert-project-registry-parity.mjs
  - tools/telegram-provider-router/src/project-registry.mjs
  - bots/capabilities.json
  - .github/workflows/ci.yml
  - projects/external-health/**
  - specs/active/external-health.md
frozen_files:
  - AGENTS.md
  - docs/agent/**
  - plan/ROADMAP.md
  - src/**
  - tests/**
gate:
  - node scripts/assert-external-health.test.mjs
  - node scripts/assert-project-registry-parity.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-bot-clone.mjs
  - npx vitest run tests/bot-host.test.ts
  - npx tsc --noEmit
---

# Packet: external-health — the Personal Health Coach's data loop, in the repo

Human mission (2026-09-30): make the brief real — four living documents built
from **verified** data, with the data cleaned up in the app by the user, guided
by a fix list the bot produces and then proves. This packet is the *gate*, not
the documents.

## Journey

The first pass proved the loop works and proved it wrong: the reconciler, the
fix list and the banked sources lived in `~/projects/external-health-coach`,
outside the repo. So the one artifact that decides whether the documents may be
written could not run on the bot's schedule, could not be reviewed in a diff, and
started from nothing on the next machine. Meanwhile the app's stored data is
genuinely wrong in a way that matters (a row dated 2026-03-06 holds the 2026-06-03
lipid panel; 9 dates carry duplicate rows; the profile shows height 178 cm and
age 28, both application defaults).

This packet moves the loop into the repo, wires it to the bot, and makes the
read-only guarantee a gate instead of a promise.

## Findings (do not redo)

- **The sheet's shape is unusual.** Each row's first cell contains a whole quoted
  CSV line, so parsing unwraps one CSV layer and parses the inside. Drive's
  `export?mimeType=text/csv` returns only the FIRST tab, which is why the ingest
  reads tabs through the Sheets v4 API (verified live 2026-09-30: 3 tabs, 140
  rows). The Sheets host matters: `/v4/` answers JSON while `/v1/` answers an
  HTML challenge from this box.
- **Two spellings of three AUDIT-C questions exist** (`AUDIT …` in 2020, `AUDIT-C …`
  in 2024). They were unmapped, which made them invisible — the reconciliation
  under-reported by two values before the fix. Unmapped test names are now counted
  and printed, never dropped.
- **A composite result is not a number.** `109 / 53 mmHg` parses as 109 by every
  naive reader; `22.7 kg/m2` and `3 /12` parse as two numbers. The rule that
  works: the leading number, except for markers declared `composite: true`
  (blood pressure), where the whole result is kept and compared by its numbers.
- **The app's stored profile is code defaults**: `age 28`, and `height 178` /
  `weight 74` against the sheet's 163 cm / 61–62.4 kg. `src/utils/appProfileUtils.ts`
  is where the defaults come from; it is **not** changed here.
- **The account id is not in `.env`** (`CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_D1_DATABASE_ID` only), so it is discovered from the token.
- **`accessToken()` returns `{ ok, token }`**, not a token. Passing the object
  through as a Bearer value produced a live 401 (`Bearer [object Object]`) during
  this pass; the fix checks the shape and fails with a reason.

## What this packet ships

1. `external-health` in `KNOWN_PROJECTS` (workspace
   `~/projects/external-health-coach`, templateDir `projects/external-health`,
   Drive folder `External-Personal-Health-Coach`, `allowGit: false`), five seats
   (data_steward, health_analyst, test_planner, research_lead, safety_reviewer),
   aliases `health` / `health coach` / `personal health` / `external health` /
   `coach`, and the router's mirror of that grammar (parity-pinned).
2. `/health verify | ingest | status` on bot-host, declared in
   `BOT_COMMANDS`, the `ui-commands` matrix (`grok_tg: false` — the router has no
   D1 or Drive credential, so it must not publish a button it cannot honour) and
   the help text.
3. `scripts/lib/health/{d1,values,sheet,reconcile}.mjs` + `scripts/health-runner.mjs`:
   the read-only D1 snapshot, the Brief-folder ingest, the diff, and the fix list
   as **checks** (H-1…H-8) whose state is answered per item.
4. `scripts/assert-external-health.test.mjs` (109 checks) and a CI step that runs
   it together with the project-alias parity and command-scope gates — which were
   declared in `bots/capabilities.json` but run by nothing.

## Out of scope, deliberately

The analysis pass and the four documents. The data gate is open (8 items), so
nothing is published from this folder; the roles and the deliverable templates are
blank scaffolding for that later pass.

## Evidence (live, 2026-09-30)

- `node scripts/health-runner.mjs --verify` against the real account:
  profile `hiJun2hTdDTk2igwerun2LKvwb42` (41 lab rows), sheet 140 rows / 14 dates
  (newest 2026-06-09), app 41 rows (newest 2026-09-06) → matches 20 · missing 36 ·
  app-only with no sheet line **2** · sheet-only 7, and 0 closed / 8 open.
- `--ingest` against the real Brief folder: 1 doc + 1 sheet (3 tabs) banked, and
  the next `--verify` read the new dump.
- `--status` reads the last artifact: what is still wrong, how fresh the data is,
  what is next, and that no document is published yet.
