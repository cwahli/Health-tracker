# C3 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 2 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: r16-scorecard/.env
- Score: **FAIL** (9 known / 1 unknown)

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
"05-Jun-2026","Se prostate specific Ag level","1.41 ug/L","- 2.49 ug/L","(OlaFRS) - 01. Satisfactory - No Action The normal ranges provided are for patients who have a diagnostic PSA to detect prostate cancer. In patients
"05-Jun-2026","Serum sodium","143 mmol/L","133 - 146 mmol/L",""
"05-Jun-2026","Serum potassium","4.3 mmol/L","3.5 - 5.3 mmol/L",""
"05-Jun-2026","Serum alkaline phosphatase","39 U/L","30 - 130 U/L",""
"05-Jun-2026","Serum total bilirubin level","16 umol/L","- 21 umol/L",""
"05-Jun-2026","Serum globulin","35 g/L","22 - 38 g/L",""
"05-Jun-2026","Serum calcium","2.47 mmol/L","- mmol/L",""
"05-Jun-2026","Serum adjusted calcium conc","2.37 mmol/L","2.08 - 2.48 mmol/L","Please note new adjusted calcium equation and new adjusted calcium Abbott Alinity reference ranges in use from 22/09/25."
"05-Jun-2026","Serum inorganic phosphate","1.12 mmol/L","0.80 - 1.50 mmol/L",""
"05-Jun-2026","Homocysteine","10.2 umol/L","< 15.0 umol/L",""
Se prostate specific Ag level  1.41 ug/L
Serum sodium  143 mmol/L
Serum potassium  4.3 mmol/L
Serum alkaline phosphatase  39 U/L
Serum total bilirubin level  16 umol/L
Serum globulin  35 g/L
Serum calcium  2.47 mmol/L
Serum adjusted calcium conc  2.37 mmol/L
Serum inorganic phosphate  1.12 mmol/L
Homocysteine  10.2 umol/L
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| r01 | Se prostate specific Ag level | alias | observation | prostate_specific_antigen |
| r02 | Serum sodium | key | observation | serum_sodium |
| r03 | Serum potassium | key | observation | serum_potassium |
| r04 | Serum alkaline phosphatase | alias | observation | alkaline_phosphatase |
| r05 | Serum total bilirubin level | alias | observation | total_bilirubin |
| r06 | Serum globulin | key | observation | serum_globulin |
| r07 | Serum calcium | key | observation | serum_calcium |
| r08 | Serum adjusted calcium conc | alias | observation | serum_adjusted_calcium |
| r09 | Serum inorganic phosphate | key | observation | serum_inorganic_phosphate |
| r10 | Homocysteine | none | pending | — |

## Agent turns (full payload sent + model output)

### Turn 1 (hit) — r01, r02, r03, r04, r05, r06, r07, r08, r09 (9 rows, 3754ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
"05-Jun-2026","Se prostate specific Ag level","1.41 ug/L","- 2.49 ug/L","(OlaFRS) - 01. Satisfactory - No Action The normal ranges provided are for patients who have a diagnostic PSA to detect prostate cancer. In patients
"05-Jun-2026","Serum sodium","143 mmol/L","133 - 146 mmol/L",""
"05-Jun-2026","Serum potassium","4.3 mmol/L","3.5 - 5.3 mmol/L",""
"05-Jun-2026","Serum alkaline phosphatase","39 U/L","30 - 130 U/L",""
"05-Jun-2026","Serum total bilirubin level","16 umol/L","- 21 umol/L",""
"05-Jun-2026","Serum globulin","35 g/L","22 - 38 g/L",""
"05-Jun-2026","Serum calcium","2.47 mmol/L","- mmol/L",""
"05-Jun-2026","Serum adjusted calcium conc","2.37 mmol/L","2.08 - 2.48 mmol/L","Please note new adjusted calcium equation and new adjusted calcium Abbott Alinity reference ranges in use from 22/09/25."
"05-Jun-2026","Serum inorganic phosphate","1.12 mmol/L","0.80 - 1.50 mmol/L",""
"05-Jun-2026","Homocysteine","10.2 umol/L","< 15.0 umol/L",""
</user_upload>

