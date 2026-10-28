---
id: biomarker-d1-mcp
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/recordProjection.ts
  - src/utils/recordProjection.test.ts
  - src/server/domain/healthTrackerDomain.ts
  - server_routes_mcp.ts
  - server_mcp.test.ts
frozen_files:
  - server_db_d1.ts
  - docs/agent/standing.json
  - src/App.tsx
gate:
  - npx vitest run src/utils/recordProjection.test.ts
  - npx vitest run server_mcp.test.ts
  - node scripts/journey-guard.mjs biomarker-d1-mcp
---

# Packet: one D1 projection and the MCP record tools

The focus pull is on main. This packet starts from that main. It does not edit the biomarker upsert SQL. The newer-than `updated_at` guard stays.

One projection reads date rows. Numeric labs stay a map. Symptom events are a separate list. Counters are the milestone 0 functions. Same-day values are not averaged. `log`, `edit`, `delete`, `confirm_source`, and `confirm_cleanup` call that projection. `log_entries` and `delete_values` stay so the step 4 tests keep their dictionary mapping.

The step 5 catalog still lists the standard dictionary because that test requires it. The catalog also lists the user's own marker keys.
