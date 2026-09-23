---
id: R-13
status: locked
class: LIVE_DEPLOY
skill: sync-jobs
edit_mode: rewrite
who: any-agent
auto_go: false
blocked_human: 'R-13.1 LIVE on OVH VPS-2 since 2026-09-20 (plan/VPS2_MOBILE_DEV.md Track V V-0…V-16 COMPLETE). No Cloud Run / Cloudflare Containers / Pages proxy work.'
allowed_files:
  - package.json
  - server.ts
  - Dockerfile
  - .dockerignore
  - wrangler.jsonc
  - public/_redirects
  - server_sse_json.test.ts
  - server_d1_schema.ts
  - server_auth.ts
  - server_auth.test.ts
  - src/components/AuthScreen.tsx
  - src/utils/breadcrumbTracker.ts
  - scripts/r13-0-preflight.mjs
  - AI_HANDOVER.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - scripts/assert-f10-pr1.mjs
  - agents/scoutInstructions.ts
  - agents/dietitianInstructions.ts
gate:
  - npx tsc --noEmit
  - npx vitest run src/server/receptionist/handoffContract.test.ts server_derivation.test.ts server_sse_json.test.ts
  - node scripts/assert-free-tier-complete.mjs
  - node scripts/assert-spec-diff.mjs R-13
---

# R-13 — Cloudflare go-live with AI Studio parity

**R-13.0 shipped 2026-09-17.** Preflight `node --env-file=.env scripts/r13-0-preflight.mjs` **PASS** (D1 `health-tracker` 14 tables, R2 `health-tracker-photos`, CORS applied for localhost + live Render). Workers Paid is **not** required (API is Node).

**R-13.1 LIVE since 2026-09-20** at https://health-tracking.duckdns.org (Caddy → Node `:3000`). Origin is **OVH VPS-2**, not Cloudflare Containers and not Cloud Run. Do not start R-13.4 / R-5 / a Cloud Run go-live.

**Architecture:** [plan/RELIABILITY.md](../../plan/RELIABILITY.md) **§12** (canonical). Execute table: [plan/ROADMAP.md](../../plan/ROADMAP.md) Track R.

## Goal

Public Health-tracker URL on the VPS (Caddy → Node). `npm run dev` (`tsx server.ts`, port 3000, Vite) unchanged. Cloudflare keeps R2/D1 only.

## Journey

Better = a real user can open the prod host, sign in with Google, submit a meal photo, and get a persisted D1 row + R2 image, while AI Studio and named vitest stay byte-identical. Not “Express on Pages Functions.” Not D1-as-primary (R-5). Not static-only CDN (R-2).

## Findings (do not redo)

- Live path is `/api/jobs/submit` + poll. Food-analyze SSE is internal loopback (`X-Session-ID: server-job-*`) — 403 from the browser.
- Jobs `fetch('http://127.0.0.1:${PORT}/…')` and keep in-memory Maps. Workers have neither loopback nor shared memory.
- 3-minute limit is **app** code: 180s abort, 90s stall, 5 min D1 stale fail. Worker HTTP wall-clock is unlimited; 524 is proxy-to-origin.
- `server.ts` imports `sharp` and `fs.mkdirSync` at eval — cannot be a Worker entry.
- `server_d1.ts` is REST-only. `server_auth.ts` treats `NODE_ENV !== 'production'` as localhost.
- `npm run build` emits Node `dist/server.cjs` as well as the SPA.
- Firebase Authorized Domains need exact hosts. `*.pages.dev` wildcard is invalid, but fixed subdomains (e.g. `health-tracker.pages.dev`) work when added.
- M23–M28 free-tier core is already green. Do not re-migrate images or re-kill Firestore writes.

## In scope

