---
id: f-8-12-packaged-bind-verify
status: locked
skill: food-brand
edit_mode: patch
allowed_files:
  - specs/active/f-8-12-packaged-bind-verify.md
frozen_files:
  - server_brand_match.ts
  - server_brand_match.test.ts
  - server_dish_finalize.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - npx vitest run server_brand_match.test.ts
---
# F-8.12 — packaged catalog residual verify (no prod change) — PACKET (locked)

## Goal
ROADMAP F-8.12 residual: Hemaviton-class drink binds vitamin C / labelled kcal from brand or printed OCR when those facts exist; bind-attempt + `BIND_MISS` stays honest otherwise.

## Measurement (2026-09-15 session)
- `server_brand_match.test.ts` 6/6 green, including the F-8.12 sensor: `matchBrandMenu("Hemaviton", "Hemaviton C1000 Orange Drink")` → HIT, calories + vitaminC locked, vitaminC > 0 and ≠ 1000 (never the name).
- No code change needed; residual is closed in tree.

## Law
- Verify-only ID. No application change.

## Gates
`npx vitest run server_brand_match.test.ts` · `node scripts/journey-guard.mjs f-8-12-packaged-bind-verify`.

## Status: LOCKED
