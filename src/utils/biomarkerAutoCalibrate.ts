import React from 'react';
import { getMergedBiomarkerDef } from '../utils/biomarkers';

/** Q-13 (move-only): moved verbatim out of BiomarkerDictionaryModal.tsx. */
export const autoCalibrateBiomarkerDef = (key: string, builtInDef?: any, customDef?: any) => {
  const merged = getMergedBiomarkerDef(key, builtInDef, customDef);
  const kLower = key.toLowerCase();
  
  // Name
  let name = merged.name || key;
  if (!name || name === key) {
    name = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Unit inference
  let unit = merged.unit || '';
  if (!unit || unit.trim() === '' || unit === 'Unknown') {
    if (builtInDef?.unit && builtInDef.unit !== 'Unknown') unit = builtInDef.unit;
    else if (kLower.includes('glucose') || kLower.includes('cholesterol') || kLower.includes('triglycerides') || kLower.includes('ldl') || kLower.includes('hdl') || kLower.includes('creatinine') || kLower.includes('bilirubin') || kLower.includes('urea') || kLower.includes('calcium') || kLower.includes('uric')) unit = 'mmol/L';
    else if (kLower.includes('hba1c') || kLower.includes('percentage') || kLower.includes('ratio')) unit = '%';
    else if (kLower.includes('pressure') || kLower.includes('systolic') || kLower.includes('diastolic')) unit = 'mmHg';
    else if (kLower.includes('heart') || kLower.includes('pulse') || kLower.includes('rate') || kLower.includes('bpm')) unit = 'bpm';
    else if (kLower.includes('weight') || kLower.includes('mass')) unit = 'kg';
    else if (kLower.includes('height')) unit = 'cm';
    else if (kLower.includes('drinking') || kLower.includes('audit') || kLower.includes('frequency') || kLower.includes('score') || kLower.includes('scale') || kLower.includes('index') || kLower.includes('count') || kLower.includes('hdss')) unit = 'score';
    else if (kLower.includes('ast') || kLower.includes('alt') || kLower.includes('alp') || kLower.includes('ggt')) unit = 'U/L';
    else if (kLower.includes('hemoglobin') || kLower.includes('protein') || kLower.includes('albumin')) unit = 'g/dL';
    else unit = 'units';
  }

  // Normal Range inference
  let normalRange = merged.normalRange || '';
  if (!normalRange || normalRange.trim() === '' || normalRange === 'Unknown') {
    if (builtInDef?.normalRange && builtInDef.normalRange !== 'Unknown') normalRange = builtInDef.normalRange;
    else if (kLower.includes('fasting_glucose') || kLower.includes('glucose')) normalRange = '3.9 - 5.6';
    else if (kLower.includes('hba1c')) normalRange = '< 5.7';
    else if (kLower.includes('total_cholesterol')) normalRange = '< 5.2';
    else if (kLower.includes('ldl')) normalRange = '< 3.4';
    else if (kLower.includes('hdl')) normalRange = '> 1.0';
    else if (kLower.includes('triglycerides')) normalRange = '< 1.7';
    else if (kLower.includes('systolic')) normalRange = '< 120';
    else if (kLower.includes('diastolic')) normalRange = '< 80';
    else if (kLower.includes('heart_rate') || kLower.includes('pulse')) normalRange = '60 - 100';
    else if (kLower.includes('drinking') || kLower.includes('audit')) normalRange = '0 - 4';
    else normalRange = 'Normal';
  }

  // Standard Medical Grouping
  let standardMedicalGrouping = merged.standardMedicalGrouping;
  if (!standardMedicalGrouping || standardMedicalGrouping.trim() === '' || standardMedicalGrouping === 'Other' || standardMedicalGrouping === 'By Medical Practice') {
    if (builtInDef?.standardMedicalGrouping && builtInDef.standardMedicalGrouping !== 'By Medical Practice' && builtInDef.standardMedicalGrouping !== 'Other') {
      standardMedicalGrouping = builtInDef.standardMedicalGrouping;
    } else if (kLower.includes('glucose') || kLower.includes('hba1c') || kLower.includes('insulin') || kLower.includes('lipid') || kLower.includes('cholesterol') || kLower.includes('triglyceride')) {
      standardMedicalGrouping = 'Metabolism & Diabetes';
    } else if (kLower.includes('pressure') || kLower.includes('heart') || kLower.includes('cardio') || kLower.includes('pulse')) {
      standardMedicalGrouping = 'Cardiovascular & Blood Pressure';
    } else if (kLower.includes('drinking') || kLower.includes('audit') || kLower.includes('sleep') || kLower.includes('smoke') || kLower.includes('diet') || kLower.includes('exercise')) {
      standardMedicalGrouping = 'Lifestyle & Preventive Health';
    } else if (kLower.includes('alt') || kLower.includes('ast') || kLower.includes('liver') || kLower.includes('bilirubin')) {
      standardMedicalGrouping = 'Liver Function';
    } else if (kLower.includes('kidney') || kLower.includes('creatinine') || kLower.includes('egfr') || kLower.includes('bun')) {
      standardMedicalGrouping = 'Renal & Kidney Function';
    } else if (kLower.includes('hemorrhoid') || kLower.includes('gastro') || kLower.includes('bowel') || kLower.includes('stool') || kLower.includes('gut') || kLower.includes('digest')) {
      standardMedicalGrouping = 'Gastrointestinal & Digestive Health';
    } else if (kLower.includes('symptom') || kLower.includes('score') || kLower.includes('scale') || kLower.includes('index') || kLower.includes('assessment')) {
      standardMedicalGrouping = 'Clinical Scores & Symptoms';
    } else {
      standardMedicalGrouping = 'General Health';
    }
  }

  // Risk Categories
  let riskCategories = merged.riskCategories;
  if (!Array.isArray(riskCategories) || riskCategories.length === 0 || riskCategories.includes('Uncategorized')) {
    if (builtInDef?.riskCategories && builtInDef.riskCategories.length > 0 && !builtInDef.riskCategories.includes('Uncategorized')) {
      riskCategories = builtInDef.riskCategories;
    } else if (kLower.includes('hemorrhoid') || kLower.includes('gastro') || kLower.includes('digest')) {
      riskCategories = ['Gastrointestinal Health'];
    } else {
      riskCategories = ['General Health'];
    }
  }

  // Potential Medical Conditions
  let potentialMedicalConditions = merged.potentialMedicalConditions;
  if (!Array.isArray(potentialMedicalConditions) || potentialMedicalConditions.length === 0) {
    if (builtInDef?.potentialMedicalConditions && builtInDef.potentialMedicalConditions.length > 0) {
      potentialMedicalConditions = builtInDef.potentialMedicalConditions;
    } else if (kLower.includes('hemorrhoid')) {
      potentialMedicalConditions = ['Hemorrhoidal Disease'];
    } else {
      potentialMedicalConditions = ['General Wellness'];
    }
  }

  return {
    name,
    unit,
    normalRange,
    standardMedicalGrouping,
    riskCategories,
    potentialMedicalConditions
  };
};
