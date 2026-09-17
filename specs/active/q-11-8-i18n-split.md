---
id: q-11-8-i18n-split
status: locked
class: GOD_FILE_GROWTH
skill: specify
edit_mode: patch
who: any-agent
auto_go: false
allowed_files:
  - src/utils/translations.ts
  - src/utils/translations/en.ts
  - src/utils/translations/fr.ts
  - src/utils/translations/zh.ts
  - src/utils/translations/id.ts
  - src/utils/translations/index.ts
  - src/utils/translations.test.ts
  - src/components/CATALOG.json
frozen_files:
  - src/types.ts
  - src/components/Header.tsx
  - src/components/AuthScreen.tsx
  - src/components/LogChat.tsx
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
  - npx vitest run src/utils/translations.test.ts
  - npm run test:receptionist
  - node scripts/journey-guard.mjs q-11-8-i18n-split
  - node scripts/assert-spec-diff.mjs q-11-8-i18n-split
  - node scripts/assert-shell-smoke.mjs
---

# Packet: Q-11.8 — translations split per language (milestone 8 of 9)

Umbrella laws apply (`specs/active/Q-11.md`). Promote `auto_go` after Q-11.7 is committed.
This milestone does not touch `src/App.tsx` — it is a data move that also happens to be the cheapest
way to shrink the transfer payload.

## Scope

`src/utils/translations.ts` is 4,009 lines / 3,960 keys in one file.

1. Split the dictionary into `src/utils/translations/{en,fr,zh,id}.ts` (≤ 1,100 lines each), keeping
   the **exact same keys and values**, exported as typed objects with the language code as the name.
2. `src/utils/translations.ts` becomes a thin re-export aggregator so every existing import
   (`import { translations } from '../utils/translations'`, `useTranslations`, …) keeps working
   unchanged. No call site moves in this milestone.
3. `src/utils/translations.test.ts` (new) must prove parity, not vibes: key sets identical across
   languages, total key count ≥ 3,960, and every value a non-empty string. `assert-parity` also
   guards the count — do not lower it.

## Done means

- Key count reported by the new test equals the baseline (3,960), and `assert-parity` stays green.
- `npm run test:receptionist` green (it asserts translated card copy).
- `CATALOG.json`: add a ceiling for each new translations file (≤ 1,100) — new ceilings are allowed;
  raising an existing one is not.
