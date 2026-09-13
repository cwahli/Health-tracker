# C6 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 4 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: (none)
- Score: **PASS** (24 known / 15 unknown)

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
Log these GP results
HbA1c levl - IFCC standardised  40 mmol/mol
Se prostate specific Ag level  1.41 ug/L
Serum sodium  143 mmol/L
Serum potassium  4.3 mmol/L
Serum creatinine  100 umol/L
eGFRcreat (CKD-EPI)/1.73 m*2  80 mL/min/1.73m2
Serum albumin  46 g/L
Serum ALT level  41 U/L
Serum alkaline phosphatase  39 U/L
AST serum level  27 U/L
Serum total bilirubin level  16 umol/L
Serum total protein  81 g/L
Serum globulin  35 g/L
Serum calcium  2.47 mmol/L
Serum adjusted calcium conc  2.37 mmol/L
Serum inorganic phosphate  1.12 mmol/L
Total white cell count  5.7 10*9/L
Red blood cell (RBC) count  5.47 10*12/L
Haemoglobin estimation  166 g/L
Haematocrit  0.48 L/L
Mean corpuscular volume (MCV)  88 fL
Mean corpusc. haemoglobin(MCH)  30.3 pg
Mean corpusc. Hb. conc. (MCHC)  346 g/L
Red blood cell distribut width  11.8 %
Platelet count  227 10*9/L
Mean platelet volume  10.6 fL
Platelet distribution width  12.9 fL
Neutrophil count  3.18 10*9/L
Eosinophil count  0.07 10*9/L
Basophil count  0.04 10*9/L
Nucleated red blood cell count  0 10*9/L
QRISK2 cardiovascular disease 10 year risk score  1.2 %
Serum cholesterol  6.5 mmol/L
Serum HDL cholesterol level  1.5 mmol/L
Serum triglycerides  1.7 mmol/L
Se non HDL cholesterol level  5 mmol/L
Serum cholesterol/HDL ratio  4.3 
Calculated LDL cholesterol lev  4.3 mmol/L
QRISK2 cardiovascular disease 10 year risk score  1.2 %
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| img_1 | HbA1c levl - IFCC standardised | alias | observation | hba1c |
| img_2 | Se prostate specific Ag level | none | pending | — |
| img_3 | Serum sodium | none | pending | — |
| img_4 | Serum potassium | none | pending | — |
| img_5 | Serum creatinine | alias | observation | creatinine |
| img_6 | eGFRcreat (CKD-EPI)/1.73 m*2 | alias | observation | egfr |
| img_7 | Serum albumin | key | observation | serum_albumin |
| img_8 | Serum ALT level | alias | observation | alt |
| img_9 | Serum alkaline phosphatase | none | pending | — |
| img_10 | AST serum level | alias | observation | ast |
| img_11 | Serum total bilirubin level | none | pending | — |
| img_12 | Serum total protein | alias | observation | total_protein |
| img_13 | Serum globulin | none | pending | — |
| img_14 | Serum calcium | none | pending | — |
| img_15 | Serum adjusted calcium conc | none | pending | — |
| img_16 | Serum inorganic phosphate | none | pending | — |
| img_17 | Total white cell count | alias | observation | wbc |
| img_18 | Red blood cell (RBC) count | alias | observation | rbc |
| img_19 | Haemoglobin estimation | alias | observation | hemoglobin |
| img_20 | Haematocrit | alias | observation | hematocrit |
| img_21 | Mean corpuscular volume (MCV) | alias | observation | mean_corpuscular_volume |
| img_22 | Mean corpusc. haemoglobin(MCH) | alias | observation | mean_corpuscular_hemoglobin |
| img_23 | Mean corpusc. Hb. conc. (MCHC) | alias | observation | mean_corpuscular_hemoglobin_concentration |
| img_24 | Red blood cell distribut width | alias | observation | rdw |
| img_25 | Platelet count | alias | observation | platelets |
| img_26 | Mean platelet volume | alias | observation | mpv |
| img_27 | Platelet distribution width | none | pending | — |
| img_28 | Neutrophil count | key | observation | neutrophil_count |
| img_29 | Eosinophil count | key | observation | eosinophil_count |
| img_30 | Basophil count | key | observation | basophil_count |
| img_31 | Nucleated red blood cell count | none | pending | — |
| img_32 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — |
| img_33 | Serum cholesterol | alias | observation | total_cholesterol |
| img_34 | Serum HDL cholesterol level | alias | observation | hdl |
| img_35 | Serum triglycerides | alias | observation | triglycerides |
| img_36 | Se non HDL cholesterol level | none | pending | — |
| img_37 | Serum cholesterol/HDL ratio | none | pending | — |
| img_38 | Calculated LDL cholesterol lev | alias | observation | ldl |
| img_39 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — |

