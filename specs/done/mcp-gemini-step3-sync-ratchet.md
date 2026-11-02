---
id: MCP-GEMINI-STEP3-SYNC-RATCHET
status: locked
class: MCP_SYNC_RATCHET_AND_TIMEZONE
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

# MCP-GEMINI-STEP3-SYNC-RATCHET — Step 3: Timezone Alignment & Server-Side Sync Ratchet

## 1. Objective
1. **Timezone Alignment:**
   - Eliminate timezone drift between Gemini (which operates in cloud/UTC time) and user-local time in the app (`profile.timezone`, e.g. `Europe/London`).
   - Use `getCurrentDateInTimezone(timezone)` in all MCP date calculations (`today`, `yesterday`).
   - Support natural relative date tokens (`'today'`, `'yesterday'`) in `manage_meals(action: 'list')` and `manage_home(action: 'get_allowance_progress')`.
   - Provide local dates (`date_local`, `time_local`), timezone identifier, and timestamp in tool responses.
   - Support `manage_home(action: 'update_profile')` to allow setting/updating timezone and language.
2. **Server-Side Sync Ratchet for Targets:**
   - Per-key timestamp map `targetTimestamps: { [nutrientKey]: epochMs }` stored in profile data.
   - Merge targets key-by-key: a newer timestamp always wins over an older timestamp, preventing stale browser tabs or out-of-order writes from overwriting newer edits.
   - Synchronously maintain both `profile.targets` and `report.dailyNutrientTargets`.
3. **Conditional D1 Upserts:**
   - Ensure `d1UpsertFoods` and `d1UpsertBiomarkers` respect `updated_at` ordering and do not resurrect deleted records.

## 2. Invariants
- Multi-tenant isolation: reads query `possibleUids`, writes go to `canonicalUid`.
- Single source of truth: Cloudflare D1 with in-memory test mocks.
- `edit_mode: rewrite` deliberate for substantial tool additions.
