---
id: biomarker-pre-mcp
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/dataEntry.ts
  - src/utils/dataEntry.test.ts
  - src/utils/openPdfBytes.ts
  - src/utils/recordFacts.ts
  - src/utils/specialistMesh.ts
  - src/utils/specialistMesh.test.ts
  - src/utils/homeStrip.test.ts
  - src/utils/onboardingRecord.ts
  - src/utils/onboardingRecord.test.ts
  - src/utils/onboardingPreview.ts
  - src/utils/recordFacts.test.ts
  - src/utils/healthRecord.ts
  - src/utils/insightsOffer.test.ts
  - src/components/InsightsTab.tsx
  - src/components/HomeTab.tsx
  - src/components/VoiceReceptionistFab.tsx
  - src/hooks/useBiomarkerActions.ts
  - src/utils/debugPayload.ts
  - src/server/biomarkers/pipeline.ts
  - src/server/biomarkers/instruction.ts
  - src/server/biomarkers/pipeline.split.test.ts
  - src/server/healthCoach/instruction.ts
  - src/server/healthCoach/instruction.record.test.ts
frozen_files:
  - server_db_d1.ts
  - server_routes_mcp.ts
  - server_routes_sync.ts
  - server_mcp.test.ts
  - src/server/domain/healthTrackerDomain.ts
  - docs/agent/standing.json
  - src/utils/biomarkers.ts
  - src/App.tsx
gate:
  - npx vitest run src/utils/dataEntry.test.ts src/utils/specialistMesh.test.ts src/utils/homeStrip.test.ts src/utils/onboardingRecord.test.ts src/utils/recordFacts.test.ts src/utils/insightsOffer.test.ts src/server/healthCoach/instruction.record.test.ts src/server/biomarkers/pipeline.split.test.ts
  - node scripts/assert-biomarker-lifecycle-m31.mjs
  - npx tsc --noEmit --pretty false --incremental false
  - node scripts/journey-guard.mjs biomarker-pre-mcp
---

# Packet: finish the record before D1 and MCP

The human allowed the Insights chain, the M31 retarget, and the PDF text-layer opener. This packet stops at the D1 projection and the MCP read and write tools.

Insights offers add-health-data, the health coach, and literature. Lab parser, range calibrator, and the separate test planner are not offered. Test planning stays on the coach instruction. The M31 assert reads the files that call the helpers. P0:A2, P0:A4, and the dictionary approve/dismiss check are retired. The PDF opener reads uncompressed text operators and does not add a PDF library or a second OCR engine. Confirmed diary facts can ride the meal debug report. Spoken handoff resolves a lab or a symptom to data_entry on the existing tool.

Do not write `biomarker_logs`. Do not edit the MCP routes. The next packet is the single D1 projection, and it starts from `main` only after the focus pull is on `main`.
