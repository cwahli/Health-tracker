# Bug-53: fleet Tickets renders CLI-filed pictures over absolute URL (2026-10-10)

Card #53 (`tag_muxcn960_px5wm4`, BUG_INTAKE_VISIBILITY, collab) — PROOF card for
spec `collab-bug-intake` verify part: a bug picture filed from CLI must resolve
over an absolute URL on every surface (board, bot list/packet text, /fleet Tickets).

## Pack repair (honest)

Live `bugctl packet --id '#53' --json` showed `state=packed` with `defect=null`
— the pack was incomplete (packed requires exactly one defect + class + surface
+ fingerprint). Repacked with one defect (pack --check green, then posted):

- component: Fleet Tickets tab (`scripts/lib/fleet-status.mjs` ticketFromRow +
  `src/miniapp/fleet.html` proofCell)
- observed: Completion-proof cell holding an absolute https image URL (CLI-filed
  R2 picture `.../shot-01.png`) rendered as plain text; proofFileId "" so no img
- expected: absolute https image URLs render as linked images (browser fetches
  directly); Drive file-ID proxy path unchanged; folders/prose stay text
- criteria: ticketFromRow maps https..png to a renderable field, fleet.html
  renders it, `node --test scripts/assert-fleet-miniapp.test.mjs` green
- class/surface: BUG_INTAKE_VISIBILITY / collab; fingerprint `...|2026-W41`
- dedupe: `bugctl list` shows exactly one BUG_INTAKE_VISIBILITY card — no duplicate.

Board (artifacts + R2 both HTTP 200, 6911B image/png) and packet-text absolute
URLs verified good pre-fix; the single broken surface was fleet Tickets.

## Repro (bundle, posted)

`node /tmp/opencode/bug53/repro.mjs`: R2 HEAD 200 image/png 6911B, yet
`ticketFromRow` gave proofFileId "" and fleet rendered text (exit 1).
Posted via `bugctl repro --status confirmed` with command + exit 1 + run_log +
before key `bugs/foodcart/tag_muxcn960_px5wm4/reports/iss_muxcn9dy_1js7rv/shot-01.png`.
The 2026-10-07 confirmed verdict (exit 0, no before key) stands alongside; both
are `confirmed`, so no repro-verdict conflict.

## Plan (posted)

Hypothesis: proofCell branches only on proofFileId (Drive); absolute URLs fall
through to text. Files: `scripts/lib/fleet-status.mjs`, `src/miniapp/fleet.html`,
`scripts/assert-fleet-miniapp.test.mjs`. Gates: `node --test
scripts/assert-fleet-miniapp.test.mjs`, `tsc --noEmit` (no .ts touched; tsc
unavailable in this worktree — no node_modules — noted, JS gate is the real one).

## Fix (0 burned hypotheses)

- `absoluteImageUrlFrom()` (new, exported): single trimmed https? URL ending in
  .png/.jpg/.jpeg/.gif/.webp (query/fragment allowed); Drive URLs, folders,
  keys, prose, embedded URLs all return "".
- `ticketFromRow`: new `proofImageUrl` field (Drive takes precedence, never both);
  `completionProof`/`proofFileId` behavior unchanged for all existing cases.
- `fleet.html` proofCell: Drive img (existing) → absolute-URL img (new, direct
  src + link) → text. Same styling/onerror as Drive.
- Sensor: new test block in `scripts/assert-fleet-miniapp.test.mjs` (R2 maps,
  Drive precedence, folder/prose stay text). Gate 18/18 green (was 17).

## Live proof (Drive folder `card:tag_muxcn960_px5wm4`, curated)

- `bug53-input-cli-picture.png` — INPUT: live R2 bytes (report
  `iss_muxcn9dy_1js7rv`, HEAD 200, 6911B), captioned. No meal job exists for CLI
  intake; the report ID is the traceable citation (stated on every panel).
- `bug53-output-fleet-tickets-fixed.png` — OUTPUT: fixed fleet Tickets staging
  render (labeled STAGING) with live Bug-53 data; the R2 image loads live bytes
  where text used to be.
- `bug53-output-board-packet-absolute-url.png` — OUTPUT: live packet evidence
  text + both absolute URLs (R2 global, artifacts board/packet) rendering live
  bytes side by side.
- Curation: the 2 pre-fix Oct-07 PNGs moved to `superseded/` (move-not-delete,
  verified by id); top level holds only the 3 fresh shots. Nothing deleted.

## Sheet honesty (row 37, verified live)

- Proof cell was still Bug-2's folder (`1Wi35a5…` = `card:tag_muwyto2i_lv3uyw`) —
  the "since fixed" note in the brief did not hold on live read. Fixed to own
  folder `https://drive.google.com/drive/folders/197QWg-ea_jRItgNn5wERrZDZDjTGn9U1`.
- Work-done: appended `[agent …]` line, human order text preserved verbatim.
- Status `Assigned`→`review` (gate 18/18 + proof filed — genuinely met); state
  `new`→`packed` (canonical); last_activity refreshed to UK shape
  (`17:22 - 10 oct (UK)`); never Done; built_at untouched.
- Sensors: `assert-sheet-proof` row 37 PASS; `assert-sheet-canonical-parity`
  row 37 PASS (other rows' FAILs are pre-existing, out of scope).

## No self-verify

Named gates green; `bugctl verify` NOT posted (parent verifies). Branch
`agent/bug53-fix` pushed, draft PR opened, never merged, never pushed to main.
Human checks in /review: row Bug-53 (Status review) with the 3 top-level proof
shots — input R2 picture through fixed fleet/board outputs, report cited.
