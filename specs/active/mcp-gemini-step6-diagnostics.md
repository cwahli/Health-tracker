---
id: MCP-GEMINI-STEP6-DIAGNOSTICS
status: done
class: MCP_DIAGNOSTICS_AND_RELIABILITY
edit_mode: rewrite
skill: builder
auto_go: false
allowed_files:
  - src/server/domain/healthTrackerDomain.ts
  - server_routes_mcp.ts
  - server_mcp.test.ts
  - plan/ROADMAP.md
  - AI_HANDOVER.md
  - specs/done/mcp-gemini-step5-resources-and-prompts.md
  - specs/active/mcp-gemini-step6-diagnostics.md
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

# MCP-GEMINI-STEP6-DIAGNOSTICS — Step 6: Diagnostic & Reliability Tools

**Done 2026-10-29.** Step 6 is on main. Do not re-execute this packet. `auto_go` is false so an unattended run does not pick it up.

## 1. Objective
1. **Implement `diagnose_health_data` tool in `server_routes_mcp.ts`:**
   - Diagnostic and data self-healing tool strictly scoped to the user's authenticated profile.
   - **Action 1: `get_meal_debug_tree`:**
     - Uses `buildCanonicalRunTree` (`src/utils/debugRunTree.ts`), `evaluateContracts` and `classifyDump` (`src/utils/dumpContract.ts`) on a meal's debug report or reconstructed run tree.
     - Detects and classifies oracle failures (`FALSE_FRIEND`, `DISH_DROP`, `STALE_TURN`, Atwater calorie mismatches).
     - Returns contract checks, oracle fails, dispatch count, and pack classification.
   - **Action 2: `simulate_calculation`:**
     - In-memory dry-run sandbox (`simulateMealCalculation`) testing proposed ingredient / weight / macro modifications.
     - Runs single-writer `finalizeDishLedger` enforcing Atwater derivation (`4*P + 4*C + 9*F`), `reapplyDerivedNutrients`, `sumItemNutrients`, and `resolveMealVerdict`.
     - Returns computed items, totals, and verdict without writing to D1 or mutating profile.
   - **Action 3: `audit_biomarkers`:**
     - Runs `runGeneralizedBiomarkerAudit` (`src/utils/biomarkerAuditEngine.ts`) against the profile's biomarker history and `customBiomarkers`.
     - Detects corrupted units, missing reference ranges, duplicate alias clusters (e.g. `ldl_cholesterol` vs `ldl`), and clinical unit conflicts (e.g. mmol/L vs mg/dL).
     - Returns summary counters, duplicate alias clusters, and actionable proposed resolutions.
   - **Action 4: `diagnose_sync`:**
     - Scans profile's records across `possibleUids` for sync health:
       - Orphan / un-uploaded photo references (`ref:...` that do not start with `https://` or `http://`).
       - Active, stuck, or failed jobs.
       - Target timestamp consistency and tombstone counts (`deletedFoodLogIds`, `deletedBiomarkerLogIds`, `deletedCustomBiomarkerKeys`).
   - **Action 5: `file_bug_ticket`:**
     - Files a structured bug ticket via `serverBugAutoFile.ts` / `persistAutoFile`.
     - **Strict Cap:** Maximum 1 open ticket per meal and oracle code. Duplicate submissions return the existing ticket.
2. **Security & Boundary Guard:**
   - Catalog mutations (`quarantineAtwaterFailures`, `upsertFoodAlias`, `mergeFoodCatalogItems`) remain strictly banned on MCP profile tokens and reserved for admin routes.
3. **Unit & Contract Verification:**
   - Add Step 6 tests in `server_mcp.test.ts` exercising all 5 actions of `diagnose_health_data`:
     - Debug tree contract evaluation and oracle failure classification.
     - In-memory dry-run calculation simulation confirming zero D1 mutation.
     - Biomarker auditing detecting alias duplicates and unit issues.
     - Sync diagnostic detecting orphan photo refs and stuck jobs.
     - Capped bug filing returning existing ticket when filing duplicate meal/oracle tickets.
