---
id: biomarker-until-d1
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/dataEntry.ts
  - src/utils/dataEntry.test.ts
  - src/utils/specialistMesh.ts
  - src/utils/specialistMesh.test.ts
  - src/utils/homeStrip.ts
  - src/utils/homeStrip.test.ts
  - src/utils/onboardingRecord.ts
  - src/utils/onboardingRecord.test.ts
  - src/utils/frontDeskRouting.ts
  - src/components/MedicalHistoryTab.tsx
  - src/components/HomeTab.tsx
  - src/components/InsightsTab.tsx
  - src/utils/translations/en.ts
  - src/utils/translations/id.ts
  - src/utils/translations/fr.ts
  - src/utils/translations/zh.ts
frozen_files:
  - server_db_d1.ts
  - server_routes_mcp.ts
  - server_mcp.test.ts
  - src/server/domain/healthTrackerDomain.ts
  - docs/agent/standing.json
  - scripts/assert-biomarker-lifecycle-m31.mjs
  - src/server/biomarkers/pipeline.ts
  - src/utils/biomarkers.ts
gate:
  - npx vitest run src/utils/dataEntry.test.ts src/utils/specialistMesh.test.ts src/utils/homeStrip.test.ts src/utils/onboardingRecord.test.ts src/utils/frontDeskRouting.test.ts
  - npx tsc --noEmit
  - node scripts/journey-guard.mjs biomarker-until-d1
---

# Packet: record work until the D1 and MCP boundary

Milestones 2, 3 (the part that is not a rewrite), 4, and 5. No D1 projection. No MCP read adapter. No MCP write tools.

The Insights clinical chain stays in place. Removing it is a rewrite of `InsightsTab.tsx`. The M31 assert is not edited. That file still needs a human confirm before it changes.

Stop after this packet. The next packet is the single D1 projection, and it starts from `main` only after the focus pull is on `main`.
