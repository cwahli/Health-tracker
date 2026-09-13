# C2 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 1 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: (none)
- Score: **PASS** (14 known / 0 unknown)

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
"05-Jun-2026","HbA1c levl - IFCC standardised","40 mmol/mol","20 - 41 mmol/mol","(AlyssaFRS) - 01. Satisfactory - No Action"
"05-Jun-2026","Serum creatinine","100 umol/L","64 - 104 umol/L",""
"05-Jun-2026","eGFRcreat (CKD-EPI)/1.73 m*2","80 mL/min/1.73m2","- mL/min/1.73m2","NA Note eGFR calculated using the CKD-EPI (2009 without ethnicity) equation."
"05-Jun-2026","Serum albumin","46 g/L","31 - 45 g/L",""
"05-Jun-2026","Serum ALT level","41 U/L","0 - 45 U/L",""
"05-Jun-2026","AST serum level","27 U/L","5 - 34 U/L",""
"05-Jun-2026","Serum total protein","81 g/L","60 - 80 g/L",""
"05-Jun-2026","Total white cell count","5.7 10*9/L","2.9 - 9.6 10*9/L",""
"05-Jun-2026","Red blood cell (RBC) count","5.47 10*12/L","4.20 - 5.80 10*12/L",""
"05-Jun-2026","Haemoglobin estimation","166 g/L","125 - 170 g/L",""
"05-Jun-2026","Haematocrit","0.48 L/L","0.390 - 0.510 L/L",""
"05-Jun-2026","Mean corpuscular volume (MCV)","88 fL","81 - 100 fL",""
"05-Jun-2026","Mean corpusc. haemoglobin(MCH)","30.3 pg","27.0 - 33.3 pg",""
"05-Jun-2026","Mean corpusc. Hb. conc. (MCHC)","346 g/L","310 - 350 g/L",""

Prior medical records:
- On 4 April 2024, HbA1c was 39 mmol/mol (annual GP checkup).
- US clinic visit on 10/15/2024: Serum creatinine was 1.1 mg/dL (annual routine check, US lab).
- On 12/10/2025, Serum creatinine was 95 umol/L (fasting morning sample).
- On June 1st, 2025, Serum ALT level was 35 U/L (baseline health check).
HbA1c levl - IFCC standardised  40 mmol/mol
Serum creatinine  100 umol/L
eGFRcreat (CKD-EPI)/1.73 m*2  80 mL/min/1.73m2
Serum albumin  46 g/L
Serum ALT level  41 U/L
AST serum level  27 U/L
Serum total protein  81 g/L
Total white cell count  5.7 10*9/L
Red blood cell (RBC) count  5.47 10*12/L
Haemoglobin estimation  166 g/L
Haematocrit  0.48 L/L
Mean corpuscular volume (MCV)  88 fL
Mean corpusc. haemoglobin(MCH)  30.3 pg
Mean corpusc. Hb. conc. (MCHC)  346 g/L
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| r01 | HbA1c levl - IFCC standardised | alias | observation | hba1c |
| r02 | Serum creatinine | alias | observation | creatinine |
| r03 | eGFRcreat (CKD-EPI)/1.73 m*2 | alias | observation | egfr |
| r04 | Serum albumin | key | observation | serum_albumin |
| r05 | Serum ALT level | alias | observation | alt |
| r06 | AST serum level | alias | observation | ast |
| r07 | Serum total protein | alias | observation | total_protein |
| r08 | Total white cell count | alias | observation | wbc |
| r09 | Red blood cell (RBC) count | alias | observation | rbc |
| r10 | Haemoglobin estimation | alias | observation | hemoglobin |
| r11 | Haematocrit | alias | observation | hematocrit |
| r12 | Mean corpuscular volume (MCV) | alias | observation | mean_corpuscular_volume |
| r13 | Mean corpusc. haemoglobin(MCH) | alias | observation | mean_corpuscular_hemoglobin |
| r14 | Mean corpusc. Hb. conc. (MCHC) | alias | observation | mean_corpuscular_hemoglobin_concentration |

## Agent turns (full payload sent + model output)

