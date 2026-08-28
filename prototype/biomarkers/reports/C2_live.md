# C2 live analysis

- Model: `gemini-3.5-flash-lite`
- Dry: false
- Insight batch: 20 · draft batch: 12 → 2 agent turns
- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.
- Template: `prototype/biomarkers/TEMPLATE.md`
- Env file: Health-tracker/.env
- Score: **PASS** (18 known / 12 unknown)

## User send (once)

```
Here are my June 2026 results. Please file them and tell me what they mean for me.
HbA1c (IFCC)  40 mmol/mol
Calculated LDL cholesterol  4.3 mmol/L
HDL cholesterol  1.2 mmol/L
Triglycerides  2.1 mmol/L
Total cholesterol  6.5 mmol/L
ApoB  90 mg/dL
ApoA1  1.4 g/L
eGFR (CKD-EPI)  80 mL/min/1.73m2
Serum creatinine  100 umol/L
Serum ALT  41 U/L
AST  27 U/L
Gamma GT  35 U/L
Haemoglobin  166 g/L
Hematocrit  0.48 L/L
Total white cell count  5.7 10*9/L
Platelets  227 10*9/L
Serum albumin  46 g/L
Total protein  81 g/L
Lp(a)  90 nmol/L
Homocysteine  12 umol/L
PSA  1.41 ug/L
Serum sodium  143 mmol/L
Serum potassium  4.3 mmol/L
Serum calcium  2.47 mmol/L
Adjusted calcium  2.37 mmol/L
Inorganic phosphate  1.12 mmol/L
Alkaline phosphatase  39 U/L
Globulin  35 g/L
Non-HDL cholesterol  5 mmol/L
Ferritin  85 ug/L
```

## Back-office identity

| id | printed | match | writeTarget | key |
|---|---|---|---|---|
| r01 | HbA1c (IFCC) | alias | observation | hba1c |
| r02 | Calculated LDL cholesterol | alias | observation | ldl |
| r03 | HDL cholesterol | alias | observation | hdl |
| r04 | Triglycerides | key | observation | triglycerides |
| r05 | Total cholesterol | key | observation | total_cholesterol |
| r06 | ApoB | key | observation | apob |
| r07 | ApoA1 | key | observation | apoa1 |
| r08 | eGFR (CKD-EPI) | alias | observation | egfr |
| r09 | Serum creatinine | alias | observation | creatinine |
| r10 | Serum ALT | alias | observation | alt |
| r11 | AST | key | observation | ast |
| r12 | Gamma GT | key | observation | gamma_gt |
| r13 | Haemoglobin | alias | observation | hemoglobin |
| r14 | Hematocrit | key | observation | hematocrit |
| r15 | Total white cell count | alias | observation | wbc |
| r16 | Platelets | key | observation | platelets |
| r17 | Serum albumin | key | observation | serum_albumin |
| r18 | Total protein | key | observation | total_protein |
| r19 | Lp(a) | none | pending | — |
| r20 | Homocysteine | none | pending | — |
| r21 | PSA | none | pending | — |
| r22 | Serum sodium | none | pending | — |
| r23 | Serum potassium | none | pending | — |
| r24 | Serum calcium | none | pending | — |
| r25 | Adjusted calcium | none | pending | — |
| r26 | Inorganic phosphate | none | pending | — |
| r27 | Alkaline phosphatase | none | pending | — |
| r28 | Globulin | none | pending | — |
| r29 | Non-HDL cholesterol | none | pending | — |
| r30 | Ferritin | none | pending | — |

## Agent turns (full output)

### Turn 1 (hit) — r01, r02, r03, r04, r05, r06, r07, r08, r09, r10, r11, r12, r13, r14, r15, r16, r17, r18 (18 rows, 4039ms)