## Agent turns (full payload sent + model output)

### Turn 1 (hit) — img_1, img_5, img_6, img_7, img_8, img_10, img_12, img_17, img_18, img_19, img_20, img_21, img_22, img_23, img_24, img_25, img_26, img_28, img_29, img_30 (20 rows, 7900ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
Log these GP results
</user_upload>

Biomarkers to review (hits - in catalog):
{
  "biomarkers": [
    {
      "id": "img_1",
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
      "id": "img_5",
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
      "id": "img_6",
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
      "id": "img_7",
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
      "id": "img_8",
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
      "id": "img_10",
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
      "id": "img_12",
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
      "id": "img_17",
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
      "id": "img_18",
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
      "id": "img_19",
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
      "id": "img_20",
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
      "id": "img_21",
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
      "id": "img_22",
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
      "id": "img_23",
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
    },
    {
      "id": "img_24",
      "name": "Red Cell Distribution Width (RDW)",
      "value": 11.8,
      "unit": "%",
      "date": "2026-06-05",
      "range": "10.5 - 16.0 %",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "11.5 - 14.5",
        "unit": "%",
        "description": "Measurement of the variation in red blood cell size and volume."
      }
    },
    {
      "id": "img_25",
      "name": "Platelets",
      "value": 227,
      "unit": "10*9/L",
      "date": "2026-06-05",
      "range": "140 - 400 10*9/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "150 - 450",
        "unit": "K/uL",
        "description": "Cells responsible for blood clotting and wound repair."
      }
    },
    {
      "id": "img_26",
      "name": "Mean Platelet Volume (MPV)",
      "value": 10.6,
      "unit": "fL",
      "date": "2026-06-05",
      "range": "[All patients] Elevated: >13; Normal: <=13",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "7.5 - 11.5",
        "unit": "fL",
        "description": "Mean Platelet Volume, measuring the average physical volume of circulating thrombocytes for bone marrow platelet production."
      }
    },
    {
      "id": "img_28",
      "name": "Neutrophils",
      "value": 3.18,
      "unit": "10*9/L",
      "date": "2026-06-05",
      "range": "1.50 - 6.10 10*9/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "2.0 - 7.5",
        "unit": "10^9/L",
        "description": "Essential white blood cells for fighting bacterial infections."
      }
    },
    {
      "id": "img_29",
      "name": "Eosinophils",
      "value": 0.07,
      "unit": "10*9/L",
      "date": "2026-06-05",
      "range": "0.00 - 0.40 10*9/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "0.02 - 0.50",
        "unit": "10^9/L",
        "description": "White blood cells involved in allergic responses and parasitic defense."
      }
    },
    {
      "id": "img_30",
      "name": "Basophils",
      "value": 0.04,
      "unit": "10*9/L",
      "date": "2026-06-05",
      "range": "0.00 - 0.10 10*9/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "0.0 - 0.1",
        "unit": "10^9/L",
        "description": "Granulocytes responsible for histamine release and inflammatory reactions."
      }
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "img_1",
    "medicalInsight": "Your HbA1c is 40 mmol/mol, which is within the optimal range for glycemic control.",
    "optimalValue": "35 mmol/mol",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 40,
        "unit": "mmol/mol",
        "comment": null
      }
    ],
    "customRangeOverlay": "[Chinese Ethnicity] Elevated (Prediabetes Risk): >=39; Optimal: <39; Low: <20",
    "dictionaryCorrection": null
  },
  {
    "id": "img_5",
    "medicalInsight": "Serum creatinine is 100 umol/L, within the normal laboratory range.",
    "optimalValue": "80 umol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 100,
        "unit": "umol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_6",
    "medicalInsight": "Your eGFR of 80 mL/min/1.73m2 indicates mild reduction in filtration capacity relative to optimal young adult baselines.",
    "optimalValue": "95 mL/min/1.73m2",
    "editReason": "Corrected naive optimal threshold of 60 to optimal target >=90 for young adults.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 80,
        "unit": "mL/min/1.73m2",
        "comment": null
      }
    ],
    "customRangeOverlay": "[Western Standard] Optimal: >=90; Normal: 60-89; Low: <60",
    "dictionaryCorrection": null
  },
  {
    "id": "img_7",
    "medicalInsight": "Serum albumin is 46 g/L, reflecting normal hepatic protein synthesis and hydration status.",
    "optimalValue": "45 g/L",
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
    "id": "img_8",
    "medicalInsight": "ALT is 41 U/L, sitting slightly above standard optimal thresholds but within broad normal ranges.",
    "optimalValue": "25 U/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 41,
        "unit": "U/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_10",
    "medicalInsight": "AST is 27 U/L, well within normal limits indicating healthy hepatic and muscular tissue.",
    "optimalValue": "22 U/L",
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
    "id": "img_12",
    "medicalInsight": "Total Protein is 81 g/L, marginally above the standard reference range.",
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
    "customRangeOverlay": "[Western Standard] High: >80; Normal: 60-80; Low: <60",
    "dictionaryCorrection": {
      "field": "normalRange",
      "correctedValue": "60 - 80",
      "reason": "Dictionary had a severe typo specifying 6-8 g/L instead of physiological 60-80 g/L."
    }
  },
  {
    "id": "img_17",
    "medicalInsight": "White blood cell count is 5.7 10*9/L, representing normal immune function.",
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
    "id": "img_18",
    "medicalInsight": "Red blood cell count is 5.47 10*12/L, indicating normal erythropoiesis.",
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
    "id": "img_19",
    "medicalInsight": "Hemoglobin is 166 g/L, within the normal range for adult males.",
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
    "id": "img_20",
    "medicalInsight": "Hematocrit is 0.48 L/L, showing normal proportion of red blood cells in circulation.",
    "optimalValue": "0.45 L/L",
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
    "id": "img_21",
    "medicalInsight": "Mean Corpuscular Volume is 88 fL, reflecting normal red blood cell sizing.",
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
    "id": "img_22",
    "medicalInsight": "Mean Corpuscular Hemoglobin is 30.3 pg, normal for hemoglobin content per cell.",
    "optimalValue": "30.0 pg",
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
    "id": "img_23",
    "medicalInsight": "Mean Corpuscular Hemoglobin Concentration is 346 g/L, well within reference limits.",
    "optimalValue": "340 g/L",
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
  },
  {
    "id": "img_24",
    "medicalInsight": "Red Cell Distribution Width is 11.8 %, indicating uniform red blood cell volume.",
    "optimalValue": "12.5 %",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 11.8,
        "unit": "%",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_25",
    "medicalInsight": "Platelet count is 227 10*9/L, showing normal clotting function.",
    "optimalValue": "250 10*9/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 227,
        "unit": "10*9/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_26",
    "medicalInsight": "Mean Platelet Volume is 10.6 fL, which is within the normal range.",
    "optimalValue": "9.5 fL",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 10.6,
        "unit": "fL",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_28",
    "medicalInsight": "Neutrophil count is 3.18 10*9/L, reflecting normal antibacterial defense.",
    "optimalValue": "3.50 10*9/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 3.18,
        "unit": "10*9/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_29",
    "medicalInsight": "Eosinophil count is 0.07 10*9/L, within normal baseline limits.",
    "optimalValue": "0.15 10*9/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 0.07,
        "unit": "10*9/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_30",
    "medicalInsight": "Basophil count is 0.04 10*9/L, normal for inflammatory regulation.",
    "optimalValue": "0.02 10*9/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 0.04,
        "unit": "10*9/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  }
]
```

### Turn 2 (hit) — img_33, img_34, img_35, img_38 (4 rows, 5187ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
Log these GP results
</user_upload>

Biomarkers to review (hits - in catalog):
{
  "biomarkers": [
    {
      "id": "img_33",
      "name": "Total Cholesterol",
      "value": 6.5,
      "unit": "mmol/L",
      "date": "2026-06-03",
      "range": "[All patients] Very High: >6.2; Elevated: >5; Optimal: <=5",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "Aim under 5.0",
        "unit": "mmol/L",
        "description": "Total amount of cholesterol in the blood."
      }
    },
    {
      "id": "img_34",
      "name": "HDL-C",
      "value": 1.5,
      "unit": "mmol/L",
      "date": "2026-06-03",
      "range": "0.9 - 1.7 mmol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "0.9 - 1.7",
        "unit": "mmol/L",
        "description": "High-Density Lipoprotein, the \"good\" cholesterol removing excess lipids."
      }
    },
    {
      "id": "img_35",
      "name": "Triglycerides",
      "value": 1.7,
      "unit": "mmol/L",
      "date": "2026-06-03",
      "range": "[All patients] Very High: >=5.6; Elevated: >=1.7; Optimal: <1.7",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "< 1.7",
        "unit": "mmol/L",
        "description": "Type of fat in the blood used for energy storage."
      }
    },
    {
      "id": "img_38",
      "name": "LDL-C",
      "value": 4.3,
      "unit": "mmol/L",
      "date": "2026-06-03",
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
    "id": "img_33",
    "medicalInsight": "Total cholesterol is elevated at 6.5 mmol/L, indicating increased cardiovascular risk for a 43-year-old male. Lifestyle modification and further lipid profile evaluation are recommended.",
    "optimalValue": "4.5 mmol/L",
    "editReason": "Corrected optimal target to a clinically robust cardiovascular prevention goal.",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 6.5,
        "unit": "mmol/L",
        "comment": "GP results"
      }
    ],
    "customRangeOverlay": "[All patients] Very High: >6.2; Elevated: >5.0; Optimal: <=5.0",
    "dictionaryCorrection": {
      "field": "normalRange",
      "correctedValue": "[All patients] Very High: >6.2; Elevated: >5.0; Optimal: <=5.0",
      "reason": "Standardize dictionary format to structured multi-bracket clinical thresholds."
    }
  },
  {
    "id": "img_34",
    "medicalInsight": "HDL-C is optimal at 1.5 mmol/L, providing a protective cardiovascular effect.",
    "optimalValue": "1.6 mmol/L",
    "editReason": "Added optimal target for cardioprotection.",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 1.5,
        "unit": "mmol/L",
        "comment": "GP results"
      }
    ],
    "customRangeOverlay": "[All patients] High: >1.7; Normal: 0.9-1.7; Low: <0.9",
    "dictionaryCorrection": {
      "field": "normalRange",
      "correctedValue": "[All patients] High: >1.7; Normal: 0.9-1.7; Low: <0.9",
      "reason": "Standardize unstructured range into multi-bracket format."
    }
  },
  {
    "id": "img_35",
    "medicalInsight": "Triglycerides are borderline elevated at 1.7 mmol/L, which warrants monitoring alongside dietary patterns and physical activity.",
    "optimalValue": "1.2 mmol/L",
    "editReason": "Set optimal target below the standard threshold for cardiovascular wellness.",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 1.7,
        "unit": "mmol/L",
        "comment": "GP results"
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_38",
    "medicalInsight": "LDL-C is elevated at 4.3 mmol/L, representing the primary atherogenic driver requiring targeted management.",
    "optimalValue": "2.5 mmol/L",
    "editReason": "Set optimal target to reflect primary prevention goals for male adults.",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 4.3,
        "unit": "mmol/L",
        "comment": "GP results"
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  }
]
```

