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
  # i18n *readers* that must follow the data (see "Gate-scope amendment" below).
  - scripts/assert-parity.mjs
  - scripts/assert-master-scorecard.mjs
  - scripts/journey-guard.mjs
  - scripts/parity-baseline.json
frozen_files:
  - src/types.ts
  - src/components/Header.tsx
  - src/components/AuthScreen.tsx
  - src/components/LogChat.tsx
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/assert-budgets.mjs
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
- `CATALOG.json`: add a ceiling for each new translations file — new ceilings are allowed;
  raising an existing one is not.

## Gate-scope amendment (recorded deviation)

Splitting a file moves **where the gates read it from**, and three standing gates parsed
`src/utils/translations.ts` as text. Each edit below keeps the check's semantics and was proven
before it was committed; none of them loosens a threshold:

| Gate | Change | Proof it is not a weakening |
| --- | --- | --- |
| `scripts/assert-parity.mjs` | i18n key count now sums the aggregator + `src/utils/translations/*.ts` instead of one path | still counts **3,960** keys, the exact pre-split number; baseline still only moves down by hand |
| `scripts/assert-master-scorecard.mjs` | `readTranslationSource()` concatenates the aggregator and the packs; `extractPack` accepts `export const en = {` as well as `en: {` | the scorecard's own extractor returns **1980 en + 1980 id keys, identical to `HEAD`** byte-for-byte, and total pass/fail stayed **744/1** |
| `scripts/journey-guard.mjs` | UI-path prefix `src/utils/translations.ts` → `src/utils/translations` | *widens* the UI classification to cover the new packs, so more evidence is required, not less |

## Budget deviation (recorded)

The ≤ 1,100 line target per pack in the scope above was a forecast and is wrong: `en` and `id` are
1,998 lines each because each language carries all 1,980 keys. The honest ceilings recorded are
2,010 (small headroom); the **real** payload win is that the transfer target went from one 190 KB
file to 94 KB + 96 KB, and the aggregator is now 31 lines. A further per-domain split (e.g.
`en.food.ts`, `en.medical.ts`) is deliberately **not** done here — the packs are flat and key-ordered
today, so a domain split needs its own packet with a key-routing test.

## Extra verification this milestone added

- `tmp-verify-i18n.cjs` (throwaway) proved the move is **byte-identical**: the extracted `en`/`id`
bodies from `HEAD` and from the new files compare equal to the character (94,055 B and 95,571 B).
- `src/utils/translations.test.ts` pins key-set parity, the ≥ 3,960 total, string-valued keys,
  `adviceNeutral` as the only intentional blank, a **frozen sha256 digest** of both packs, and the
  English per-key fallback for `fr`/`zh`.
