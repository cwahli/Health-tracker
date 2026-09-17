---
id: q-10-dependency-audit
status: locked
class: DEP_HYGIENE
skill: sync-jobs
edit_mode: patch
who: any-agent
auto_go: true
allowed_files:
  - package.json
  - package-lock.json
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/components/Header.tsx
  - src/components/AgentResultTable.tsx
  - src/jobs/JobStore.ts
  - server.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-budgets.mjs
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
gate:
  - npx tsc --noEmit
  - node scripts/assert-budgets.mjs
  - node scripts/journey-guard.mjs q-10-dependency-audit
  - node scripts/assert-spec-diff.mjs q-10-dependency-audit
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-10 dependency consolidation (hygiene only)

**Unlocked 2026-09-17.** After Q-9. Any builder. Do not wait for Grok. Serialize **after** Q-4 if both are open (different files — Q-4 first in Current work).

## Journey

`package.json` has leftover runtime deps from abandoned paths (FDC, extra SQL, duplicate zip). Better = each remaining dependency has a live import/require in app or server code. Reward = `tsc` + named gates still green, not a knip-as-reliability-gate (R-7 abandoned).

## Findings (do not redo)

- Q-9 shipped extract-only. Q-8.2 process boards exist. Q-10 was “later step after Q-9.”
- R-7 knip / `getBiomarkerStatus` memo as a reliability gate is **abandoned**. Do not add knip CI.
- Must **keep** (live): `react`, `react-dom`, `express`, `firebase`, `firebase-admin`, `@supabase/supabase-js`, `@google/genai`, `sharp`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `zod`, `lucide-react`, `recharts`, `react-markdown`, `remark-gfm`, `idb-keyval`, `dotenv`, `compression`, `exifr`, `html-to-image`, `react-zoom-pan-pinch`, `papaparse`, `@zip.js/zip.js` **or** `jszip` (audit which is live — keep the live one), `motion`, `leaflet` / `react-leaflet` if a map still mounts.
- Suspect (remove only if `rg` of the package name is 0 under `src/`, `server*.ts`, `scripts/`, `prototype/` excluding `node_modules` and lockfile): `pg` / `@types/pg` if D1 replaced postgres; unused `@google-cloud/firestore` if only `firebase` is used; duplicate zip client.
- DevDeps stay unless a script in `package.json` no longer references them.

## Plan

### Node 1 — inventory

- For every `dependencies` key, `rg -l --glob '!node_modules/**' --glob '!package-lock.json' <name>` from repo root. Record live vs unused in the PR body (or `AI_HANDOVER.md` Now line).
- Guidance: match the **import string** (`from 'pg'`, `from '@google-cloud/firestore'`), not a substring of another package.
- Done when: a two-column list exists. No uninstall yet.

### Node 2 — uninstall unused only

- `npm uninstall` each unused runtime dep. Do not bump versions of kept packages.
- Pitfalls: (sharp is server-only, keep) · (firebase-admin dynamic import in `server_auth.ts`, keep) · (Do not delete `jszip` because `file-saver` exists — check each).
- Done when: `npx tsc --noEmit` 0 and `package.json` diff is only removals + lockfile.

## Test plan

```text
npx tsc --noEmit
node scripts/assert-budgets.mjs
node scripts/journey-guard.mjs q-10-dependency-audit
node scripts/assert-spec-diff.mjs q-10-dependency-audit
node scripts/assert-shell-smoke.mjs
```

Do **not** `npm test`. Do **not** run knip.

## Audit plan

1. Scope vs ROADMAP Q-10 only.
2. No `src/` in the diff.
3. Honest residual: kept unused-looking dep named if rg is non-zero in a comment-only file.

## Blast radius

Out of scope: god-file splits, R-7 knip gate, upgrading React/Vite, adding a new provider SDK.

## Stop and come back

`tsc` red after uninstall · Frozen file in the diff · “cleanup” of `src/` imports · live Gemini