### Turn 3 (miss) — img_2, img_3, img_4, img_9, img_11, img_13, img_14, img_15, img_16, img_27, img_31, img_32 (12 rows, 9569ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
Log these GP results
</user_upload>

Biomarkers to review (misses - uncataloged, draft catalog entry):
{
  "biomarkers": [
    {
      "id": "img_2",
      "name": "Se prostate specific Ag level",
      "value": 1.41,
      "unit": "ug/L",
      "date": "2026-06-05",
      "range": "- 2.49 ug/L"
    },
    {
      "id": "img_3",
      "name": "Serum sodium",
      "value": 143,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "133 - 146 mmol/L"
    },
    {
      "id": "img_4",
      "name": "Serum potassium",
      "value": 4.3,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "3.5 - 5.3 mmol/L"
    },
    {
      "id": "img_9",
      "name": "Serum alkaline phosphatase",
      "value": 39,
      "unit": "U/L",
      "date": "2026-06-05",
      "range": "30 - 130 U/L"
    },
    {
      "id": "img_11",
      "name": "Serum total bilirubin level",
      "value": 16,
      "unit": "umol/L",
      "date": "2026-06-05",
      "range": "- 21 umol/L"
    },
    {
      "id": "img_13",
      "name": "Serum globulin",
      "value": 35,
      "unit": "g/L",
      "date": "2026-06-05",
      "range": "22 - 38 g/L"
    },
    {
      "id": "img_14",
      "name": "Serum calcium",
      "value": 2.47,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "- mmol/L"
    },
    {
      "id": "img_15",
      "name": "Serum adjusted calcium conc",
      "value": 2.37,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "2.08 - 2.48 mmol/L"
    },
    {
      "id": "img_16",
      "name": "Serum inorganic phosphate",
      "value": 1.12,
      "unit": "mmol/L",
      "date": "2026-06-05",
      "range": "0.80 - 1.50 mmol/L"
    },
    {
      "id": "img_27",
      "name": "Platelet distribution width",
      "value": 12.9,
      "unit": "fL",
      "date": "2026-06-05",
      "range": "8.3 - 18.0 fL"
    },
    {
      "id": "img_31",
      "name": "Nucleated red blood cell count",
      "value": 0,
      "unit": "10*9/L",
      "date": "2026-06-05",
      "range": "0.00 - 0.01 10*9/L"
    },
    {
      "id": "img_32",
      "name": "QRISK2 cardiovascular disease 10 year risk score",
      "value": 1.2,
      "unit": "%",
      "date": "2026-06-04",
      "range": "- %"
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "img_2",
    "medicalInsight": "Prostate specific antigen level is within the optimal reference range, indicating low risk of prostate pathology for a 43-year-old male.",
    "optimalValue": "1.0 ug/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.41,
        "unit": "ug/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "se_prostate_specific_ag_level",
      "name": "Se prostate specific Ag level",
      "unit": "ug/L",
      "aliases": [
        "PSA",
        "Prostate Specific Antigen"
      ],
      "normalRange": "[Western Standard] High: >2.49; Optimal: <=2.49; Low: <0.0",
      "description": "Measures the concentration of prostate-specific antigen in the blood, used for prostate health screening.",
      "riskCategories": [
        "Prostate Health"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >2.49; Optimal: 0.0-2.49"
  },
  {
    "id": "img_3",
    "medicalInsight": "Serum sodium is well within normal physiological limits, reflecting normal hydration and electrolyte balance.",
    "optimalValue": "140 mmol/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 143,
        "unit": "mmol/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_sodium",
      "name": "Serum sodium",
      "unit": "mmol/L",
      "aliases": [
        "Sodium",
        "Na+"
      ],
      "normalRange": "[Western Standard] High: >146; Normal: 133-146; Low: <133",
      "description": "Primary extracellular electrolyte crucial for fluid balance, nerve conduction, and muscle function.",
      "riskCategories": [
        "Electrolytes",
        "Hydration"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >146; Normal: 133-146; Low: <133"
  },
  {
    "id": "img_4",
    "medicalInsight": "Serum potassium level is optimal, supporting normal cardiac and neuromuscular function.",
    "optimalValue": "4.2 mmol/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 4.3,
        "unit": "mmol/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_potassium",
      "name": "Serum potassium",
      "unit": "mmol/L",
      "aliases": [
        "Potassium",
        "K+"
      ],
      "normalRange": "[Western Standard] High: >5.3; Normal: 3.5-5.3; Low: <3.5",
      "description": "Primary intracellular electrolyte vital for maintaining normal cardiac rhythm and cellular potential.",
      "riskCategories": [
        "Electrolytes",
        "Cardiovascular"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >5.3; Normal: 3.5-5.3; Low: <3.5"
  },
  {
    "id": "img_9",
    "medicalInsight": "Alkaline phosphatase is within the normal range, indicating healthy liver and bone metabolism.",
    "optimalValue": "70 U/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 39,
        "unit": "U/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_alkaline_phosphatase",
      "name": "Serum alkaline phosphatase",
      "unit": "U/L",
      "aliases": [
        "ALP",
        "Alkaline Phosphatase"
      ],
      "normalRange": "[Western Standard] High: >130; Normal: 30-130; Low: <30",
      "description": "Enzyme associated with the biliary tract, liver, and bone tissue turnover.",
      "riskCategories": [
        "Liver Function",
        "Bone Health"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >130; Normal: 30-130; Low: <30"
  },
  {
    "id": "img_11",
    "medicalInsight": "Total bilirubin level is normal, suggesting healthy hepatic processing and red blood cell turnover.",
    "optimalValue": "10 umol/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 16,
        "unit": "umol/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_total_bilirubin_level",
      "name": "Serum total bilirubin level",
      "unit": "umol/L",
      "aliases": [
        "Total Bilirubin",
        "Bilirubin"
      ],
      "normalRange": "[Western Standard] High: >21; Optimal: <=21; Low: <0",
      "description": "Yellow breakdown product of normal heme catabolism, excreted by the liver.",
      "riskCategories": [
        "Liver Function"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >21; Optimal: 0-21"
  },
  {
    "id": "img_13",
    "medicalInsight": "Serum globulin is within the normal range, indicating a well-balanced immune and protein status.",
    "optimalValue": "28 g/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 35,
        "unit": "g/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_globulin",
      "name": "Serum globulin",
      "unit": "g/L",
      "aliases": [
        "Globulins"
      ],
      "normalRange": "[Western Standard] High: >38; Normal: 22-38; Low: <22",
      "description": "Group of blood proteins including enzymes, antibodies, and transport proteins.",
      "riskCategories": [
        "Protein Status",
        "Liver Function"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >38; Normal: 22-38; Low: <22"
  },
  {
    "id": "img_14",
    "medicalInsight": "Serum calcium is normal, supporting optimal skeletal and cellular signaling functions.",
    "optimalValue": "2.35 mmol/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.47,
        "unit": "mmol/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_calcium",
      "name": "Serum calcium",
      "unit": "mmol/L",
      "aliases": [
        "Calcium",
        "Ca"
      ],
      "normalRange": "[Western Standard] High: >2.60; Normal: 2.15-2.60; Low: <2.15",
      "description": "Essential mineral for bone structure, vascular contraction, muscle function, and nerve transmission.",
      "riskCategories": [
        "Bone Health",
        "Electrolytes"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >2.60; Normal: 2.15-2.60; Low: <2.15"
  },
  {
    "id": "img_15",
    "medicalInsight": "Adjusted calcium concentration is well within normal limits, reflecting stable protein-corrected calcium balance.",
    "optimalValue": "2.30 mmol/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.37,
        "unit": "mmol/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_adjusted_calcium_conc",
      "name": "Serum adjusted calcium conc",
      "unit": "mmol/L",
      "aliases": [
        "Corrected Calcium",
        "Adjusted Calcium"
      ],
      "normalRange": "[Western Standard] High: >2.48; Normal: 2.08-2.48; Low: <2.08",
      "description": "Total serum calcium adjusted for variations in serum albumin levels.",
      "riskCategories": [
        "Bone Health",
        "Electrolytes"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >2.48; Normal: 2.08-2.48; Low: <2.08"
  },
  {
    "id": "img_16",
    "medicalInsight": "Serum inorganic phosphate is optimal, supporting energy metabolism and bone homeostasis.",
    "optimalValue": "1.10 mmol/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.12,
        "unit": "mmol/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_inorganic_phosphate",
      "name": "Serum inorganic phosphate",
      "unit": "mmol/L",
      "aliases": [
        "Phosphate",
        "Phosphorus"
      ],
      "normalRange": "[Western Standard] High: >1.50; Normal: 0.80-1.50; Low: <0.80",
      "description": "Essential mineral involved in bone mineralization, energy storage, and acid-base balance.",
      "riskCategories": [
        "Bone Health",
        "Metabolism"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >1.50; Normal: 0.80-1.50; Low: <0.80"
  },
  {
    "id": "img_27",
    "medicalInsight": "Platelet distribution width is normal, suggesting uniform platelet production.",
    "optimalValue": "12.0 fL",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 12.9,
        "unit": "fL",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "platelet_distribution_width",
      "name": "Platelet distribution width",
      "unit": "fL",
      "aliases": [
        "PDW"
      ],
      "normalRange": "[Western Standard] High: >18.0; Normal: 8.3-18.0; Low: <8.3",
      "description": "Indicates variation in platelet size, useful in evaluating thrombopoiesis.",
      "riskCategories": [
        "Hematology"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >18.0; Normal: 8.3-18.0; Low: <8.3"
  },
  {
    "id": "img_31",
    "medicalInsight": "Nucleated red blood cell count is within normal limits, showing effective bone marrow erythropoiesis.",
    "optimalValue": "0.0 10*9/L",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-05",
        "value": 0,
        "unit": "10*9/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "nucleated_red_blood_cell_count",
      "name": "Nucleated red blood cell count",
      "unit": "10*9/L",
      "aliases": [
        "NRBC",
        "Normoblast Count"
      ],
      "normalRange": "[Western Standard] High: >0.01; Normal: 0.00-0.01; Low: <0.00",
      "description": "Immature red blood cells occasionally seen in peripheral blood during extreme marrow stress or hemolysis.",
      "riskCategories": [
        "Hematology"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >0.01; Normal: 0.00-0.01; Low: <0.00"
  },
  {
    "id": "img_32",
    "medicalInsight": "QRISK2 cardiovascular disease 10-year risk score is low, indicating favorable long-term cardiovascular health.",
    "optimalValue": "1.0 %",
    "editReason": null,
    "logs": [
      {
        "date": "2026-06-04",
        "value": 1.2,
        "unit": "%",
        "comment": "GP cardiovascular assessment"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "qrisk2_cardiovascular_disease_10_year_risk_score",
      "name": "QRISK2 cardiovascular disease 10 year risk score",
      "unit": "%",
      "aliases": [
        "QRISK2",
        "10-Year CVD Risk"
      ],
      "normalRange": "[Western Standard] High: >=10.0; Moderate: 5.0-9.9; Optimal: <5.0",
      "description": "Calculates the percentage risk of developing cardiovascular disease over a 10-year period.",
      "riskCategories": [
        "Cardiovascular"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >=10.0; Moderate: 5.0-9.9; Optimal: <5.0"
  }
]
```

### Turn 4 (miss) — img_36, img_37, img_39 (3 rows, 3411ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
Log these GP results
</user_upload>

Biomarkers to review (misses - uncataloged, draft catalog entry):
{
  "biomarkers": [
    {
      "id": "img_36",
      "name": "Se non HDL cholesterol level",
      "value": 5,
      "unit": "mmol/L",
      "date": "2026-06-03",
      "range": "- mmol/L"
    },
    {
      "id": "img_37",
      "name": "Serum cholesterol/HDL ratio",
      "value": 4.3,
      "unit": "",
      "date": "2026-06-03",
      "range": ""
    },
    {
      "id": "img_39",
      "name": "QRISK2 cardiovascular disease 10 year risk score",
      "value": 1.2,
      "unit": "%",
      "date": "2025-06-26",
      "range": "- %"
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "img_36",
    "medicalInsight": "Non-HDL cholesterol of 5 mmol/L is elevated, representing total atherogenic particle burden and indicating increased cardiovascular risk for a 43-year-old male.",
    "optimalValue": "2.6 mmol/L",
    "editReason": "Target set below standard clinical threshold for optimal primary prevention.",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 5,
        "unit": "mmol/L",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_non_hdl_cholesterol",
      "name": "Serum non-HDL cholesterol level",
      "unit": "mmol/L",
      "aliases": [
        "Non-HDL Cholesterol",
        "Non-High-Density Lipoprotein Cholesterol"
      ],
      "normalRange": "[Western Standard] High: >=4.1; Borderline High: 3.4-4.0; Optimal: <3.4",
      "description": "Calculated as total cholesterol minus HDL cholesterol, measuring all atherogenic lipoproteins.",
      "riskCategories": [
        "Cardiovascular Risk",
        "Lipid Panel"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >=4.1; Borderline High: 3.4-4.0; Optimal: <3.4"
  },
  {
    "id": "img_37",
    "medicalInsight": "The cholesterol to HDL ratio of 4.3 falls into a moderate risk category for cardiovascular disease development.",
    "optimalValue": "3.0",
    "editReason": "Target set to optimal physiological ratio for risk reduction.",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 4.3,
        "unit": "",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "serum_cholesterol_hdl_ratio",
      "name": "Serum cholesterol/HDL ratio",
      "unit": "",
      "aliases": [
        "Cholesterol to HDL Ratio",
        "TC/HDL Ratio"
      ],
      "normalRange": "[Western Standard] High: >5.0; Moderate: 3.6-5.0; Optimal: <3.6",
      "description": "Ratio comparing total cholesterol to high-density lipoprotein cholesterol to assess cardiovascular risk.",
      "riskCategories": [
        "Cardiovascular Risk",
        "Lipid Panel"
      ]
    },
    "customRangeOverlay": "[Western Standard] High: >5.0; Moderate: 3.6-5.0; Optimal: <3.6"
  },
  {
    "id": "img_39",
    "medicalInsight": "A QRISK2 10-year cardiovascular disease risk score of 1.2% indicates a low risk category over the next decade.",
    "optimalValue": "< 5.0 %",
    "editReason": "Target represents standard low-risk threshold.",
    "logs": [
      {
        "date": "2025-06-26",
        "value": 1.2,
        "unit": "%",
        "comment": "GP lab"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "qrisk2_cvd_10_year_risk_score",
      "name": "QRISK2 cardiovascular disease 10 year risk score",
      "unit": "%",
      "aliases": [
        "QRISK2 Score",
        "10-Year CVD Risk"
      ],
      "normalRange": "[UK Clinical Standard] High: >=20.0; Moderate: 10.0-19.9; Low: <10.0",
      "description": "Algorithm predicting the risk of developing a cardiovascular event over a 10-year period.",
      "riskCategories": [
        "Cardiovascular Risk"
      ]
    },
    "customRangeOverlay": "[UK Clinical Standard] High: >=20.0; Moderate: 10.0-19.9; Low: <10.0"
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| img_1 | HbA1c levl - IFCC standardised | alias | observation | — | hba1c | — | — |
| img_2 | Se prostate specific Ag level | none | pending | — | — | se_prostate_specific_ag_level | — |
| img_3 | Serum sodium | none | pending | — | — | serum_sodium | — |
| img_4 | Serum potassium | none | pending | — | — | serum_potassium | — |
| img_5 | Serum creatinine | alias | observation | — | creatinine | — | — |
| img_6 | eGFRcreat (CKD-EPI)/1.73 m*2 | alias | observation | — | egfr | — | — |
| img_7 | Serum albumin | key | observation | — | serum_albumin | — | — |
| img_8 | Serum ALT level | alias | observation | — | alt | — | — |
| img_9 | Serum alkaline phosphatase | none | pending | — | — | serum_alkaline_phosphatase | — |
| img_10 | AST serum level | alias | observation | — | ast | — | — |
| img_11 | Serum total bilirubin level | none | pending | — | — | serum_total_bilirubin_level | — |
| img_12 | Serum total protein | alias | observation | — | total_protein | — | — |
| img_13 | Serum globulin | none | pending | — | — | serum_globulin | — |
| img_14 | Serum calcium | none | pending | — | — | serum_calcium | — |
| img_15 | Serum adjusted calcium conc | none | pending | — | — | serum_adjusted_calcium_conc | — |
| img_16 | Serum inorganic phosphate | none | pending | — | — | serum_inorganic_phosphate | — |
| img_17 | Total white cell count | alias | observation | — | wbc | — | — |
| img_18 | Red blood cell (RBC) count | alias | observation | — | rbc | — | — |
| img_19 | Haemoglobin estimation | alias | observation | — | hemoglobin | — | — |
| img_20 | Haematocrit | alias | observation | — | hematocrit | — | — |
| img_21 | Mean corpuscular volume (MCV) | alias | observation | — | mean_corpuscular_volume | — | — |
| img_22 | Mean corpusc. haemoglobin(MCH) | alias | observation | — | mean_corpuscular_hemoglobin | — | — |
| img_23 | Mean corpusc. Hb. conc. (MCHC) | alias | observation | — | mean_corpuscular_hemoglobin_concentration | — | — |
| img_24 | Red blood cell distribut width | alias | observation | — | rdw | — | — |
| img_25 | Platelet count | alias | observation | — | platelets | — | — |
| img_26 | Mean platelet volume | alias | observation | — | mpv | — | — |
| img_27 | Platelet distribution width | none | pending | — | — | platelet_distribution_width | — |
| img_28 | Neutrophil count | key | observation | — | neutrophil_count | — | — |
| img_29 | Eosinophil count | key | observation | — | eosinophil_count | — | — |
| img_30 | Basophil count | key | observation | — | basophil_count | — | — |
| img_31 | Nucleated red blood cell count | none | pending | — | — | nucleated_red_blood_cell_count | — |
| img_32 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — | — | qrisk2_cardiovascular_disease_10_year_risk_score | — |
| img_33 | Serum cholesterol | alias | observation | — | total_cholesterol | — | — |
| img_34 | Serum HDL cholesterol level | alias | observation | — | hdl | — | — |
| img_35 | Serum triglycerides | alias | observation | — | triglycerides | — | — |
| img_36 | Se non HDL cholesterol level | none | pending | — | — | serum_non_hdl_cholesterol | — |
| img_37 | Serum cholesterol/HDL ratio | none | pending | — | — | serum_cholesterol_hdl_ratio | — |
| img_38 | Calculated LDL cholesterol lev | alias | observation | — | ldl | — | — |
| img_39 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — | — | qrisk2_cvd_10_year_risk_score | — |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
