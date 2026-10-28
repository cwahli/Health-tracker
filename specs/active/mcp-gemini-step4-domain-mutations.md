---
id: MCP-GEMINI-STEP4-DOMAIN-MUTATIONS
status: locked
class: MCP_DOMAIN_SERVICE_AND_MUTATIONS
edit_mode: rewrite
skill: builder
auto_go: true
allowed_files:
  - src/server/domain/healthTrackerDomain.ts
  - server_routes_mcp.ts
  - server_mcp.test.ts
  - plan/ROADMAP.md
  - AI_HANDOVER.md
  - specs/done/mcp-gemini-step3-sync-ratchet.md
  - specs/active/mcp-gemini-step4-domain-mutations.md
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

# MCP-GEMINI-STEP4-DOMAIN-MUTATIONS — Step 4: Shared Domain Service & Mutation Tools

## 1. Objective
1. **Shared Domain Service (`src/server/domain/healthTrackerDomain.ts`):**
   - Unify meal and biomarker mutation logic between Website and MCP interfaces.
   - `finalizeAndCreateMeal`: Takes structured items, runs `finalizeDishLedger` (enforcing the single-writer invariant: calories are derived via Atwater, never LLM-emitted), computes `reapplyDerivedNutrients`, aggregates with `sumItemNutrients`, derives verdict with `resolveMealVerdict`, and saves to D1 (`d1UpsertFoods`).
   - `editMeal`: Executes natural language or structured patches via `server_meal_edit.ts` (`applyMealEdits`), updates totals and meal items, and saves changes to D1.
   - `deleteMeal`: Deletes the meal log from D1 (`d1DeleteFoods`) and stamps `deletedFoodLogIds[mealId] = Date.now()` on the user's profile to prevent client resurrection.
   - `upsertBiomarkerEntry`: Merges new biomarker key-value pairs into existing same-date records across `possibleUids`, maps keys to canonical names via `getMappedBiomarkerKey`, flags improbable values via `isBiomarkerValueImprobable`, and saves to D1 (`d1UpsertBiomarkers`).
   - `deleteBiomarkerEntry`: Deletes a specific biomarker key from a date's test dictionary (preserving other tests on that date) OR deletes the entire date record with a tombstone in `deletedBiomarkerLogIds[id] = Date.now()` and removal from D1 (`d1DeleteBiomarkers`).
   - `manageUserActions`: Add, update, toggle complete, or remove actions in `profile.actions`.
   - `manageUserHabits`: Add, toggle complete, or remove habits in `profile.dailyBenefits`.
   - `withIdempotency`: Wraps mutating actions with `idempotency_key` cache to guarantee zero duplicate inserts on Gemini retries.
2. **Expose Domain Mutation Actions in `server_routes_mcp.ts`:**
   - `manage_meals`:
     - `log_structured`: Directly log meals with items, weights, and optional photo URLs.
     - `edit`: Patch an existing meal by `meal_id` using commands or message.
     - `delete`: Delete a meal by `meal_id` with tombstone.
   - `manage_biomarkers`:
     - `log_entries`: Log one or more biomarker readings for a given date.
     - `delete_values`: Delete specific marker key or whole date record.
   - `manage_home`:
     - `manage_actions`: Add, toggle, update, or delete clinical health actions.
     - `manage_habits`: Add, toggle, update, or delete daily benefit habits.
3. **Comprehensive Unit & Contract Verification:**
   - Add Step 4 test suite in `server_mcp.test.ts` testing all mutation pathways, single kcal writer adherence, tombstone stamping, same-day biomarker merging, and idempotency deduplication.