### Turn 1 (hit) — r01, r02, r03, r04, r05, r06, r07, r08, r09, r10, r11, r12, r13, r14 (14 rows, 7027ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
"05-Jun-2026","HbA1c levl - IFCC standardised","40 mmol/mol","20 - 41 mmol/mol","(AlyssaFRS) - 01. Satisfactory - No Action"
"05-Jun-2026","Serum creatinine","100 umol/L","64 - 104 umol/L",""
"05-Jun-2026","eGFRcreat (CKD-EPI)/1.73 m*2","80 mL/min/1.73m2","- mL/min/1.73m2","NA Note eGFR calculated using the CKD-EPI (2009 without ethnicity) equation."
"05-Jun-2026","Serum albumin","46 g/L","31 - 45 g/L",""
"05-Jun-2026","Serum ALT level","41 U/L","0 - 45 U/L",""
"05-Jun-2026","AST serum level","27 U/L","5 - 34 U/L",""
"05-Jun-2026","Serum total protein","81 g/L","60 - 80 g/L",""
"05-Jun-2026","Total white cell count","5.7 10*9/L","2.9 - 9.6 10*9/L",""
"05-Jun-2026","Red blood cell (RBC) count","5.47 10*12/L","4.20 - 5.80 10*12/L",""
"05-Jun-2026","Haemoglobin estimation","166 g/L","125 - 170 g/L",""
"05-Jun-2026","Haematocrit","0.48 L/L","0.390 - 0.510 L/L",""
"05-Jun-2026","Mean corpuscular volume (MCV)","88 fL","81 - 100 fL",""
"05-Jun-2026","Mean corpusc. haemoglobin(MCH)","30.3 pg","27.0 - 33.3 pg",""
"05-Jun-2026","Mean corpusc. Hb. conc. (MCHC)","346 g/L","310 - 350 g/L",""