```json
{
  "rows": [
    {
      "id": "r01",
      "medicalInsight": "Your HbA1c is currently Elevated at 40 mmol/mol for a 43-year-old Chinese male, showing a slight upward trend from 39 to 40.",
      "customRangeOverlay": null
    },
    {
      "id": "r02",
      "medicalInsight": "Your LDL-C is Very High at 4.3 mmol/L for a 43-year-old Chinese male.",
      "customRangeOverlay": null
    },
    {
      "id": "r03",
      "medicalInsight": "Your HDL-C is Optimal at 1.2 mmol/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r04",
      "medicalInsight": "Your Triglycerides are Elevated at 2.1 mmol/L for a 43-year-old Chinese male.",
      "customRangeOverlay": null
    },
    {
      "id": "r05",
      "medicalInsight": "Your Total Cholesterol is Very High at 6.5 mmol/L for a 43-year-old Chinese male.",
      "customRangeOverlay": null
    },
    {
      "id": "r06",
      "medicalInsight": "Your ApoB is Optimal at 90 mg/dL.",
      "customRangeOverlay": null
    },
    {
      "id": "r07",
      "medicalInsight": "Your ApoA1 is Optimal at 1.4 g/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r08",
      "medicalInsight": "Your eGFR is Mildly Decreased (CKD G2) at 80 mL/min/1.73m² for a 43-year-old Chinese male.",
      "customRangeOverlay": null
    },
    {
      "id": "r09",
      "medicalInsight": "Your Creatinine is Optimal at 100 umol/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r10",
      "medicalInsight": "Your ALT (SGPT) is Elevated at 41 U/L for a 43-year-old Chinese male.",
      "customRangeOverlay": null
    },
    {
      "id": "r11",
      "medicalInsight": "Your AST (SGOT) is Optimal at 27 U/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r12",
      "medicalInsight": "Your Gamma GT (GGT) is Optimal at 35 U/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r13",
      "medicalInsight": "Your Hemoglobin is Optimal at 166 g/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r14",
      "medicalInsight": "Your Hematocrit is Optimal at 0.48 L/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r15",
      "medicalInsight": "Your White Blood Cell count is Optimal at 5.7 10*9/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r16",
      "medicalInsight": "Your Platelets are Optimal at 227 10*9/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r17",
      "medicalInsight": "Your Serum Albumin is Optimal at 46 g/L.",
      "customRangeOverlay": null
    },
    {
      "id": "r18",
      "medicalInsight": "Your Total Protein is Elevated at 81 g/L for a 43-year-old Chinese male.",
      "customRangeOverlay": null
    }
  ]
}
```

### Turn 2 (miss) — r19, r20, r21, r22, r23, r24, r25, r26, r27, r28, r29, r30 (12 rows, 5437ms)

```json
{
  "rows": [
    {
      "id": "r19",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "lp_a",
        "name": "Lipoprotein (a)",
        "unit": "nmol/L",
        "aliases": [
          "Lp(a)"
        ],
        "normalRange": "<75",
        "description": "A type of lipoprotein that carries cholesterol in the blood, elevated levels are an independent risk factor for cardiovascular disease.",
        "riskCategories": [
          "cardiovascular"
        ]
      }
    },
    {
      "id": "r20",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "homocysteine",
        "name": "Homocysteine",
        "unit": "umol/L",
        "aliases": [
          "Homocysteine"
        ],
        "normalRange": "5-15",
        "description": "An amino acid in the blood associated with cardiovascular health and B-vitamin status.",
        "riskCategories": [
          "cardiovascular",
          "metabolic"
        ]
      }
    },
    {
      "id": "r21",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "psa",
        "name": "Prostate Specific Antigen",
        "unit": "ug/L",
        "aliases": [
          "PSA"
        ],
        "normalRange": "0-4.0",
        "description": "A protein produced by the prostate gland, used as a screening tool for prostate conditions.",
        "riskCategories": [
          "prostate"
        ]
      }
    },
    {
      "id": "r22",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "serum_sodium",
        "name": "Serum Sodium",
        "unit": "mmol/L",
        "aliases": [
          "Sodium"
        ],
        "normalRange": "135-145",
        "description": "An electrolyte crucial for fluid balance, nerve function, and muscle contraction.",
        "riskCategories": [
          "electrolyte",
          "metabolic"
        ]
      }
    },
    {
      "id": "r23",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "serum_potassium",
        "name": "Serum Potassium",
        "unit": "mmol/L",
        "aliases": [
          "Potassium"
        ],
        "normalRange": "3.5-5.0",
        "description": "An electrolyte essential for proper heart, muscle, and nerve function.",
        "riskCategories": [
          "electrolyte",
          "cardiovascular"
        ]
      }
    },
    {
      "id": "r24",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "serum_calcium",
        "name": "Serum Calcium",
        "unit": "mmol/L",
        "aliases": [
          "Calcium"
        ],
        "normalRange": "2.10-2.55",
        "description": "A mineral vital for bone health, nerve signaling, and muscle function.",
        "riskCategories": [
          "bone",
          "metabolic"
        ]
      }
    },
    {
      "id": "r25",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "adjusted_calcium",
        "name": "Adjusted Calcium",
        "unit": "mmol/L",
        "aliases": [
          "Corrected Calcium"
        ],
        "normalRange": "2.10-2.55",
        "description": "Calcium level adjusted for serum albumin concentration to reflect true active calcium.",
        "riskCategories": [
          "bone",
          "metabolic"
        ]
      }
    },
    {
      "id": "r26",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "inorganic_phosphate",
        "name": "Inorganic Phosphate",
        "unit": "mmol/L",
        "aliases": [
          "Phosphate",
          "Phosphorus"
        ],
        "normalRange": "0.80-1.50",
        "description": "A mineral important for bone mineralization, energy production, and cellular function.",
        "riskCategories": [
          "bone",
          "metabolic"
        ]
      }
    },
    {
      "id": "r27",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "alkaline_phosphatase",
        "name": "Alkaline Phosphatase",
        "unit": "U/L",
        "aliases": [
          "ALP"
        ],
        "normalRange": "40-129",
        "description": "An enzyme found mostly in the liver and bones, used to evaluate liver and bone disorders.",
        "riskCategories": [
          "liver",
          "bone"
        ]
      }
    },
    {
      "id": "r28",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "globulin",
        "name": "Globulin",
        "unit": "g/L",
        "aliases": [
          "Serum Globulin"
        ],
        "normalRange": "20-35",
        "description": "A group of proteins in the blood that includes antibodies and transport proteins.",
        "riskCategories": [
          "immune",
          "liver"
        ]
      }
    },
    {
      "id": "r29",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "non_hdl_cholesterol",
        "name": "Non-HDL Cholesterol",
        "unit": "mmol/L",
        "aliases": [
          "Non-HDL"
        ],
        "normalRange": "<3.4",
        "description": "Total cholesterol minus HDL, representing all atherogenic particles in circulation.",
        "riskCategories": [
          "cardiovascular"
        ]
      }
    },
    {
      "id": "r30",
      "match": "none",
      "writeTarget": "pending",
      "key": null,
      "newCatalogDraft": {
        "suggestedKey": "ferritin",
        "name": "Ferritin",
        "unit": "ug/L",
        "aliases": [
          "Serum Ferritin"
        ],
        "normalRange": "30-300",
        "description": "A blood protein that contains iron, serving as the primary marker for body iron stores.",
        "riskCategories": [
          "hematology",
          "metabolic"
        ]
      }
    }
  ]
}
```

