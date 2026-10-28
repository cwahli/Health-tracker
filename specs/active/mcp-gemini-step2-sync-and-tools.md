---
id: MCP-GEMINI-STEP2-TOOLS
status: locked
class: MCP_DOMAIN_TOOLS_AND_SYNC
edit_mode: rewrite
skill: builder
auto_go: true
allowed_files:
  - server_routes_mcp.ts
  - server_mcp.test.ts
  - server_db_d1.ts
  - server_routes_sync.ts
  - plan/ROADMAP.md
  - AI_HANDOVER.md
  - scripts/author-trail-debt.txt
frozen_files:
  - agents/**
  - server_dish_finalize.ts
  - server_derivation.ts
  - src/jobs/JobStore.ts
  - src/jobs/SupabaseJobSync.ts
  - .github/workflows/ci.yml
gate:
  - npx tsc --noEmit
  - npx vitest run server_mcp.test.ts
---

# MCP-GEMINI-STEP2-TOOLS — Step 2: Domain Query Tools & Allowance Progress

## 1. Objective
Enable Gemini to answer live and historical dietary, allowance, and biomarker questions via MCP:
1. `manage_meals`:
   - `list`: Browse and query meals by date range (`date_from`, `date_to`), single `date`, or keyword search across `possibleUids`. Returns full nutritional breakdowns (calories, protein, carbs, fat, fiber, sodium, etc.).
   - `get_detail`: Fetch complete meal record by `mealId`, including items breakdown and photo URLs.
2. `manage_home`:
   - `get_dashboard` / `get_allowance_progress`: Computes exact consumed calories and macro/micronutrients for any date (today, yesterday, or historical) against active daily target thresholds (e.g. 1,651 kcal, sat_fat < 15g, fiber >= 30g), returning consumed, target, and remaining deficit/surplus.
   - `set_targets`: Updates daily/weekly nutrient targets with per-key timestamps.
   - `get_profile`: Demographics, preferences, and baseline metrics.
3. `manage_biomarkers`:
   - `list`: Query blood test and lab marker history by date range or specific biomarker keys.
   - `get_trends`: Longitudinal trend analysis (min, max, delta %, latest values).

## 2. Invariants
- **Multi-Tenant Profile Isolation:** Reads query `possibleUids`; writes go to `canonicalUid`.
- **Single Source of Truth:** Direct D1 integration for meals and biomarkers with in-memory test fallbacks.
- **Allowance Ring Parity:** Calorie and nutrient sums match homepage calculations.
