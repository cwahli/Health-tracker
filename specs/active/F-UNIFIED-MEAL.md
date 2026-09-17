---
id: F-UNIFIED-MEAL
status: locked
class: SINGLE_PATH_MEAL
skill: food-calc
edit_mode: rewrite
allowed_files:
  - serverBrandMenu.ts
  - server_d1_schema.ts
  - server_db_d1.ts
  - server_routes_food.ts
  - server_routes_r2.ts
  - src/components/LogChat.tsx
  - src/components/NutritionDataBrowserModal.tsx
  - src/server/food/server_food_db_search.ts
  - src/server/food/server_food_scout_source.ts
  - src/utils/imageResolver.ts
  - src/utils/translations.ts
  - src/server/food/server_food_multi_composition.test.ts
  - src/utils/imageResolver.contract.test.ts
  - src/utils/bracketPortionParser.ts
  - src/utils/bracketPortionParser.test.ts
  - src/server/food/server_brand_image_linking.contract.test.ts
  - src/utils/compositeFoodCalculation.ts
  - tests/food_autocomplete_composition.contract.test.ts
  - golden/scorecard/instruction/gates.json
  - golden/scorecard/instruction/MASTER_SCORECARD.md
  - supabase/migrations/20260917_brand_menu_items_image_url.sql

  - specs/packets/R-13.md
frozen_files:
  - src/App.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
gate:
  - npx tsc --noEmit
  - npx vitest run src/utils/imageResolver.contract.test.ts src/server/food/server_food_multi_composition.test.ts src/server/food/server_food_scout_source.test.ts
  - node scripts/assert-shell-smoke.mjs
---

# F-UNIFIED-MEAL — Unified Food Logging, Brand Food Images, CAS Deduplication & Multi-Item Composition

## Goal
Consolidate food addition into a single FoodCard path, attach images to brand items, implement SHA-256 CAS deduplication, isolate multi-user catalog data, and support multi-item staging.

## In scope
- Single meal addition path: 0-latency composite FoodCard when pure known items are submitted, eliminating the raw bypass
- Brand food images in D1, Supabase migration, search API, autocomplete dropdown, and Nutrition Data Browser
- SHA-256 Content-Addressable Storage (CAS) in R2 and cross-reference tokens
- Multi-item staging tray in LogChat
- Nutrition browser image editing and photo upload

## Out of scope
- Changing USDA / FDC resolvers
- Changing App.tsx job poller or JobStore core lifecycle

## Invariants
- Zero image byte duplication in R2 via SHA-256 content addressing
- Single FoodCard verification UI across all addition paths
- Public brand catalog vs private user food_logs separation preserved