## Merged fill vs expected

| printed | expected key | got key | expected target | got target | ok |
|---|---|---|---|---|---|
| HbA1c (IFCC) | hba1c | hba1c | observation | observation | yes |
| Calculated LDL cholesterol | ldl | ldl | observation | observation | yes |
| HDL cholesterol | hdl | hdl | observation | observation | yes |
| Triglycerides | triglycerides | triglycerides | observation | observation | yes |
| Total cholesterol | total_cholesterol | total_cholesterol | observation | observation | yes |
| ApoB | apob | apob | observation | observation | yes |
| ApoA1 | apoa1 | apoa1 | observation | observation | yes |
| eGFR (CKD-EPI) | egfr | egfr | observation | observation | yes |
| Serum creatinine | creatinine | creatinine | observation | observation | yes |
| Serum ALT | alt | alt | observation | observation | yes |
| AST | ast | ast | observation | observation | yes |
| Gamma GT | gamma_gt | gamma_gt | observation | observation | yes |
| Haemoglobin | hemoglobin | hemoglobin | observation | observation | yes |
| Hematocrit | hematocrit | hematocrit | observation | observation | yes |
| Total white cell count | wbc | wbc | observation | observation | yes |
| Platelets | platelets | platelets | observation | observation | yes |
| Serum albumin | serum_albumin | serum_albumin | observation | observation | yes |
| Total protein | total_protein | total_protein | observation | observation | yes |
| Lp(a) | — | — | pending | pending | yes |
| Homocysteine | — | — | pending | pending | yes |
| PSA | — | — | pending | pending | yes |
| Serum sodium | — | — | pending | pending | yes |
| Serum potassium | — | — | pending | pending | yes |
| Serum calcium | — | — | pending | pending | yes |
| Adjusted calcium | — | — | pending | pending | yes |
| Inorganic phosphate | — | — | pending | pending | yes |
| Alkaline phosphatase | — | — | pending | pending | yes |
| Globulin | — | — | pending | pending | yes |
| Non-HDL cholesterol | — | — | pending | pending | yes |
| Ferritin | — | — | pending | pending | yes |

## Hit templates (dictionary locked + user slots)

### HbA1c (`hba1c`)

