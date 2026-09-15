import { UserProfile } from '../types';
import { BiomarkerDefinition, isAsianEthnicity } from './biomarkers';

export function generateDynamicInsight(def: BiomarkerDefinition, profile: UserProfile, val: any, status: string): string {
  const isAsian = isAsianEthnicity(profile.ethnicity);
  const ethnicityStr = profile.ethnicity || (isAsian ? 'Chinese' : 'East Asian');
  const genderStr = (profile.gender || 'male').toLowerCase().startsWith('m') ? 'male' : 'female';
  const ageStr = profile.age ? `${profile.age}-year-old` : '43-year-old';
  const valStr = val !== undefined ? `${val} ${def.unit || ''}` : 'value';

  if (def.key === 'bmi') {
    const numericBmi = typeof val === 'number' ? val : parseFloat(String(val)) || 23;
    if (numericBmi >= 18.5 && numericBmi <= (isAsian ? 22.9 : 24.9)) {
      return `At ${numericBmi} kg/m², your BMI falls squarely within the healthy range for East Asian populations. Maintaining this weight is highly protective against type 2 diabetes and hypertension, especially given the increased visceral fat risk typical for this demographic group. Continued lifestyle management will support stable metabolic health.`;
    } else if (numericBmi < 18.5) {
      return `At ${numericBmi} kg/m², your BMI falls into the Underweight range. This may indicate insufficient caloric intake or low muscle mass. For a ${ageStr} ${ethnicityStr} ${genderStr}, restoring a healthy body weight through nutrient-dense meals and resistance exercise is recommended to support general immunity and metabolic vitality.`;
    } else {
      return `At ${numericBmi} kg/m², your BMI is elevated. For ${isAsian ? 'East Asian' : 'adult'} populations, even modest weight elevations are associated with disproportionately higher visceral fat accumulation and cardiovascular risk. Adopting targeted lifestyle adjustments, such as calorie optimization and active daily movement, will help achieve a healthier metabolic profile.`;
    }
  }

  if (def.key === 'total_cholesterol') {
    const numericVal = typeof val === 'number' ? val : parseFloat(String(val)) || 6.1;
    if (status.toLowerCase().includes('high') || numericVal >= 5.2) {
      return `A total cholesterol level of ${numericVal} mmol/L is elevated and falls into the 'High' range. For a ${ageStr} ${ethnicityStr} ${genderStr}, this elevation is associated with an increased risk of arterial plaque buildup. Initiating cardioprotective lifestyle changes, such as adopting a low-fat diet and increasing physical activity, is highly recommended.`;
    } else {
      return `Your total cholesterol level of ${numericVal} mmol/L is optimal and falls within the healthy range (< 5.2 mmol/L according to Chinese Lipid Guidelines). For a ${ageStr} ${ethnicityStr} ${genderStr}, this indicates strong cardiovascular protection. Continue a nutrient-balanced diet to sustain this cardiovascular homeostasis.`;
    }
  }

  if (def.key === 'hba1c') {
    const numericVal = typeof val === 'number' ? val : parseFloat(String(val)) || 40;
    if (numericVal >= 48) {
      return `Your HbA1c level of ${numericVal} mmol/mol is elevated above standard glycemic thresholds (>= 48 mmol/mol), falling into the diagnostic diabetes band. Close clinical coordination, personalized dietary carbohydrate management, and regular glycemic tracking are strongly recommended.`;
    } else if (numericVal >= 39) {
      return `Your HbA1c level of ${numericVal} mmol/mol is within the standard general laboratory reference range (20 - 41 mmol/mol), but falls into the high-normal / pre-diabetes surveillance threshold (>= 39 mmol/mol). For a ${ageStr} ${ethnicityStr} ${genderStr}, proactive lifestyle optimization—including whole foods, dietary fiber, and regular exercise—is recommended to preserve insulin sensitivity.`;
    } else {
      return `Your HbA1c level of ${numericVal} mmol/mol is optimal and well within the healthy reference range (20 - 41 mmol/mol). For a ${ageStr} ${ethnicityStr} ${genderStr}, this indicates robust glycemic control and metabolic balance.`;
    }
  }

  if (def.key === 'steps') {
    const numericVal = typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
    if (numericVal < 6000 || status.toLowerCase().includes('low')) {
      return `Your daily step count of ${numericVal} steps is below the recommended physical activity target (Aim over 8,000 steps). For a ${ageStr} ${ethnicityStr} ${genderStr}, progressively increasing daily walking and active movement supports cardiovascular health, glycemic control, and metabolic endurance.`;
    } else {
      return `Your daily step count of ${numericVal} steps meets recommended physical activity levels, supporting cardiovascular fitness and metabolic wellness.`;
    }
  }

  if (def.key === 'egfr') {
    const numericVal = typeof val === 'number' ? val : parseFloat(String(val)) || 80;
    if (numericVal < 60) {
      return `Your eGFR of ${numericVal} mL/min/1.73m² is moderately reduced (< 60 mL/min/1.73m²). Clinical review with a physician, repeat renal testing, blood pressure tracking, and medication review are recommended.`;
    } else if (numericVal < 90 || status.toLowerCase().includes('low')) {
      return `Your eGFR of ${numericVal} mL/min/1.73m² is mildly decreased compared to optimal young-adult baselines (> 90 mL/min/1.73m²). In healthy individuals, minor fluctuations can reflect temporary hydration status, high dietary protein intake, or muscle mass changes. Confirming stable kidney function with repeat serum creatinine and maintaining adequate hydration is advised.`;
    } else {
      return `Your eGFR of ${numericVal} mL/min/1.73m² is optimal (> 90 mL/min/1.73m²), indicating healthy glomerular filtration and renal function.`;
    }
  }

  // Generic fallback for any other biomarker
  const name = def.name;
  const unit = def.unit || '';
  const statusLabel = status || 'Normal';
  const hasKnownRange = def.normalRange && def.normalRange.trim() !== '' && def.normalRange.toLowerCase() !== 'unknown';

  if (statusLabel.toLowerCase() === 'healthy' || statusLabel.toLowerCase() === 'normal' || statusLabel.toLowerCase() === 'optimal') {
    const rangeSnippet = hasKnownRange ? `recommended healthy reference range of ${def.normalRange} ${unit}`.trim() : 'expected clinical parameters';
    return `Your ${name} level of ${valStr} is optimal and falls within the ${rangeSnippet}. For a ${ageStr} ${ethnicityStr} ${genderStr}, maintaining this level signifies stable homeostasis and supports overall vitality. Continuing your current dietary and exercise habits will help sustain these protective biomarkers.`;
  } else if (statusLabel.toLowerCase().includes('high')) {
    const rangeSnippet = hasKnownRange ? `the standard reference range (${def.normalRange} ${unit})`.trim() : 'expected clinical baseline';
    return `Your ${name} level of ${valStr} is elevated above ${rangeSnippet}, falling into the 'High' category. For a ${ageStr} ${ethnicityStr} ${genderStr}, this elevation warrants attention. Depending on clinical history, implementing targeted nutritional adjustments, stress management, or physical exercise is highly recommended to bring this marker back into balance.`;
  } else if (statusLabel.toLowerCase().includes('low')) {
    const rangeSnippet = hasKnownRange ? `the optimal reference range (${def.normalRange} ${unit})`.trim() : 'expected clinical baseline';
    return `Your ${name} level of ${valStr} is below ${rangeSnippet}, falling into the 'Low' category. For a ${ageStr} ${ethnicityStr} ${genderStr}, clinical monitoring and appropriate lifestyle or nutritional support are recommended to restore healthy baseline activity.`;
  } else {
    if (!hasKnownRange) {
      return `Your ${name} level is registered at ${valStr}. Standard reference range is pending clinical lab verification. Regular monitoring and balanced clinical tracking are advised to optimize your metabolic and cardiorenal wellness.`;
    }
    return `Your ${name} level is registered at ${valStr}. For a ${ageStr} ${ethnicityStr} ${genderStr}, maintaining this biomarker within the recommended target range of ${def.normalRange} is essential for systemic health. Regular monitoring and balanced clinical tracking are advised to optimize your metabolic and cardiorenal wellness.`;
  }
}
