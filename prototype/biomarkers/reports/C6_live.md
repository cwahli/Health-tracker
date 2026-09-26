# C6 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 3 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: r16-scorecard/.env
- Score: **FAIL** (37 known / 2 unknown)

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
| img_2 | Se prostate specific Ag level | alias | observation | prostate_specific_antigen |
| img_3 | Serum sodium | key | observation | serum_sodium |
| img_4 | Serum potassium | key | observation | serum_potassium |
| img_5 | Serum creatinine | alias | observation | creatinine |
| img_6 | eGFRcreat (CKD-EPI)/1.73 m*2 | alias | observation | egfr |
| img_7 | Serum albumin | key | observation | serum_albumin |
| img_8 | Serum ALT level | alias | observation | alt |
| img_9 | Serum alkaline phosphatase | alias | observation | alkaline_phosphatase |
| img_10 | AST serum level | alias | observation | ast |
| img_11 | Serum total bilirubin level | alias | observation | total_bilirubin |
| img_12 | Serum total protein | alias | observation | total_protein |
| img_13 | Serum globulin | key | observation | serum_globulin |
| img_14 | Serum calcium | key | observation | serum_calcium |
| img_15 | Serum adjusted calcium conc | alias | observation | serum_adjusted_calcium |
| img_16 | Serum inorganic phosphate | key | observation | serum_inorganic_phosphate |
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
| img_27 | Platelet distribution width | key | observation | platelet_distribution_width |
| img_28 | Neutrophil count | key | observation | neutrophil_count |
| img_29 | Eosinophil count | key | observation | eosinophil_count |
| img_30 | Basophil count | key | observation | basophil_count |
| img_31 | Nucleated red blood cell count | key | observation | nucleated_red_blood_cell_count |
| img_32 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — |
| img_33 | Serum cholesterol | alias | observation | total_cholesterol |
| img_34 | Serum HDL cholesterol level | alias | observation | hdl |
| img_35 | Serum triglycerides | alias | observation | triglycerides |
| img_36 | Se non HDL cholesterol level | alias | observation | non_hdl_cholesterol |
| img_37 | Serum cholesterol/HDL ratio | alias | observation | cholesterol_hdl_ratio |
| img_38 | Calculated LDL cholesterol lev | alias | observation | ldl |
| img_39 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — |

## Agent turns (full payload sent + model output)

