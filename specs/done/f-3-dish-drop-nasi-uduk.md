---
id: f-3-dish-drop-nasi-uduk
status: locked
skill: food-scout
edit_mode: patch
allowed_files:
  - server_vision_scout.ts
  - server_vision_scout.test.ts
frozen_files:
  - server.ts
  - src/App.tsx
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - npx vitest run server_vision_scout.test.ts
---
# F-3 — one class playbook: DISH_DROP (sole-dish unroll, Nasi Uduk live payload) — PACKET (locked)

## Goal
One class playbook per session (ROADMAP F-3; method `docs/agent/domains/food-calc.md` §3b). Class: `DISH_DROP`, sole-dish-unroll subtype. Live case `J-ID-01-job_1789430040929`: scout returned ONE dish "Nasi Uduk dengan Telur Balado dan Tempe Orek" (350g, zero boxes) with 3 foods — product must yield 3 standalone items, not 1 collapsed dish.

## Law
- Inner loop = named vitest only. No `POST /loop`, no fixture painting, no kcal claims.
- The Mie Ayam unroll test (`server_vision_scout.test.ts:960`) stays green; new repro asserts names + weights, not boxes (live boxes are all-zero; zoom crop is out of scope).

## Mechanism
- New repro test feeding the exact live payload (dish + 3 foods + dishNutrients from the debug file) through `parseAndHealVisionScout`, expecting items `[Nasi Uduk, Telur Balado, Tempe Orek]` with weights `[200, 75, 75]`, `hasComponents false`.
- If red: fix the unroll gate (`server_vision_scout.ts:1285-1288` compound-name / sole-dish condition) minimally — the `dengan…dan…` Indonesian compound must count as a compound name even when component inclusion already holds.
- If green on first run: no prod change; the session locks the sensor and closes the class with an honest note.

## Sensor
- New test `unrolls sole Nasi Uduk dish (job_1789430040929) with dengan-dan compound name` in `server_vision_scout.test.ts`.
- No new assert script (F-3's gate is the named vitest + tsc).

## Gates
`npx tsc --noEmit` · `npx vitest run server_vision_scout.test.ts` · `node scripts/journey-guard.mjs f-3-dish-drop-nasi-uduk`.

## Status: LOCKED
