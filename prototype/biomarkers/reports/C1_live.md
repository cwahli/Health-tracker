# C1 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 1 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: (none)
- Score: **PASS** (2 known / 0 unknown)

## System instruction (verbatim)

```
You are an expert clinical laboratory AI reviewing a patient's biomarker panel.
Patient Profile: 43-year-old Chinese male, Unit Preference: SI.
For each biomarker:
- id: matching id
- medicalInsight: Provide a concise, clinically accurate insight for every row (including optimal/normal baseline markers). Cite trend if previous values exist. Consider patient ethnography (e.g. for Chinese patients, HbA1c >=39 indicates elevated prediabetes risk). Never write Critical.
- customRangeOverlay: If agreeing with range, return null. If missing thresholds or ethnic demographics, provide FULL multi-bracket range specifying the profile source and clinical names. Format MUST be "[Profile] Clinical Name: Range; Clinical Name: Range". Example: "[Chinese Ethnicity] Elevated (Diabetes): >=48; Elevated: >=39; Optimal: <39" or "[Western Standard] High: >104; Normal: 64-104; Low: <64". If multiple demographic profiles exist, provide all of them.
- optimalValue: If existing is accurate, return "". Otherwise provide 1 single ideal target value without inequalities or ranges (e.g. "33 mmol/mol", "80 umol/L", "95 mL/min/1.73m2"; note 60 for eGFR is naive CKD G2, correct it). NEVER output a range with a dash like "20 - 41".
- editReason: If replacing/correcting existing user values or suboptimal optimalValue, explain why. Otherwise "". For eGFR, if correcting optimal from naive 60 to >= 90, you MUST provide an editReason explaining correction of naive normal eGFR.
- logs: Extract all logs with standardized "YYYY-MM-DD" dates, labName if mentioned (e.g. "US lab", "GP Clinic"), and comments. Convert US units to patient's unitPreference with standard clinical integer rounding (e.g. 1.1 mg/dL creatinine → 97 umol/L, not decimals like 97.24). Standardize scientific units (e.g. 10^9/L).
- DICTIONARY CORRECTION: If dictionary info has typos/errors (e.g. Total Protein 6-8 g/L instead of 60-80 g/L), output dictionaryCorrection: { field, correctedValue, reason }. Otherwise null.
- UNCATALOGED (MISS): If not in dictionary, output match="none", writeTarget="pending", key=null, and newCatalogDraft: { suggestedKey, name, unit, aliases, normalRange, description, riskCategories }. NOTE: normalRange MUST follow the same bracketed profile format with clinical names, e.g., "[Western Standard] High: >1.4; Optimal: 0.5-1.4; Low: <0.5".
JSON { "rows": [...] }.
```

## User send (once)

```
Hi, I got my bloods back. Haemoglobin A1c (IFCC) on 5 June 2026 was 40, and LDL 4.3. What does that mean for me?
Haemoglobin A1c (IFCC)  40 mmol/mol
LDL cholesterol  4.3 mmol/L
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| r01 | Haemoglobin A1c (IFCC) | alias | observation | hba1c |
| r02 | LDL cholesterol | alias | observation | ldl |

## Agent turns (full payload sent + model output)

### Turn 1 (hit) — r01, r02 (2 rows, 1484ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
Hi, I got my bloods back. Haemoglobin A1c (IFCC) on 5 June 2026 was 40, and LDL 4.3. What does that mean for me?
</user_upload>

Biomarkers to review (hits - in catalog):
{
  "biomarkers": [
    {
      "id": "r01",
      "name": "HbA1c",
      "value": 40,
      "unit": "mmol/mol",
      "date": "2026-06-05",
      "range": "20 - 41 mmol/mol",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "20 - 41",
        "unit": "mmol/mol",
        "description": "Average blood glucose levels over the past 2-3 months."
      }
    },
    {
      "id": "r02",
      "name": "LDL-C",
      "value": 4.3,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "[All patients] Very High: >3.4; Elevated: >2.6; Optimal: <=2.6",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "< 2.6",
        "unit": "mmol/L",
        "description": "Low-Density Lipoprotein, the \"bad\" cholesterol driving plaque."
      }
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "r01",
    "medicalInsight": "For a 43-year-old Chinese male, an HbA1c of 40 mmol/mol indicates an elevated prediabetes risk according to Chinese clinical thresholds.",
    "optimalValue": "34 mmol/mol",
    "editReason": "Providing a tailored optimal value and incorporating Chinese ethnic prediabetes risk thresholds (>=39 mmol/mol).",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 40,
        "unit": "mmol/mol",
        "comment": null
      }
    ],
    "customRangeOverlay": "[Chinese Ethnicity] Elevated (Prediabetes Risk): >=39; Optimal: <39; [Western Standard] Normal: 20-41; High: >41",
    "dictionaryCorrection": null
  },
  {
    "id": "r02",
    "medicalInsight": "LDL-C of 4.3 mmol/L is very high and indicates significantly elevated cardiovascular risk, requiring lifestyle and likely therapeutic intervention.",
    "optimalValue": "2.0 mmol/L",
    "editReason": "Providing an optimal therapeutic target for cardiovascular risk management.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 4.3,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| r01 | Haemoglobin A1c (IFCC) | alias | observation | — | hba1c | — | — |
| r02 | LDL cholesterol | alias | observation | — | ldl | — | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