### Turn 1 (hit) — img_1, img_2, img_3, img_4, img_5, img_6, img_7, img_8, img_9, img_10, img_11, img_12, img_13, img_14, img_15, img_16, img_17, img_18, img_19, img_20 (20 rows, 7801ms)

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
      "id": "img_2",
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
      "id": "img_3",
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
      "id": "img_4",
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
      "id": "img_9",
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
      "id": "img_11",
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
      "id": "img_13",
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
      "id": "img_14",
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
      "id": "img_15",
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
      "id": "img_16",
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
    }
  ]
}
```

**Model output:**

```json
[
  {
    "id": "img_1",
    "medicalInsight": "HbA1c is 40 mmol/mol, indicating an elevated prediabetes risk for a Chinese patient.",
    "optimalValue": "35 mmol/mol",
    "editReason": "Set optimal target for metabolic health.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 40,
        "unit": "mmol/mol",
        "comment": null
      }
    ],
    "customRangeOverlay": "[Chinese Ethnicity] Elevated (Prediabetes/Diabetes): >=39; Optimal: <39",
    "dictionaryCorrection": null
  },
  {
    "id": "img_2",
    "medicalInsight": "Prostate Specific Antigen is 1.41 ug/L, within normal limits for prostate health screening.",
    "optimalValue": "1.0 ug/L",
    "editReason": "Set optimal target for baseline screening.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 1.41,
        "unit": "ug/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_3",
    "medicalInsight": "Serum Sodium is 143 mmol/L, reflecting normal electrolyte and hydration status.",
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
    "id": "img_4",
    "medicalInsight": "Serum Potassium is 4.3 mmol/L, well within the normal physiological range.",
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
    "id": "img_5",
    "medicalInsight": "Serum creatinine is 100 umol/L, within normal limits.",
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
    "medicalInsight": "Your eGFR of 80 mL/min/1.73m2 indicates mild reduction but represents a common baseline; evaluated carefully for accurate kidney health.",
    "optimalValue": "95 mL/min/1.73m2",
    "editReason": "Correcting naive normal eGFR to reflect true optimal filtration capacity.",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 80,
        "unit": "mL/min/1.73m2",
        "comment": null
      }
    ],
    "customRangeOverlay": "[Western Standard] Normal: >=90; Mild Decrease: 60-89; Low: <60",
    "dictionaryCorrection": null
  },
  {
    "id": "img_7",
    "medicalInsight": "Serum Albumin is 46 g/L, indicating normal synthetic liver function and protein status.",
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
    "medicalInsight": "ALT is 41 U/L, marginally at the upper boundary, suggesting minor monitoring of liver enzymes.",
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
    "id": "img_9",
    "medicalInsight": "Alkaline Phosphatase is 39 U/L, demonstrating normal hepatobiliary and bone turnover status.",
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
    "id": "img_10",
    "medicalInsight": "AST is 27 U/L, falling within the standard normal range.",
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
    "id": "img_11",
    "medicalInsight": "Total Bilirubin is 16 umol/L, showing normal pigment metabolism and clearance.",
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
    "id": "img_12",
    "medicalInsight": "Total Protein is 81 g/L, slightly elevated above standard reference limits, warranting clinical correlation.",
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
      "reason": "Correcting dictionary typo from g/L range of 6-8 to proper clinical units of 60-80 g/L."
    }
  },
  {
    "id": "img_13",
    "medicalInsight": "Serum Globulin is 35 g/L, sitting at the upper end of the normal reference interval.",
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
    "id": "img_14",
    "medicalInsight": "Serum Calcium is 2.47 mmol/L, well within normal calcium homeostasis bounds.",
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
    "customRangeOverlay": "[Western Standard] Normal: 2.15-2.55; High: >2.55; Low: <2.15",
    "dictionaryCorrection": null
  },
  {
    "id": "img_15",
    "medicalInsight": "Serum Adjusted Calcium is 2.37 mmol/L, reflecting normal physiological ionized calcium levels.",
    "optimalValue": "2.30 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 2.37,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_16",
    "medicalInsight": "Serum Inorganic Phosphate is 1.12 mmol/L, demonstrating normal mineral and bone metabolism.",
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
  },
  {
    "id": "img_17",
    "medicalInsight": "White Blood Cell count is 5.7 10^9/L, representing a healthy immune cell profile.",
    "optimalValue": "6.0 10^9/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 5.7,
        "unit": "10^9/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_18",
    "medicalInsight": "Red Blood Cell count is 5.47 10^12/L, indicating normal erythropoiesis.",
    "optimalValue": "5.00 10^12/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 5.47,
        "unit": "10^12/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_19",
    "medicalInsight": "Hemoglobin is 166 g/L, within the normal adult male range for oxygen transport capacity.",
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
    "medicalInsight": "Hematocrit is 0.48 L/L, showing normal red blood cell volume distribution.",
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
  }
]
```

### Turn 2 (hit) — img_21, img_22, img_23, img_24, img_25, img_26, img_27, img_28, img_29, img_30, img_31, img_33, img_34, img_35, img_36, img_37, img_38 (17 rows, 6542ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
Log these GP results
</user_upload>

Biomarkers to review (hits - in catalog):
{
  "biomarkers": [
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
      "id": "img_27",
      "name": "Platelet Distribution Width",
      "value": 12.9,
      "unit": "fL",
      "date": "2026-06-05",
      "range": "8.3 - 18.0 fL",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "8.3 - 18.0",
        "unit": "fL",
        "description": "Geometric standard deviation of platelet size distribution; reflects thrombopoiesis and platelet activation."
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
    },
    {
      "id": "img_31",
      "name": "Nucleated Red Blood Cell Count",
      "value": 0,
      "unit": "10*9/L",
      "date": "2026-06-05",
      "range": "0.00 - 0.01 10*9/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "0.00 - 0.01",
        "unit": "10^9/L",
        "description": "Immature nucleated erythrocytes in peripheral circulation; normally negligible in healthy adult blood."
      }
    },
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
      "id": "img_36",
      "name": "Non-HDL Cholesterol",
      "value": 5,
      "unit": "mmol/L",
      "date": "2026-06-03",
      "range": "- mmol/L",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "< 3.8",
        "unit": "mmol/L",
        "description": "Total cholesterol minus HDL-C; quantifies circulating atherogenic apolipoprotein B-containing particles."
      }
    },
    {
      "id": "img_37",
      "name": "Cholesterol / HDL Ratio",
      "value": 4.3,
      "unit": "",
      "date": "2026-06-03",
      "range": "< 4.0",
      "optimalValue": null,
      "existingInsight": null,
      "existingCustomRange": null,
      "dictionary": {
        "normalRange": "< 4.0",
        "unit": "ratio",
        "description": "Ratio of total serum cholesterol to cardioprotective HDL cholesterol, serving as an atherogenic risk index."
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
    "id": "img_21",
    "medicalInsight": "MCV is optimal at 88 fL, indicating normal average red blood cell volume and healthy erythropoiesis.",
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
    "medicalInsight": "MCH is optimal at 30.3 pg, reflecting appropriate hemoglobin content per red blood cell.",
    "optimalValue": "30 pg",
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
    "medicalInsight": "MCHC is optimal at 346 g/L, showing normal hemoglobin concentration within circulating erythrocytes.",
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
  },
  {
    "id": "img_24",
    "medicalInsight": "RDW is optimal at 11.8%, demonstrating uniform red blood cell sizing and low anisocytosis risk.",
    "optimalValue": "13.0 %",
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
    "medicalInsight": "Platelet count is optimal at 227 10*9/L, supporting normal thrombocytic function and clotting capacity.",
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
    "medicalInsight": "MPV is optimal at 10.6 fL, indicating normal platelet production and volume metrics.",
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
    "id": "img_27",
    "medicalInsight": "Platelet Distribution Width is optimal at 12.9 fL, reflecting stable platelet size uniformity.",
    "optimalValue": "13.0 fL",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 12.9,
        "unit": "fL",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_28",
    "medicalInsight": "Neutrophil count is optimal at 3.18 10*9/L, indicating a healthy innate immune defense reserve.",
    "optimalValue": "4.00 10*9/L",
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
    "medicalInsight": "Eosinophil count is optimal at 0.07 10*9/L, showing normal regulation of allergic and parasitic responses.",
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
    "medicalInsight": "Basophil count is optimal at 0.04 10*9/L, confirming baseline granulocyte levels.",
    "optimalValue": "0.05 10*9/L",
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
  },
  {
    "id": "img_31",
    "medicalInsight": "Nucleated Red Blood Cell Count is 0 10*9/L, representing the expected normal absence in adult circulation.",
    "optimalValue": "0.00 10*9/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-05",
        "value": 0,
        "unit": "10*9/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_33",
    "medicalInsight": "Total Cholesterol is elevated at 6.5 mmol/L, indicating increased cardiovascular risk requiring lifestyle or dietary review.",
    "optimalValue": "4.5 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 6.5,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_34",
    "medicalInsight": "HDL-C is optimal at 1.5 mmol/L, providing protective cardiovascular reverse cholesterol transport.",
    "optimalValue": "1.4 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 1.5,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_35",
    "medicalInsight": "Triglycerides are elevated at 1.7 mmol/L, reflecting borderline dyslipidemia and potential metabolic strain.",
    "optimalValue": "1.2 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 1.7,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": null,
    "dictionaryCorrection": null
  },
  {
    "id": "img_36",
    "medicalInsight": "Non-HDL Cholesterol is elevated at 5.0 mmol/L, indicating an excess of atherogenic lipoprotein particles in circulation.",
    "optimalValue": "3.0 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 5,
        "unit": "mmol/L",
        "comment": null
      }
    ],
    "customRangeOverlay": "[Western Standard] High: >=3.8; Optimal: <3.8",
    "dictionaryCorrection": null
  },
  {
    "id": "img_37",
    "medicalInsight": "Cholesterol / HDL Ratio is elevated at 4.3, suggesting a moderately increased atherogenic risk profile.",
    "optimalValue": "3.2",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-03",
        "value": 4.3,
        "unit": "",
        "comment": null
      }
    ],
    "customRangeOverlay": "[Western Standard] High: >=4.0; Optimal: <4.0",
    "dictionaryCorrection": null
  },
  {
    "id": "img_38",
    "medicalInsight": "LDL-C is elevated at 4.3 mmol/L, a primary driver of atherosclerotic cardiovascular disease that warrants intervention.",
    "optimalValue": "2.4 mmol/L",
    "editReason": "",
    "logs": [
      {
        "date": "2026-06-03",
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

### Turn 3 (miss) — img_32, img_39 (1 rows, 2125ms)

**User contents sent to the model** (system instruction is above; this is the user turn):

```
<user_upload>
Log these GP results
</user_upload>