- R-13.0 preflight script (D1/R2/CORS/env). **Done 2026-09-17.** Residual: add the **exact** prod host to Firebase Authorized Domains **after** 13.1 prints the URL (`firebase` CLI as `cwah.liu@gmail.com`; Identity Toolkit admin API is 403 on the Studio sandbox — if PATCH fails, one console click, not a blocker to ship 13.1).
- R-13.1 `build:web` split, PORT default 3000, Dockerfile / Container, Workers/Pages **static** SPA, route `/api/*` to the Node process
- R-13.2 SSE `: ping` on loopback streams; timeout copy
- R-13.3 `server_auth.ts` localhost-only skip; popup fallback
- Later, **only after 13.1 live:** R-13.4 native D1/R2 bindings + in-process analyze; R-13.5 logs/cost

## Out of scope

- Importing `server.ts` / `export { app }` into `functions/api/[[route]].ts`
- Skipping `app.listen` on `CF_PAGES`
- R-5 D1 as primary SQL; R-2 static-latency-only Pages
- Food-calc, scout instructions, `App.tsx` / `LogChat` / `JobStore` job-lifecycle rewrite
- God-file split of `server.ts` (R-4)
- Track B/F/S current work
- Raising Worker CPU to 5 min in order to run Express on V8

## Invariants

- `finalizeDishLedger` is the only kcal writer (food) — do not touch
- Locked SI converts: `1.293` / `1.411` / `3.362` / `79.56` / `13.68`
- Agent schema has no `calories`
- `shouldExpandMealAgent` stays TypeScript
- `npm run dev` = `tsx server.ts`, port **3000**, Vite when `runningViaTsx`
- Production API is a **Node process** on OVH VPS-2 (Cloudflare Containers parked), not a Pages Function
- One writer per entity (RELIABILITY Rule 5). Blobs stay R2
- `NODE_ENV=production` on the live process

## Prior art (do not reimplement)

- RELIABILITY.md §12 (this program)
- M23–M28 (`assert-free-tier-complete.mjs`)
- M29 job submit+poll (client already uses it)
- D1 HTTP helper `server_d1.ts` / `server_db_d1.ts`
- R2 S3 helper `server_routes_r2.ts`
- Client image compress `src/utils/imageCompressor.ts`
- Debug live-stream `: ping` every 15s in `server.ts`

## Plan

Procedural graph.

0. **R-13.0 Preflight (agent).** `node --env-file=.env scripts/r13-0-preflight.mjs`. Done when all PASS. Secrets stay in env — never commit `.env`.
1. **R-13.1 Ship.** `build:web` vs `build:server` split in `package.json`. PORT default 3000. Loopback URLs use `process.env.INTERNAL_BASE_URL || http://127.0.0.1:${PORT}`. Dockerfile and .dockerignore for Node process. `public/_redirects` and `wrangler.jsonc` for Cloudflare routing.
2. Verify: AI Studio boot `npm run dev` still serves Vite on port 3000, `npx vitest run src/server/receptionist/handoffContract.test.ts server_derivation.test.ts server_sse_json.test.ts`, and Guard exit 0.
3. After a public URL exists: add that **exact** host to Firebase Authorized Domains (not `*.pages.dev`). Guest mode until that lands.

## Test plan

```text
npx tsc --noEmit
npx vitest run src/server/receptionist/handoffContract.test.ts server_derivation.test.ts server_sse_json.test.ts
node scripts/assert-free-tier-complete.mjs
node scripts/assert-spec-diff.mjs R-13
npm run dev
# must log frontend=vite and bind port 3000
```

## Decisions (human lock)

1. API host: **OVH VPS-2** (`node dist/server.cjs` + Caddy). Not Cloudflare Containers. Not Cloud Run. Track V: [plan/VPS2_MOBILE_DEV.md](../../plan/VPS2_MOBILE_DEV.md).
2. Public hostname: **custom domain** added to Firebase Authorized Domains (exact host). Not `*.pages.dev`. Not Render after V-17.
3. Preview Google login: **Production host only** (preview PRs use guest mode).
4. Region: human at V-0.
