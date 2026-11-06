---
id: biomarker-history-screen
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/healthRecord.ts
  - src/utils/healthRecord.test.ts
  - src/components/MedicalHistoryTab.tsx
  - src/types.ts
frozen_files:
  - server_db_d1.ts
  - server_routes_mcp.ts
  - docs/agent/standing.json
  - src/App.tsx
  - src/utils/biomarkers.ts
  - src/hooks/useAppSync.ts
gate:
  - npx vitest run src/utils/healthRecord.test.ts
  - npx tsc --noEmit
  - node scripts/journey-guard.mjs biomarker-history-screen
---

# Packet: History screen uses the milestone 0 record

Milestone 1 only. No D1 migration. No MCP edits. The dictionary and the practice and condition filters stay.

## Done when

1. The tracked-biomarker count and the total-log count on Medical History are `trackedMarkerCount` and `totalLogEntryCount` via `projectHistoryScreen`.
2. A 17-column diary still shows its first event after a column is removed and after a column is added. A later log with headers in a different order keeps the same column ids. Re-importing the same movement does not add a second log entry. An unknown header is proposed and the known cells are still saved.
3. A symptom event has `kind: 'symptom'` and is listed on the history screen when `profile.symptomDiaries` has events. Cells are addressed by column id.
4. Risk labels on rows are only the labels already used by the catalog. An unknown label is dropped.
5. Same-day lab values are not averaged.
6. `sleep_duration` and a `*_symptom_score` key skip the laboratory-ratio flag on this screen.
7. `server_db_d1.ts` and `server_routes_mcp.ts` are not edited.