Biomarkers to review (misses - uncataloged, draft catalog entry):
{
  "biomarkers": [
    {
      "id": "img_32",
      "name": "QRISK2 cardiovascular disease 10 year risk score",
      "value": 1.2,
      "unit": "%",
      "date": "2026-06-04",
      "range": "- %"
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
    "id": "img_32",
    "medicalInsight": "The QRISK2 10-year cardiovascular disease risk score is 1.2 percent, indicating a low risk category. This is stable compared to the previous measurement of 1.2 percent in June 2025.",
    "optimalValue": "5.0 %",
    "editReason": "Setting optimal target to under 10 percent for low cardiovascular risk classification.",
    "logs": [
      {
        "date": "2026-06-04",
        "value": 1.2,
        "unit": "%",
        "comment": "GP Clinic"
      },
      {
        "date": "2025-06-26",
        "value": 1.2,
        "unit": "%",
        "comment": "GP Clinic"
      }
    ],
    "match": "none",
    "writeTarget": "pending",
    "key": null,
    "newCatalogDraft": {
      "suggestedKey": "qrisk2_10_year_cvd_risk",
      "name": "QRISK2 cardiovascular disease 10 year risk score",
      "unit": "%",
      "aliases": [
        "QRISK2",
        "CVD 10 year risk score"
      ],
      "normalRange": "[Western Standard] High Risk: >=20.0; Moderate Risk: 10.0-19.9; Low Risk: <10.0",
      "description": "Calculates the percentage risk of developing a cardiovascular event over a 10-year period based on clinical and demographic risk factors.",
      "riskCategories": [
        "Cardiovascular",
        "Metabolic"
      ]
    },
    "customRangeOverlay": "[Western Standard] High Risk: >=20.0; Moderate Risk: 10.0-19.9; Low Risk: <10.0"
  }
]
```

## Scored template vs expected

| id | printed | match | writeTarget | status | key | draft | fail |
|---|---|---|---|---|---|---|---|
| img_1 | HbA1c levl - IFCC standardised | alias | observation | — | hba1c | — | — |
| img_2 | Se prostate specific Ag level | alias | observation | — | prostate_specific_antigen | — | — |
| img_3 | Serum sodium | key | observation | — | serum_sodium | — | — |
| img_4 | Serum potassium | key | observation | — | serum_potassium | — | — |
| img_5 | Serum creatinine | alias | observation | — | creatinine | — | — |
| img_6 | eGFRcreat (CKD-EPI)/1.73 m*2 | alias | observation | — | egfr | — | — |
| img_7 | Serum albumin | key | observation | — | serum_albumin | — | — |
| img_8 | Serum ALT level | alias | observation | — | alt | — | — |
| img_9 | Serum alkaline phosphatase | alias | observation | — | alkaline_phosphatase | — | — |
| img_10 | AST serum level | alias | observation | — | ast | — | — |
| img_11 | Serum total bilirubin level | alias | observation | — | total_bilirubin | — | — |
| img_12 | Serum total protein | alias | observation | — | total_protein | — | — |
| img_13 | Serum globulin | key | observation | — | serum_globulin | — | — |
| img_14 | Serum calcium | key | observation | — | serum_calcium | — | — |
| img_15 | Serum adjusted calcium conc | alias | observation | — | serum_adjusted_calcium | — | — |
| img_16 | Serum inorganic phosphate | key | observation | — | serum_inorganic_phosphate | — | — |
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
| img_27 | Platelet distribution width | key | observation | — | platelet_distribution_width | — | — |
| img_28 | Neutrophil count | key | observation | — | neutrophil_count | — | — |
| img_29 | Eosinophil count | key | observation | — | eosinophil_count | — | — |
| img_30 | Basophil count | key | observation | — | basophil_count | — | — |
| img_31 | Nucleated red blood cell count | key | observation | — | nucleated_red_blood_cell_count | — | — |
| img_32 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — | — | qrisk2_10_year_cvd_risk | newCatalogDraft, medicalInsight |
| img_33 | Serum cholesterol | alias | observation | — | total_cholesterol | — | — |
| img_34 | Serum HDL cholesterol level | alias | observation | — | hdl | — | — |
| img_35 | Serum triglycerides | alias | observation | — | triglycerides | — | — |
| img_36 | Se non HDL cholesterol level | alias | observation | — | non_hdl_cholesterol | — | — |
| img_37 | Serum cholesterol/HDL ratio | alias | observation | — | cholesterol_hdl_ratio | — | — |
| img_38 | Calculated LDL cholesterol lev | alias | observation | — | ldl | — | — |
| img_39 | QRISK2 cardiovascular disease 10 year risk score | none | pending | — | — | — | newCatalogDraft, medicalInsight |

## Contract checks

- Model **must not emit status**: verified (pure TS classifier assigns it).
- Model **must not alter dictionary**: verified (hits lock catalog definition).
- Medical insight **must be personalised**: verified by `scoreBiomarkersCase`.
- Contract: `TEMPLATE.md` + `template.ts`.
