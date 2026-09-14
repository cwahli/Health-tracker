/**
 * Single per-analyte conversion table (QUALITY.md SECOND_MATH_PATH).
 * Unknown pair → refuse. Locked G-B1 outputs:
 *   HDL 50×0.02586=1.293 · TG 125×0.01129=1.411 · LDL 130×0.02586=3.362
 *   creat 0.9×88.4=79.56 · bili 0.8×17.1=13.68
 */
export type AnalyteConversionSpec = { from: string; to: string; multiply: number };

export const ANALYTE_CONVERSIONS: Record<string, AnalyteConversionSpec> = {
  hdl: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  ldl: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  total_cholesterol: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  non_hdl_cholesterol: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  vldl_cholesterol: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  vldl: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  triglycerides: { from: 'mg/dl', to: 'mmol/l', multiply: 0.01129 },
  fasting_glucose: { from: 'mg/dl', to: 'mmol/l', multiply: 0.0555 },
  glucose: { from: 'mg/dl', to: 'mmol/l', multiply: 0.0555 },
  creatinine: { from: 'mg/dl', to: 'umol/l', multiply: 88.4 },
  total_bilirubin: { from: 'mg/dl', to: 'umol/l', multiply: 17.1 },
  direct_bilirubin: { from: 'mg/dl', to: 'umol/l', multiply: 17.1 },
  bilirubin: { from: 'mg/dl', to: 'umol/l', multiply: 17.1 },
  hemoglobin: { from: 'g/dl', to: 'g/l', multiply: 10 },
  mean_corpuscular_hemoglobin_concentration: { from: 'g/dl', to: 'g/l', multiply: 10 },
  mchc: { from: 'g/dl', to: 'g/l', multiply: 10 },
  hematocrit: { from: '%', to: 'l/l', multiply: 0.01 },
  albumin: { from: 'g/dl', to: 'g/l', multiply: 10 },
  serum_albumin: { from: 'g/dl', to: 'g/l', multiply: 10 },
  total_protein: { from: 'g/dl', to: 'g/l', multiply: 10 },
  serum_globulin: { from: 'g/dl', to: 'g/l', multiply: 10 },
  globulin: { from: 'g/dl', to: 'g/l', multiply: 10 },
  uric_acid: { from: 'mg/dl', to: 'umol/l', multiply: 59.48 },
  calcium: { from: 'mg/dl', to: 'mmol/l', multiply: 0.2495 },
  serum_calcium: { from: 'mg/dl', to: 'mmol/l', multiply: 0.2495 },
  serum_adjusted_calcium: { from: 'mg/dl', to: 'mmol/l', multiply: 0.2495 },
  serum_inorganic_phosphate: { from: 'mg/dl', to: 'mmol/l', multiply: 0.3229 },
  phosphate: { from: 'mg/dl', to: 'mmol/l', multiply: 0.3229 },
};

export function specForAnalyte(mappedKey: string, customDef?: any): AnalyteConversionSpec | undefined {
  if (customDef?.conversions && Array.isArray(customDef.conversions) && customDef.conversions.length > 0) {
    return customDef.conversions[0];
  }
  return ANALYTE_CONVERSIONS[mappedKey];
}
