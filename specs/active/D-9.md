---
id: D-9
status: locked
class: R2_REGROWTH
skill: sync-jobs
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - server_routes_r2.ts
  - tests/server_routes_r2_cas.contract.test.ts
  - plan/ROADMAP.md
  - plan/DATA_PLANE.md
  - AI_HANDOVER.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - serverJobs.ts
  - server_routes_jobs.ts
  - server_routes_sync.ts
  - scripts/migrate-supabase-images-to-r2.ts
  - scripts/migrate-firestore-images-to-r2.ts
  - plan/R2_DELETE_CANDIDATES.json
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - agents/scoutInstructions.ts
  - agents/dietitianInstructions.ts
gate:
  - npx tsc --noEmit
  - npx vitest run tests/server_routes_r2_cas.contract.test.ts
  - node scripts/journey-guard.mjs D-9
---

# Packet: D-9 — stop R2 photo regrowth (no deletes)

Human replies: **go** | stop | one comment. Nothing below is applied yet.

## Journey

Better = every new meal/job photo lands under **one** content key no matter how
many times it is analyzed, so the 325 duplicate groups (~440 MB, audit
`6e5e5b4`) stop growing while D-10 waits on D-1 — instead of each analysis
minting a fresh `job_<ts>_<rand>.jpg` plus a `_0` twin.

## Findings (do not redo — verified by reading, not guessing)

1. **CAS write path already exists** (`5a48fc7`, 2026-09-17). `uploadBase64ToR2`
   (`server_routes_r2.ts:40-112`) and the `/api/r2/upload-photo` handler
   (`:281-358`) both sha256 the bytes, `HeadObject` the
   `photos/sha256_<hash>.jpg` key, and PUT only on miss. Every server photo
   writer funnels through it: `serverJobs.ts:516`,
   `server_routes_jobs.ts:95`, `server_routes_sync.ts:874`.
2. **Regrowth stop is unverified in production.** The 2026-09-20 `photos/`
   listing contains **zero** `sha256_` keys — the 2,063 dups and 589 `_0`
   twins all predate CAS. Either no meal has flowed through the CAS path
   since the 17th, or a bypass exists. This packet closes the bypasses; it
   does not rebuild CAS.
3. **Bypass A — job-keyed fallback URLs.** `uploadBase64ToR2` returns
   `/photos/<safeId>[ _<index>].jpg` when the S3 client is unconfigured
   (`:82-83`), on decode failure (`:71-73`), and on empty input (`:46-48`).
   A no-client deploy mints phantom job-keyed names again (display 404s, and
   a later PUT under that name re-creates exactly the `job_*` junk D-10 must
   sweep). The `index` suffix parameter (`:43-44`) is dead weight on the CAS
   path — the key never contains it.
4. **Bypass B — client display guesses are not uploads, keep them that way.**
   `LogChat.tsx:1180`, `FoodCard.tsx:995`, `imageResolver.ts:20`,
   `server_food_db_search.ts:199` synthesize `/photos/<id>.jpg` URLs for
   display. Those files are **frozen** here: the rule is no code in this
   packet may ever PUT under a guessed key to "fix" a 404.
5. **No observability.** Neither CAS site logs `deduplicated:true/false`, so
   the next audit cannot confirm the stop without a full bucket listing.
6. **Test gap.** `tests/server_routes_r2_cas.contract.test.ts` covers
   deterministic key + cross-id equality + passthrough + the fallback. It
   does **not** cover: different bytes ⇒ different keys, index never in key,
   HeadObject-hit ⇒ no `PutObject` call. The fallback test (`:32-35`)
   asserts the Bypass-A URL and must be rewritten with it.

## Plan

1. **Kill Bypass A (`server_routes_r2.ts` only).**
   When the bytes decode but the client is unconfigured or the PUT fails,
   return the CAS proxy URL (`/photos/sha256_<hash>.jpg` — computable without
   a PUT; the next configured boot's head-check reuses it). On empty/invalid
   input return `''` and let callers skip (no phantom key).
   Done when: no code path in the file returns a `/photos/<safeId>` URL.
2. **Log one greppable line per CAS decision** (`deduplicated=true|false`,
   key, bytes) at both CAS sites. No metrics product.
   Done when: `rg deduplicated server_routes_r2.ts` hits exactly the two
   decision points.
3. **Extend the CAS contract test** (same file, no new suite):
   different-bytes ⇒ different keys; `index` 0/1/2 ⇒ identical URL;
   mocked HeadObject-hit ⇒ `PutObject` never sent; empty input ⇒ `''`.
   Rewrite the fallback case from Finding 6.
   Done when: the named gate is green.
4. **Production proof is observational, not a gate:** the D-10 audit re-run
   must show new uploads landing as `sha256_` keys and zero new duplicate
   groups. Do not block this packet on live traffic.

## Test plan

```text
npx tsc --noEmit
npx vitest run tests/server_routes_r2_cas.contract.test.ts
node scripts/journey-guard.mjs D-9
```

## Audit plan

1. Scope vs ROADMAP: flips the **D-9** row to done; does not touch D-1,
   D-2, D-10, F-13, or Track V.
2. One frozen example: re-upload of an existing meal photo returns the
   identical `sha256_` URL with `deduplicated=true` and no second object.
3. Honest residual named: historical `job_*`/`_0` dups stay in the bucket
   until D-10; `missing_referenced_absent` (backslash key) stays open.

## Blast radius

Allowed / Frozen are the YAML lists above. `LogChat.tsx`, `JobStore.ts`,
and the three CAS call sites stay frozen — the fix lives in the single
writer plus its test, so no job-lifecycle serialize collision is created.
Out of scope: **any R2 object delete**, any historical `image_urls`
rewrite, running the migration scripts, client display guesses, D-10.

## Stop and come back

Two repairs fail · Frozen file in the diff · A live `photos/job_*` PUT is
found outside `uploadBase64ToR2` that cannot be routed through it ·
`PutObject` needed on the hot path (latency) · New class appears.
