---
id: q-11-9-assembly
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false
allowed_files:
  - src/App.tsx
  - src/main.tsx
  - src/components/CATALOG.json
  - scripts/parity-baseline.json
frozen_files:
  - src/types.ts
  - src/jobs/JobStore.ts
  - src/components/LogChat.tsx
  - src/components/Header.tsx
  - src/components/AuthScreen.tsx
  - src/utils/storageUtils.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
  - scripts/assert-parity.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - node scripts/assert-parity.mjs
  - node scripts/assert-budgets.mjs
  - npx vitest run src/jobs/__tests__/JobSession.contract.test.ts src/utils/appProfileUtils.test.ts src/utils/translations.test.ts
  - npm run build:web
  - node scripts/journey-guard.mjs q-11-9-assembly
  - node scripts/assert-spec-diff.mjs q-11-9-assembly
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.9 — `App.tsx` assembly & final ratchet (milestone 9 of 9)

Umbrella laws apply (`specs/active/Q-11.md`). **Human go required.** This is the only milestone that
rewrites `App.tsx` wholesale, which is exactly where `a14abea` went wrong; run it only with every
previous milestone committed and green.

## Scope

1. `src/App.tsx` becomes a wiring layer (≤ 1,200 lines this milestone, ≤ 350 the follow-up): hooks in,
   `<AppShell>` / `<AppTabs>` / `<AppModals>` out, no business logic left behind.
2. Leftovers are moved into the module that owns them — never deleted. Any orphan you cannot place is
   a **stop-and-report**, not a judgement call to drop.
3. Finish the ratchet: `CATALOG.json` `src/App.tsx` ceiling to the achieved count; then run
   `node scripts/assert-parity.mjs --update` **only** if metrics improved, and say so in the commit.
4. `npm run build:web` must produce an unchanged-looking app: `dist/` chunks may regroup, but the
   shell, tabs, modals, auth gate and sign-out must behave exactly as before.
5. Close out the umbrella: move `Q-11.md` and this milestone's siblings to `specs/done/`, and record
   the final line counts in `AI_HANDOVER.md`.

## Done means

- `src/App.tsx` ≤ 1,200 lines, `assert-parity` green, full gate list green, `build:web` succeeds.
- Live walkthrough recorded: sign-in → demo shell → log a meal → open a modal → Sign Out → gate.
- No file deleted anywhere in Q-11; `git diff --stat` vs `338b252` shows additions and line reductions
  in `App.tsx` only.
