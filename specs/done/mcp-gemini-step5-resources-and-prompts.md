---
id: MCP-GEMINI-STEP5-RESOURCES-AND-PROMPTS
status: locked
class: MCP_DYNAMIC_RESOURCES_AND_PROMPTS
edit_mode: rewrite
skill: builder
auto_go: true
allowed_files:
  - server_routes_mcp.ts
  - server_mcp.test.ts
  - plan/ROADMAP.md
  - AI_HANDOVER.md
  - specs/done/mcp-gemini-step4-domain-mutations.md
  - specs/active/mcp-gemini-step5-resources-and-prompts.md
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

# MCP-GEMINI-STEP5-RESOURCES-AND-PROMPTS — Step 5: Dynamic Schema Resource & Prompts

## 1. Objective
1. **Declare Capabilities in `initialize`:**
   - Add `resources: { listChanged: false, subscribe: false }`
   - Add `prompts: { listChanged: false }`
2. **Implement Dynamic Schema Resource (`resources/list` & `resources/read`):**
   - Resource URI: `schema://health-tracker/catalog`
   - Name: `Health-tracker Clinical & Nutritional Catalog`
   - Dynamically generated from:
     - All 31 active nutrient keys from `defaultNutrientTargets` (HomeTab.tsx) and `NUTRIENT_KEYS` / `LIMIT_NUTRIENT_KEYS` (nutrients.ts) with codes, labels, units, and polarities (`limit` vs `goal`).
     - Standard biomarker definitions from `biomarkerDefinitions` (biomarkers.ts) plus authenticated user profile's `customBiomarkers` (canonical key, display name, unit, reference range, category).
     - Domain tool metadata and schemas (`manage_home`, `manage_meals`, `manage_biomarkers`).
3. **Implement MCP Clinical Prompts (`prompts/list` & `prompts/get`):**
   - `audit_meal_accuracy`: Forensic meal audit comparing photo against breakdown, dishes, and Atwater derivation. Optional `meal_id` parameter.
   - `daily_nutrition_debrief`: End-of-day nutritional review calculating caloric and micronutrient intake against allowances with actionable advice. Optional `date` parameter (defaults to "today").
   - `biomarker_diet_correlation`: Longitudinal cross-correlation between out-of-range biomarkers and 30-90 day dietary intake trends. Optional `biomarker_key` parameter.
   - `triage_and_fix_latest_issue`: Diagnostic triage checking recent meals, biomarker entries, and sync state for discrepancies and recommending own-data fixes.
4. **Fix base commit debt:**
   - Record `1edd5e15` in `scripts/author-trail-debt.txt`.
