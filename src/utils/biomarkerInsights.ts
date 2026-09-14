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

  // Generic fallback for any other biomarker
  const name = def.name;
  const unit = def.unit || '';
  const statusLabel = status || 'Normal';

  if (statusLabel.toLowerCase() === 'healthy' || statusLabel.toLowerCase() === 'normal' || statusLabel.toLowerCase() === 'optimal') {
    return `Your ${name} level of ${valStr} is optimal and falls within the recommended healthy reference range of ${def.normalRange} ${unit}. For a ${ageStr} ${ethnicityStr} ${genderStr}, maintaining this level signifies stable homeostasis and supports overall vitality. Continuing your current dietary and exercise habits will help sustain these protective biomarkers.`;
  } else if (statusLabel.toLowerCase().includes('high')) {
    return `Your ${name} level of ${valStr} is elevated above the standard reference range (${def.normalRange} ${unit}), falling into the 'High' category. For a ${ageStr} ${ethnicityStr} ${genderStr}, this elevation warrants attention. Depending on clinical history, implementing targeted nutritional adjustments, stress management, or physical exercise is highly recommended to bring this marker back into balance.`;
  } else if (statusLabel.toLowerCase().includes('low')) {
    return `Your ${name} level of ${valStr} is below the optimal reference range (${def.normalRange} ${unit}), falling into the 'Low' category. For a ${ageStr} ${ethnicityStr} ${genderStr}, this low level can be associated with sub-optimal nutrient absorption or metabolic efficiency. Prioritizing dietary reinforcement or targeted supplementation is recommended to restore healthy baseline activity.`;
  } else {
    return `Your ${name} level is registered at ${valStr}. For a ${ageStr} ${ethnicityStr} ${genderStr}, maintaining this biomarker within the recommended target range of ${def.normalRange} is essential for systemic health. Regular monitoring and balanced clinical tracking are advised to optimize your metabolic and cardiorenal wellness.`;
  }
}
