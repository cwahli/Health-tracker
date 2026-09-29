---
name: google-workspace-routing
description: Use when Health-tracker work needs Google Sheets, Drive or Docs - pick gws vs the fleet store, probe readiness first, and keep photos out of Google.
metadata:
  version: 1.0.0
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
