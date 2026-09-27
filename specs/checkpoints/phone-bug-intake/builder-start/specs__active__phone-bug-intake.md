---
id: phone-bug-intake
status: locked
class: BUG_INTAKE_VISIBILITY
skill: debug-contract
edit_mode: patch
allowed_files:
  - src/components/Header.tsx
  - src/components/BugSnapshotFab.tsx
  - src/components/BugTrackerModal.tsx
  - src/components/FlagIssueModal.tsx
  - src/utils/bugSnapshot.ts
  - src/utils/bugSnapshot.test.ts
  - serverBugSnapshot.ts
  - serverIssueBacklog.ts
  - scripts/bugctl.mjs
  - scripts/phone-screenshot.mjs
  - tests/bugctl-queue.test.ts
frozen_files:
  - src/App.tsx
  - src/jobs/JobStore.ts
  - src/jobs/SupabaseJobSync.ts
  - src/jobs/JobQueueRunner.ts
  - src/jobs/__tests__/JobSession.contract.test.ts
  - src/components/LogChat.tsx
  - src/components/TaskPlaceholderCard.tsx
  - src/components/FoodHistoryTab.tsx
  - src/jobs/JobStore.ts
  - scripts/bot-host.mjs
  - scripts/run-coding-dispatch.sh
  - scripts/journey-guard.mjs
  - scripts/assert-*.mjs
  - docs/agent/standing.json
  - docs/agent/**
  - AGENTS.md
  - plan/ROADMAP.md
gate:
  - npx vitest run src/utils/bugSnapshot.test.ts tests/bugctl-queue.test.ts
  - node scripts/assert-bug-ticket-continuity.mjs
  - node scripts/assert-bug-pack.mjs
---

# Packet: phone-bug-intake — a phone screenshot becomes a viewable, fixable ticket

## Journey

A user finds a bug in the app **on their phone**. They screenshot it there, and
that image arrives as a ticket in the existing bug system — carrying the image —
where it can be listed, looked at, and driven into the fix loop that already
works (`bugctl list → pack → handoff → run-coding-dispatch.sh --ticket=#n →
attempt → verify → done`).

"Better" = the image survives the whole trip. Today it dies three times: a
normal user **cannot open the capture UI at all**, the one human path that does
accept a file **writes a payload shape the ticket reader cannot read**, and the
text surface that humans and agents actually read **omits evidence entirely**.

This packet does **not** build a new bug system. The bug system is the target.
The fix loop is already proven end to end on card #3. This is intake + evidence
plumbing, not a rewrite.

## Findings (do not redo)

Verified this session against the live deploy and in the tree. Do not re-derive.

1. **The capture UI is admin-only, and not even mounted for anyone else.**
   - `src/components/Header.tsx:318` —
     `const isAdmin = profile?.userType === 'Admin' || profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com';`
   - `src/components/Header.tsx:499` — `{isAdmin && (<BugSnapshotFab …/>)}`.
     The component is never *created* for a non-admin.
   - `src/components/BugSnapshotFab.tsx:630` — `if (!isAdmin || !enabled) return null;`
   - `src/components/AuthScreen.tsx:211` — `userType: isDemo ? 'Demo' : (isCwah ? 'Admin' : 'Standard')`.
     So every real phone account is `Standard` and **structurally cannot file**.

2. **`enabled` is per-browser localStorage, default on, admin-only toggle.**
   `BugSnapshotFab.tsx:235` `useState(true)` → `setEnabled(isBugSnapshotEnabled())`
   at `:294`; key `bug_snapshot_enabled` (`src/utils/bugSnapshot.ts:8,14-23`).
   The only writer is `BugSnapshotSettingsToggle` (`BugSnapshotFab.tsx:2125-2177`),
   itself rendered only under `{isAdmin && …}` (`DbInteractionsOverlay.tsx:198-199`).

3. **`bugWriteGuard` is NOT the blocker for a phone in a browser — do not
   "fix" it.** `serverBugSnapshot.ts:65-83` accepts `X-Bug-Api-Token`, **or**
   same-origin `Origin`/`Referer` host (`:69-76`), **or** loopback-only when the
   token is unset (`:77-81`). A phone loading the deployed app posts same-origin,
   so branch 2 already satisfies it. Touching this guard would widen the write
   surface to any non-browser caller and is **out of scope by design**.

4. **`reports: []` on all 8 live cards is structural, not corruption.** The
   snapshot POST is self-consistent (write `serverBugSnapshot.ts:686-713`, read
   `:1516-1538` agree on shape). But the two intake paths that actually run
   — `POST /api/bugs` (what `bugctl create` calls, `:2037-2100`) and
   `POST /api/bugs/auto-file` (`serverBugAutoFile.ts:59-105`) — write **only
   `issue_tags`**, never `issue_backlog`/`issue_tag_links`. The report reader at
   `:1516-1524` selects `issue_id FROM issue_tag_links`, finds nothing, returns
   `[]`. Those 8 cards were all created by the CLI/auto-file path, so
   `reports: []` is the *expected* output of the system as built.

5. **The other human path has a real payload-shape mismatch.** `FlagIssueModal`
   (`src/components/FlagIssueModal.tsx:261-262`) sends the same data URL under
   **both** `screenshot_data:` and `screenshot_url:`; `POST /api/issues/flag`
   (`serverIssueBacklog.ts:522`) writes `payload = { is_r2, r2_url,
   pipelineErrorsCount, pipelineWarningsCount, dishQuery }`
   (`serverIssueBacklog.ts:686-695`) and uploads the base64 to
   `backlogs/<id>.json` (`:733-741`). The report reader
   (`serverBugSnapshot.ts:1534-1538`) looks for `reportId`, `r2_prefix`,
   `r2_manifest_key`, `shot_count` — **none of which exist in a flag payload**.
   Result: a user who flags an issue *with a screenshot* still gets
   `shot_count: 0` and an image the artifacts route cannot serve, because that
   route only builds `bugs/<category>/<tagId>/reports/<reportId>/<name>` (`:1772`).
   - Compounding: `src/utils/bugSnapshot.ts:737` deletes `clone.screenshot_data`
     for PII but leaves the duplicate `screenshot_url` unscrubbed, and
     `FlagIssueModal.tsx:530-541` does a raw `FileReader.readAsDataURL` with
     **no** `compressImage`/`compressToWebpOrJpeg`, unlike every other capture
     path — a 1170×2532 phone PNG goes into the JSON body at full size.

6. **The text surface drops evidence — this is why nobody ever *sees* a bug
   image even when one exists.** `serverBugSnapshot.ts:2276-2293`
   (`format=text`) emits title/state/class/defect/repro/plan/verify/remaining/
   burns. It carries **no** `current_evidence`, no photo URL, no `r2_prefix`, no
   report id — even though the JSON branch one line earlier (`:2272`) *does* send
   `current_evidence: item.current_evidence`. `scripts/bot-host.mjs:2001` prints
   the **text** form for `/resume`. So an engineer reading a ticket in Telegram
   never sees a screenshot.

7. **The report rows show a count but no image.**
   `src/components/BugTrackerModal.tsx:2157` renders `{rep.shot_count || 0}
   screenshot(s)` with only *Payload* and *Prune R2* buttons (`:2140-2185`) —
   no image button. The clickable-image machinery already exists on the
   *commit* rows (`:2053-2082` + lightbox `:2197+`) and in
   `src/utils/bugSnapshot.ts` (`bugArtifactUrl` `:57-65`, `evidencePhotoSrc`
   `:67-74`, both already imported at `BugTrackerModal.tsx:36`), so this is a
   missing render, not a missing capability.

8. **No discovery route for `bugs/**`.** There is no list endpoint for bug
   screenshots. `scripts/phone-screenshot.mjs` (merged this session in `85bf1fb`)
   enumerates **meal photos only**, via `/api/admin/meals-with-photos`
   (`serverBrandMenu.ts:1719`; `phone-screenshot.mjs:96`). A bug shot is
   fetchable only if you already know `tagId` + `reportId` + `shot-01.jpg` and
   call `GET /api/bugs/:tagId/artifacts?reportId=&name=shot-01.jpg`
   (`:1751-1801`).

9. **The FAB "screenshot" is a DOM re-render, not a screen grab.**
   `BugSnapshotFab.tsx:166-222` uses `html-to-image` `toJpeg`; the comment at
   `:166` says "DOM capture only — no getDisplayMedia". Any non-CORS image taints
   the canvas and `toJpeg` throws → returns `null`; submit then refuses with
   "Add at least one screenshot" (`:890`). A **real phone screenshot** is a
   *file* from the gallery/share sheet — that is the `FlagIssueModal` /
   file-picker path, not this one. Both must attach to the ticket.

## Plan

A procedural micro-node graph. Each node: one job, local sensor, explicit pitfall.

### Node 1 — intake: un-gate the capture UI to any signed-in user
- **Target:** `src/components/Header.tsx:318,499`,
  `src/components/BugSnapshotFab.tsx:630` (and `:226,235` prop plumbing).
- **Do:** introduce one explicit capability (e.g. `canFileBug`) computed in
  `Header.tsx` from the existing profile (`userType !== 'Demo'`), and use it for
  the FAB mount + the FAB's own `return null`. Keep the **settings toggle
  admin-only** (`DbInteractionsOverlay.tsx:198-199`) — toggling global capture
  behaviour is an operator decision, filing a bug is not.
- **Pitfall:** do **not** delete or rename `isAdmin`. `Header.tsx` uses it for
  other admin chrome (Bug Tracker button `DbInteractionsOverlay.tsx:158-164`,
  nickname shortcut `:346-353`). Widen only the capture surface.
- **Pitfall:** `userType === 'Demo'` must stay out — a demo profile filing
  tickets is noise.
- **Sensor:** FAB mounts for a `Standard` profile and not for `Demo`.
  `npx tsc --noEmit` clean.

### Node 2 — intake: make an attached screenshot a real report row
- **Target:** `serverIssueBacklog.ts:522,686-695,733-741`;
  `src/components/FlagIssueModal.tsx:261-262,530-541`;
  `src/components/BugSnapshotFab.tsx:1217-1221`.
- **Do:** when a flag/snapshot carries an image, write it under the **canonical
  report shape** the reader already expects — `r2_prefix`, `r2_manifest_key`,
  `shot_count` — and store the object at a key the artifacts route can actually
  build (`bugs/<category>/<tagId>/reports/<reportId>/shot-01.jpg`,
  `serverBugSnapshot.ts:1772`). Add the matching `issue_tag_links` row so
  `reports` resolves at all. Compress via the existing
  `src/utils/imageCompressor.ts` (`compressImage` / `compressToWebpOrJpeg`)
  instead of raw `readAsDataURL`.
- **Pitfall:** **stop sending the same data URL twice.** Kill the
  `screenshot_data:` + `screenshot_url:` duplication, and make sure the PII
  scrub (`src/utils/bugSnapshot.ts:737`) can no longer miss a copy. One field,
  one place.
- **Pitfall:** do not widen `bugWriteGuard` (Finding 3). Same-origin is enough.
- **Pitfall:** R2 upload must **soft-fail with an honest record** — the existing
  `serverBugSnapshot.ts:726-728` logs and still records the key, and
  `putR2Object:176-177` returns a synthetic `r2://<key>` when the S3 client is
  missing. Do not persist a key that resolves to nothing without saying so.
- **Sensor:** a posted image yields `GET /api/bugs/:tagId` →
  `reports[0].shot_count >= 1` with a servable `r2_prefix`, and
  `GET /api/bugs/:tagId/artifacts?reportId=…&name=shot-01.jpg` returns the
  bytes. Both directions — **Log** (`data:`) and **Sync** (`/photos/` vs R2).

### Node 3 — visibility: carry evidence into the text surface
- **Target:** `serverBugSnapshot.ts:2276-2293` (add to the `lines` array).
- **Do:** append an `## Evidence` block to the `format=text` output built from
  the same `item.current_evidence` the JSON branch already sends at `:2272`:
  photo URLs, `r2_prefix`, `report_id`, `shot_count`, `debug_url`.
- **Pitfall:** the file already carries a **committed, verified** defect of this
  exact shape — `bugctl packet --format text` "returns an HTTP 200 error object
  instead of the text packet" is live card **#8**, state `done`, tag
  `tag_mugujw64_8cp01q` (seen in `/api/bugs/list` this session). If your change
  is what makes #8's complaint stale, say so in the commit; do not silently
  close a card you did not re-verify, and do not repaint `expected.json`.
- **Pitfall:** do not dump the whole evidence blob — URLs and ids, capped.
- **Sensor:** `GET /api/bugs/:id/packet?format=text` on a card with a shot
  contains the evidence lines. Add a case to
  `scripts/assert-bug-ticket-continuity.mjs`'s domain, not a new one-off suite.

### Node 4 — visibility: render the image on report rows
- **Target:** `src/components/BugTrackerModal.tsx:2140-2185` (esp. `:2157`).
- **Do:** replace the count-only row with the real image, reusing the
  already-imported `bugArtifactUrl` / `evidencePhotoSrc`
  (`src/utils/bugSnapshot.ts:57-74`) and the existing lightbox (`:2197+`).
  Never use a raw `bugs/...` R2 key as an `<img src>` — that is the standing
  rule in `src/utils/bugSnapshot.ts:57-65`.
- **Pitfall:** i18n (AGENTS.md §0.7) — any new user-visible string goes in
  `src/utils/translations.ts` with `id` parity. No hardcoded English chrome.
- **Sensor:** a report row shows a thumbnail and opens the lightbox; `en`/`id`
  key parity holds.

### Node 5 — visibility: one place to see every bug image
- **Target:** `serverBugSnapshot.ts:1401-1450` (`GET /api/bugs/list`),
  `scripts/phone-screenshot.mjs`.
- **Do:** add `shot_count` (+ `r2_prefix`/`report_id` when present) to the list
  rows so "which bugs have a phone screenshot" is one query, not N detail reads.
  Teach `phone-screenshot.mjs` a `--kind=bug` mode that walks that list and
  fetches each `shot-NN.jpg` through the artifacts route. Keep the existing
  `--kind=meal` default behaviour byte-identical.
- **Pitfall:** these two GET routes are **unauthenticated** and that is a known,
  separately-reported exposure (flagged in PR #299) — do **not** widen what they
  return while adding fields, and do not "fix" the auth here. Listing a count is
  not a new disclosure class; serving raw `env.json` to the world would be.
- **Sensor:** `--kind=bug` lists the newest card with shots and downloads its
  image; `--kind=meal` output unchanged.

### Node 6 — intake: let the agent attach an image when it files a card
- **Target:** `scripts/bugctl.mjs` (`create`, and the `WRITE_OPS`/queue paths
  at `:150-168`), `tests/bugctl-queue.test.ts`.
- **Do:** `bugctl create --screenshot=<path>` uploads the file to the canonical
  R2 key and writes the `issue_backlog` + `issue_tag_links` rows, so
  agent-filed cards have the same report shape as phone-filed ones. Queue
  offline like every other write.
- **Pitfall:** `scripts/run-coding-dispatch.sh` is **frozen** and its
  `--screenshot=` flag expects a *local* file (`:333,1221,1560`) — do not
  rewire the dispatcher. `bugctl create` is the seam.
- **Pitfall:** reads never queue (`WRITE_OPS`, `bugctl.mjs:150-151`) — keep it
  that way.
- **Sensor:** `tests/bugctl-queue.test.ts` still 5/5, plus a new case: create
  with a screenshot while the API is down queues and replays with the image.

## Test plan

```text
npx tsc --noEmit
npx vitest run src/utils/bugSnapshot.test.ts tests/bugctl-queue.test.ts
npx vitest run src/utils/bug*.test.ts
node scripts/assert-bug-ticket-continuity.mjs
node scripts/assert-bug-pack.mjs
node scripts/journey-guard.mjs phone-bug-intake
```

Per `docs/agent/DOMAIN_REGRESSION_MAP.md:145-146`, this domain maps to
`src/utils/bug*.test.ts` and `tests/bugctl-queue.test.ts`. **Consolidate into
`src/utils/bugSnapshot.test.ts` and `tests/bugctl-queue.test.ts`** — do not spawn
a new one-off suite (L16).

## Audit plan

1. Scope vs ROADMAP — no silent extra IDs. This is not a ROADMAP ID; it is a
   locked packet. Confirm with the human before it lands.
2. **Standing rows that stay in force, unprompted** —
   - `meal_image_unique` — one URL per capture, drop `data:`/`blob:` once
     `/photos/` or an `https` URL exists. Node 2 must not re-introduce a `data:`
     copy alongside a stored key.
   - `load_hack_forbidden` — no `@ts-nocheck`, no deleting tests or gate files
     to make this pass.
   - `i18n_a11y_soak_hygiene` — Node 4's new control needs an `ariaSnapshot`
     story; no invented i18n keys.
3. **Class list — this packet must not be a symptom patch.** Forbidden:
   repainting `expected.json`, painting a ticket green, `POST /loop`, adding a
   feature flag that hides the symptom, adding a **second** intake path that
   bypasses `issue_backlog`/`issue_tag_links`.
4. **Honest residual, named not painted** —
   - `run-coding-dispatch.sh --screenshot=` still wants a local file; an
     engineer dispatching a card with an R2-only image still needs a download
     step. Out of scope; name it in the handover.
   - `qa-runner.mjs:456-457` writes `bugs/<tagId>/<ts>-before.png`, a **different
     key shape** the artifacts route cannot build. Pre-existing, not fixed here.
   - Both GET routes stay unauthenticated pending a separate decision.

## Blast radius

Allowed / Frozen are the YAML lists above.

Out of scope, explicitly:
- `bugWriteGuard` / any auth change (Finding 3).
- `scripts/bot-host.mjs` and the Telegram inbound-photo path — the user chose
  "un-gate the FAB", not "route via the bot".
- `scripts/run-coding-dispatch.sh` (frozen).
- The food/biomarker calculation pipeline. `DebugNode#1` is a debug-contract
  journey; if any node turns out to require a pipeline change, **stop** and
  re-plan rather than widening.
- Standing/journey docs and `assert-*.mjs` semantics (AGENTS.md §3 — protected).

## Stop and come back

Two repairs fail · any Frozen file appears in the diff · Node 2 turns out to
need a second write path (stop: that is the symptom-patch trap) · live Gemini
or live model call requested · card #8 turns out to need its own re-verification
before its text-packet complaint is considered resolved.