Prior medical records:
- On 4 April 2024, HbA1c was 39 mmol/mol (annual GP checkup).
- US clinic visit on 10/15/2024: Serum creatinine was 1.1 mg/dL (annual routine check, US lab).
- On 12/10/2025, Serum creatinine was 95 umol/L (fasting morning sample).
- On June 1st, 2025, Serum ALT level was 35 U/L (baseline health check).
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
      },
      "previous": "39 mmol/mol"
    },
    {
      "id": "r02",
      "name": "Creatinine",
      "value": 100,
      "unit": "umol/L",
      "date": "2026-06-05",
      "range": "64 - 104 umol/L",
      "optimalValue": "80 umol/L",
      "existingInsight": "Serum creatinine is 100 umol/L, within the normal laboratory range.",
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "44 - 106",
        "unit": "umol/L",
        "description": "A waste product from muscle breakdown, filtered by kidneys."
      }
    },
    {
      "id": "r03",
      "name": "eGFR",
      "value": 80,
      "unit": "mL/min/1.73m2",
      "date": "2026-06-05",
      "range": ">= 60 mL/min/1.73m2",
      "optimalValue": "60 mL/min/1.73m2",
      "existingInsight": "Your eGFR of 80 is normal.",
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "over 90",
        "unit": "mL/min/1.73m²",
        "description": "Estimated Glomerular Filtration Rate, showing kidney health."
      }
    },
    {
      "id": "r04",
      "name": "Serum Albumin",
      "value": 46,
      "unit": "g/L",
      "date": "2026-06-05",
      "range": "31 - 45 g/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "35 - 50",
        "unit": "g/L",
        "description": "Main protein produced by the liver, keeping fluid balance in vessels."
      }
    },
    {
      "id": "r05",
      "name": "ALT (SGPT)",
      "value": 41,
      "unit": "U/L",
      "date": "2026-06-05",
      "range": "0 - 45 U/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "10 - 40",
        "unit": "U/L",
        "description": "Alanine Aminotransferase, an enzyme found mostly in the liver."
      }
    },
    {
      "id": "r06",
      "name": "AST (SGOT)",
      "value": 27,
      "unit": "U/L",
      "date": "2026-06-05",
      "range": "5 - 34 U/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "10 - 40",
        "unit": "U/L",
        "description": "Aspartate Aminotransferase, an enzyme found in liver and muscle."
      }
    },
    {
      "id": "r07",
      "name": "Total Protein",
      "value": 81,
      "unit": "g/L",
      "date": "2026-06-05",
      "range": "6 - 8 g/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "6 - 8 g/L",
        "unit": "g/L",
        "description": "Measures the total amount of protein in your blood."
      }
    },
    {
      "id": "r08",
      "name": "White Blood Cell (WBC)",
      "value": 5.7,
      "unit": "10*9/L",
      "date": "2026-06-05",
      "range": "2.9 - 9.6 10*9/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "4.5 - 11.0",
        "unit": "K/uL",
        "description": "Total white blood cell count for immune function."
      }
    },
    {
      "id": "r09",
      "name": "Red Blood Cell (RBC)",
      "value": 5.47,
      "unit": "10*12/L",
      "date": "2026-06-05",
      "range": "4.20 - 5.80 10*12/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "4.5 - 5.9",
        "unit": "M/uL",
        "description": "Total red blood cell count carrying oxygen to tissue."
      }
    },
    {
      "id": "r10",
      "name": "Hemoglobin",
      "value": 166,
      "unit": "g/L",
      "date": "2026-06-05",
      "range": "125 - 170 g/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "120 - 175",
        "unit": "g/L",
        "description": "Oxygen-carrying protein in red blood cells."
      }
    },
    {
      "id": "r11",
      "name": "Hematocrit",
      "value": 0.48,
      "unit": "L/L",
      "date": "2026-06-05",
      "range": "0.390 - 0.510 L/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "0.36 - 0.50",
        "unit": "L/L",
        "description": "The proportion of blood made up of red blood cells."
      }
    },
    {
      "id": "r12",
      "name": "Mean Corpuscular Volume (MCV)",
      "value": 88,
      "unit": "fL",
      "date": "2026-06-05",
      "range": "81 - 100 fL",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "80 - 100",
        "unit": "fL",
        "description": "Average volume or size of red blood cells."
      }
    },
    {
      "id": "r13",
      "name": "Mean Corpuscular Hemoglobin (MCH)",
      "value": 30.3,
      "unit": "pg",
      "date": "2026-06-05",
      "range": "27.0 - 33.3 pg",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "27 - 33",
        "unit": "pg",
        "description": "Average amount of hemoglobin per red blood cell."
      }
    },
    {
      "id": "r14",
      "name": "Mean Corpuscular Hemoglobin Concentration (MCHC)",
      "value": 346,
      "unit": "g/L",
      "date": "2026-06-05",
      "range": "310 - 350 g/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "320 - 360",
        "unit": "g/L",
        "description": "Average concentration of hemoglobin inside red blood cells."
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
    "medicalInsight": "Your HbA1c is 40 mmol/mol, showing a slight increase compared to 39 mmol/mol on 2024-04-04. For Chinese adults, an HbA1c of 39 mmol/mol or higher indicates an elevated prediabetes risk.",
    "optimalValue": "35 mmol/mol",
    "editReason": "Correct optimal value to reflect ideal non-diabetic target.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 40,
        "unit": "mmol/mol",
        "comment": "IFCC standardised"
      },
      {
        "date": "2024-04-04",
        "value": 39,
        "unit": "mmol/mol",
        "comment": "Annual GP checkup"
      }
    ],
    "customRangeOverlay": "[Chinese Ethnicity] Elevated (Prediabetes Risk): >=39; Optimal: <39",
    "dictionaryCorrection": null
  },
  {
    "id": "r02",
    "medicalInsight": "Your serum creatinine is 100 umol/L, which is within the normal laboratory range and consistent with previous readings of 97 umol/L on 2024-10-15 and 95 umol/L on 2025-12-10.",
    "optimalValue": "80 umol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 100,
        "unit": "umol/L",
        "comment": null
      },
      {
        "date": "2025-12-10",
        "value": 95,
        "unit": "umol/L",
        "comment": "Fasting morning sample"
      },
      {
        "date": "2024-10-15",
        "value": 97,
        "unit": "umol/L",
        "comment": "US lab"
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r03",
    "medicalInsight": "Your eGFR of 80 mL/min/1.73m2 indicates mildly decreased kidney function, though common in routine panels. The optimal target is adjusted to reflect normal physiological expectations above 90.",
    "optimalValue": "95 mL/min/1.73m2",
    "editReason": "Correcting naive normal eGFR threshold to proper clinical optimal target >=90.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 80,
        "unit": "mL/min/1.73m2",
        "comment": "Calculated using the CKD-EPI (2009 without ethnicity) equation"
      }
    ],
    "customRangeOverlay": "[Western Standard] CKD G2 (Mildly Decreased): 60-89; Optimal: >=90; Low: <60",
    "dictionaryCorrection": null
  },
  {
    "id": "r04",
    "medicalInsight": "Serum albumin is 46 g/L, which is slightly above the reference upper limit of 45 g/L but clinically stable.",
    "optimalValue": "43 g/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 46,
        "unit": "g/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r05",
    "medicalInsight": "Your serum ALT level is 41 U/L, showing a slight elevation compared to 35 U/L on 2025-06-01. Monitor for potential mild hepatic stress.",
    "optimalValue": "25 U/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 41,
        "unit": "U/L",
        "comment": null
      },
      {
        "date": "2025-06-01",
        "value": 35,
        "unit": "U/L",
        "comment": "Baseline health check"
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r06",
    "medicalInsight": "AST serum level is 27 U/L, well within the normal reference range, supporting normal liver and muscle tissue status.",
    "optimalValue": "20 U/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 27,
        "unit": "U/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r07",
    "medicalInsight": "Serum total protein is 81 g/L, slightly above the standard range. The dictionary range format was corrected from 6-8 g/L to 60-80 g/L.",
    "optimalValue": "70 g/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 81,
        "unit": "g/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": {
      "field": "normalRange",
      "correctedValue": "60 - 80",
      "reason": "Standard units for Total Protein are g/L with normal range typically 60-80 g/L, not 6-8 g/L."
    }
  },
  {
    "id": "r08",
    "medicalInsight": "Total white cell count is 5.7 10*9/L, indicating a normal immune cell profile.",
    "optimalValue": "6.0 10*9/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 5.7,
        "unit": "10*9/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r09",
    "medicalInsight": "Red blood cell count is 5.47 10*12/L, which falls comfortably within the expected adult range.",
    "optimalValue": "5.00 10*12/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 5.47,
        "unit": "10*12/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r10",
    "medicalInsight": "Haemoglobin estimation is 166 g/L, indicating optimal oxygen-carrying capacity without signs of anemia or polycythemia.",
    "optimalValue": "150 g/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 166,
        "unit": "g/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r11",
    "medicalInsight": "Haematocrit is 0.48 L/L, representing a normal proportion of red blood cells in circulation.",
    "optimalValue": "0.450 L/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 0.48,
        "unit": "L/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r12",
    "medicalInsight": "Mean corpuscular volume (MCV) is 88 fL, reflecting normal red blood cell sizing.",
    "optimalValue": "90 fL",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 88,
        "unit": "fL",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r13",
    "medicalInsight": "Mean corpuscular haemoglobin (MCH) is 30.3 pg, which is well within normal limits.",
    "optimalValue": "29.5 pg",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 30.3,
        "unit": "pg",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "r14",
    "medicalInsight": "Mean corpuscular Hb concentration (MCHC) is 346 g/L, confirming normal hemoglobin concentration inside the red blood cells.",
    "optimalValue": "335 g/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 346,
        "unit": "g/L",
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
| r01 | HbA1c levl - IFCC standardised | alias | observation | — | hba1c | — | — |
| r02 | Serum creatinine | alias | observation | — | creatinine | — | — |
| r03 | eGFRcreat (CKD-EPI)/1.73 m*2 | alias | observation | — | egfr | — | — |
| r04 | Serum albumin | key | observation | — | serum_albumin | — | — |
| r05 | Serum ALT level | alias | observation | — | alt | — | — |
| r06 | AST serum level | alias | observation | — | ast | — | — |
| r07 | Serum total protein | alias | observation | — | total_protein | — | — |
| r08 | Total white cell count | alias | observation | — | wbc | — | — |
| r09 | Red blood cell (RBC) count | alias | observation | — | rbc | — | — |
| r10 | Haemoglobin estimation | alias | observation | — | hemoglobin | — | — |
| r11 | Haematocrit | alias | observation | — | hematocrit | — | — |
| r12 | Mean corpuscular volume (MCV) | alias | observation | — | mean_corpuscular_volume | — | — |
| r13 | Mean corpusc. haemoglobin(MCH) | alias | observation | — | mean_corpuscular_hemoglobin | — | — |
| r14 | Mean corpusc. Hb. conc. (MCHC) | alias | observation | — | mean_corpuscular_hemoglobin_concentration | — | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