- Alias: hba1cc; glycatedhaemoglobin; hemoglobin_a1c_mmol_mol; hba1c_mmol_mol; hemoglobin_a1c
- Normal range: 20 - 41 mmol/mol
- Description: Average blood glucose levels over the past 2-3 months.
- Risk categories: Metabolic
- Custom range (dictionary): [All patients] Elevated (Diabetes): >= 48; Elevated: >= 39; Normal: >= 20; Elevated (Diabetes): >= 6.5; Elevated: >= 5.7
- Status (computed): **Elevated**
- Logs: 2024-04-04=39 · 2026-06-05=40
- Insight: Your HbA1c is currently Elevated at 40 mmol/mol for a 43-year-old Chinese male, showing a slight upward trend from 39 to 40.

### LDL-C (`ldl`)

- Alias: ldlc; ldlcholesterol; calculatedldlcholesterol; calculatedldl; calculated_ldl_cholesterol_mmol_l; calculated_ldl_cholesterol
- Normal range: < 2.6 mmol/L
- Description: Low-Density Lipoprotein, the "bad" cholesterol driving plaque.
- Risk categories: Cardiovascular
- Custom range (dictionary): [All patients] Very High: > 3.4; Elevated: > 2.6; Optimal: <= 2.6
- Status (computed): **Very High**
- Logs: 2026-06-05=4.3
- Insight: Your LDL-C is Very High at 4.3 mmol/L for a 43-year-old Chinese male.

### HDL-C (`hdl`)

- Alias: hdlc; hdlcholesterol; serum_hdl_cholesterol; serum_hdl_cholesterol_mmol_l
- Normal range: 0.9 - 1.7 mmol/L
- Description: High-Density Lipoprotein, the "good" cholesterol removing excess lipids.
- Risk categories: Cardiovascular
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=1.2
- Insight: Your HDL-C is Optimal at 1.2 mmol/L.

### Triglycerides (`triglycerides`)

- Alias: trig; serum_triglycerides; serum_triglycerides_mmol_l
- Normal range: < 1.7 mmol/L
- Description: Type of fat in the blood used for energy storage.
- Risk categories: Cardiovascular
- Custom range (dictionary): [All patients] Very High: >= 5.6; Elevated: >= 1.7; Optimal: < 1.7
- Status (computed): **Elevated**
- Logs: 2026-06-05=2.1
- Insight: Your Triglycerides are Elevated at 2.1 mmol/L for a 43-year-old Chinese male.

### Total Cholesterol (`total_cholesterol`)

- Alias: cholesterol; serumtotalcholesterol; serum_cholesterol
- Normal range: Aim under 5.0 mmol/L
- Description: Total amount of cholesterol in the blood.
- Risk categories: Cardiovascular
- Custom range (dictionary): [All patients] Very High: > 6.2; Elevated: > 5; Optimal: <= 5
- Status (computed): **Very High**
- Logs: 2026-06-05=6.5
- Insight: Your Total Cholesterol is Very High at 6.5 mmol/L for a 43-year-old Chinese male.

### ApoB (`apob`)

- Alias: —
- Normal range: under 90 mg/dL
- Description: Apolipoprotein B, the best indicator of atherogenic particle count.
- Risk categories: 
- Custom range (dictionary): [All patients] Very High: > 110; Elevated: > 90; Optimal: <= 90
- Status (computed): **Optimal**
- Logs: 2026-06-05=90
- Insight: Your ApoB is Optimal at 90 mg/dL.

### ApoA1 (`apoa1`)

- Alias: apolipoprotein_a1; apolipoproteina1; apoa_1; apolipoprotein_a_1; apo_a1; apoa1_g_l
- Normal range: 1.19 - 2.40 g/L
- Description: Apolipoprotein A1, the primary protein constituent of HDL particles that mediates reverse cholesterol transport.
- Risk categories: Cardiovascular
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=1.4
- Insight: Your ApoA1 is Optimal at 1.4 g/L.

### eGFR (`egfr`)

- Alias: egfrmlmin173m2; egfrmlmin173; egfr_ml_min_1_73m2; egfr_mlmin173m2
- Normal range: over 90 mL/min/1.73m²
- Description: Estimated Glomerular Filtration Rate, showing kidney health.
- Risk categories: Kidney
- Custom range (dictionary): [All patients] Decreased (CKD G3): < 60; Mildly Decreased (CKD G2): < 90; Optimal: >= 90
- Status (computed): **Mildly Decreased (CKD G2)**
- Logs: 2026-06-05=80
- Insight: Your eGFR is Mildly Decreased (CKD G2) at 80 mL/min/1.73m² for a 43-year-old Chinese male.

### Creatinine (`creatinine`)