Biomarkers to review (hits - in catalog):
{
  "biomarkers": [
    {
      "id": "r01",
      "name": "Prostate Specific Antigen",
      "value": 1.41,
      "unit": "ug/L",
      "date": "2026-06-05",
      "range": "- 2.49 ug/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "< 2.5",
        "unit": "ug/L",
        "description": "Glycoprotein enzyme produced by prostatic epithelium; utilized for prostate health screening."
      }
    },
    {
      "id": "r02",
      "name": "Serum Sodium",
      "value": 143,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "133 - 146 mmol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "135 - 145",
        "unit": "mmol/L",
        "description": "Primary extracellular electrolyte regulating osmotic pressure, blood volume, and membrane potential."
      }
    },
    {
      "id": "r03",
      "name": "Serum Potassium",
      "value": 4.3,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "3.5 - 5.3 mmol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "3.5 - 5.0",
        "unit": "mmol/L",
        "description": "Essential electrolyte regulating cardiac rhythm, neuromuscular transmission, and cellular fluid balance."
      }
    },
    {
      "id": "r04",
      "name": "Alkaline Phosphatase",
      "value": 39,
      "unit": "U/L",
      "date": "2026-06-05",
      "range": "30 - 130 U/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "30 - 130",
        "unit": "U/L",
        "description": "Hydrolase enzyme abundant in biliary canaliculi and osteoblasts; screens for cholestasis and bone turnover."
      }
    },
    {
      "id": "r05",
      "name": "Total Bilirubin",
      "value": 16,
      "unit": "umol/L",
      "date": "2026-06-05",
      "range": "- 21 umol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "3 - 21",
        "unit": "umol/L",
        "description": "Bile pigment derived from erythrocyte breakdown; evaluated for hepatobiliary clearance and hemolysis."
      }
    },
    {
      "id": "r06",
      "name": "Serum Globulin",
      "value": 35,
      "unit": "g/L",
      "date": "2026-06-05",
      "range": "22 - 38 g/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "20 - 35",
        "unit": "g/L",
        "description": "Serum proteins excluding albumin, comprising immunoglobulins, complement factors, and transport globulins."
      }
    },
    {
      "id": "r07",
      "name": "Serum Calcium",
      "value": 2.47,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "- mmol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "2.15 - 2.55",
        "unit": "mmol/L",
        "description": "Total serum calcium essential for mineralized bone matrix, cardiac excitation, and cell signaling."
      }
    },
    {
      "id": "r08",
      "name": "Serum Adjusted Calcium",
      "value": 2.37,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "2.08 - 2.48 mmol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "2.20 - 2.60",
        "unit": "mmol/L",
        "description": "Serum calcium adjusted for serum albumin concentration, reflecting physiological ionized calcium."
      }
    },
    {
      "id": "r09",
      "name": "Serum Inorganic Phosphate",
      "value": 1.12,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "0.80 - 1.50 mmol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "0.80 - 1.50",
        "unit": "mmol/L",
        "description": "Inorganic phosphate crucial for ATP bioenergetics, acid-base homeostasis, and hydroxyapatite bone crystal formation."
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
    "medicalInsight": "Prostate-specific antigen is within normal limits, indicating a satisfactory baseline for prostate health.",
    "optimalValue": "< 1.0 ug/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.41,
        "unit": "ug/L",
        "comment": "Satisfactory - No Action"
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r02",
    "medicalInsight": "Serum sodium is well-maintained within the normal physiological range, reflecting proper hydration and osmotic balance.",
    "optimalValue": "140 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 143,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r03",
    "medicalInsight": "Serum potassium level is optimal, supporting stable cardiac conduction and neuromuscular function.",
    "optimalValue": "4.2 mmol/L",
    "editReason": "",
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
  },
  {
    "id": "r04",
    "medicalInsight": "Alkaline phosphatase activity is within normal limits, suggesting healthy hepatobiliary and bone turnover status.",
    "optimalValue": "65 U/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 39,
        "unit": "U/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r05",
    "medicalInsight": "Total bilirubin is normal, indicating normal hepatic clearance and red blood cell turnover.",
    "optimalValue": "10 umol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 16,
        "unit": "umol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r06",
    "medicalInsight": "Serum globulin concentration is within the expected range, reflecting normal immune protein synthesis.",
    "optimalValue": "28 g/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 35,
        "unit": "g/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r07",
    "medicalInsight": "Total serum calcium is normal, supporting healthy skeletal mineralization and cellular signaling.",
    "optimalValue": "2.35 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.47,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r08",
    "medicalInsight": "Serum adjusted calcium is within normal limits, indicating stable physiologically active calcium levels.",
    "optimalValue": "2.30 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.37,
        "unit": "mmol/L",
        "comment": "Please note new adjusted calcium equation and new adjusted calcium Abbott Alinity reference ranges in use from 22/09/25."
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r09",
    "medicalInsight": "Inorganic phosphate is normal, assuring proper energy metabolism and bone mineral homeostasis.",
    "optimalValue": "1.10 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.12,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  }
]
```

### Turn 2 (miss) — r10 (1 rows, 1785ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
"05-Jun-2026","Se prostate specific Ag level","1.41 ug/L","- 2.49 ug/L","(OlaFRS) - 01. Satisfactory - No Action The normal ranges provided are for patients who have a diagnostic PSA to detect prostate cancer. In patients
"05-Jun-2026","Serum sodium","143 mmol/L","133 - 146 mmol/L",""
"05-Jun-2026","Serum potassium","4.3 mmol/L","3.5 - 5.3 mmol/L",""
"05-Jun-2026","Serum alkaline phosphatase","39 U/L","30 - 130 U/L",""
"05-Jun-2026","Serum total bilirubin level","16 umol/L","- 21 umol/L",""
"05-Jun-2026","Serum globulin","35 g/L","22 - 38 g/L",""
"05-Jun-2026","Serum calcium","2.47 mmol/L","- mmol/L",""
"05-Jun-2026","Serum adjusted calcium conc","2.37 mmol/L","2.08 - 2.48 mmol/L","Please note new adjusted calcium equation and new adjusted calcium Abbott Alinity reference ranges in use from 22/09/25."
"05-Jun-2026","Serum inorganic phosphate","1.12 mmol/L","0.80 - 1.50 mmol/L",""
"05-Jun-2026","Homocysteine","10.2 umol/L","< 15.0 umol/L",""
</user_upload>

Biomarkers to review (misses - uncataloged, draft catalog entry):
{
  "biomarkers": [
    {
      "id": "r10",
      "name": "Homocysteine",
      "value": 10.2,
      "unit": "umol/L",
      "date": "2026-06-05",
      "range": "< 15.0 umol/L"
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "r10",
    "medicalInsight": "Homocysteine level of 10.2 umol/L is optimal and within the normal reference range, indicating healthy one-carbon metabolism and adequate B-vitamin status for this 43-year-old male.",
    "optimalValue": "8.0 umol/L",
    "editReason": "Provided a specific optimal target for cardiovascular health rather than just an upper limit.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 10.2,
        "unit": "umol/L",
        "comment": null
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "homocysteine",
      "name": "Homocysteine",
      "unit": "umol/L",
      "aliases": [
        "Serum Homocysteine",
        "Hcy"
      ],
      "normalRange": "[Western Standard] High: >=15.0; Optimal: <15.0",
      "description": "An amino acid in the blood whose elevated levels are associated with a higher risk of heart disease, stroke, and vitamin B deficiencies.",
      "riskCategories": [
        "Cardiovascular",
        "Metabolic",
        "Neurological"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >=15.0; Optimal: <15.0"
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| r01 | Se prostate specific Ag level | alias | observation | — | prostate_specific_antigen | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r02 | Serum sodium | key | observation | — | serum_sodium | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r03 | Serum potassium | key | observation | — | serum_potassium | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r04 | Serum alkaline phosphatase | alias | observation | — | alkaline_phosphatase | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r05 | Serum total bilirubin level | alias | observation | — | total_bilirubin | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r06 | Serum globulin | key | observation | — | serum_globulin | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r07 | Serum calcium | key | observation | — | serum_calcium | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r08 | Serum adjusted calcium conc | alias | observation | — | serum_adjusted_calcium | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r09 | Serum inorganic phosphate | key | observation | — | serum_inorganic_phosphate | — | writeTarget, match, unknown_not_existing_key, newCatalogDraft |
| r10 | Homocysteine | none | pending | — | — | homocysteine | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
