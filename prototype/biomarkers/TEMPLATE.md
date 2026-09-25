# Biomarker fill template (do not forget)

Single contract for prototype and later product. The agent does **not** invent this shape.

A row is a **view**. On apply it splits into catalog / overlay / observation / pending.

## Slots

| Slot | In dictionary | On user profile | Who fills | Agent may write? |
|---|---|---|---|---|
| Biomarker Name | Yes | No | Back-office prefill on alias/key hit | No (new-key draft only) |
| Key | Yes | No | `getMappedBiomarkerKey` | No (new-key draft only) |
| Alias | Yes | No | Prefill | Propose extra aliases only via `dictionaryCorrection` |
| Normal Range | Yes | No | Prefill population default | No |
| Unit | Yes | No | Prefill canonical unit | No (convert is TS table) |
| Description | Yes | No | Prefill | No |
| Risk Categories | Yes | No | Prefill | No |
| Not Used | Yes (retired) | Yes (hide-for-me) | Existing flag / user hide | Only if user asked to hide |
| Custom Range | Yes (population brackets) | Yes (overlay if this profile differs) | Prefill brackets; agent overlay | Overlay only, never catalog |
| Medical Insight | No | Yes | Agent | **Yes** — cite computed status; Optimal = one sentence; else status + profile + trend |
| Historical Logs | No | Yes | Intake + existing history | Add/edit/delete ops only |
| Current Evaluation Status | — | Derived | TypeScript (`getBiomarkerStatus` / brackets) | **Never** |

Dropped from fill: Clinical Reference Range (duplicate display), Medical Practice, Medical Conditions.

## Two processes

**Hit (already in dictionary)**  
Back-office locks name/key/aliases/range/unit/description/risks/population custom range, appends this log, computes status.  
Agent receives that snapshot + profile + logs and returns **only** `medicalInsight` (and overlay if `rangeVariesBy` / stale). It must not re-emit dictionary slots. Insight must use the injected status label (e.g. HbA1c 40 mmol/mol is **Elevated** from brackets `>=39`, not “above 20–41”). TypeScript sanitizes labels (total cholesterol 6.5 is **Very High**, never Critical; eGFR 80 is **Mildly Decreased (CKD G2)**). Optimal → one sentence; otherwise ≤2 sentences with age/sex/ethnicity and log trend.

**Miss (not in dictionary)**  
No prefill. Agent returns `newCatalogDraft` + pending. Not Home. Not approved.

## Example (HbA1c hit)

| Slot | Value | Source |
|---|---|---|
| Name | HbA1c | dictionary |
| Key | hba1c | dictionary |
| Alias | hba1cc; glycatedhaemoglobin; hemoglobin_a1c_mmol_mol; hba1c_mmol_mol; hemoglobin_a1c | dictionary |
| Normal Range | 20 - 41 | dictionary |
| Unit | mmol/mol | dictionary |
| Description | Glycated hemoglobin reflecting average blood glucose levels. | dictionary |
| Risk Categories | Metabolic; Cardiovascular; Screenings & Wellness | dictionary |
| Not Used | false | user/catalog flag |
| Custom Range | [All patients] Elevated (Diabetes): >=48; Elevated: >=39; Normal: >=20; … | dictionary brackets (overlay only if this profile differs) |
| Medical Insight | Elevated for a 43-year-old Chinese male; 39 → 40. Must not say 40 is outside 20–41. | user |
| Historical Logs | 2026-06-05: 40 · 2024-04-04: 39 | user |
| Status | Elevated | computed |

Turns (automated): TypeScript packs from `OUTPUT_TOKEN_BUDGET` in `template.ts`. Identified markers only emit insight, so more of them fit per turn than new-key drafts. The model does not decide batch size.

Code: `template.ts` (same slots). Instruction: `instruction.ts`.