- Alias: serumcreatinine; serumcreatinineumoll; serum_creatinine_umol_l; serum_creatinine
- Normal range: 44 - 106 umol/L
- Description: A waste product from muscle breakdown, filtered by kidneys.
- Risk categories: Kidney
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=100
- Insight: Your Creatinine is Optimal at 100 umol/L.

### ALT (SGPT) (`alt`)

- Alias: sgpt; alanine_aminotransferase; serum_alt_level_u_l; serum_alt_level
- Normal range: 10 - 40 U/L
- Description: Alanine Aminotransferase, an enzyme found mostly in the liver.
- Risk categories: Liver
- Custom range (dictionary): —
- Status (computed): **Elevated**
- Logs: 2026-06-05=41
- Insight: Your ALT (SGPT) is Elevated at 41 U/L for a 43-year-old Chinese male.

### AST (SGOT) (`ast`)

- Alias: sgot; aspartate_aminotransferase; ast_serum_level_u_l; ast_serum_level
- Normal range: 10 - 40 U/L
- Description: Aspartate Aminotransferase, an enzyme found in liver and muscle.
- Risk categories: Liver
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=27
- Insight: Your AST (SGOT) is Optimal at 27 U/L.

### Gamma GT (GGT) (`gamma_gt`)

- Alias: ggt; gamma_glutamyl_transferase; gamma_glutamyl_transpeptidase; gammagt; gammaglutamyltransferase; gammaglutamyltranspeptidase; serum_gamma_gt_level; serum_ggt_level
- Normal range: 9 - 48 U/L
- Description: Gamma-Glutamyl Transferase, a sensitive enzyme marker for biliary tract function, hepatic stress, and alcohol intake.
- Risk categories: Liver
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=35
- Insight: Your Gamma GT (GGT) is Optimal at 35 U/L.

### Hemoglobin (`hemoglobin`)

- Alias: haemoglobin; hgb; hb; hemoglobin_g_l; haemoglobinestimation; haemoglobin_estimation; haemoglobin_estimation_hb; haemoglobin_hb; hemoglobingl; hemoglobingdl; haemoglobingl; haemoglobingdl
- Normal range: 120 - 175 g/L
- Description: Oxygen-carrying protein in red blood cells.
- Risk categories: Hematology
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=166
- Insight: Your Hemoglobin is Optimal at 166 g/L.

### Hematocrit (`hematocrit`)

- Alias: —
- Normal range: 0.36 - 0.50 L/L
- Description: The proportion of blood made up of red blood cells.
- Risk categories: 
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=0.48
- Insight: Your Hematocrit is Optimal at 0.48 L/L.

### White Blood Cell (WBC) (`wbc`)

- Alias: whitebloodcell; total_white_cell_count; total_white_cell_count_10_9_l; white_blood_cell_count
- Normal range: 4.5 - 11.0 K/uL
- Description: Total white blood cell count for immune function.
- Risk categories: Hematology
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=5.7
- Insight: Your White Blood Cell count is Optimal at 5.7 10*9/L.

### Platelets (`platelets`)

- Alias: plateletcount; platelet; platelet_count_10_9_l; platelet_count
- Normal range: 150 - 450 K/uL
- Description: Cells responsible for blood clotting and wound repair.
- Risk categories: Hematology
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=227
- Insight: Your Platelets are Optimal at 227 10*9/L.

### Serum Albumin (`serum_albumin`)

- Alias: albumin; serumalbumin; serum_albumin_g_l
- Normal range: 35 - 50 g/L
- Description: Main protein produced by the liver, keeping fluid balance in vessels.
- Risk categories: Liver; Kidney
- Custom range (dictionary): —
- Status (computed): **Optimal**
- Logs: 2026-06-05=46
- Insight: Your Serum Albumin is Optimal at 46 g/L.

### Total Protein (`total_protein`)

- Alias: serumtotalprotein; serum_total_protein_g_l; serum_total_protein
- Normal range: 60 - 80 g/L
- Description: Measures the total amount of protein in your blood.
- Risk categories: Liver; Kidney
- Custom range (dictionary): —
- Status (computed): **Elevated**
- Logs: 2026-06-05=81
- Insight: Your Total Protein is Elevated at 81 g/L for a 43-year-old Chinese male.


## Instruction notes

- Hits: dictionary locked; agent only `medicalInsight` / overlay. Misses: pending draft.
- Status is computed+sanitized in TS (never Critical on chronic). Insight cites it; Optimal = 1 sentence; else profile + trend.
- HbA1c 40 is Elevated from brackets, not outside 20–41.
- Contract: `TEMPLATE.md` + `template.ts`.
