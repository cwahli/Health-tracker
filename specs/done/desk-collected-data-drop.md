---
id: desk-collected-data-drop
status: locked
skill: receptionist
edit_mode: patch
allowed_files:
  - src/server/receptionist/call_agent.ts
  - src/server/receptionist/handoffContract.test.ts
  - src/utils/translations.ts
frozen_files:
  - src/server/receptionist/instruction.ts
  - src/server/receptionist/schema.ts
  - src/components/chat-cards/ReceptionistCard.tsx
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - npx tsc --noEmit
  - npx vitest run src/server/receptionist/handoffContract.test.ts
---
# Desk double-ask — deterministic demographic extraction — PACKET (locked)

## Goal
Live `job_frontdesk_1789468175766`: user submitted age/gender/height/weight, next turn re-asked already-given fields. Snapshot fill currently depends on the model parsing the submit text; the re-ask gate then re-fires on model drops.
Shared note: `src/utils/translations.ts` ID fills are shared with `desk-uiform-label-language` (single commit serving both).

## Law
- Deterministic extraction is additive: fills snapshot holes, never overwrites model/existing values. Same pattern as the existing `detectedActivity` block.
- EN + ID submit labels (form submits echo field labels: "Age:", "Gender:", "Berat Badan Saat Ini:", "Tingkat Aktivitas:", "Berat Badan Target:").

## Mechanism
- New exported `extractDemographicsFromText(text)` in `src/server/receptionist/call_agent.ts` → `{ age, gender, heightCm, weightKg, targetWeightKg, activityLevel }` (absent keys omitted):
  - age `/(?:age|usia)\s*[:\-]?\s*(\d{1,3})/i`, sanity 5–120
  - gender `/(wanita|female)/i → Female`, `/(pria|\bmale\b)/i → Male` (check pria before male-in-female? "female" contains "male" — match female/wanita first)
  - height `/(?:height|tinggi(?:\s*badan)?)\s*[:\-]?\s*(\d{2,3})/i`, sanity 50–250
  - target first `/(?:berat badan target|target weight)\s*[:\-]?\s*(\d{2,3}(?:\.\d+)?)/i`, then current `/(?:berat badan saat ini|current weight|(?<!target\s)weight(?!.*target)|berat(?!\s*badan\s*target))\s*[:\-]?\s*(\d{2,3}(?:\.\d+)?)/i`, sanity 20–400
  - activity: reuse the existing detectedActivity regex set (extract to share or duplicate the small set; no behavior change)
- Hook next to the activity block (~1005, before promote/enforce): merge hits into `snap` + `collectedData` only when currently empty, prune matched keys from `missingFields`/`pendingItems` (mirror activity lines 1018-1028).

## Sensor
- `handoffContract.test.ts`: exact live strings — `"Age: 15, Gender: Wanita, Height: 145, Berat Badan Saat Ini: 40"` → all four extracted; `"Tingkat Aktivitas: sedentary, Berat Badan Target: 35 kg"` → activity + target; adversarial `"female"` must not also match male; target weight must not leak into current weight.

## Gates
`npx tsc --noEmit` · `npx vitest run src/server/receptionist/handoffContract.test.ts` · `node scripts/journey-guard.mjs desk-collected-data-drop`.

## Status: LOCKED
