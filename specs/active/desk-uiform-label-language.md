---
id: desk-uiform-label-language
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
  - npx vitest run src/server/receptionist/handoffContract.test.ts src/utils/i18n.test.ts
---
# Desk uiForm label language — normalize model labels + fill ID keys — PACKET (locked)

## Goal
Live job: turn-2 form showed EN labels (Age/Gender/Height) while session language is ID. Two causes: (a) model-provided uiForm bypasses the TS synthesizer and `ReceptionistCard` renders `field.label` verbatim; (b) ID pack itself lacks translations (`age`→"Age", `gender`→"Gender", `height`→"Height", `medicalHistory`→"Medical History" — identical to EN, so even the synthesizer emits English).

## Law
- Server-side normalization (all clients benefit; card untouched). Unknown labels pass through unmapped (honest residual, never blank).
- EN is source of truth; this fills ID values only, no key changes (parity test keeps passing).

## Mechanism
1. `src/utils/translations.ts` ID fill: `age`→"Usia", `gender`→"Jenis Kelamin", `height`→"Tinggi Badan", `medicalHistory`→"Riwayat Medis".
2. New exported `normalizeUiFormLanguage(uiForm, formLang)` in `call_agent.ts`: build EN→key map from the synthesizer's field set (`gender/age/height/weight/activity/medicalhistory/targetweight` via `t('en', key)` at runtime); rewrite a model field label to `t(formLang, key)` on case-insensitive EN match. Hook in post-process next to the synthesizer (applies when model DID provide fields; synthesizer path unchanged).
3. Units: map `years`→`tahun` when formLang is id (cm/kg universal, left alone).

## Sensor
- `handoffContract.test.ts`: model form `{Age, Gender, Height}` + `id` → `{Usia, Jenis Kelamin, Tinggi Badan}`; unknown label passes through; `en` form untouched.
- Existing `i18n.test.ts` parity must stay green (45/45).

## Gates
`npx tsc --noEmit` · `npx vitest run src/server/receptionist/handoffContract.test.ts src/utils/i18n.test.ts` · `node scripts/journey-guard.mjs desk-uiform-label-language`.

## Status: LOCKED
