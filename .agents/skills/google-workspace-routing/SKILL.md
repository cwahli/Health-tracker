---
name: google-workspace-routing
description: Use when Health-tracker work needs Google Sheets, Drive or Docs - pick gws vs the fleet store, probe readiness first, and keep photos out of Google.
metadata:
  version: 1.1.0
  audience: health-tracker-agents
---

# Google tools in Health-tracker

## 1. Pick the client

| Need | Use |
|------|-----|
| Agent ad-hoc task (make a sheet, append rows, move a Drive file, write a Doc) | `gws` — load a `gws-*` skill for syntax |
| Fleet/agent store (turn log, packs, evidence, weekly rollups) | `scripts/lib/google-store.mjs` — shared by every surface |

Both write the same Google account. Never fork a second implementation; never add `googleapis` as a dependency (see `plan/GOOGLE_WORKSPACE_PLAN.md` §3).

## 2. Probe before you promise

```bash
node scripts/probe-google-store.mjs
```

Zero-burn: mints a token, lists one page, writes nothing. It is `NOT READY` when
`GOOGLE_USER_CREDENTIALS_JSON` or `GOOGLE_FOLDER_<PROJECT>` is absent from this host.

* READY → proceed.
* NOT READY → say which variable/folder is missing and which location can do it.
  Never fake a write, never invent an ID, never retry hoping the credential appears.

The phone holds no key by design. A host without it hands off (QS-3), it does not fail silently.

**Probe `gws` too, and do not switch clients silently.** `gws` is the §1 default
for ad-hoc work, but it carries its own credentials and is frequently NOT logged
in on a host where the fleet store is READY:

```bash
gws sheets spreadsheets get --params '{"spreadsheetId":"<id>"}'   # 401 ⇒ gws is unusable here
```

A 401 from `gws` is not a dead end and not a reason to fall through to
`scripts/lib/google-store.mjs` without saying so. Name the switch out loud, so
the reader knows which credential wrote the thing and which scope it needed.

## 2a. Read the shape before you believe a read

`scripts/lib/google-store.mjs` helpers return the envelope
`{ ok, status, json }` — **the payload is nested under `.json`, not spread on the
top level.** Getting this wrong makes every field `undefined`, which reads
exactly like "the tab is empty":

| Helper | Truth | The trap |
|--------|-------|----------|
| `readTab(sheetId, tab, token, {range})` | `r.json.values` | `r.values` → `undefined` → "empty tab" |
| `getSheet(sheetId, token)` | `r.sheet.properties` | `r.properties` → `undefined` |
| `appendRows(sheetId, tab, rows, token)` | `r.json.updates.updatedRange` | `r.updatedRange` |

Measured 2026-10-05: `readTab` on a populated tab returned `undefined` at
`r.values`, the agent concluded the tab was blank, and appended six rows
expecting `A1`. They landed at `A3`, under an existing header and a populated
row. Nothing was overwritten — `appendRows` only inserts — but the placement was
wrong and the read that justified it was never true.

Three rules that would have caught it:

1. **First use of a helper in a session: log the whole response**, not the fields
   you expect. `JSON.stringify(r)` is the whole fix, and it is what caught the
   truth one command later.
2. **`undefined` from a helper is a broken field path until proven otherwise**,
   never evidence about the world. An absent value and an absent thing are not
   the same claim.
3. **A read returning "empty" and a write that returns success do not agree.**
   If the tab looked empty, an append landing anywhere but the row you predicted
   means the read was wrong. Resolve that before reporting the write as done.

**Read back as proof, and check the range.** After a write, re-read and compare
against what you intended — not against "did it not error". `updatedRange` is the
honest report of where the rows actually went.

**Hand back a pointer, not just a receipt.** "Appended 6 rows" is not something
the reader can check. A spreadsheet link opens `activeTabId`, and when that is
unset Sheets defaults to **index 0** — so writing to tab 3 of a six-tab sheet and
replying with the plain sheet URL shows the reader tab 1 and looks like nothing
happened. Measured 2026-10-05: six rows written to `request consultation`, the
reader reported "I see no difference", because the URL opened `Test plan`.

So report all three:

* the **tab title**, quoted, so it can be matched against the tab bar
* a link carrying `#gid=<sheetId>` and `&range=<the cells you wrote>`
* the `sheetId` itself, which is the `gid` and is stable across renames

```bash
# gid + written range, from a metadata read
gws sheets spreadsheets get --params '{"spreadsheetId":"<id>","fields":"sheets.properties"}'
#   -> sheets.properties[].properties.sheetId / .title ; link as #gid=<sheetId>&range=A3:A8
```

If the reader says they cannot see the change, suspect the tab before suspecting
the write. Re-read first, then send the `gid` link — in that order, because the
re-read is what distinguishes "wrong tab" from "never written".

## 3. What goes where

**Sheets — append-only ledger.** Monthly tabs (`2026-09`), create the tab if missing.
Corrections are new rows, never cell edits. Exactly one writer role per spreadsheet.

**Docs — append at `endIndex`.** Generation only ever appends, so a human section
survives regeneration. Two generators must target different documents.

**Drive — agent text artifacts only:** `turns/`, `packs/`, `evidence/`, `docs/`.
Content-addressed names, never overwritten. Moving a file already in Drive is fine
(`files update` with `addParents`/`removeParents`).

**Never Google:** secrets/keys, or photos. Meal images and binaries live on R2
(`DATA_PLANE.md`), audited by `PhotoStorageAdminTab.tsx` / `/api/admin/r2-photo-audit`.
There is no second photo store and no Google Photos API to manage or edit with —
if asked to move meal pictures to Drive, say R2 is the source and ask first.

## 4. Hard rules

* The app stays Firebase Auth + D1 + R2. Google is agent-side only — no second OAuth stack, no schema change.
* Credentials: host config, mode 600, a path in env. Never in the repo, chat, log, or payload.
* Confirm before any write or delete; prefer `--dry-run` first, then read back as proof.
