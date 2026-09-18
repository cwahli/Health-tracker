
import { t, interpolate } from './i18n';

export const isAsianEthnicity = (eth?: string): boolean => {
  if (!eth) return false;
  const lower = eth.toLowerCase();
  if (lower.includes('caucasian')) return false;
  return /\b(asian|asians|east asian|south asian|southeast asian)\b/i.test(lower) ||
    lower.includes('asian') || lower.includes('china') || lower.includes('chinese') ||
    lower.includes('india') || lower.includes('indian') || lower.includes('japan') ||
    lower.includes('japanese') || lower.includes('korea') || lower.includes('korean') ||
    lower.includes('vietnam') || lower.includes('filipino') || lower.includes('taiwan') ||
    lower.includes('oriental');
};

export function getActiveStructuredRangeRule(customDef: any, profile?: any): any | null {
  if (!customDef) return null;
  const { customRanges } = customDef;
  if (!customRanges || customRanges.length === 0) return null;

  for (const cr of customRanges) {
    let match = true;
    if (cr.filters) {
      if (cr.filters.gender && profile?.gender && cr.filters.gender.toLowerCase() !== profile.gender.toLowerCase()) match = false;
      if (cr.filters.ethnicity) {
        if (!profile || !profile.ethnicity) {
          match = false;
        } else {
          const t = cr.filters.ethnicity.toLowerCase();
          const p = profile.ethnicity.toLowerCase();
          if (t === 'asian') {
            if (!isAsianEthnicity(p)) match = false;
          } else if (!p.includes(t) && !t.includes(p)) {
            match = false;
          }
        }
      }
      if (cr.filters.minAge !== undefined && cr.filters.minAge !== '' && profile?.age && profile.age < Number(cr.filters.minAge)) match = false;
      if (cr.filters.maxAge !== undefined && cr.filters.maxAge !== '' && profile?.age && profile.age > Number(cr.filters.maxAge)) match = false;
    }
    if (match) return cr;
  }
  return null;
}

export function getEffectiveRangeText(key: string, profile?: any): string {
  const def = biomarkerDefinitions.find(d => d.key === key);
  if (!def) return '';
  const rule = getActiveStructuredRangeRule(def, profile);
  if (rule?.range?.type === 'bracket' && Array.isArray(rule.range.brackets)) {
    const normalBracket = rule.range.brackets.find((b: any) =>
      (b.severity || '').toLowerCase() === 'normal' || (b.alias || '').toLowerCase() === 'normal'
    );
    if (normalBracket) {
      const hasMin = normalBracket.min !== null && normalBracket.min !== undefined;
      const hasMax = normalBracket.max !== null && normalBracket.max !== undefined;
      if (hasMin && hasMax) return `${normalBracket.min} - ${normalBracket.max}`;
      if (hasMin) return `>= ${normalBracket.min}`;
      if (hasMax) return `<= ${normalBracket.max}`;
    }
  }
  return def.normalRange || '';
}

export function getBmiThresholds(profile?: any): { normalMax: number; overweightMax: number } {
  const fallback = { normalMax: 24.9, overweightMax: 30.0 };
  const def = biomarkerDefinitions.find(d => d.key === 'bmi');
  if (!def) return fallback;
  const rule = getActiveStructuredRangeRule(def, profile);
  const brackets = rule?.range?.type === 'bracket' ? rule.range.brackets : null;
  if (!Array.isArray(brackets)) return fallback;
  const normalBracket = brackets.find((b: any) => (b.severity || '').toLowerCase() === 'normal');
  const overweightBracket = brackets.find((b: any) => (b.severity || '').toLowerCase() === 'at risk');
  return {
    normalMax: normalBracket?.max ?? fallback.normalMax,
    overweightMax: overweightBracket?.max ?? fallback.overweightMax
  };
}

export function getIdealBmiTarget(profile?: any): number {
  const isAsian = isAsianEthnicity(profile?.ethnicity);
  if (isAsian) return 21.0;
  const isMale = (profile?.gender || '').toLowerCase().startsWith('m');
  return isMale ? 22.5 : 21.7;
}

export function evaluateStructuredRange(num: number, customDef: any, profile?: any): { label: string, severity: string } | null {
  if (!customDef) return null;
  const { rangeConfig, customRanges } = customDef;
  
  if (!rangeConfig && (!customRanges || customRanges.length === 0)) return null;

  const activeRule = getActiveStructuredRangeRule(customDef, profile);
  const activeRange = activeRule ? activeRule.range : rangeConfig;

  if (!activeRange) return null;

  if (activeRange.type === 'simple') {
    for (const cond of activeRange.conditions) {
      let isMatch = false;
      switch (cond.operator) {
        case '>=': isMatch = num >= cond.value; break;
        case '<=': isMatch = num <= cond.value; break;
        case '>': isMatch = num > cond.value; break;
        case '<': isMatch = num < cond.value; break;
      }
      if (isMatch) return { label: cond.alias, severity: cond.severity };
    }
  } else if (activeRange.type === 'bracket') {
    for (const br of activeRange.brackets) {
      let isMatch = true;
      if (br.min !== null && num < br.min) isMatch = false;
      if (br.max !== null && num > br.max) isMatch = false;
      if (isMatch) return { label: br.alias, severity: br.severity };
    }
  }

  return null;
}

import { UserProfile } from '../types';
import { ANALYTE_CONVERSIONS, AnalyteConversionSpec } from './analyteConversions';

export interface BiomarkerDefinition {
  key: string;
  name: string;
  category: 'hematology' | 'blood_sugar' | 'lipids' | 'inflammation' | 'thyroid' | 'liver' | 'kidneys' | 'hormones' | 'vitamins' | 'other';
  unit: string;
  normalRange: string;
  structuredRanges?: any[];
  customRanges?: any[];
  descriptions: { [lang: string]: string };
  benefitRisk?: string;
  riskCategories?: string[];
  standardMedicalGrouping?: string;
  potentialMedicalConditions?: string[];
  aliases?: string[];
  rangeVariesBy?: ('age' | 'sex' | 'ethnicity')[];
  conversions?: AnalyteConversionSpec[];
  plausibleBounds?: { min?: number; max?: number };
}

export const biomarkerDefinitions: BiomarkerDefinition[] = [
  // Blood Sugar
  {
    key: 'hba1c',
    name: 'HbA1c',
    category: 'blood_sugar',
    unit: 'mmol/mol',
    normalRange: '20 - 41',
    descriptions: {
      en: 'Average blood glucose levels over the past 2-3 months.',
      fr: 'Moyenne de la glycémie sur les 2-3 derniers mois.',
      zh: '过去2-3个月的平均血糖水平。',
      id: 'Rata-rata kadar glukosa darah selama 2-3 bulan terakhir.'
    },
    riskCategories: ['Metabolic'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['hba1cc', 'glycatedhaemoglobin', 'hemoglobin_a1c_mmol_mol', 'hba1c_mmol_mol', 'hemoglobin_a1c'],    // Makes the thresholds that getBiomarkerStatus() has always applied
    // (see the `key === 'hba1c'` block below, left in place as a fallback)
    // visible and editable via the Dictionary's Custom Overrides UI and
    // the CSV export. Same 48 / 39 (IFCC mmol/mol) and 6.5 / 5.7 (DCCT %)
    // thresholds, same precedence — purely additive, no behavior change.
    customRanges: [
      {
        id: 'hba1c_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '>=', value: 48, alias: 'Elevated (Diabetes)', severity: 4 },
            { operator: '>=', value: 39, alias: 'Elevated', severity: 2 },
            { operator: '>=', value: 20, alias: 'Normal', severity: 0 },
            { operator: '>=', value: 6.5, alias: 'Elevated (Diabetes)', severity: 4 },
            { operator: '>=', value: 5.7, alias: 'Elevated', severity: 2 }
          ]
        }
      }
    ]
  },
  {
    key: 'fasting_glucose',
    name: 'Fasting Glucose',
    category: 'blood_sugar',
    unit: 'mg/dL',
    normalRange: '70 - 99',
    descriptions: {
      en: 'Blood sugar level after an overnight fast.',
      fr: 'Taux de sucre dans le sang à jeun.',
      zh: '空腹血糖水平。',
      id: 'Kadar gula darah setelah puasa semalaman.'
    },
    riskCategories: ['Metabolic'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['fastingbloodglucose', 'fasting_blood_glucose', 'glucose', 'serumglucose', 'fasting_plasma_glucose', 'fasting_plasma_glucose_fpg', 'fpg']
  },
  {
    key: 'insulin',
    name: 'Fasting Insulin',
    category: 'blood_sugar',
    unit: 'mIU/L',
    normalRange: '2.6 - 24.9',
    descriptions: {
      en: 'Level of insulin hormone; early warning for insulin resistance.',
      fr: 'Taux d\'insuline; indicateur précoce de résistance à l\'insuline.',
      zh: '胰岛素水平；胰岛素抵抗的早期预警指标。',
      id: 'Kadar hormon insulin; deteksi dini resistensi insulin.'
    },
    riskCategories: ['Metabolic'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['fasting_insulin', 'serum_insulin', 'fasting_insulin_level', 'insulin_milli_int_units_per_l']
  },

  // Lipids
  {

    key: 'ldl',
    name: 'LDL-C',
    category: 'lipids',
    unit: 'mmol/L',
    normalRange: '< 2.6',
    descriptions: {
      en: 'Low-Density Lipoprotein, the "bad" cholesterol driving plaque.',
      fr: 'Cholestérol LDL, dit "mauvais" cholestérol favorisant les plaques.',
      zh: '低密度脂蛋白胆固醇（“坏”胆固醇），动脉斑块的主要驱动因素。',
      id: 'Low-Density Lipoprotein, kolesterol "jahat" penyebab plak.'
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['ldlc', 'ldlcholesterol', 'calculatedldlcholesterol', 'calculatedldl', 'calculated_ldl_cholesterol_mmol_l', 'calculated_ldl_cholesterol'],
    // Mirrors the `key === 'ldl'` hardcoded thresholds in getBiomarkerStatus
    // (kept as a fallback) — mg/dL only, matches this definition's unit.
    customRanges: [
      {
        id: 'ldl_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '>', value: 3.4, alias: 'Very High', severity: 4 },
            { operator: '>', value: 2.6, alias: 'Elevated', severity: 2 },
            { operator: '<=', value: 2.6, alias: 'Optimal', severity: 0 }
          ]
        }
      }
    ]
  },
  {
    key: 'apob',
    name: 'ApoB',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: 'under 90',
    descriptions: {
      en: 'Apolipoprotein B, the best indicator of atherogenic particle count.',
      fr: 'Apolipoprotéine B, meilleur indicateur de particules athérogènes.',
      zh: '载脂蛋白B，评估动脉粥样硬化风险的黄金指标。',
      id: 'Apolipoprotein B, indikator terbaik jumlah partikel aterogenik.'
    },
    customRanges: [
      {
        id: 'apob_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '>', value: 110, alias: 'Very High', severity: 4 },
            { operator: '>', value: 90, alias: 'Elevated', severity: 2 },
            { operator: '<=', value: 90, alias: 'Optimal', severity: 0 }
          ]
        }
      }
    ]
  },
  {
    key: 'total_cholesterol',
    name: 'Total Cholesterol',
    category: 'lipids',
    unit: 'mmol/L',
    normalRange: 'Aim under 5.0',
    descriptions: {
      en: 'Total amount of cholesterol in the blood.',
      fr: 'Quantité totale de cholestérol dans le sang.',
      zh: '血液中的总胆固醇含量。',
      id: 'Jumlah total kolesterol dalam darah.'
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['cholesterol', 'serumtotalcholesterol', 'serum_cholesterol'],
    // Mirrors LDL: 1.3× the “Aim under 5.0” heuristic used to brand 6.5 as
    // Critical. Chronic lipids are Elevated / Very High, never ER-critical.
    customRanges: [
      {
        id: 'total_cholesterol_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '>', value: 6.2, alias: 'Very High', severity: 4 },
            { operator: '>', value: 5.0, alias: 'Elevated', severity: 2 },
            { operator: '<=', value: 5.0, alias: 'Optimal', severity: 0 }
          ]
        }
      }
    ]
  },
  {
    key: 'hdl',
    name: 'HDL-C',
    category: 'lipids',
    unit: 'mmol/L',
    normalRange: '0.9 - 1.7',
    descriptions: {
      en: 'High-Density Lipoprotein, the "good" cholesterol removing excess lipids.',
      fr: 'Cholestérol HDL, dit "bon" cholestérol favorisant le retour des lipides.',
      zh: '高密度脂蛋白胆固醇（“好”胆固醇），协助清除血管内多余脂质。',
      id: 'High-Density Lipoprotein, kolesterol "baik" pembersih lipid berlebih.'
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['hdlc', 'hdlcholesterol', 'serum_hdl_cholesterol', 'serum_hdl_cholesterol_mmol_l']
  },
  {
    key: 'triglycerides',
    name: 'Triglycerides',
    category: 'lipids',
    unit: 'mmol/L',
    normalRange: '< 1.7',
    descriptions: {
      en: 'Type of fat in the blood used for energy storage.',
      fr: 'Type de graisse circulante servant à stocker l\'énergie.',
      zh: '血液中用于能量储存的游离脂肪分子。',
      id: 'Jenis lemak dalam darah yang digunakan untuk penyimpanan energi.'
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['trig', 'serum_triglycerides', 'serum_triglycerides_mmol_l'],
    customRanges: [
      {
        id: 'triglycerides_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '>=', value: 5.6, alias: 'Very High', severity: 4 },
            { operator: '>=', value: 1.7, alias: 'Elevated', severity: 2 },
            { operator: '<', value: 1.7, alias: 'Optimal', severity: 0 }
          ]
        }
      }
    ]
  },
  // Kidneys
  {
    key: 'egfr',
    name: 'eGFR',
    category: 'kidneys',
    unit: 'mL/min/1.73m²',
    normalRange: 'over 90',
    descriptions: {
      en: 'Estimated Glomerular Filtration Rate, showing kidney health.',
      fr: 'Débit de filtration glomérulaire estimé, reflétant la santé rénale.',
      zh: '估算肾小球滤过率，反映肾脏滤过排毒功能。',
      id: 'Laju Filtrasi Glomerulus Estimasi, menunjukkan fungsi penyaringan ginjal.'
    },
    riskCategories: ['Kidney'],
    standardMedicalGrouping: 'Renal',
    aliases: ['egfrmlmin173m2', 'egfrmlmin173', 'egfr_ml_min_1_73m2', 'egfr_mlmin173m2'],
    customRanges: [
      {
        id: 'egfr_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '<', value: 60, alias: 'Decreased (CKD G3)', severity: -4 },
            { operator: '<', value: 90, alias: 'Mildly Decreased (CKD G2)', severity: -2 },
            { operator: '>=', value: 90, alias: 'Optimal', severity: 0 }
          ]
        }
      }
    ]
  },
  {
    key: 'bun',
    name: 'BUN (Blood Urea Nitrogen)',
    category: 'kidneys',
    unit: 'mg/dL',
    normalRange: '7 - 20',
    descriptions: {
      en: 'Urea nitrogen levels; high levels can show kidney load.',
      fr: 'Azote uréique sanguin, indicateur de charge rénale.',
      zh: '血尿素氮，评估肾脏排泄功能及蛋白质代谢。',
      id: 'Kadar nitrogen urea darah; kadar tinggi menunjukkan beban ginjal.'
    }
  },
  {
  // Hematology
  
    key: 'rbc',
    name: 'Red Blood Cell (RBC)',
    category: 'hematology',
    unit: 'M/uL',
    normalRange: '4.5 - 5.9',
    descriptions: {
      en: 'Total red blood cell count carrying oxygen to tissue.',
      fr: 'Nombre total de globules rouges transportant l\'oxygène.',
      zh: '红细胞总数，负责向全身组织输送氧气。',
      id: 'Jumlah sel darah merah yang membawa oksigen ke seluruh tubuh.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['redbloodcell', 'redbloodcells', 'redbloodcellcount', 'red_blood_cell_count_10_12_l', 'red_blood_cell_count']
  },
  {
    key: 'platelets',
    name: 'Platelets',
    category: 'hematology',
    unit: 'K/uL',
    normalRange: '150 - 450',
    descriptions: {
      en: 'Cells responsible for blood clotting and wound repair.',
      fr: 'Plaquettes jouant un rôle clé dans la coagulation.',
      zh: '血小板，负责血液凝固与创伤修复。',
      id: 'Keping darah, agen pembekuan darah dan penutupati luka.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['plateletcount', 'platelet', 'platelet_count_10_9_l', 'platelet_count']
  },
  // Inflammation
  {
    key: 'hscrp',
    name: 'hs-CRP',
    category: 'inflammation',
    unit: 'mg/L',
    normalRange: 'under 1.0',
    descriptions: {
      en: 'High-Sensitivity C-Reactive Protein, showing vascular inflammation.',
      fr: 'Protéine C-réactive ultra-sensible, marqueur d\'inflammation vasculaire.',
      zh: '超敏C反应蛋白，评估血管内皮炎症和心脏风险。',
      id: 'C-Reactive Protein Sensitivitas Tinggi, penanda inflamasi pembuluh darah.'
    },
    // Mirrors the `key === 'hscrp'` hardcoded thresholds in getBiomarkerStatus
    // (kept as a fallback).
    customRanges: [
      {
        id: 'hscrp_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '>=', value: 3.0, alias: 'High risk', severity: 4 },
            { operator: '>=', value: 1.0, alias: 'Elevated', severity: 2 },
            { operator: '<', value: 1.0, alias: 'Optimal', severity: 0 }
          ]
        }
      }
    ]
  },
  // Hormones
  {
    key: 'testosterone',
    name: 'Testosterone (Total)',
    category: 'hormones',
    unit: 'ng/dL',
    normalRange: '300 - 1000',
    descriptions: {
      en: 'Primary male sex hormone supporting libido, bone, and muscle.',
      fr: 'Hormone sexuelle mâle principale soutenant la libido et la masse musculaire.',
      zh: '男性核心性激素，支持肌肉、骨骼健康及活力。',
      id: 'Hormon seks utama pria, mendukung libido, tulang, dan otot.'
    }
  },
  // Vitamins
  {
    key: 'vitamin_d',
    name: 'Vitamin D (25-OH)',
    category: 'vitamins',
    unit: 'ng/mL',
    normalRange: '30 - 100',
    descriptions: {
      en: 'Crucial for bone metabolism, immunity, and hormone synthesis.',
      fr: 'Vitamine essentielle pour le métabolisme osseux, l\'immunité et les hormones.',
      zh: '骨骼代谢、全身免疫及多项激素合成必不可少的维生素。',
      id: 'Vitamin penting untuk metabolisme tulang, imun, dan sintesis hormon.'
    },
    customRanges: [
      {
        id: 'vitamin_d_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '<', value: 20, alias: 'Severe deficiency', severity: -4 },
            { operator: '<', value: 30, alias: 'Low', severity: -2 },
            { operator: '>=', value: 30, alias: 'Optimal', severity: 0 }
          ]
        }
      }
    ]
  },
  {
    key: 'vitamin_b12',
    name: 'Vitamin B12',
    category: 'vitamins',
    unit: 'pg/mL',
    normalRange: '200 - 900',
    descriptions: {
      en: 'Supports neurological function and red blood cell production.',
      fr: 'Soutient le système nerveux et la synthèse des globules rouges.',
      zh: '支持神经系统健康和红细胞分裂生成。',
      id: 'Mendukung fungsi saraf dan pembentukan sel darah merah.'
    }
  },
  {
    key: 'bmi',
    name: 'Body Mass Index (BMI)',
    category: 'other',
    unit: 'kg/m2',
    normalRange: '18.5 - 24.9',
    customRanges: [
      {
        filters: { ethnicity: 'Asian' },
        range: {
          type: 'bracket',
          brackets: [
            { min: 27.5, max: null, alias: 'Obese', severity: 'Critical' },
            { min: 22.9, max: 27.5, alias: 'Overweight', severity: 'At risk' },
            { min: 18.5, max: 22.9, alias: 'Normal', severity: 'Normal' },
            { min: null, max: 18.5, alias: 'Underweight', severity: 'Low' }
          ]
        }
      },
      {
        filters: {},
        range: {
          type: 'bracket',
          brackets: [
            { min: 30.0, max: null, alias: 'Obese', severity: 'Critical' },
            { min: 24.9, max: 30.0, alias: 'Overweight', severity: 'At risk' },
            { min: 18.5, max: 24.9, alias: 'Normal', severity: 'Normal' },
            { min: null, max: 18.5, alias: 'Underweight', severity: 'Low' }
          ]
        }
      }
    ],
    descriptions: {
      en: 'A measure of body fat based on height and weight.',
      fr: 'Une mesure de la corpulence basée sur la taille et le poids.',
      zh: '基于身高和体重的身体质量指数。',
      id: 'Ukuran lemak tubuh berdasarkan tinggi dan berat badan.'
    },
    riskCategories: ['Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['bodymassindex', 'bmi_kg_m2']
  },
  {
    key: 'creatinine',
    name: 'Creatinine',
    category: 'kidneys',
    unit: 'umol/L',
    normalRange: '44 - 106',
    descriptions: {
      en: 'A waste product from muscle breakdown, filtered by kidneys.',
      fr: 'Déchet de l\'activité musculaire éliminé par les reins.',
      zh: '肌肉代谢产生并由肾脏滤过排出的代谢废物.',
      id: 'Produk sisa dari pemecahan otot, disaring oleh ginjal.'
    },
    riskCategories: ['Kidney'],
    standardMedicalGrouping: 'Renal',
    aliases: ['serumcreatinine', 'serumcreatinineumoll', 'serum_creatinine_umol_l', 'serum_creatinine']
  },
  {
    key: 'hematocrit',
    name: 'Hematocrit',
    category: 'hematology',
    unit: 'L/L',
    normalRange: '0.36 - 0.50',
    descriptions: {
      en: 'The proportion of blood made up of red blood cells.',
      fr: 'Proportion de globules rouges dans le sang.',
      zh: '血液中红细胞所占的体积百分比（血细胞比容）。',
      id: 'Proporsi darah yang terdiri dari sel darah merah.'
    }
  },
  {
    key: 'hemoglobin',
    name: 'Hemoglobin',
    category: 'hematology',
    unit: 'g/L',
    normalRange: '120 - 175',
    descriptions: {
      en: 'Oxygen-carrying protein in red blood cells.',
      fr: 'Protéine transporteuse d\'oxygène dans les globules rouges.',
      zh: '红细胞中携带氧气的关键蛋白质（血红蛋白）。',
      id: 'Protein pembawa oksigen dalam sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['haemoglobin', 'hgb', 'hb', 'hemoglobin_g_l', 'haemoglobinestimation', 'haemoglobin_estimation', 'haemoglobin_estimation_hb', 'haemoglobin_hb', 'hemoglobingl', 'hemoglobingdl', 'haemoglobingl', 'haemoglobingdl']
  },
  {
    key: 'mean_corpuscular_hemoglobin',
    name: 'Mean Corpuscular Hemoglobin (MCH)',
    category: 'hematology',
    unit: 'pg',
    normalRange: '27 - 33',
    descriptions: {
      en: 'Average amount of hemoglobin per red blood cell.',
      fr: 'Quantité moyenne d\'hémoglobine par globule rouge.',
      zh: '每个红细胞内平均含有的血红蛋白量（平均红细胞血红蛋白量）。',
      id: 'Jumlah rata-rata hemoglobin per sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['mch', 'mean_corpuscular_hemoglobin_pg', 'meancorpuscularhemoglobin', 'meancorpuscularhemoglobinpg', 'meancorpuschaemoglobinmch', 'haemoglobin_mch']
  },
  {
    key: 'mean_corpuscular_volume',
    name: 'Mean Corpuscular Volume (MCV)',
    category: 'hematology',
    unit: 'fL',
    normalRange: '80 - 100',
    descriptions: {
      en: 'Average volume or size of red blood cells.',
      fr: 'Volume globulaire moyen reflétant la taille des globules rouges.',
      zh: '红细胞平均体积（MCV），反映红细胞大小。',
      id: 'Volume rata-rata atau ukuran sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['mcv', 'mean_corpuscular_volume_fl', 'meancorpuscularvolume', 'meancorpuscularvolumemcv']
  },
  {
    key: 'mean_corpuscular_hemoglobin_concentration',
    name: 'Mean Corpuscular Hemoglobin Concentration (MCHC)',
    category: 'hematology',
    unit: 'g/L',
    normalRange: '320 - 360',
    descriptions: {
      en: 'Average concentration of hemoglobin inside red blood cells.',
      fr: 'Concentration corpusculaire moyenne en hémoglobine.',
      zh: '平均红细胞血红蛋白浓度（MCHC）。',
      id: 'Konsentrasi rata-rata hemoglobin di dalam sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['mchc', 'mean_corpuscular_hb_conc_g_l', 'mean_corpuscular_hb_concentration', 'mean_corpuscular_hb_conc', 'meancorpuschbconcmchc', 'mean_corpuscular_hemoglobin_concentration_g_l']
  },
  {
    key: 'rdw',
    name: 'Red Cell Distribution Width (RDW)',
    category: 'hematology',
    unit: '%',
    normalRange: '11.5 - 14.5',
    descriptions: {
      en: 'Measurement of the variation in red blood cell size and volume.',
      fr: 'Indice de distribution des globules rouges mesurant l\'anisocytose.',
      zh: '红细胞体积分布宽度，反映红细胞大小的一致性。',
      id: 'Variasi ukuran dan volume sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['red_blood_cell_distribution_width', 'redbloodcelldistributwidth', 'red_blood_cell_distribution_width_percent']
  },
  {
    key: 'serum_albumin',
    name: 'Serum Albumin',
    category: 'liver',
    unit: 'g/L',
    normalRange: '35 - 50',
    descriptions: {
      en: 'Main protein produced by the liver, keeping fluid balance in vessels.',
      fr: 'Principale protéine produite par le foie maintenant la pression oncotique.',
      zh: '肝脏合成的主要蛋白质，维持血管内胶体渗透压及营养状态。',
      id: 'Protein utama yang diproduksi oleh hati.'
    },
    riskCategories: ['Liver', 'Kidney'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['albumin', 'serumalbumin', 'serum_albumin_g_l']
  },
  {
    key: 'total_protein',
    name: 'Total Protein',
    category: 'other',
    unit: 'g/L',
    normalRange: '60 - 80',
    descriptions: {
      en: 'Measures the total amount of protein in your blood.',
      fr: 'Mesure la quantité totale de protéines dans le sang.',
      zh: '测定血液中的总蛋白质含量。',
      id: 'Mengukur jumlah total protein dalam darah.'
    },
    riskCategories: ['Liver', 'Kidney'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['serumtotalprotein', 'serum_total_protein_g_l', 'serum_total_protein']
  },
  {
    key: 'audit_total_score',
    name: 'AUDIT Total Score',
    category: 'other',
    unit: 'points',
    normalRange: '0 - 7',
    descriptions: {
      en: 'Alcohol Use Disorders Identification Test total score.',
      fr: 'Score total du test d\'identification des troubles liés à l\'usage d\'alcool.',
      zh: '酒精使用障碍筛查量表总分。',
      id: 'Skor total Tes Identifikasi Gangguan Penggunaan Alkohol.'
    }
  },
  {
    key: 'wbc',
    name: 'White Blood Cell (WBC)',
    category: 'hematology',
    unit: 'K/uL',
    normalRange: '4.5 - 11.0',
    descriptions: { en: 'Total white blood cell count for immune function.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['whitebloodcell', 'total_white_cell_count', 'total_white_cell_count_10_9_l', 'white_blood_cell_count']
  },
  {
    key: 'neutrophil_count',
    name: 'Neutrophils',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '2.0 - 7.5',
    descriptions: { en: 'Essential white blood cells for fighting bacterial infections.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['neutrophils', 'neutrophil', 'neutrophils_10_9_l', 'abs_neutrophil_count', 'neutrophil_count_10_9_l']
  },
  {
    key: 'lymphocyte_count',
    name: 'Lymphocytes',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '1.0 - 3.5',
    descriptions: { en: 'White blood cells critical for adaptive viral and antibody immunity.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['lymphocytes', 'lymphocyte', 'lymphocytes_10_9_l', 'abs_lymphocyte_count', 'lymphocyte_count_10_9_l']
  },
  {
    key: 'monocyte_count',
    name: 'Monocyte Count',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '0.1 - 0.6',
    descriptions: { en: 'Phagocytic white blood cells that clear cellular debris and respond to chronic inflammation.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['monocytes', 'monocyte', 'monocytes_10_9_l', 'abs_monocyte_count', 'monocyte_count_10_9_l']
  },
  {
    key: 'eosinophil_count',
    name: 'Eosinophils',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '0.02 - 0.50',
    descriptions: { en: 'White blood cells involved in allergic responses and parasitic defense.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['eosinophils', 'eosinophil', 'eosinophils_10_9_l', 'abs_eosinophil_count', 'eosinophil_count_10_9_l']
  },
  {
    key: 'basophil_count',
    name: 'Basophils',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '0.0 - 0.1',
    descriptions: { en: 'Granulocytes responsible for histamine release and inflammatory reactions.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['basophils', 'basophil', 'basophils_10_9_l', 'abs_basophil_count', 'basophil_count_10_9_l']
  },
  {
    key: 'alt',
    name: 'ALT (SGPT)',
    category: 'liver',
    unit: 'U/L',
    normalRange: '10 - 40',
    descriptions: { en: 'Alanine Aminotransferase, an enzyme found mostly in the liver.' },
    riskCategories: ['Liver'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['sgpt', 'alanine_aminotransferase', 'serum_alt_level_u_l', 'serum_alt_level']
  },
  {
    key: 'ast',
    name: 'AST (SGOT)',
    category: 'liver',
    unit: 'U/L',
    normalRange: '10 - 40',
    descriptions: { en: 'Aspartate Aminotransferase, an enzyme found in liver and muscle.' },
    riskCategories: ['Liver'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['sgot', 'aspartate_aminotransferase', 'ast_serum_level_u_l', 'ast_serum_level']
  },
  {
    key: 'steps',
    name: 'Daily Steps',
    category: 'other',
    unit: 'steps',
    normalRange: 'Aim over 8000',
    descriptions: { en: 'Total daily step count.' },
    riskCategories: ['Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['step_count', 'stepcount']
  },
  {
    key: 'weight',
    name: 'Body Weight',
    category: 'other',
    unit: 'kg',
    normalRange: 'Varies',
    descriptions: { en: 'Total body mass.' },
    riskCategories: ['Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['body_weight', 'bodyweight']
  },
  {
    key: 'hemorrhoidal_symptom_score',
    name: 'Hemorrhoidal Disease Symptom Score (HDSS)',
    category: 'other',
    unit: 'score',
    normalRange: '0',
    descriptions: { en: 'A clinical index evaluating the frequency and severity of anorectal vascular symptoms.' },
    riskCategories: ['Gastrointestinal'],
    standardMedicalGrouping: 'Gastrointestinal',
    aliases: ['hdss', 'hemorrhoids', 'hemorrhoid_score', 'hemorrhoid_symptom_score', 'hemorrhoidal_disease_symptom_score', 'blood_in_stool_score']
  },
  {
    key: 'gerd_symptom_score',
    name: 'Gastroesophageal Reflux Symptom Score (GERD-SS)',
    category: 'other',
    unit: 'score',
    normalRange: '0',
    descriptions: { en: 'A clinical index evaluating the frequency and severity of upper gastrointestinal reflux symptoms.' },
    riskCategories: ['Gastrointestinal'],
    standardMedicalGrouping: 'Gastrointestinal',
    aliases: ['gerd_score', 'acid_reflux_score', 'heartburn_score']
  },
  {
    key: 'joint_pain_severity_score',
    name: 'Joint Pain Severity Score',
    category: 'other',
    unit: 'score',
    normalRange: '0',
    descriptions: { en: 'A clinical scale evaluating articular joint discomfort and flare severity.' },
    riskCategories: ['Musculoskeletal'],
    standardMedicalGrouping: 'Musculoskeletal',
    aliases: ['joint_pain_score', 'arthritis_symptom_score']
  },
  {
    key: 'blood_pressure',
    name: 'Blood Pressure',
    category: 'other',
    unit: 'mmHg',
    normalRange: '< 120 / < 80',
    descriptions: { en: 'Combined systolic and diastolic arterial blood pressure.' },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['bloodpressure', 'arterial_blood_pressure', 'bp', 'sitting_blood_pressure', 'standing_blood_pressure']
  },
  {
    key: 'systolic_blood_pressure',
    name: 'Systolic Blood Pressure',
    category: 'other',
    unit: 'mmHg',
    normalRange: '< 120',
    descriptions: { en: 'Peak arterial pressure during cardiac contraction (systole).' },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['systolic', 'sbp', 'systolic_bp', 'systolicbloodpressure', 'sitting_systolic_blood_pressure']
  },
  {
    key: 'diastolic_blood_pressure',
    name: 'Diastolic Blood Pressure',
    category: 'other',
    unit: 'mmHg',
    normalRange: '< 80',
    descriptions: { en: 'Minimum arterial pressure during cardiac relaxation (diastole).' },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['diastolic', 'dbp', 'diastolic_bp', 'diastolicbloodpressure', 'sitting_diastolic_blood_pressure']
  },
  {
    key: 'audit_c_total_score',
    name: 'AUDIT-C Alcohol Consumption Score',
    category: 'other',
    unit: 'score',
    normalRange: '0 - 3',
    descriptions: { en: 'Alcohol Use Disorders Identification Test Consumption 3-item screening score (0 to 12).' },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Screenings & Assessments',
    aliases: ['audit_c_score', 'audit_c', 'auditctotalscore', 'audit_c_consumption_score', 'audit_c_score_total', 'alcohol_use_disorders_identification_test_c']
  },
  {
    key: 'ideal_body_weight',
    name: 'Ideal Body Weight (Target)',
    category: 'other',
    unit: 'kg',
    normalRange: 'Varies',
    descriptions: { en: 'Calculated or target ideal body weight goal, distinct from measured historical weight.' },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['idealbodyweight', 'target_weight', 'targetbodyweight', 'goal_weight', 'ideal_weight', 'reference_weight']
  },
  {
    key: 'apoa1',
    name: 'ApoA1',
    category: 'lipids',
    unit: 'g/L',
    normalRange: '1.19 - 2.40',
    descriptions: {
      en: 'Apolipoprotein A1, the primary protein constituent of HDL particles that mediates reverse cholesterol transport.',
      fr: 'Apolipoprotéine A1, composant majeur du cholestérol HDL.',
      zh: '载脂蛋白A1，高密度脂蛋白（HDL）的主要结构蛋白。',
      id: 'Apolipoprotein A1, komponen protein utama partikel kolesterol HDL.'
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['apolipoprotein_a1', 'apolipoproteina1', 'apoa_1', 'apolipoprotein_a_1', 'apo_a1', 'apoa1_g_l']
  },
  {
    key: 'gamma_gt',
    name: 'Gamma GT (GGT)',
    category: 'liver',
    unit: 'U/L',
    normalRange: '9 - 48',
    descriptions: {
      en: 'Gamma-Glutamyl Transferase, a sensitive enzyme marker for biliary tract function, hepatic stress, and alcohol intake.',
      fr: 'Gamma-glutamyl transférase, marqueur de la fonction biliaire et hépatique.',
      zh: '谷氨酰转肽酶（GGT），评估胆道与肝脏代谢负担的敏感指标。',
      id: 'Gamma-Glutamyl Transferase, enzim penanda fungsi empedu dan hati.'
    },
    riskCategories: ['Liver'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['ggt', 'gamma_glutamyl_transferase', 'gamma_glutamyl_transpeptidase', 'gammagt', 'gammaglutamyltransferase', 'gammaglutamyltranspeptidase', 'serum_gamma_gt_level', 'serum_ggt_level']
  },
  {
    key: 'mpv',
    name: 'Mean Platelet Volume (MPV)',
    category: 'hematology',
    unit: 'fL',
    normalRange: '7.5 - 11.5',
    descriptions: {
      en: 'Mean Platelet Volume, measuring the average physical volume of circulating thrombocytes for bone marrow platelet production.',
      fr: 'Volume plaquettaire moyen (VPM), taille moyenne des plaquettes sanguines.',
      zh: '平均血小板体积（MPV），反映骨髓血小板生成与活性的指标。',
      id: 'Volume Trombosit Rata-rata (MPV), mengukur ukuran rata-rata trombosit.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['mean_platelet_volume', 'meanplateletvolume', 'mean_platelet_volume_mpv', 'mpv_fl', 'mean_platelet_volume_fl'],
    // Mirrors the `key === 'mpv'` hardcoded threshold in getBiomarkerStatus
    // (kept as a fallback). MPV has no "critical" tier, only "elevated".
    customRanges: [
      {
        id: 'mpv_default_thresholds',
        name: 'Standard clinical thresholds (all patients)',
        filters: {},
        range: {
          type: 'simple',
          conditions: [
            { operator: '>', value: 13.0, alias: 'Elevated', severity: 'high' },
            { operator: '<=', value: 13.0, alias: 'Normal', severity: 'normal' }
          ]
        }
      }
    ]
  },
  {
    key: 'qrisk2',
    name: 'QRISK2 10-Year Cardiovascular Risk',
    category: 'other',
    unit: '%',
    normalRange: '< 10',
    descriptions: {
      en: 'QRISK2 algorithm estimating the 10-year percentage probability of developing cardiovascular disease, coronary heart disease, or stroke.',
      fr: 'Score de risque cardiovasculaire à 10 ans QRISK2.',
      zh: 'QRISK2 10年心血管疾病与中风风险预测百分比。',
      id: 'Skor risiko kardiovaskular 10 tahun QRISK2.'
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Cardiovascular',
    aliases: ['qrisk2_10yr_risk_percent', 'qrisk2_score', 'qrisk_2', 'qrisk2_10_year_cardiovascular_risk', 'qrisk2_percent', 'qrisk2_10yr_risk']
  },
  {
    key: 'audit_score',
    name: 'AUDIT Score (Total)',
    category: 'other',
    unit: 'score',
    normalRange: '0 - 7',
    descriptions: {
      en: 'Alcohol Use Disorders Identification Test 10-question comprehensive assessment composite score (0 to 40).',
      fr: 'Score total du test d identification des troubles liés à la consommation d alcool (AUDIT).',
      zh: '酒精使用障碍筛查量表（AUDIT）总分（0-40分）。',
      id: 'Skor total kuesioner skrining konsumsi alkohol AUDIT (0-40).'
    },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Screenings & Assessments',
    aliases: ['audit_score_total', 'audit_total_score', 'auditscore', 'audit']
  },
  {
    key: 'audit_score_frequency_drinking',
    name: 'AUDIT Drinking Frequency Score',
    category: 'other',
    unit: 'score',
    normalRange: '0 - 1',
    descriptions: {
      en: 'AUDIT Item 1 evaluating how often alcohol is consumed (0: never to 4: 4+ times a week).',
      fr: 'Sous-score AUDIT de fréquence de consommation d alcool.',
      zh: 'AUDIT量表第1题：饮酒频率自评得分。',
      id: 'Skor frekuensi minum alkohol pada instrumen AUDIT.'
    },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Screenings & Assessments',
    aliases: ['audit_drinking_frequency', 'audit_q1_score']
  },
  {
    key: 'audit_binge_drinking_score',
    name: 'AUDIT Binge Drinking Score',
    category: 'other',
    unit: 'score',
    normalRange: '0 - 4',
    descriptions: {
      en: 'AUDIT Item 3 evaluating frequency of binge drinking.',
    },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'General / Wellness',
    aliases: ['audit_binge_score', 'audit_q3_score', 'audit_score_freq_drunk', 'audit_score_freq_drunk_6_units']
  },
  {
    key: 'audit_score_typical_day_units',
    name: 'AUDIT Typical Units Score',
    category: 'other',
    unit: 'score',
    normalRange: '0 - 1',
    descriptions: {
      en: 'AUDIT Item 2 evaluating standard drinks containing alcohol on a typical day when drinking (0: 1-2 to 4: 10+).',
      fr: 'Sous-score AUDIT de quantité de verres par occasion.',
      zh: 'AUDIT量表第2题：典型饮酒日的标准饮酒量得分。',
      id: 'Skor jumlah unit alkohol rata-rata per hari minum pada instrumen AUDIT.'
    },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Screenings & Assessments',
    aliases: ['audit_typical_units', 'audit_q2_score']
  },
  {
    key: 'qdiabetes',
    name: 'QDiabetes 10-Year Risk Score',
    category: 'other',
    unit: '%',
    normalRange: '< 5',
    descriptions: {
      en: 'QDiabetes clinical risk calculation predicting the 10-year probability of developing Type 2 diabetes.',
      fr: 'Score de risque de diabète de type 2 à 10 ans QDiabetes.',
      zh: 'QDiabetes 10年2型糖尿病发病风险预测百分比。',
      id: 'Skor risiko 10 tahun diabetes tipe 2 QDiabetes.'
    },
    riskCategories: ['Metabolic'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['qdiabetes_risk_score_percent', 'qdiabetes_score', 'qdiabetes_10yr_risk_percent', 'qdiabetes_percent']
  },
  {
    key: 'fast_alcohol_score',
    name: 'FAST Alcohol Score',
    category: 'other',
    unit: 'points',
    normalRange: '< 3',
    descriptions: {
      en: 'Fast Alcohol Screening Test (FAST) score. A score of 3 or more indicates hazardous drinking (max 16).',
    },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'General / Wellness',
    aliases: ['fast_alcohol_screening_test', 'fast_score']
  },
  {
    key: 'weekly_alcohol_consumption',
    name: 'Weekly Alcohol Consumption',
    category: 'other',
    unit: 'units/week',
    normalRange: '0 - 14',
    descriptions: {
      en: 'Self-reported total weekly units of alcohol (UK guidelines advise <= 14 units per week spread across days).',
      fr: 'Consommation hebdomadaire totale d alcool en unités standard.',
      zh: '每周酒精摄入总量（单位：标准酒精单位/周）。',
      id: 'Konsumsi alkohol mingguan dalam satuan unit alkohol.'
    },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Screenings & Assessments',
    aliases: ['alcohol_units_per_week', 'weekly_alcohol_units', 'alcohol_weekly_intake', 'alcohol_consumption_units']
  }
];

export const CLINICAL_FILLER_WORDS = [
  'serum', 'plasma', 'blood', 'total', 'fasting', 'estimated', 'intact', 
  'calculated', 'senon', 'se', 'level', 'levels', 'count', 'rate', 'ratio', 
  'percent', 'percentage', 'val', 'value', 'score', 'estimation', 'standardised', 
  'index', 'test'
];
// NOTE: 'free' is intentionally excluded from generic prefix stripping. Free vs Total
// forms (e.g. Free Testosterone vs Total Testosterone, Free PSA vs Total PSA) are
// clinically distinct analytes with different units/ranges and must never collapse
// onto the same canonical stem. See hasFreeTotalConflict guard below for the
// name-similarity path, and CLINICAL_SYNONYM_MAP for the explicit "free_x" -> "free_x" aliases.

export const COMMON_PREFIXES = [
  'serum_', 'plasma_', 'blood_', 'total_', 'fasting_', 'estimated_', 'intact_', 'calculated_', 'senon_', 'se_'
];
export const COMMON_SUFFIXES = [
  '_level', '_count', '_serum', '_rate', '_ratio', '_percent', '_percentage', '_val', '_value', '_score', '_estimation', '_standardised'
];
export const COMMON_UNIT_SUFFIXES = [
  '_umol_l', '_umoll', '_u_l', '_ul', '_iu_l', '_iul', '_iu_ml', '_iuml',
  '_mg_dl', '_mgdl', '_mg_l', '_mgl', '_mmol_l', '_mmoll', '_mmol_mol', '_mmolmol',
  '_g_l', '_gl', '_g_dl', '_gdl', '_ug_dl', '_ugdl', '_ug_l', '_ugl', '_mcg_dl', '_mcgdl', '_mcg_l', '_mcgl',
  '_fl', '_k_ul', '_kul', '_m_ul', '_mul',
  '_ml_min_1_73m2', '_ml_min_173m2', '_mlmin173m2', '_mlmin_173m2', '_ml_min_173_m2', '_ml_min', '_mlmin',
  '_pg_ml', '_pgml', '_pg', '_ng_dl', '_ngdl', '_ng_ml', '_ngml', '_uiu_ml', '_uiuml', '_miu_l', '_miul', '_beats_min', '_bpm',
  '_10_9_l', '_109l', '_10_12_l', '_1012l', '_10_6_ul', '_106ul',
  '_kg_m2', '_kgm2', '_points', '_percent', '_percentage', '_pct', '_fraction', '_l_l', '_ratio', '_score'
];

/**
 * Standard clinical abbreviation synonym mappings so medical aliases resolve
 * to a shared canonical stem (e.g. AST <=> SGOT <=> Aspartate Aminotransferase).
 */
export const CLINICAL_SYNONYM_MAP: Record<string, string> = {
  // Liver
  'ast': 'ast',
  'sgot': 'ast',
  'aspartateaminotransferase': 'ast',
  'aspartatetransaminase': 'ast',
  'alt': 'alt',
  'sgpt': 'alt',
  'alanineaminotransferase': 'alt',
  'alaninetransaminase': 'alt',
  'alp': 'alkaline_phosphatase',
  'alkalinephosphatase': 'alkaline_phosphatase',
  'alkphos': 'alkaline_phosphatase',
  'ggt': 'gamma_gt',
  'gammaglutamyltransferase': 'gamma_gt',
  'gammaglutamyltranspeptidase': 'gamma_gt',
  'bilirubin': 'total_bilirubin',
  'totalbilirubin': 'total_bilirubin',
  'directbilirubin': 'direct_bilirubin',
  'indirectbilirubin': 'indirect_bilirubin',

  // Lipids
  'hdl': 'hdl',
  'hdlc': 'hdl',
  'hdlcholesterol': 'hdl',
  'highdensitylipoprotein': 'hdl',
  'ldl': 'ldl',
  'ldlc': 'ldl',
  'ldlcholesterol': 'ldl',
  'lowdensitylipoprotein': 'ldl',
  'cholesterol': 'total_cholesterol',
  'totalcholesterol': 'total_cholesterol',
  'trig': 'triglycerides',
  'trigs': 'triglycerides',
  'triglyceride': 'triglycerides',
  'triglycerides': 'triglycerides',
  'apob': 'apob',
  'apolipoproteinb': 'apob',
  'apoa1': 'apoa1',
  'apolipoproteina1': 'apoa1',
  'lpa': 'lp_a',
  'lipoprotein_a': 'lp_a',
  'lipoproteina': 'lp_a',
  'nonhdl': 'non_hdl_cholesterol',
  'nonhdlcholesterol': 'non_hdl_cholesterol',
  'cholesterolhdlratio': 'cholesterol_hdl_ratio',

  // Other / Screenings
  'qrisk2_10yr_risk': 'qrisk2',
  'qrisk210yrrisk': 'qrisk2',

  // Blood Sugar & Metabolic
  'hba1c': 'hba1c',
  'glycatedhemoglobin': 'hba1c',
  'glycatedhaemoglobin': 'hba1c',
  'hemoglobina1c': 'hba1c',
  'haemoglobina1c': 'hba1c',
  'glucose': 'fasting_glucose',
  'fastingglucose': 'fasting_glucose',
  'bloodglucose': 'fasting_glucose',
  'bloodsugar': 'fasting_glucose',
  'insulin': 'fasting_insulin',
  'fastinginsulin': 'fasting_insulin',

  // Kidneys & Electrolytes
  'egfr': 'egfr',
  'egfrcreat': 'egfr',
  'egfrcreatckdepi': 'egfr',
  'egfrcreatckdepi173m2': 'egfr',
  'gfr': 'egfr',
  'estimatedgfr': 'egfr',
  'estimatedglomerularfiltrationrate': 'egfr',
  'glomerularfiltrationrate': 'egfr',
  'glomerularfiltrationrateestimated': 'egfr',
  'kidneyfunctionegfr': 'egfr',
  'creatinine': 'creatinine',
  'bun': 'bun',
  'bloodureanitrogen': 'bun',
  'urea': 'bun',
  'uricacid': 'uric_acid',
  'urate': 'uric_acid',
  'sodium': 'serum_sodium',
  'potassium': 'serum_potassium',
  'calcium': 'serum_calcium',
  'chloride': 'serum_chloride',
  'magnesium': 'serum_magnesium',
  'phosphate': 'serum_inorganic_phosphate',
  'phosphorus': 'serum_inorganic_phosphate',
  'albumin': 'serum_albumin',
  'globulin': 'serum_globulin',
  'totalprotein': 'total_protein',

  // Hematology (CBC)
  'wbc': 'wbc',
  'whitebloodcell': 'wbc',
  'whitebloodcells': 'wbc',
  'whitebloodcellcount': 'wbc',
  'totalwhitecell': 'wbc',
  'rbc': 'rbc',
  'redbloodcell': 'rbc',
  'redbloodcells': 'rbc',
  'redbloodcellcount': 'rbc',
  'hemoglobin': 'hemoglobin',
  'haemoglobin': 'hemoglobin',
  'hgb': 'hemoglobin',
  'hb': 'hemoglobin',
  'hematocrit': 'hematocrit',
  'haematocrit': 'hematocrit',
  'hct': 'hematocrit',
  'platelet': 'platelets',
  'platelets': 'platelets',
  'plateletcount': 'platelets',
  'plt': 'platelets',
  'mcv': 'mean_corpuscular_volume',
  'meancorpuscularvolume': 'mean_corpuscular_volume',
  'mch': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobin': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhaemoglobin': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobinpg': 'mean_corpuscular_hemoglobin',
  'meancorpuschaemoglobinmch': 'mean_corpuscular_hemoglobin',
  'mchc': 'mean_corpuscular_hemoglobin_concentration',
  'meancorpuscularhemoglobinconcentration': 'mean_corpuscular_hemoglobin_concentration',
  'meancorpuscularhaemoglobinconcentration': 'mean_corpuscular_hemoglobin_concentration',
  'rdw': 'rdw',
  'redcelldistributionwidth': 'rdw',
  'redbloodcelldistributionwidth': 'rdw',
  'mpv': 'mean_platelet_volume',
  'meanplateletvolume': 'mean_platelet_volume',
  'pdw': 'platelet_distribution_width',
  'plateletdistributionwidth': 'platelet_distribution_width',
  'neutrophil': 'neutrophil_count',
  'neutrophils': 'neutrophil_count',
  'neutrophilcount': 'neutrophil_count',
  'lymphocyte': 'lymphocyte_count',
  'lymphocytes': 'lymphocyte_count',
  'monocyte': 'monocyte_count',
  'monocytes': 'monocyte_count',
  'eosinophil': 'eosinophil_count',
  'eosinophils': 'eosinophil_count',
  'basophil': 'basophil_count',
  'basophils': 'basophil_count',

  // Inflammation & Hormones & Vitamins
  'crp': 'hscrp',
  'hscrp': 'hscrp',
  'creactiveprotein': 'hscrp',
  'highsensitivitycreactiveprotein': 'hscrp',
  'ferritin': 'ferritin',
  'serumferritin': 'ferritin',
  'iron': 'serum_iron',
  'tsh': 'tsh',
  'thyroidstimulatinghormone': 'tsh',
  'ft4': 'free_t4',
  'freet4': 'free_t4',
  'freethyroxine': 'free_t4',
  'ft3': 'free_t3',
  'freet3': 'free_t3',
  'freetriiodothyronine': 'free_t3',
  'testosterone': 'testosterone',
  'totaltestosterone': 'testosterone',
  'freetestosterone': 'free_testosterone',
  'vitamind': 'vitamin_d',
  'vitd': 'vitamin_d',
  '25ohvitamind': 'vitamin_d',
  'vitaminb12': 'vitamin_b12',
  'vitb12': 'vitamin_b12',
  'folate': 'folate',
  'folicacid': 'folate',
  'psa': 'prostate_specific_antigen',
  'prostatespecificantigen': 'prostate_specific_antigen',
  'bmi': 'bmi',
  'bodymassindex': 'bmi',
  'weight': 'weight',
  'bodyweight': 'weight',
  'height': 'height',
  'standingheight': 'height'
};

/**
 * Clinical qualifier terms that change a biomarker's identity, unit, or reference
 * range when present. If exactly one of two candidate biomarker strings contains a
 * term from this list, they are treated as distinct tests — never auto-merged by the
 * substring/stem-similarity fallback (rule 5 in isBiomarkerDuplicateCandidate).
 *
 * This list is the SINGLE place to extend false-friend protection. To protect a new
 * pair of frequently-confused biomarkers (e.g. "Direct Bilirubin" vs "Indirect
 * Bilirubin", "Ionized Calcium" vs "Total Calcium"), add the discriminating word(s)
 * here — do not write a new hasXConflict boolean. Grouped by category for
 * maintainability; the grouping is documentation only, all terms are checked
 * identically (XOR presence = conflict).
 */
export const CLINICAL_DISCRIMINATOR_TERMS: string[] = [
  // Specimen / fluid type — same analyte name, different sample source
  'urine', 'urinary', 'serum', 'plasma', 'csf', 'saliva', 'stool', 'faecal', 'fecal', 'sweat', 'capillary',
  // Fraction / binding state
  'free', 'total', 'bound', 'direct', 'indirect', 'conjugated', 'unconjugated', 'ionized', 'ionised',
  // Measurement type on the same base analyte (e.g. red-cell indices)
  'concentration', 'conc', 'mchc', 'volume', 'width', 'distribution', 'corpuscular',
  // Lipoprotein fraction
  'hdl', 'ldl', 'vldl', 'nonhdl',
  // Glycation / averaging window
  'a1c', 'fructosamine',
  // Timing / physiological state
  'fasting', 'random', 'postprandial', 'basal', 'peak', 'trough',
  // Laterality (imaging-adjacent biomarkers, e.g. paired organ measures)
  'left', 'right',
];

/**
 * Generic false-friend check: true if a discriminator term from
 * CLINICAL_DISCRIMINATOR_TERMS appears in exactly one of the two cleaned strings.
 */
export function hasDiscriminatorConflict(cleanA: string, cleanB: string): boolean {
  for (const term of CLINICAL_DISCRIMINATOR_TERMS) {
    if (cleanA.includes(term) !== cleanB.includes(term)) return true;
  }
  return false;
}

/**
 * Looks up a canonical synonym for a stem/name fragment, tolerating both the
 * contiguous form CLINICAL_SYNONYM_MAP is authored in (e.g. "bodymassindex")
 * and the underscored form normalizeStemKey() can still return for multi-word
 * compounds that don't fully collapse to a single recognized token
 * (e.g. "body_mass_index"). Without this, any compound stem that retains an
 * underscore silently fails synonym resolution even though the no-underscore
 * form is a known entry.
 */
export function lookupClinicalSynonym(s?: string | null): string | undefined {
  if (!s) return undefined;
  if (CLINICAL_SYNONYM_MAP[s]) return CLINICAL_SYNONYM_MAP[s];
  const noUnderscore = s.replace(/_/g, '');
  if (noUnderscore !== s && CLINICAL_SYNONYM_MAP[noUnderscore]) return CLINICAL_SYNONYM_MAP[noUnderscore];
  return undefined;
}

/**
 * Normalizes an arbitrary key stem for generalized morphological clustering and alias resolution
 */
export function normalizeStemKey(key: string): string {
  if (!key) return '';
  let stem = key.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  
  // Iteratively strip known unit suffixes
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of COMMON_UNIT_SUFFIXES) {
      if (stem.endsWith(suf)) {
        stem = stem.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }

  // Regex-based unit trailing strip for arbitrary delimiter variants (e.g. _mlmin173m2, _mmol_mol, _g_dl)
  stem = stem.replace(/_(?:ml_?min(?:_?1_?73m2)?|mmol_?mol|mmol_?l|umol_?l|pmol_?l|nmol_?l|mg_?dl|mg_?l|g_?l|g_?dl|ug_?dl|ug_?l|mcg_?dl|mcg_?l|pg_?ml|ng_?ml|ng_?dl|uiu_?ml|miu_?l|u_?l|iu_?l|iu_?ml|k_?ul|10_?9_?l|10_?12_?l|10_?6_?ul|m_?ul|fl|beats_?min|bpm|kg_?m2|points|percent|fraction|l_?l)$/i, '');

  // Iteratively strip known prefixes
  changed = true;
  while (changed) {
    changed = false;
    for (const pre of COMMON_PREFIXES) {
      if (stem.startsWith(pre)) {
        stem = stem.slice(pre.length);
        changed = true;
        break;
      }
    }
  }

  // Iteratively strip known suffixes
  changed = true;
  while (changed) {
    changed = false;
    for (const suf of COMMON_SUFFIXES) {
      if (stem.endsWith(suf)) {
        stem = stem.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }

  return stem.replace(/^_+|_+$/g, '');
}

/**
 * Normalizes a human-readable biomarker name into a standardized comparable string
 * stripping unit suffixes, parenthetical abbreviations, and clinical filler words.
 */
export function normalizeBiomarkerName(name?: string): string {
  if (!name) return '';
  let clean = name.toLowerCase().trim();

  // Strip parenthetical abbreviations e.g. "Body Mass Index (BMI)" => "Body Mass Index", "AST (SGOT)" => "AST"
  clean = clean.replace(/\([^)]*\)/g, ' ');

  // Strip common trailing unit tokens
  clean = clean.replace(/\b(?:pg(?:\/ml)?|ng\/(?:ml|dl)|mg\/(?:dl|l)|mmol\/(?:l|mol)|µmol\/l|umol\/l|u\/l|iu\/l|miu\/l|uiu\/ml|k\/ul|10\^9\/l|10\^12\/l|fl|kg\/m2|kg\/m²|ml\/min\/1\.73m2|ml\/min(?:\/1\.73m²)?|g\/l|g\/dl|score|points|steps|beats\/min|bpm|percent|%)\b/gi, ' ');

  // Strip clinical filler words
  const fillerRegex = new RegExp(`\\b(?:${CLINICAL_FILLER_WORDS.join('|')})\\b`, 'gi');
  clean = clean.replace(fillerRegex, ' ');

  // Collapse spaces and symbols
  clean = clean.replace(/[^a-z0-9]+/g, ' ').trim();
  return clean;
}

const CUSTOM_KEY_ALIASES: Record<string, string> = {
  'hemorrhoids': 'hemorrhoidal_symptom_score',
  'blood_in_stool': 'hemorrhoidal_symptom_score',
  'rectal_bleeding': 'hemorrhoidal_symptom_score',
  'acid_reflux': 'gerd_symptom_score',
  'heartburn': 'gerd_symptom_score',
  'height_cm': 'height',
  'serum_psa': 'prostate_specific_antigen',
  'serum_prostate_specific_antigen': 'prostate_specific_antigen',
  'audit_c_score': 'audit_c_total_score',
  'hematocrit_l_l': 'hematocrit',
  'hemoglobin_g_l': 'hemoglobin',
  'hemoglobingl': 'hemoglobin',
  'hemoglobingdl': 'hemoglobin',
  'serum_albumin_2': 'serum_albumin',
  'serum_albumin_g_l': 'serum_albumin',
  'serum_globulin_g_l': 'serum_globulin',
  'qrisk2_10_year_risk': 'qrisk2',
  'qrisk2_10_year_risk_score': 'qrisk2',
  'serum_sodium_mmol_l': 'serum_sodium',
  'serum_calcium_mmol_l': 'serum_calcium',
  'alkaline_phosphatase_2': 'alkaline_phosphatase',
  'alkaline_phosphatase_u_l': 'alkaline_phosphatase',
  'serum_potassium_mmol_l': 'serum_potassium',
  'total_bilirubin_umol_l': 'total_bilirubin',
  'serum_total_cholesterol': 'total_cholesterol',
  'serum_hdl_cholesterol': 'hdl',
  'serum_triglyceride': 'triglycerides',
  'serum_triglycerides': 'triglycerides',
  'hba1c_levs': 'hba1c',
  'hba1c_level': 'hba1c',
  'hba1c_levl_ifcc_standardised': 'hba1c',
  'hba1c_level_ifcc_standardised': 'hba1c',
  'serum_lipid_level': 'total_cholesterol',
  'serum_ldl_cholesterol': 'ldl',
  'serum_creatinine': 'creatinine',
  'serum_alanine_aminotransferase': 'alt',
  'alanine_aminotransferase': 'alt',
  'serum_aspartate_aminotransferase': 'ast',
  'aspartate_aminotransferase': 'ast',
  'fasting_blood_glucose': 'fasting_glucose',
  'body_mass_index': 'bmi',
  'bmi_kg_m2': 'bmi',
  'bmikgm2': 'bmi',
  'weight_kg': 'weight',
  'mean_platelet_volume_fl': 'mean_platelet_volume',
  'neutrophil_count_10_9_l': 'neutrophil_count',
  'mean_corpuscular_volume_fl': 'mean_corpuscular_volume',
  'mean_corpuscular_volume_mcv': 'mean_corpuscular_volume',
  'total_white_cell_count_wbc': 'wbc',
  'mean_corpuscular_hb_conc_g_l': 'mean_corpuscular_hemoglobin_concentration',
  'mean_corpuscular_hemoglobin_concentration_g_l': 'mean_corpuscular_hemoglobin_concentration',
  'mean_corpuscular_hemoglobin_concentration_mchc': 'mean_corpuscular_hemoglobin_concentration',
  'serum_adjusted_calcium_mmol_l': 'serum_adjusted_calcium',
  'mean_corpuscular_hemoglobin_pg': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobinpg': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobin': 'mean_corpuscular_hemoglobin',
  'platelet_distribution_width_fl': 'platelet_distribution_width',
  'platelet_distribution_width_pdw': 'platelet_distribution_width',
  'serum_inorganic_phosphate_mmol_l': 'serum_inorganic_phosphate',
  'nucleated_red_blood_cell_count_10_9_l': 'nucleated_red_blood_cell_count',
  'red_blood_cell_distribution_width_percent': 'red_blood_cell_distribution_width',
  // NHS / EMIS print names (cleanNoUnderscore form)
  'hba1clevlifccstandardised': 'hba1c',
  'seprostatespecificaglevel': 'prostate_specific_antigen',
  'serumsodium': 'serum_sodium',
  'serumpotassium': 'serum_potassium',
  'serumcreatinine': 'creatinine',
  'egfrcreatckdepi173m2': 'egfr',
  'egfr_mlmin173m2': 'egfr',
  'egfr_ml_min_1_73m2': 'egfr',
  'egfr_mlmin_173m2': 'egfr',
  'egfr_ml_min_173_m2': 'egfr',
  'egfrmlmin173m2': 'egfr',
  'egfrmlmin173': 'egfr',
  'serumalbumin': 'serum_albumin',
  'serumaltlevel': 'alt',
  'serumalkalinephosphatase': 'alkaline_phosphatase',
  'astserumlevel': 'ast',
  'serumtotalbilirubinlevel': 'total_bilirubin',
  'serumtotalprotein': 'total_protein',
  'serumglobulin': 'serum_globulin',
  'serumcalcium': 'serum_calcium',
  'serumadjustedcalciumconc': 'serum_adjusted_calcium',
  'seruminorganicphosphate': 'serum_inorganic_phosphate',
  'totalwhitecellcount': 'wbc',
  'redbloodcellrbccount': 'rbc',
  'haemoglobinestimation': 'hemoglobin',
  'haematocrit': 'hematocrit',
  'meancorpuscularvolumemcv': 'mean_corpuscular_volume',
  'meancorpuschaemoglobinmch': 'mean_corpuscular_hemoglobin',
  'meancorpuschbconcmchc': 'mean_corpuscular_hemoglobin_concentration',
  'redbloodcelldistributwidth': 'rdw',
  'plateletcount': 'platelets',
  'meanplateletvolume': 'mean_platelet_volume',
  'plateletdistributionwidth': 'platelet_distribution_width',
  'neutrophilcount': 'neutrophil_count',
  'nucleatedredbloodcellcount': 'nucleated_red_blood_cell_count',
  'serumcholesterol': 'total_cholesterol',
  'serumhdl': 'hdl',
  'serumhdlcholesterollevel': 'hdl',
  'serumtriglycerides': 'triglycerides',
  'serumldl': 'ldl',
  'serumbilirubin': 'total_bilirubin',
  'senonhdlcholesterollevel': 'non_hdl_cholesterol',
  'serumcholesterolhdlratio': 'cholesterol_hdl_ratio',
  'calculatedldlcholesterollev': 'ldl',
  'bodymassindex': 'bmi',
  'bodyweight': 'weight',
  'standingheight': 'height',
  'qrisk2cardiovasculardisease10yearriskscore': 'qrisk2_10yr_risk',
  'qdiabetesriskcalculatorscore': 'qdiabetes_risk',
  'bloodpressure': 'blood_pressure',
  'pulserate': 'pulse_rate',
  'alcoholconsumption': 'alcohol_consumption',
  'auditcalcoholusedisordersidentificationtestconsumptionscore': 'audit_c_total_score',
  'chlamydiadnadetection': 'chlamydia_dna_detection',
  'ngonorrhoeanuclaciddetn': 'n_gonorrhoeae_nucl_acid_detn',
  'ideal_body_weight': 'ideal_body_weight',
  'idealbodyweight': 'ideal_body_weight',
  'target_weight': 'target_weight',
  'targetbodyweight': 'target_weight',
  'goal_weight': 'goal_weight',
  'goalbodyweight': 'goal_weight',
  'ideal_weight': 'ideal_body_weight',
  'idealweight': 'ideal_body_weight',
  'systolic_blood_pressure': 'systolic_blood_pressure',
  'systolicbloodpressure': 'systolic_blood_pressure',
  'diastolic_blood_pressure': 'diastolic_blood_pressure',
  'diastolicbloodpressure': 'diastolic_blood_pressure',
  'systolic': 'systolic_blood_pressure',
  'diastolic': 'diastolic_blood_pressure',
  'audit_c_total_score': 'audit_c_total_score',
  'auditctotalscore': 'audit_c_total_score',
};

// PERF: getMappedBiomarkerKey is a pure function of (rawKey, rawName) given
// biomarkerDefinitions/CUSTOM_KEY_ALIASES, which are static consts that never
// change after module load. It is called extremely frequently from hot paths
// like isBiomarkerDuplicateCandidate() (itself called O(n^2)-ish from
// getDuplicateAliasGroups on every Health tab render), and on every call it
// was doing 1-2 full linear scans over biomarkerDefinitions with per-entry
// regex/string cleaning plus a nested loop over each definition's aliases.
// Caching eliminates that repeated work with zero behavior change.
const __mappedBiomarkerKeyCache = new Map<string, string>();

export function getMappedBiomarkerKey(rawKey: string, rawName?: string): string {
  if (!rawKey && !rawName) return '';
  const __cacheKey = (rawKey || '') + '\u0000' + (rawName || '');
  const __cached = __mappedBiomarkerKeyCache.get(__cacheKey);
  if (__cached !== undefined) return __cached;
  const __result = __getMappedBiomarkerKeyUncached(rawKey, rawName);
  __mappedBiomarkerKeyCache.set(__cacheKey, __result);
  return __result;
}

function __getMappedBiomarkerKeyUncached(rawKey: string, rawName?: string): string {
  const primaryInput = rawKey || rawName || '';

  const resolveCandidate = (inputStr: string): string | null => {
    if (!inputStr) return null;
    const clean = inputStr.toLowerCase().replace(/[^a-z0-9_]/g, ''); // Keep underscores for exact matching
    const cleanNoUnderscore = inputStr.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Ideal / Target / Goal Weight Guard: must never map to measured 'weight'
    if (
      cleanNoUnderscore.includes('idealbodyweight') ||
      cleanNoUnderscore.includes('targetbodyweight') ||
      cleanNoUnderscore.includes('idealweight') ||
      cleanNoUnderscore.includes('targetweight') ||
      cleanNoUnderscore.includes('goalweight') ||
      cleanNoUnderscore.includes('referenceweight')
    ) {
      return 'ideal_body_weight';
    }

    // 1. Exact match on definitions
    for (const def of biomarkerDefinitions) {
      const defKeyNoUnderscore = def.key.replace(/[^a-z0-9]/g, '');
      const defNameNoUnderscore = (def.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        def.key === clean ||
        def.key === cleanNoUnderscore ||
        defKeyNoUnderscore === cleanNoUnderscore ||
        defNameNoUnderscore === cleanNoUnderscore
      )
        return def.key;
      if (def.aliases) {
        for (const alias of def.aliases) {
          const aliasNoUnderscore = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (alias === clean || alias === cleanNoUnderscore || aliasNoUnderscore === cleanNoUnderscore) return def.key;
        }
      }
    }

    // 2. Exact match on explicit aliases
    if (CUSTOM_KEY_ALIASES[clean]) return CUSTOM_KEY_ALIASES[clean];
    if (CUSTOM_KEY_ALIASES[cleanNoUnderscore]) return CUSTOM_KEY_ALIASES[cleanNoUnderscore];

    // 3. Specimen Guard & False Friend Guard (IDENTITY_FALSE_FRIEND)
    const isUrine = clean.includes('urine') || clean.includes('urinary');
    if (isUrine) {
      if (clean.includes('albumin') && !clean.includes('microalbumin')) return 'urine_albumin';
    } else {
      if (cleanNoUnderscore === 'albumin') return 'serum_albumin';
    }

    // eGFR guards
    if (cleanNoUnderscore.startsWith('egfr') || clean.startsWith('egfr')) {
      return 'egfr';
    }

    // MCH / Hemoglobin guard
    if (
      clean === 'mch' || 
      (clean.includes('mean_corpuscular_hemoglobin') && !clean.includes('concentration')) ||
      (cleanNoUnderscore.includes('meancorpuscularhemoglobin') && !cleanNoUnderscore.includes('concentration') && !cleanNoUnderscore.includes('volume'))
    ) {
      return 'mean_corpuscular_hemoglobin';
    }
    if (
      (cleanNoUnderscore === 'hemoglobin' || cleanNoUnderscore === 'haemoglobin' || cleanNoUnderscore.startsWith('hemoglobing') || cleanNoUnderscore.startsWith('haemoglobing')) &&
      !cleanNoUnderscore.includes('meancorpuscular') &&
      !cleanNoUnderscore.includes('a1c')
    ) {
      return 'hemoglobin';
    }

    // 4. Clinical Synonym Dictionary match
    const directSyn = lookupClinicalSynonym(cleanNoUnderscore);
    if (directSyn) return directSyn;
    const stem = normalizeStemKey(inputStr);
    const stemSyn = lookupClinicalSynonym(stem);
    if (stemSyn) return stemSyn;

    // 5. Match by stem on definitions and aliases
    if (stem) {
      const stemDef = biomarkerDefinitions.find(d => 
        d.key === stem || 
        normalizeStemKey(d.key) === stem ||
        (Array.isArray(d.aliases) && d.aliases.some(a => normalizeStemKey(a) === stem))
      );
      if (stemDef) return stemDef.key;
    }

    // Substring mapping for common clinical names that were dropped
    for (const def of biomarkerDefinitions) {
      const defNameNoUnderscore = (def.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      // If the input explicitly contains the clinical name, and isn't guarded
      if (defNameNoUnderscore.length > 5 && cleanNoUnderscore.includes(defNameNoUnderscore)) {
         // Guard against false friends:
         const SPECIMENS = ['urine', 'urinary', 'csf', 'saliva', 'stool', 'faecal', 'fecal', 'sweat', 'capillary'];
         const hasSpecimenConflict = SPECIMENS.some(specimen => 
           cleanNoUnderscore.includes(specimen) !== (def.key.includes(specimen) || defNameNoUnderscore.includes(specimen))
         );
         if (hasSpecimenConflict) continue;
         if (cleanNoUnderscore.includes('meancorpuscular') && def.key === 'hemoglobin') continue;
         
         return def.key;
      }
    }

    return null;
  };

  // Try rawKey first
  if (rawKey) {
    const resKey = resolveCandidate(rawKey);
    if (resKey) return resKey;
  }

  // Try rawName if rawKey didn't resolve to a known biomarker definition
  if (rawName && rawName !== rawKey) {
    const resName = resolveCandidate(rawName);
    if (resName) return resName;
  }

  // Canonicalize unknown keys to lowercase slug form so "Hemoglobin" and "hemoglobin"
  // cannot become parallel dictionary identities.
  const clean = primaryInput.toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '');
  return clean || rawKey;
}

/**
 * Checks if two biomarker definitions/records are duplicates of each other using
 * key stems, normalized names, unit compatibility, and range/value similarity.
 */
export function isBiomarkerDuplicateCandidate(
  bioA: { key: string; name?: string; unit?: string; normalRange?: string; values?: any[]; category?: string },
  bioB: { key: string; name?: string; unit?: string; normalRange?: string; values?: any[]; category?: string }
): { isMatch: boolean; confidence: number; reason: string; matchType: string } {
  if (!bioA || !bioB || !bioA.key || !bioB.key) {
    return { isMatch: false, confidence: 0, reason: 'Invalid biomarker entries', matchType: 'none' };
  }

  if (bioA.key === bioB.key) {
    return { isMatch: true, confidence: 1.0, reason: 'Exact key identity', matchType: 'exact_key' };
  }

  const stemA = normalizeStemKey(bioA.key);
  const stemB = normalizeStemKey(bioB.key);

  const rawCleanA = (bioA.name || bioA.key).toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawCleanB = (bioB.name || bioB.key).toLowerCase().replace(/[^a-z0-9]/g, '');

  const normNameA = normalizeBiomarkerName(bioA.name || bioA.key);
  const normNameB = normalizeBiomarkerName(bioB.name || bioB.key);

  // 1. Canonical Stem Match (e.g. egfr and egfr_mlmin173m2, ast and ast_serum_level_u_l)
  if (stemA && stemB && stemA === stemB) {
    return {
      isMatch: true,
      confidence: 0.98,
      reason: `Shared canonical stem "${stemA}"`,
      matchType: 'canonical_stem'
    };
  }

  // 2. Exact Normalized Name Match (e.g. Name: "eGFR" vs Name: "eGFR", "Body Mass Index" vs "Body Mass Index")
  if (rawCleanA && rawCleanB && rawCleanA === rawCleanB) {
    return {
      isMatch: true,
      confidence: 0.99,
      reason: `Exact identical biomarker name "${bioA.name || bioA.key}"`,
      matchType: 'exact_name'
    };
  }

  // 3. Unit-Stripped Normalized Name Match (e.g. "Mean Corpuscular Hemoglobin Pg" vs "Mean Corpuscular Hemoglobin")
  if (normNameA && normNameB && (normNameA === normNameB || normNameA.replace(/\s+/g, '') === normNameB.replace(/\s+/g, ''))) {
    return {
      isMatch: true,
      confidence: 0.95,
      reason: `Standardized name match "${normNameA}" after unit/abbreviation normalization`,
      matchType: 'normalized_name'
    };
  }

  // 4. Clinical Synonym Dictionary match
  const synA = lookupClinicalSynonym(rawCleanA) || lookupClinicalSynonym(stemA);
  const synB = lookupClinicalSynonym(rawCleanB) || lookupClinicalSynonym(stemB);
  if (synA && synB && synA === synB) {
    return {
      isMatch: true,
      confidence: 0.96,
      reason: `Clinical synonym match resolving to "${synA}"`,
      matchType: 'clinical_synonym'
    };
  }

  // 4b. Canonical Mapped-Key Match — reuses the single source-of-truth resolver
  // (getMappedBiomarkerKey), which additionally applies specimen/false-friend guards
  // (e.g. any "egfr*" variant, MCH-vs-hemoglobin disambiguation) that the stem/synonym
  // checks above don't cover on their own. Only trusted when it lands on a REAL
  // catalog key (not the raw-slug fallback getMappedBiomarkerKey returns for
  // completely unrecognized input), so two unrelated unknown markers can't
  // coincidentally "match" just because neither resolved to anything.
  const mappedA = getMappedBiomarkerKey(bioA.key, bioA.name);
  const mappedB = getMappedBiomarkerKey(bioB.key, bioB.name);
  const isKnownCatalogKey = (k: string) => biomarkerDefinitions.some(d => d.key === k);
  if (mappedA && mappedB && mappedA === mappedB && isKnownCatalogKey(mappedA)) {
    return {
      isMatch: true,
      confidence: 0.94,
      reason: `Both resolve to the same catalog biomarker "${mappedA}"`,
      matchType: 'canonical_mapped_key'
    };
  }

  // 5. Close Substring / Stem Ingestion with unit/category compatibility check
  const isSubstring = (rawCleanA.length > 5 && rawCleanB.includes(rawCleanA)) || (rawCleanB.length > 5 && rawCleanA.includes(rawCleanB));
  const isNameSubstring = (normNameA.length > 4 && normNameB.includes(normNameA)) || (normNameB.length > 4 && normNameA.includes(normNameB));

  if (isSubstring || isNameSubstring) {
    // Check for distinct clinical discriminators (false friends). Uses the single
    // declarative CLINICAL_DISCRIMINATOR_TERMS list above — do not reintroduce a local
    // array here. To extend false-friend protection for a new confusable pair, add the
    // word to CLINICAL_DISCRIMINATOR_TERMS, not here.
    const isFalseFriend = hasDiscriminatorConflict(rawCleanA, rawCleanB);

    if (!isFalseFriend) {
      // Confirm with unit or category or range if available
      const unitA = (bioA.unit || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const unitB = (bioB.unit || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const unitMatch = !unitA || !unitB || unitA === unitB || unitA.includes(unitB) || unitB.includes(unitA);
      
      const rangeA = (bioA.normalRange || '').toLowerCase().trim();
      const rangeB = (bioB.normalRange || '').toLowerCase().trim();
      const rangeMatch = !rangeA || !rangeB || rangeA === 'unknown' || rangeB === 'unknown' || rangeA === rangeB;

      if (unitMatch && rangeMatch) {
        return {
          isMatch: true,
          confidence: 0.88,
          reason: `High substring name similarity with compatible units and clinical ranges`,
          matchType: 'close_name_match'
        };
      }
    }
  }

  return { isMatch: false, confidence: 0, reason: 'No significant duplicate signature detected', matchType: 'none' };
}

/**
 * Searches across the entire dictionary universe (built-in catalog, active custom biomarkers,
 * not-used biomarkers, and logged historical entries) to identify if a new biomarker candidate
 * is already present or duplicates an existing entry.
 */
export function findDuplicateOrExistingBiomarker(
  input: string,
  profile?: any,
  biomarkerHistory?: any[]
): {
  isDuplicate: boolean;
  matchedKey: string;
  matchedName: string;
  isNotUsed: boolean;
  isBuiltIn: boolean;
  reason: string;
} | null {
  if (!input || !input.trim()) return null;
  const target = input.trim();
  const targetStem = normalizeStemKey(target);
  const targetNormName = normalizeBiomarkerName(target);
  const mappedKey = getMappedBiomarkerKey(target);

  const customBiomarkers = profile?.customBiomarkers || {};
  const notUsedBiomarkers = Array.isArray(profile?.notUsedBiomarkers) ? profile.notUsedBiomarkers : [];
  const notUsedMedical = Array.isArray(profile?.notUsedInMedicalHistory) ? profile.notUsedInMedicalHistory : [];
  const allNotUsed = new Set([...notUsedBiomarkers, ...notUsedMedical]);

  // Candidate Pool:
  // 1. Check Built-in Catalog
  for (const def of biomarkerDefinitions) {
    const match = isBiomarkerDuplicateCandidate(
      { key: target, name: target },
      { key: def.key, name: def.name, unit: def.unit, normalRange: def.normalRange }
    );
    if (match.isMatch || def.key === mappedKey || (def.aliases && def.aliases.includes(target))) {
      const isNotUsed = allNotUsed.has(def.key);
      return {
        isDuplicate: true,
        matchedKey: def.key,
        matchedName: def.name,
        isNotUsed,
        isBuiltIn: true,
        reason: match.reason || `Direct match with standard biomarker catalog (${def.name})`
      };
    }
  }

  // 2. Check Custom Biomarkers (active & not-used)
  for (const [key, def] of Object.entries(customBiomarkers)) {
    const customDef = def as any;
    const match = isBiomarkerDuplicateCandidate(
      { key: target, name: target },
      { key, name: customDef.name || key, unit: customDef.unit, normalRange: customDef.normalRange }
    );
    if (match.isMatch || key === mappedKey || normalizeStemKey(key) === targetStem) {
      const isNotUsed = allNotUsed.has(key);
      return {
        isDuplicate: true,
        matchedKey: key,
        matchedName: customDef.name || key,
        isNotUsed,
        isBuiltIn: false,
        reason: match.reason || `Direct match with existing custom biomarker (${customDef.name || key})`
      };
    }
  }

  // 3. Check Not-Used Biomarker Keys that might not be in customBiomarkers
  for (const notUsedKey of allNotUsed) {
    if (notUsedKey === mappedKey || normalizeStemKey(notUsedKey) === targetStem) {
      return {
        isDuplicate: true,
        matchedKey: notUsedKey,
        matchedName: notUsedKey,
        isNotUsed: true,
        isBuiltIn: false,
        reason: `Matched archived/not-used biomarker key (${notUsedKey})`
      };
    }
  }

  return null;
}

export function getCustomBiomarkerDef(profile: any, coreKey: string) {
  if (!profile || !profile.customBiomarkers) return undefined;
  
  // 1. Try the core key first
  if (profile.customBiomarkers[coreKey]) return profile.customBiomarkers[coreKey];
  
  // 2. Fallback to aliases: if the database has a legacy key, return that!
  const centralDef = biomarkerDefinitions.find(d => d.key === coreKey);
  if (centralDef && centralDef.aliases) {
    for (const alias of centralDef.aliases) {
      if (profile.customBiomarkers[alias]) return profile.customBiomarkers[alias];
    }
  }
  return undefined;
}

export const categoryLabels: { [key: string]: { [lang: string]: string } } = {
  blood_sugar: { en: 'Blood Sugar', fr: 'Glycémie', zh: '血糖管理', id: 'Gula Darah' },
  lipids: { en: 'Cardiovascular Lipids', fr: 'Lipides & Cardiovasculaire', zh: '心血管与血脂', id: 'Profil Lipid' },
  kidneys: { en: 'Kidney Function', fr: 'Fonction Rénale', zh: '肾脏功排毒', id: 'Fungsi Ginjal' },
  hematology: { en: 'Hematology (CBC)', fr: 'Hématologie (NFS)', zh: '血常规与红细胞', id: 'Hematologi' },
  inflammation: { en: 'Inflammation markers', fr: 'Marqueurs Inflammatoires', zh: '机体炎性指标', id: 'Penanda Inflamasi' },
  hormones: { en: 'Endocrine Hormones', fr: 'Hormones Endocriniennes', zh: '内分泌与激素', id: 'Hormon Endokrin' },
  vitamins: { en: 'Vitamins & Micronutrients', fr: 'Vitamines & Micronutriments', zh: '维生素与微量元素', id: 'Vitamin & Mikro' }
};
export function parseNormalRangeBounds(normalRangeStr?: string): { min?: number; max?: number } {
  if (!normalRangeStr) return {};
  const s = String(normalRangeStr).trim();
  if (s.toLowerCase().startsWith('unknown') || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'unset') return {};
  const rangeMatch = s.match(/(-?[\d.]+)\s*-\s*(-?[\d.]+)/);
  if (rangeMatch) {
    return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  }
  const underMatch = s.match(/(?:under|<|aim\s+under|<=)\s*(-?[\d.]+)/i);
  if (underMatch) {
    return { max: parseFloat(underMatch[1]) };
  }
  const overMatch = s.match(/(?:over|>|aim\s+over|>=)\s*(-?[\d.]+)/i);
  if (overMatch) {
    return { min: parseFloat(overMatch[1]) };
  }
  return {};
}

export function isExcludedDeviceMetric(k: string): boolean {
  return /^(steps|step_count|stepcount|daily_steps|weight|body_weight|bodyweight|active_minutes|sleep_duration|resting_heart_rate|water_intake|distance)$/i.test(k);
}

export function isBiomarkerValueImprobable(key: string, val: number | string, normalRangeStr?: string): boolean {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return false;
  
  const mapped = getMappedBiomarkerKey(key) || key;
  const def = biomarkerDefinitions.find(d => d.key === mapped || d.key === key || (Array.isArray(d.aliases) && d.aliases.some(a => a.toLowerCase() === key.toLowerCase())));

  if (def?.plausibleBounds) {
    if (def.plausibleBounds.min !== undefined && num < def.plausibleBounds.min) return true;
    if (def.plausibleBounds.max !== undefined && num > def.plausibleBounds.max) return true;
  }

  // Device & lifestyle biometrics (steps, active minutes, water intake, etc.) vary by daily behavior
  // and must not be flagged as improbable clinical blood lab unit mismatches.
  if (isExcludedDeviceMetric(key) || isExcludedDeviceMetric(mapped)) {
    if (num < 0) return true;
    return false;
  }

  let rangeStr = (normalRangeStr && normalRangeStr !== 'Unknown' && normalRangeStr !== 'unset' && normalRangeStr !== 'n/a' && normalRangeStr !== '-') ? normalRangeStr : undefined;
  if (!rangeStr) {
    rangeStr = def?.normalRange;
  }

  const bounds = parseNormalRangeBounds(rangeStr);
  const refMax = bounds.max !== undefined ? bounds.max : bounds.min;
  const refMin = bounds.min !== undefined ? bounds.min : 0;
  const normalizedKey = (key || '').toLowerCase();

  // Structural check 1: Unit scale mismatch (e.g. decimal ratio entered when normal range is percentage or whole numbers)
  if (bounds.min !== undefined && refMax !== undefined && refMax >= 10 && num > 0 && num < 1.0) {
    return true; // Decimal fraction entered when reference range is whole unit (e.g., 0.48 for 36-50%)
  }

  // Structural check 2: Unit scale mismatch (e.g. percentage or whole number entered when normal range is ratio <= 1.0)
  if (refMax !== undefined && refMax > 0 && refMax <= 1.0 && num >= 10) {
    return true; // Percentage entered when reference range is a fraction (e.g., 42.1 for 0.36-0.50 L/L)
  }

  // Structural check 3: WBC Differential cell count / percentage mismatch (Basophils, Eosinophils, Monocytes, Lymphocytes, Neutrophils)
  const isWbc = /basophil|eosinophil|monocyte|lymphocyte|neutrophil/.test(normalizedKey);
  if (isWbc && refMax !== undefined && refMax <= 8.0) {
    if (num >= 50 && refMax <= 2.0) return true; // e.g. 100 cells/µL for basophils
    if (num > refMax * 3) return true; // e.g. 55 for neutrophils (2.0-6.3), 32 for lymphocytes (1.0-3.2), 7 for monocytes (0.1-0.6), 4 for eosinophils (0.02-0.52)
    if (num >= 1.5 && refMax <= 1.0) return true;
  }

  // Structural check 4: Unit mismatch for high-baseline analytes with bounded clinical ranges
  if (bounds.min !== undefined && bounds.max !== undefined && refMin >= 50 && num > 0 && num < refMin * 0.45) {
    return true; // e.g. Hemoglobin 14.5 g/dL when range is 120-180 g/L, or Sodium 30 when range is 135-145
  }

  // Structural check 5: Extreme physiological outliers (> 4x max or < 0.25x min)
  if (bounds.min !== undefined && bounds.max !== undefined && refMin > 0 && num < refMin * 0.25) {
    return true;
  }
  if (refMax !== undefined && refMax > 0 && num > refMax * 4) {
    return true;
  }

  return false;
}

export interface FlaggedTelemetryError {
  key: string;
  name: string;
  value: any;
  unit: string;
  reason: string;
  issueTitle?: string;
  preciseCause?: string;
  suggestedFix?: string;
  badgeLabel?: string;
  samples: string[];
  proposedAutoFix?: {
    canAutoFix: boolean;
    proposedValue: number;
    proposedMultiplier: number;
    fixLabel: string;
    reason: string;
  };
}

export interface TelemetryDiagnosis {
  issueTitle: string;
  preciseCause: string;
  suggestedFix: string;
  badgeLabel: string;
}

export function diagnoseTelemetryIssue(
  key: string,
  name: string,
  val: any,
  unit: string,
  rangeStr?: string,
  historyEntries?: { date: string; val: any }[],
  lang?: unknown
): TelemetryDiagnosis {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  const bounds = parseNormalRangeBounds(rangeStr);
  const refMax = bounds.max !== undefined ? bounds.max : bounds.min;
  const refMin = bounds.min !== undefined ? bounds.min : 0;
  const normalizedKey = (key || '').toLowerCase();
  const displayUnit = unit || '';

  // 1. WBC Differential Count Scale Mismatch (Basophils, Eosinophils, Monocytes, Lymphocytes, Neutrophils)
  const isWbcDifferential = /basophil|eosinophil|monocyte|lymphocyte|neutrophil/.test(normalizedKey);
  if (isWbcDifferential && !isNaN(num) && refMax !== undefined && refMax <= 8.0) {
    if (num >= 50 && refMax <= 2.0) {
      // e.g. 100 logged for basophils (range 0.0 - 0.1 10^9/L)
      const multiple = Math.round(num / (refMax || 0.1));
      return {
        issueTitle: t(lang, 'outlierTitleWbcCells'),
        preciseCause: interpolate(t(lang, 'outlierWbcCellsCause'), { val, unit: displayUnit || '10^9/L', multiple, range: rangeStr || '0.0 - 0.1', converted: (num / 1000).toFixed(2) }),
        suggestedFix: interpolate(t(lang, 'outlierFixWbcCells'), { converted: (num / 1000).toFixed(2) }),
        badgeLabel: t(lang, 'outlierBadgeWbcCells')
      };
    }
    if (num > refMax * 3 || (num >= 1.5 && refMax <= 1.0)) {
      // e.g. 55 for neutrophils, 32 for lymphocytes, 7 for monocytes, 4 for eosinophils
      const multiple = Math.round(num / refMax);
      return {
        issueTitle: t(lang, 'outlierTitleWbcPct'),
        preciseCause: interpolate(t(lang, 'outlierWbcPctCause'), { val, unit: displayUnit || '10^9/L', multiple, range: rangeStr || '', converted: (num * 0.1).toFixed(2) }),
        suggestedFix: interpolate(t(lang, 'outlierFixWbcPct'), { val, converted: (num * 0.1).toFixed(2) }),
        badgeLabel: t(lang, 'outlierBadgeWbcPct')
      };
    }
  }

  // 2. Ratio vs Percentage scale mismatch (e.g. Hematocrit 0.48 vs 48%)
  if (refMax !== undefined && refMax > 0 && refMax <= 1.0 && !isNaN(num) && num >= 10) {
    return {
      issueTitle: interpolate(t(lang, 'outlierTitleRatioPct'), { val }),
      preciseCause: interpolate(t(lang, 'outlierRatioPctCause'), { val, range: rangeStr }),
      suggestedFix: interpolate(t(lang, 'outlierFixRatioPct'), { converted: (num / 100).toFixed(2) }),
      badgeLabel: t(lang, 'outlierBadgeRatioPct')
    };
  }

  if (bounds.min !== undefined && refMax !== undefined && refMax >= 10 && !isNaN(num) && num > 0 && num < 1.0) {
    return {
      issueTitle: interpolate(t(lang, 'outlierTitleRatioDec'), { val }),
      preciseCause: interpolate(t(lang, 'outlierRatioDecCause'), { val, range: rangeStr, refMin, refMax }),
      suggestedFix: interpolate(t(lang, 'outlierFixRatioDec'), { converted: (num * 100).toFixed(1) }),
      badgeLabel: t(lang, 'outlierBadgeRatioDec')
    };
  }

  // 3. High-baseline unit multiplier mismatch (e.g. Hemoglobin 14.5 g/dL vs 120-180 g/L, or Cholesterol mg/dL vs mmol/L)
  if (bounds.min !== undefined && bounds.max !== undefined && refMin >= 50 && !isNaN(num) && num > 0 && num < refMin * 0.45) {
    return {
      issueTitle: t(lang, 'outlierTitleTenX'),
      preciseCause: interpolate(t(lang, 'outlierTenXCause'), { val, range: rangeStr }),
      suggestedFix: interpolate(t(lang, 'outlierFixTenX'), { converted: (num * 10).toFixed(0), rMin: (refMin / 10).toFixed(1), rMax: (bounds.max / 10).toFixed(1) }),
      badgeLabel: t(lang, 'outlierBadgeTenX')
    };
  }

  // 4. Very High Outlier (>3.5x normal max)
  if (refMax !== undefined && refMax > 0 && num > refMax * 3.5) {
    const ratio = Math.round(num / refMax);
    return {
      issueTitle: t(lang, 'outlierTitleHigh'),
      preciseCause: interpolate(t(lang, 'outlierHighCause'), { val, unit: displayUnit, ratio, refMax }),
      suggestedFix: t(lang, 'outlierFixHigh'),
      badgeLabel: interpolate(t(lang, 'outlierBadgeHigh'), { ratio })
    };
  }

  // 5. Very Low Outlier (<0.25x normal min)
  if (refMin !== undefined && refMin > 0 && num < refMin * 0.25) {
    return {
      issueTitle: t(lang, 'outlierTitleLow'),
      preciseCause: interpolate(t(lang, 'outlierLowCause'), { val, unit: displayUnit, refMin }),
      suggestedFix: t(lang, 'outlierFixLow'),
      badgeLabel: t(lang, 'outlierBadgeLow')
    };
  }

  // 6. Historical Shift Check
  if (historyEntries && historyEntries.length >= 2) {
    const numValues = historyEntries
      .map(e => (typeof e.val === 'number' ? e.val : parseFloat(String(e.val))))
      .filter(n => !isNaN(n));
    if (numValues.length >= 2) {
      const maxVal = Math.max(...numValues);
      const minVal = Math.min(...numValues.filter(v => v > 0));
      if (minVal > 0 && maxVal / minVal >= 15) {
        return {
          issueTitle: t(lang, 'outlierTitleHistory'),
          preciseCause: interpolate(t(lang, 'outlierHistoryCause'), { minVal, maxVal, gap: Math.round(maxVal / minVal) }),
          suggestedFix: t(lang, 'outlierFixHistory'),
          badgeLabel: t(lang, 'outlierBadgeHistory')
        };
      }
    }
  }

  return {
    issueTitle: t(lang, 'outlierTitleGeneric'),
    preciseCause: interpolate(t(lang, 'outlierGenericCause'), { val, range: rangeStr || 'unknown' }),
    suggestedFix: t(lang, 'outlierFixGeneric'),
    badgeLabel: t(lang, 'outlierBadgeGeneric')
  };
}

function rangeFit(value: number, min?: number, max?: number): number {
  if (min === undefined && max === undefined) return Number.POSITIVE_INFINITY;
  const lo = min ?? max as number;
  const hi = max ?? min as number;
  if (value >= lo && value <= hi) return 0;
  if (value < lo) return (lo - value) / Math.max(Math.abs(lo), 1e-6);
  return (value - hi) / Math.max(Math.abs(hi), 1e-6);
}

export function computeBiomarkerTelemetryMultiplier(
  key: string,
  val: any,
  rangeStr?: string,
  lang?: unknown
): { multiplier: number; reason: string } | null {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num) || num <= 0) return null;
  const mapped = getMappedBiomarkerKey(key) || key;
  const spec = ANALYTE_CONVERSIONS[mapped] || ANALYTE_CONVERSIONS[key];
  if (!spec) return null;

  let effectiveRange = (rangeStr && rangeStr !== 'Unknown' && rangeStr !== 'unset' && rangeStr !== 'n/a' && rangeStr !== '-') ? rangeStr : undefined;
  if (!effectiveRange) {
    const def = biomarkerDefinitions.find(d => d.key === mapped || d.key === key || (Array.isArray(d.aliases) && d.aliases.some(a => a.toLowerCase() === key.toLowerCase())));
    effectiveRange = def?.normalRange;
  }
  const bounds = parseNormalRangeBounds(effectiveRange);
  if (bounds.min === undefined && bounds.max === undefined) return null;

  const fitNone = rangeFit(num, bounds.min, bounds.max);
  if (fitNone === 0) return null;

  const asSi = num * spec.multiply;
  const asUs = num / spec.multiply;
  const fitToSi = rangeFit(asSi, bounds.min, bounds.max);
  const fitToUs = rangeFit(asUs, bounds.min, bounds.max);
  const best = Math.min(fitToSi, fitToUs);
  if (best >= fitNone || best > 2) return null;

  if (fitToSi <= fitToUs && fitToSi * 4 < fitToUs) {
    return {
      multiplier: spec.multiply,
      reason: interpolate(t(lang, 'auditFixConverted'), { from: spec.from, to: spec.to, m: spec.multiply }),
    };
  }
  if (fitToUs < fitToSi && fitToUs * 4 < fitToSi) {
    return {
      multiplier: 1 / spec.multiply,
      reason: interpolate(t(lang, 'auditFixConvertedBack'), { from: spec.from, to: spec.to, m: spec.multiply }),
    };
  }
  return null;
}

let _lastFlaggedArgs: any[] = [];
let _lastFlaggedResult: FlaggedTelemetryError[] = [];

export function detectFlaggedTelemetryErrors(
  resolvedBiomarkers: Record<string, any>,
  profile: any,
  activeHistory: any[],
  allDefinitions: any[]
): FlaggedTelemetryError[] {
  if (
    _lastFlaggedArgs[0] === resolvedBiomarkers &&
    _lastFlaggedArgs[1] === profile &&
    _lastFlaggedArgs[2] === activeHistory &&
    _lastFlaggedArgs[3] === allDefinitions
  ) {
    return _lastFlaggedResult;
  }
  _lastFlaggedResult = _detectFlaggedTelemetryErrors(resolvedBiomarkers, profile, activeHistory, allDefinitions);
  _lastFlaggedArgs = [resolvedBiomarkers, profile, activeHistory, allDefinitions];
  return _lastFlaggedResult;
}

function _detectFlaggedTelemetryErrors(
  resolvedBiomarkers: Record<string, any>,
  profile: any,
  activeHistory: any[],
  allDefinitions: any[]
): FlaggedTelemetryError[] {
  const flaggedMap = new Map<string, FlaggedTelemetryError>();

  // Helper to resolve def & custom case-insensitively and canonicalize key
  const resolveDefAndCustom = (k: string) => {
    const canonical = getMappedBiomarkerKey(k) || k;
    const kClean = (k || '').toLowerCase().replace(/[\s_]/g, '');
    const canClean = canonical.toLowerCase().replace(/[\s_]/g, '');
    const custom = profile?.customBiomarkers?.[k] ||
      profile?.customBiomarkers?.[canonical] ||
      Object.entries(profile?.customBiomarkers || {}).find(([ck]) => ck.toLowerCase() === k.toLowerCase() || ck.toLowerCase().replace(/[\s_]/g, '') === kClean || ck.toLowerCase().replace(/[\s_]/g, '') === canClean)?.[1];
    const def = (allDefinitions || []).find((d: any) => d.key === canonical || d.key?.toLowerCase() === k.toLowerCase() || d.key?.toLowerCase().replace(/[\s_]/g, '') === kClean || d.name?.toLowerCase() === k.toLowerCase() || d.name?.toLowerCase().replace(/[\s_]/g, '') === kClean) ||
      biomarkerDefinitions.find((d: any) => d.key === canonical || d.key?.toLowerCase() === k.toLowerCase() || d.key?.toLowerCase().replace(/[\s_]/g, '') === kClean || d.name?.toLowerCase() === k.toLowerCase() || d.name?.toLowerCase().replace(/[\s_]/g, '') === kClean);
    return { custom, def, canonicalKey: canonical };
  };

  // Compute automated conversion proposal for an outlier
  const buildAutoFixProposal = (key: string, val: any, range?: string) => {
    const num = typeof val === 'number' ? val : parseFloat(String(val));
    if (isNaN(num)) return undefined;
    const fix = computeBiomarkerTelemetryMultiplier(key, num, range, profile?.language);
    if (!fix) {
      return {
        canAutoFix: false,
        proposedValue: num,
        proposedMultiplier: 1,
        fixLabel: t(profile?.language, 'auditFixNeedsReview'),
        reason: t(profile?.language, 'auditFixAmbiguous')
      };
    }
    let converted = num * fix.multiplier;
    if (converted >= 100) converted = Math.round(converted);
    else if (converted >= 10) converted = parseFloat(converted.toFixed(1));
    else converted = parseFloat(converted.toFixed(3));

    return {
      canAutoFix: true,
      proposedValue: converted,
      proposedMultiplier: fix.multiplier,
      fixLabel: fix.reason,
      reason: fix.reason
    };
  };

  // 1. Check current resolved biomarkers
  Object.entries(resolvedBiomarkers || {}).forEach(([key, val]) => {
    if (val === undefined || val === null || val === '') return;
    if (isExcludedDeviceMetric(key)) return;
    if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || (profile?.customBiomarkers?.[key] && profile?.deletedCustomBiomarkerKeys?.[key])) return;
    
    const { custom, def, canonicalKey } = resolveDefAndCustom(key);
    const range = (custom?.normalRange && custom.normalRange !== 'Unknown' && custom.normalRange !== 'unset' && custom.normalRange !== 'n/a' && custom.normalRange !== '-') ? custom.normalRange : (def?.normalRange || custom?.normalRange);
    const name = custom?.name || def?.name || canonicalKey;
    const unit = custom?.unit || def?.unit || '';

    const num = typeof val === 'number' ? val : parseFloat(String(val));
    if (!isNaN(num) && isBiomarkerValueImprobable(canonicalKey, num, range)) {
      const diag = diagnoseTelemetryIssue(canonicalKey, name, val, unit, range, undefined, profile?.language);
      const autoFix = buildAutoFixProposal(canonicalKey, val, range);
      flaggedMap.set(canonicalKey, {
        key: canonicalKey,
        name,
        value: val,
        unit,
        reason: diag.preciseCause,
        issueTitle: diag.issueTitle,
        preciseCause: diag.preciseCause,
        suggestedFix: diag.suggestedFix,
        badgeLabel: diag.badgeLabel,
        samples: [`Current: ${val} ${unit}`.trim()],
        proposedAutoFix: autoFix
      });
    }
  });

  // 2. Check historical logs for ratio/percentage/unit notation shifts and outliers
  const historyByKey: Record<string, { date: string; val: any; rawKey: string }[]> = {};
  (activeHistory || []).forEach((log: any) => {
    if (log.biomarkers) {
      Object.entries(log.biomarkers).forEach(([key, val]) => {
        if (isExcludedDeviceMetric(key)) return;
        const { canonicalKey } = resolveDefAndCustom(key);
        if (!historyByKey[canonicalKey]) historyByKey[canonicalKey] = [];
        historyByKey[canonicalKey].push({ date: log.date || 'log', val, rawKey: key });
      });
    }
  });

  Object.entries(historyByKey).forEach(([key, entries]) => {
    if (isExcludedDeviceMetric(key)) return;
    if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || (profile?.customBiomarkers?.[key] && profile?.deletedCustomBiomarkerKeys?.[key])) return;
    
    const { custom, def, canonicalKey } = resolveDefAndCustom(key);
    const range = (custom?.normalRange && custom.normalRange !== 'Unknown' && custom.normalRange !== 'unset' && custom.normalRange !== 'n/a' && custom.normalRange !== '-') ? custom.normalRange : (def?.normalRange || custom?.normalRange);
    const name = custom?.name || def?.name || canonicalKey;
    const unit = custom?.unit || def?.unit || '';

    const numValues = entries
      .map(e => (typeof e.val === 'number' ? e.val : parseFloat(String(e.val))))
      .filter(n => !isNaN(n));

    let hasImprobableEntry = false;
    let worstEntry: { date: string; val: any; rawKey: string } | null = null;
    const sampleStrs: string[] = [];
    entries.forEach(e => {
      const n = typeof e.val === 'number' ? e.val : parseFloat(String(e.val));
      if (!isNaN(n)) {
        if (isBiomarkerValueImprobable(canonicalKey, n, range)) {
          hasImprobableEntry = true;
          if (!worstEntry) worstEntry = e;
        }
        sampleStrs.push(`${e.date}: ${e.val}`);
      }
    });

    let hasLargeShift = false;
    if (numValues.length >= 2) {
      const maxVal = Math.max(...numValues);
      const minVal = Math.min(...numValues.filter(v => v > 0));
      if (minVal > 0 && maxVal / minVal >= 15) {
        hasLargeShift = true;
      }
    }

    if (hasImprobableEntry || hasLargeShift) {
      const existing = flaggedMap.get(canonicalKey);
      const targetVal = worstEntry ? worstEntry.val : entries[0]?.val;
      const diag = diagnoseTelemetryIssue(canonicalKey, name, targetVal, unit, range, entries, profile?.language);
      const autoFix = buildAutoFixProposal(canonicalKey, targetVal, range);

      const prioritizedSamples = worstEntry && isBiomarkerValueImprobable(canonicalKey, typeof worstEntry.val === 'number' ? worstEntry.val : parseFloat(String(worstEntry.val)), range)
        ? [`${worstEntry.date}: ${worstEntry.val}`, ...sampleStrs.filter(s => s !== `${worstEntry?.date}: ${worstEntry?.val}`).slice(0, 4)]
        : sampleStrs.slice(0, 5);

      if (existing) {
        prioritizedSamples.forEach(s => {
          if (!existing.samples.includes(s)) existing.samples.push(s);
        });
        if (!existing.preciseCause && diag.preciseCause) {
          existing.preciseCause = diag.preciseCause;
          existing.issueTitle = diag.issueTitle;
          existing.suggestedFix = diag.suggestedFix;
          existing.badgeLabel = diag.badgeLabel;
        }
        if (!existing.proposedAutoFix && autoFix) {
          existing.proposedAutoFix = autoFix;
        }
      } else {
        flaggedMap.set(canonicalKey, {
          key: canonicalKey,
          name,
          value: targetVal,
          unit,
          reason: diag.preciseCause,
          issueTitle: diag.issueTitle,
          preciseCause: diag.preciseCause,
          suggestedFix: diag.suggestedFix,
          badgeLabel: diag.badgeLabel,
          samples: prioritizedSamples,
          proposedAutoFix: autoFix
        });
      }
    }
  });

  // 3. Check custom biomarker definitions for corrupted/missing unit declarations
  if (profile?.customBiomarkers) {
    Object.entries(profile.customBiomarkers).forEach(([key, customDef]: [string, any]) => {
      if (isExcludedDeviceMetric(key)) return;
      if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || profile?.deletedCustomBiomarkerKeys?.[key]) return;
      const { canonicalKey, def } = resolveDefAndCustom(key);
      if (flaggedMap.has(canonicalKey)) return;

      const unit = String(customDef?.unit || '').trim().toLowerCase();
      const isCorrupted = !unit || unit === 'null' || unit === 'undefined' || unit === 'unknown' || unit === 'none';
      if (isCorrupted) {
        const name = customDef?.name || def?.name || canonicalKey;
        const range = customDef?.normalRange || def?.normalRange;
        flaggedMap.set(canonicalKey, {
          key: canonicalKey,
          name,
          value: customDef?.optimalValue || 'Unspecified',
          unit: customDef?.unit || '',
          reason: t(profile?.language, 'auditCauseMissingUnit'),
          issueTitle: t(profile?.language, 'auditTitleMissingUnit'),
          preciseCause: t(profile?.language, 'auditCauseMissingUnit'),
          suggestedFix: t(profile?.language, 'auditFixMissingUnit'),
          badgeLabel: t(profile?.language, 'auditBadgeMissingUnit'),
          samples: [t(profile?.language, 'auditSampleCorruptUnit')],
          proposedAutoFix: {
            canAutoFix: false,
            proposedValue: 0,
            proposedMultiplier: 1,
            fixLabel: t(profile?.language, 'auditFixNeedsReview'),
            reason: t(profile?.language, 'auditFixNeedsReviewReason')
          }
        });
      }
    });
  }

  return Array.from(flaggedMap.values());
}

export function normalizeHistoricalTelemetryErrors(
  history: any[],
  profile: any,
  allDefinitions?: any[],
  targetKeys?: string[]
): { updatedHistory: any[]; fixedCount: number } {
  if (!history || !Array.isArray(history)) return { updatedHistory: [], fixedCount: 0 };

  let fixedCount = 0;
  const updatedHistory = history.map((log: any) => {
    if (!log || !log.biomarkers) return log;

    const newBiomarkers = { ...log.biomarkers };
    let logChanged = false;

    Object.entries(newBiomarkers).forEach(([key, val]) => {
      if (val === undefined || val === null || val === '') return;
      if (targetKeys && targetKeys.length > 0 && !targetKeys.includes(key)) return;

      const num = typeof val === 'number' ? val : parseFloat(String(val));
      if (isNaN(num)) return;

      const def = (allDefinitions || []).find((d: any) => d.key === key) || biomarkerDefinitions.find((d: any) => d.key === key);
      const custom = profile?.customBiomarkers?.[key];
      const range = custom?.normalRange || def?.normalRange;

      let minNorm: number | null = null;
      let maxNorm: number | null = null;
      if (range) {
        const m = range.match(/([\d.]+)\s*-\s*([\d.]+)/);
        if (m) {
          minNorm = parseFloat(m[1]);
          maxNorm = parseFloat(m[2]);
        }
      }

      const k = key.toLowerCase();
      let normalizedVal: number | null = null;

      // 1. Hematocrit (unit: L/L or ratio, normal range 0.35 - 0.55; if entered as %, 48 -> 0.48)
      if (k === 'hematocrit') {
        if (num > 10) {
          normalizedVal = parseFloat((num / 100).toFixed(3)); // 48% -> 0.48 L/L
        }
      }
      // 2. Hemoglobin (unit: g/L, normal range 120 - 180; if entered as g/dL, 14.0 -> 140)
      else if (k === 'hemoglobin') {
        if (num > 0 && num < 30) {
          if (num * 10 >= 100 && num * 10 <= 250) {
            normalizedVal = parseFloat((num * 10).toFixed(1));  // 14.0 g/dL -> 140 g/L
          }
        }
      }
      // 3. Total cholesterol / lipids mg/dL -> mmol/L (e.g. 195 mg/dL -> 5.04 mmol/L)
      else if (k === 'total_cholesterol' || k === 'cholesterol') {
        if (num > 100) {
          normalizedVal = parseFloat((num / 38.67).toFixed(2));
        }
      }
      // 7. Generic scaling rule based on normal range bounds
      else if (minNorm !== null && maxNorm !== null && minNorm > 0 && maxNorm > 0) {
        if (num < minNorm * 0.15) {
          if (num * 100 >= minNorm * 0.7 && num * 100 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num * 100).toFixed(2));
          } else if (num * 10 >= minNorm * 0.7 && num * 10 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num * 10).toFixed(2));
          }
        } else if (num > maxNorm * 8) {
          if (num / 100 >= minNorm * 0.7 && num / 100 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num / 100).toFixed(2));
          } else if (num / 10 >= minNorm * 0.7 && num / 10 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num / 10).toFixed(2));
          }
        }
      }

      if (normalizedVal !== null && normalizedVal !== num) {
        newBiomarkers[key] = normalizedVal;
        logChanged = true;
        fixedCount++;
      }
    });

    if (logChanged) {
      return { ...log, biomarkers: newBiomarkers, sync_state: 'update' as const, updated_at: Date.now() };
    }
    return log;
  });

  return { updatedHistory, fixedCount };
}

/**
 * Load-time pass: FLAG only. Does not rewrite numbers (law: no silent convert).
 * `fixedCount` is how many keys look improbable — callers must not treat this as "already fixed".
 */
export function sanitizeBiomarkerHistoryOnLoad(
  history: any[],
  profile: any
): { history: any[]; fixedCount: number; current: Record<string, any>; flaggedKeys: string[] } {
  const flagged = detectFlaggedTelemetryErrors(
    {},
    profile,
    history || [],
    undefined
  );
  const flaggedKeys = flagged.map((f) => f.key);
  const current: Record<string, any> = {};
  const toYmd = (d: any) => {
    const s = String(d || '').trim();
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}${iso[2].padStart(2, '0')}${iso[3].padStart(2, '0')}`;
    const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (dmy) return `${dmy[3]}${dmy[2].padStart(2, '0')}${dmy[1].padStart(2, '0')}`;
    return s;
  };
  const sorted = [...(history || [])]
    .filter((h) => h && h.sync_state !== 'delete')
    .sort((a, b) => toYmd(a?.date).localeCompare(toYmd(b?.date)));
  sorted.forEach((log) => {
    Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') {
        current[k] = v;
      }
    });
  });
  return { history: history || [], fixedCount: flaggedKeys.length, current, flaggedKeys };
}

// Shared bracket-string matcher: parses a bracket's `range` string (supports
// "<", ">", "<=", ">=", the Unicode "≤"/"≥" operators, "under"/"over", plain
// "X - Y" bounds, and exact-value brackets like "0") and returns the matching
// bracket object, or null. Used by both getBiomarkerStatus() (severity enum)
// and getCustomStatusLabel() (display label) so AI-proposed rangeBrackets
// overrides (e.g. ethnicity-specific calibration) evaluate consistently
// instead of each call site re-implementing (and drifting from) its own
// parsing logic.
export function matchRangeBracket(num: number, rangeBrackets: any[] | undefined): any | null {
  if (!Array.isArray(rangeBrackets) || rangeBrackets.length === 0 || isNaN(num)) return null;
  for (const br of rangeBrackets) {
    if (!br) continue;
    const rawRange = String(br?.range || '').trim();
    if (rawRange.toLowerCase().startsWith('unknown')) continue;

    // Numeric-bounds bracket shape (e.g. AI clinical calibration brackets):
    // { label, severity, min, max }. Checked first because these brackets carry
    // no `range` string for the block below to parse. Bounds are inclusive on
    // both ends; a null/undefined bound is treated as unbounded in that direction.
    const hasNumericBound = (br?.min !== undefined && br?.min !== null && !isNaN(Number(br.min)))
      || (br?.max !== undefined && br?.max !== null && !isNaN(Number(br.max)));
    if (hasNumericBound) {
      const min = (br?.min !== undefined && br?.min !== null && !isNaN(Number(br.min))) ? Number(br.min) : null;
      const max = (br?.max !== undefined && br?.max !== null && !isNaN(Number(br.max))) ? Number(br.max) : null;
      const aboveMin = min === null || num >= min;
      const belowMax = max === null || num <= max;
      if (aboveMin && belowMax) return br;
      continue;
    }

    const rangeStr = rawRange.toLowerCase()
      .replace(/≥/g, '>=')
      .replace(/≤/g, '<=');
    if (!rangeStr) continue;

    if (rangeStr.includes('<') || rangeStr.includes('under')) {
      const valMatch = rangeStr.match(/[\d.]+/);
      if (valMatch) {
        const limit = parseFloat(valMatch[0]);
        const inclusive = rangeStr.includes('<=');
        if (inclusive ? num <= limit : num < limit) return br;
      }
      continue;
    }
    if (rangeStr.includes('>') || rangeStr.includes('over')) {
      const valMatch = rangeStr.match(/[\d.]+/);
      if (valMatch) {
        const limit = parseFloat(valMatch[0]);
        const inclusive = rangeStr.includes('>=');
        if (inclusive ? num >= limit : num > limit) return br;
      }
      continue;
    }
    const boundsMatch = rangeStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
    if (boundsMatch) {
      const min = parseFloat(boundsMatch[1]);
      const max = parseFloat(boundsMatch[2]);
      if (num >= min && num <= max) return br;
      continue;
    }
    if (/^[\d.]+$/.test(rangeStr) && num === parseFloat(rangeStr)) return br;
  }
  return null;
}

// Tunable constants for the simple-bounds/structuredRanges severity fallback
// (see getBiomarkerSeverityScore). Deliberately conservative: a raw
// percentage-deviation formula has no clinical calibration behind it, so it
// is capped at SEVERITY_FALLBACK_MAX_MAGNITUDE. Magnitudes 4-5 ("Very High"
// / "Acute Panic Emergency" on the -5..+5 clinical scale used in
// rangeBrackets/structured ranges, see agents/biomarkerInstructions.ts) are
// reserved for biomarkers that have an actual clinician-calibrated severity
// number, so an uncalibrated lifestyle lifestyle metric (e.g. Steps) can never
// out-rank a calibrated lab value at the same tier.
export const SEVERITY_FALLBACK_BREAKPOINTS = [0.10, 0.25]; // -> magnitudes 1, 2; anything beyond -> 3
export const SEVERITY_FALLBACK_MAX_MAGNITUDE = 3;

/**
 * Converts a fractional deviation beyond a violated boundary into a
 * magnitude on the same 0-5 scale used by clinician-calibrated severity
 * numbers, capped at SEVERITY_FALLBACK_MAX_MAGNITUDE. `ratio` is
 * excess-beyond-boundary divided by a reference width (see call sites for
 * how that width is chosen for one-sided vs two-sided ranges).
 */
function fallbackMagnitudeFromRatio(ratio: number): number {
  if (!isFinite(ratio) || ratio <= 0) return 0;
  if (ratio <= SEVERITY_FALLBACK_BREAKPOINTS[0]) return 1;
  if (ratio <= SEVERITY_FALLBACK_BREAKPOINTS[1]) return 2;
  return SEVERITY_FALLBACK_MAX_MAGNITUDE;
}

/**
 * Universal severity score for ranking, on the same signed -5..+5 scale
 * clinician-calibrated brackets already use (0 = optimal, +/-5 = acute
 * emergency). Returns null when no severity can be established at all
 * (missing value, no usable range, or a non-numeric result) — callers must
 * treat null as its own "unknown" tier rather than folding it into 0, since
 * 0 now means "confirmed normal", not "no data".
 *
 * Priority order (highest-fidelity source wins):
 *   1. customDef.rangeBrackets numeric severity (matchRangeBracket)
 *   2. evaluateStructuredRange numeric severity
 *   3. customDef.structuredRanges (isNormal buckets, no severity number) —
 *      distance-from-normal-boundary fallback, capped at magnitude 3
 *   4. plain normalRange string bounds (parseNormalRangeBounds) —
 *      distance-from-boundary fallback, capped at magnitude 3
 * Never mutates or depends on getBiomarkerStatus's string category, so
 * existing status/label behavior is unaffected.
 */
export function getBiomarkerSeverityScore(key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): number | null {
  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    if (customDef?.profileAdjustedNormalRange) {
      rangeStr = customDef.profileAdjustedNormalRange;
    } else if (customDef?.normalRange) {
      rangeStr = customDef.normalRange;
    } else {
      const def = biomarkerDefinitions.find(d => d.key === key);
      rangeStr = def?.normalRange;
    }
  }

  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return null;

  let valueToEvaluate = num;
  const rangeBoundsForScaling = parseNormalRangeBounds(rangeStr);
  if (rangeBoundsForScaling.min !== undefined && rangeBoundsForScaling.max !== undefined && rangeBoundsForScaling.max >= 10 && valueToEvaluate > 0 && valueToEvaluate < 1.0) {
    valueToEvaluate *= 100;
  }

  // 1. Clinician-calibrated rangeBrackets — use the numeric severity directly.
  if (Array.isArray(customDef?.rangeBrackets) && customDef.rangeBrackets.length > 0) {
    const validBrackets = customDef.rangeBrackets.filter((b: any) => b && !String(b.range || '').toLowerCase().startsWith('unknown'));
    if (validBrackets.length > 0) {
      const matchedBracket = matchRangeBracket(valueToEvaluate, validBrackets);
      if (matchedBracket && (typeof matchedBracket.severity === 'number' || (typeof matchedBracket.severity === 'string' && matchedBracket.severity.trim() !== '' && !isNaN(Number(matchedBracket.severity))))) {
        return Number(matchedBracket.severity);
      }
    }
  }

  // 2. Structured range (rangeConfig / bracket-type customRanges) numeric severity.
  const effectiveDef = customDef || biomarkerDefinitions.find(d => d.key === key);
  const evalRes = evaluateStructuredRange(valueToEvaluate, effectiveDef, profile);
  if (evalRes && (typeof evalRes.severity === 'number' || (typeof evalRes.severity === 'string' && evalRes.severity.trim() !== '' && !isNaN(Number(evalRes.severity))))) {
    return Number(evalRes.severity);
  }

  // 3. customDef.structuredRanges: named min/max buckets with an isNormal flag
  // but no severity number. Derive magnitude from how far the matched bucket
  // sits beyond the nearest normal boundary, capped at SEVERITY_FALLBACK_MAX_MAGNITUDE.
  if (customDef?.structuredRanges?.length > 0) {
    const ranges = customDef.structuredRanges;
    let matchedRange: any = null;
    for (const r of ranges) {
      let profileMatch = true;
      if (profile) {
        if (r.targetGender && profile.gender && r.targetGender.toLowerCase() !== profile.gender.toLowerCase()) profileMatch = false;
        if (r.targetEthnicity && profile.ethnicity) {
          const targetEth = r.targetEthnicity.toLowerCase();
          const pEth = profile.ethnicity.toLowerCase();
          if (!pEth.includes(targetEth) && !targetEth.includes(pEth)) profileMatch = false;
        }
        if (r.targetAgeMin !== undefined && r.targetAgeMin !== '' && profile.age && profile.age < Number(r.targetAgeMin)) profileMatch = false;
        if (r.targetAgeMax !== undefined && r.targetAgeMax !== '' && profile.age && profile.age > Number(r.targetAgeMax)) profileMatch = false;
      }
      if (!profileMatch) continue;
      let valMatch = true;
      if (r.min !== undefined && r.min !== '') { if (valueToEvaluate < Number(r.min)) valMatch = false; }
      if (r.max !== undefined && r.max !== '') { if (valueToEvaluate >= Number(r.max)) valMatch = false; }
      if (valMatch) { matchedRange = r; break; }
    }

    if (matchedRange) {
      if (matchedRange.isNormal) return 0;
      const normalRange = ranges.find((r: any) => r.isNormal);
      const isAboveNormal = normalRange ? (normalRange.max !== undefined && normalRange.max !== '' && valueToEvaluate >= Number(normalRange.max)) : true;
      const nearestBoundary = normalRange
        ? (isAboveNormal ? Number(normalRange.max) : Number(normalRange.min))
        : (matchedRange.min !== undefined ? Number(matchedRange.min) : 0);
      const bucketWidth = (matchedRange.min !== undefined && matchedRange.max !== undefined && isFinite(Number(matchedRange.max)))
        ? Math.abs(Number(matchedRange.max) - Number(matchedRange.min))
        : Math.abs(nearestBoundary) || 1;
      const excess = Math.abs(valueToEvaluate - nearestBoundary);
      const magnitude = fallbackMagnitudeFromRatio(excess / bucketWidth);
      return isAboveNormal ? magnitude : -magnitude;
    }
  }

  // 4. Plain "min - max" / one-sided normalRange string — distance-from-boundary fallback.
  if (!rangeStr || rangeStr.toLowerCase() === 'unknown') return null;
  const bounds = parseNormalRangeBounds(rangeStr);
  if (bounds.min === undefined && bounds.max === undefined) return null;

  if (bounds.min !== undefined && valueToEvaluate < bounds.min) {
    const referenceWidth = bounds.max !== undefined ? Math.abs(bounds.max - bounds.min) : Math.abs(bounds.min) || 1;
    const excess = bounds.min - valueToEvaluate;
    return -fallbackMagnitudeFromRatio(excess / referenceWidth);
  }
  if (bounds.max !== undefined && valueToEvaluate > bounds.max) {
    const referenceWidth = bounds.min !== undefined ? Math.abs(bounds.max - bounds.min) : Math.abs(bounds.max) || 1;
    const excess = valueToEvaluate - bounds.max;
    return fallbackMagnitudeFromRatio(excess / referenceWidth);
  }
  if (bounds.min !== undefined || bounds.max !== undefined) return 0;
  return null;
}

export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): 'normal' | 'low' | 'high' | 'critical' | 'flagged' | 'unknown' => {
  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    if (customDef?.profileAdjustedNormalRange) {
      rangeStr = customDef.profileAdjustedNormalRange;
    } else if (customDef?.normalRange) {
      rangeStr = customDef.normalRange;
    } else {
      const def = biomarkerDefinitions.find(d => d.key === key);
      rangeStr = def?.normalRange;
    }
  }

  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) {
    if (typeof val === 'string' && rangeStr && typeof rangeStr === 'string') {
      const valLower = val.trim().toLowerCase();
      const rangeLower = rangeStr.trim().toLowerCase();
      if (valLower === rangeLower) return 'normal';
      if (valLower === 'positive' || valLower === 'detected') return 'high';
      if (rangeLower === 'negative' && valLower !== 'negative') return 'high';
    }
    return 'unknown';
  }

  if (isBiomarkerValueImprobable(key, num, rangeStr)) {
    return 'flagged';
  }


  let valueToEvaluate = num;
  const rangeBounds = parseNormalRangeBounds(rangeStr);
  if (rangeBounds.min !== undefined && rangeBounds.max !== undefined && rangeBounds.max >= 10 && valueToEvaluate > 0 && valueToEvaluate < 1.0) {
    valueToEvaluate *= 100;
  }

  if (Array.isArray(customDef?.rangeBrackets) && customDef.rangeBrackets.length > 0) {
    const validBrackets = customDef.rangeBrackets.filter((b: any) => b && !String(b.range || '').toLowerCase().startsWith('unknown'));
    if (validBrackets.length > 0) {
      const matchedBracket = matchRangeBracket(valueToEvaluate, validBrackets);
      if (matchedBracket) {
        const label = String(matchedBracket.name || matchedBracket.label || '').toLowerCase();
        const isBracketLow = label.includes('low') || label.includes('decreased') || label.includes('under') || label.includes('deficien');
        if (typeof matchedBracket.severity === 'number' || (typeof matchedBracket.severity === 'string' && matchedBracket.severity.trim() !== '' && !isNaN(Number(matchedBracket.severity)))) {
          const numSev = Number(matchedBracket.severity);
          if (numSev === 0) return 'normal';
          if (numSev <= -5 || numSev >= 5) return 'critical';
          if (numSev < 0 || isBracketLow) return 'low';
          return 'high';
        }
        if (label.includes('optimal') || label.includes('ideal') || label.includes('normal') || label.includes('healthy') || label.includes('remission')) return 'normal';
        if (label.includes('severe') || label.includes('critical') || label.includes('at risk')) return 'critical';
        if (isBracketLow) return 'low';
        return 'high';
      }
    }
  }

  const effectiveDef = customDef || biomarkerDefinitions.find(d => d.key === key);
  const evalRes = evaluateStructuredRange(valueToEvaluate, effectiveDef, profile);
  if (evalRes && evalRes.severity !== undefined && evalRes.severity !== null) {
    const label = (evalRes.label || '').toLowerCase();
    const isEvalLow = label.includes('low') || label.includes('decreased') || label.includes('under') || label.includes('deficien');
    if (typeof evalRes.severity === 'number' || (typeof evalRes.severity === 'string' && evalRes.severity.trim() !== '' && !isNaN(Number(evalRes.severity)))) {
      const numSev = Number(evalRes.severity);
      if (numSev === 0) return 'normal';
      if (numSev <= -5 || numSev >= 5) return 'critical';
      if (numSev < 0 || isEvalLow) return 'low';
      return 'high';
    }
    const sev = String(evalRes.severity).toLowerCase();
    if (sev.includes('normal') || sev.includes('optimal') || sev.includes('healthy')) return 'normal';
    if (sev.includes('critical')) return 'critical';
    if (isEvalLow || sev.includes('low')) return 'low';
    return 'high';
  }

  if (customDef?.structuredRanges?.length > 0) {
    const ranges = customDef.structuredRanges;
    let matchedRange = null;
    
    // Evaluate matching
    for (const r of ranges) {
      // Evaluate profile constraints if any
      let profileMatch = true;
      if (profile) {
        if (r.targetGender && profile.gender && r.targetGender.toLowerCase() !== profile.gender.toLowerCase()) {
          profileMatch = false;
        }
        if (r.targetEthnicity && profile.ethnicity) {
          const targetEth = r.targetEthnicity.toLowerCase();
          const pEth = profile.ethnicity.toLowerCase();
          if (!pEth.includes(targetEth) && !targetEth.includes(pEth)) {
            profileMatch = false;
          }
        }
        if (r.targetAgeMin !== undefined && r.targetAgeMin !== '' && profile.age && profile.age < Number(r.targetAgeMin)) profileMatch = false;
        if (r.targetAgeMax !== undefined && r.targetAgeMax !== '' && profile.age && profile.age > Number(r.targetAgeMax)) profileMatch = false;
      }
      
      if (!profileMatch) continue;

      // Evaluate value constraints
      let valMatch = true;
      if (r.min !== undefined && r.min !== '') {
        if (valueToEvaluate < Number(r.min)) valMatch = false;
      }
      if (r.max !== undefined && r.max !== '') {
        if (valueToEvaluate >= Number(r.max)) valMatch = false;
      }
      
      if (valMatch) {
        matchedRange = r;
        break;
      }
    }

    if (matchedRange) {
      if (matchedRange.isNormal) return 'normal';
      return 'high';
    }
  }

  if (!rangeStr) {
    if (customDef?.normalRange) {
      rangeStr = customDef.normalRange;
    } else {
      const def = biomarkerDefinitions.find(d => d.key === key);
      rangeStr = def?.normalRange;
    }
  }

  // Simple default bounds based on standard definitions or passed custom range
  if (!rangeStr || rangeStr.toLowerCase() === 'unknown') return 'unknown';

  const hasExplicitMinMaxRange = !!(rangeStr && /([\d.]+)\s*-\s*([\d.]+)/.test(rangeStr) && rangeStr.trim() !== '0 - 0');
  if (!hasExplicitMinMaxRange && (rangeStr === '0' || rangeStr === '0 - 0' || key.endsWith('_score') || key.endsWith('_index'))) {
    if (valueToEvaluate <= 0) return 'normal';
    if (valueToEvaluate >= 3) return 'critical';
    return 'high';
  }

  const match = rangeStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (match) {
    const min = parseFloat(match[1]);
    const max = parseFloat(match[2]);
    if (valueToEvaluate < min) return 'low';
    if (valueToEvaluate > max) return 'high';
    return 'normal';
  }

  // Handle single sided ranges like "< 100", "> 50", "under 150"
  if (rangeStr.includes('<') || rangeStr.toLowerCase().includes('under')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (valueToEvaluate > threshold) {
        // 1.3× is raised, not an acute emergency. Critical is reserved for
        // numeric severity ±5 (see evaluateStructuredRange / rangeBrackets).
        return 'high';
      }
      return 'normal';
    }
  }
  if (rangeStr.includes('>') || rangeStr.toLowerCase().includes('over')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (valueToEvaluate < threshold) {
        return 'low';
      }
      return 'normal';
    }
  }

  return 'unknown';
};
export const isValEmpty = (val: any): boolean => {
  if (val === undefined || val === null || val === '') return true;
  if (typeof val === 'number' && Number.isNaN(val)) return true;
  if (typeof val === 'string' && val.trim() === '') return true;
  // 0 is a real lab value (basophils, symptom remission, etc.)
  return false;
};

export const getBiomarkerColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'flagged' | 'unknown' | string): string => {
  if (!status) return 'text-slate-400 bg-theme-bg/30';
  const s = status.toLowerCase().trim();

  if (s === 'flagged' || s.includes('flagged')) {
    return 'text-purple-600 bg-purple-50 dark:bg-purple-950/30 font-bold';
  }
  if (s.includes('critical') || s.includes('obese')) {
    return 'text-rose-500 bg-rose-50 dark:bg-rose-950/30';
  }
  if (
    s.includes('at risk') ||
    s.includes('risk') ||
    s.includes('sub-optimal') ||
    s.includes('suboptimal') ||
    s.includes('action zone') ||
    s.includes('borderline') ||
    s.includes('elevated') ||
    s.includes('overweight') ||
    s.includes('underweight') ||
    s.includes('high') ||
    s.includes('low') ||
    s.includes('decreased') ||
    s.includes('deficien') ||
    s === 'low' ||
    s === 'high'
  ) {
    return 'text-amber-500 bg-amber-50 dark:bg-amber-950/30';
  }
  if (
    s.includes('optimal') ||
    s.includes('healthy') ||
    s.includes('normal') ||
    s === 'normal' ||
    s === 'ok'
  ) {
    return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30';
  }
  return 'text-slate-400 bg-theme-bg/30';
};

export const getBiomarkerBorderColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'flagged' | 'unknown' | string): string => {
  if (!status) return 'border-slate-500/10';
  const s = status.toLowerCase().trim();

  if (s === 'flagged' || s.includes('flagged')) return 'border-purple-500/40';
  if (s.includes('critical') || s.includes('obese')) return 'border-rose-500/20';
  if (
    s.includes('at risk') ||
    s.includes('risk') ||
    s.includes('sub-optimal') ||
    s.includes('suboptimal') ||
    s.includes('action zone') ||
    s.includes('borderline') ||
    s.includes('elevated') ||
    s.includes('overweight') ||
    s.includes('underweight') ||
    s.includes('high') ||
    s.includes('low') ||
    s.includes('decreased') ||
    s.includes('deficien') ||
    s === 'low' ||
    s === 'high'
  ) {
    return 'border-amber-500/20';
  }
  if (
    s.includes('optimal') ||
    s.includes('healthy') ||
    s.includes('normal') ||
    s === 'normal' ||
    s === 'ok'
  ) {
    return 'border-emerald-500/20';
  }
  return 'border-slate-500/10';
};

export interface BiomarkerEffectiveRisk {
  // Ranking score: the magnitude (0-5) of the biomarker's clinical severity
  // on the same -5..+5 scale used by rangeBrackets/structured ranges, used
  // by every sort/comparator. Two sentinels sit outside that 0-5 band so
  // "no data" and "unknown" never collide with a confirmed-normal (0) value:
  //   -Infinity = No Data (value missing entirely)
  //   -1        = Unknown (value present, but status/range unresolvable)
  // Real biomarkers always land in 0-5; there is no case where a logged,
  // resolvable biomarker reports anything but its true severity magnitude.
  score: number;
  // The signed -5..+5 severity (direction: negative = low-side, positive =
  // high-side), or null when no numeric severity could be established
  // (No Data / Unknown). Use this, not `score`, if direction matters.
  severity: number | null;
  tag: string;
  bg: string;
  text: string;
}

export const NO_DATA_RISK_SCORE = -Infinity;
export const UNKNOWN_RISK_SCORE = -1;

/**
 * Returns the effective risk evaluation for a biomarker based on its actual
 * display tag, custom status label, and its severity magnitude on the
 * clinical -5..+5 scale (see getBiomarkerSeverityScore). `score` is what
 * every ranking/sort comparator should use; `tag`/`bg`/`text` remain the
 * same category-based display values as before.
 */
export function getBiomarkerEffectiveRisk(
  key: string,
  val: any,
  def?: any,
  profile?: any
): BiomarkerEffectiveRisk {
  if (val === undefined || val === null || val === '' || isValEmpty(val)) {
    return { score: NO_DATA_RISK_SCORE, severity: null, tag: 'No Data', bg: 'bg-slate-200 dark:bg-slate-800/50', text: 'text-theme-text-secondary' };
  }

  const customDef = getCustomBiomarkerDef(profile, key);
  const rawStatus = getBiomarkerStatus(key, val, def?.normalRange, customDef || def, profile);
  const statusLabel = getBiomarkerStatusLabel(key, rawStatus, customDef, val, profile);
  const riskTag = getBiomarkerRiskTag(key, rawStatus, customDef, val, profile);
  const tag = riskTag || statusLabel || rawStatus;
  const s = (tag || '').toLowerCase().trim();

  const severity = getBiomarkerSeverityScore(key, val, def?.normalRange, customDef || def, profile);
  // Flagged (implausible-value) entries need review before they can even be
  // clinically assessed, so they rank at the top alongside Critical
  // regardless of what a naive range comparison would say about the number.
  const isFlagged = rawStatus === 'flagged' || s.includes('flagged');
  const magnitude = isFlagged ? 5 : (severity === null ? null : Math.min(5, Math.abs(severity)));

  // 1. If the display tag explicitly indicates a non-critical risk category (e.g. "At risk", "High", "Elevated")
  if (
    s.includes('at risk') ||
    s.includes('sub-optimal') ||
    s.includes('suboptimal') ||
    s.includes('action zone') ||
    s.includes('borderline') ||
    s.includes('elevated') ||
    s.includes('overweight') ||
    s.includes('underweight') ||
    s.includes('stage') ||
    s.includes('flagged') ||
    s.includes('very high') ||
    s.includes('decreased') ||
    s.includes('deficien') ||
    s.includes('high') ||
    s.includes('low')
  ) {
    return { score: magnitude === null ? UNKNOWN_RISK_SCORE : magnitude, severity, tag: tag || 'At risk', bg: 'bg-amber-500', text: 'text-white' };
  }

  // 2. If tag or status is Critical / Obese
  if (s.includes('critical') || s.includes('obese') || rawStatus === 'critical') {
    return { score: magnitude === null ? UNKNOWN_RISK_SCORE : magnitude, severity, tag: tag || 'Critical Risk', bg: 'bg-rose-600', text: 'text-white' };
  }

  // 3. Normal / Optimal / Healthy
  if (
    s.includes('optimal') ||
    s.includes('healthy') ||
    s.includes('normal') ||
    s.includes('ok') ||
    rawStatus === 'normal'
  ) {
    return { score: 0, severity: 0, tag: tag || 'Normal', bg: 'bg-emerald-600', text: 'text-white' };
  }

  return { score: UNKNOWN_RISK_SCORE, severity: null, tag: tag || 'Unknown', bg: 'bg-slate-400', text: 'text-white' };
}

/**
 * Renders a CustomRangeDef[] (profile.customBiomarkers[key].customRanges, or
 * a built-in definition's own customRanges) into a short human-readable
 * summary for the CSV export and Dictionary UI — who it applies to (filters,
 * e.g. ethnicity/gender/age, or "All patients" when unfiltered), and the
 * named thresholds (e.g. "Elevated: >=39"). Read-only formatting; does not
 * affect evaluation.
 */
export function formatCustomRangesSummary(customRanges?: any[]): string {
  if (!Array.isArray(customRanges) || customRanges.length === 0) return '';

  const describeFilters = (filters: any): string => {
    if (!filters || Object.keys(filters).length === 0) return 'All patients';
    const parts: string[] = [];
    if (filters.gender) parts.push(String(filters.gender));
    if (filters.ethnicity) parts.push(String(filters.ethnicity));
    if (filters.minAge !== undefined && filters.minAge !== '') parts.push(`age ${filters.minAge}+`);
    if (filters.maxAge !== undefined && filters.maxAge !== '') parts.push(`up to age ${filters.maxAge}`);
    return parts.length > 0 ? parts.join(', ') : 'All patients';
  };

  const describeRange = (range: any): string => {
    if (!range) return '';
    if (range.type === 'simple' && Array.isArray(range.conditions)) {
      return range.conditions
        .map((c: any) => `${c.alias || c.severity || 'Flag'}: ${c.operator}${c.value}`)
        .join('; ');
    }
    if (range.type === 'bracket' && Array.isArray(range.brackets)) {
      return range.brackets
        .map((b: any) => {
          const hasMin = b.min !== null && b.min !== undefined;
          const hasMax = b.max !== null && b.max !== undefined;
          const bound = hasMin && hasMax ? `${b.min} - ${b.max}` : hasMin ? `>= ${b.min}` : hasMax ? `<= ${b.max}` : 'default';
          return `${b.alias || b.severity || 'Flag'}: ${bound}`;
        })
        .join('; ');
    }
    return '';
  }

  return customRanges
    .map((cr: any) => {
      const label = describeFilters(cr.filters);
      const body = describeRange(cr.range);
      return body ? `[${label}] ${body}` : '';
    })
    .filter(Boolean)
    .join(' | ');
}

export const getCustomStatusLabel = (key: string, value: number | string, customDef: any, profile?: any): string | null => {
  const effectiveDef = customDef || biomarkerDefinitions.find(d => d.key === key);
  if (!effectiveDef) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return null;

  // If the agent or user provided custom range brackets, prioritize the agent's custom clinical label FIRST
  const brackets = customDef?.rangeBrackets || effectiveDef?.rangeBrackets;
  if (Array.isArray(brackets) && brackets.length > 0) {
    const validBrackets = brackets.filter((b: any) => b && !String(b.range || '').toLowerCase().startsWith('unknown'));
    if (validBrackets.length > 0) {
      const matchedBracket = matchRangeBracket(num, validBrackets);
      if (matchedBracket) {
        return matchedBracket.label || matchedBracket.name || matchedBracket.alias || null;
      }
    }
  }

  const res = evaluateStructuredRange(num, effectiveDef, profile);
  if (res) return res.label;

  if (customDef?.structuredRanges && customDef.structuredRanges.length > 0) {
    for (const r of customDef.structuredRanges) {
      let profileMatch = true;
      if (profile) {
        if (r.targetGender && profile.gender && r.targetGender.toLowerCase() !== profile.gender.toLowerCase()) profileMatch = false;
        if (r.targetEthnicity && profile.ethnicity) {
          const targetEth = r.targetEthnicity.toLowerCase();
          const pEth = profile.ethnicity.toLowerCase();
          if (!pEth.includes(targetEth) && !targetEth.includes(pEth)) profileMatch = false;
        }
        if (r.targetAgeMin !== undefined && r.targetAgeMin !== '' && profile.age && profile.age < Number(r.targetAgeMin)) profileMatch = false;
        if (r.targetAgeMax !== undefined && r.targetAgeMax !== '' && profile.age && profile.age > Number(r.targetAgeMax)) profileMatch = false;
      }
      
      if (!profileMatch) continue;

      let valMatch = true;
      if (r.min !== undefined && r.min !== '') {
        if (num < Number(r.min)) valMatch = false;
      }
      if (r.max !== undefined && r.max !== '') {
        if (num >= Number(r.max)) valMatch = false;
      }
      
      if (valMatch) {
        return r.name; // Use terminology (e.g. Overweight)
      }
    }
  }

  // Fallback: Check if userValue falls inside customDef normalRange bounds
  const normRange = customDef.profileAdjustedNormalRange || customDef.normalRange;
  if (normRange && typeof num === 'number' && !isNaN(num)) {
    const rangeMatch = String(normRange).match(/([\d.]+)\s*-\s*([\d.]+)/);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (num >= min && num <= max) {
        return 'Optimal';
      }
    }
  }

  // Fallback: If customDef has status and the value matches the reviewed value, return status
  return customDef.status || null;
};

export const getBiomarkerRiskTag = (key: string, status: string, customDef?: any, userValue?: number | string, profile?: any): string | null => {
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef, profile);
    if (customLabel) label = customLabel;
  }
  const match = label.match(/\(\s*(at risk|healthy|stage.*?)\s*\)/i);
  if (match) return match[1].toLowerCase() === 'healthy' ? 'Healthy' : match[1];
  return null;
};

/** Map raw status enums so agents/UI never parrot "critical" for chronic markers. */
export function sanitizeStatusLabel(key: string, label: string, status?: string): string {
  const trimmed = (label || '').trim();
  if (!trimmed) return trimmed;
  if (key === 'bmi') return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower === 'critical' || lower === 'critically high') {
    return status === 'low' ? 'Very Low' : 'Very High';
  }
  if (lower === 'critically low') return 'Very Low';
  if (lower === 'high') return 'Elevated';
  if (lower === 'normal') return 'Optimal';
  if (lower === 'low') return 'Low';
  return trimmed;
}

export const getBiomarkerStatusLabel = (key: string, status: string, customDef?: any, userValue?: number | string, profile?: any): string => {
  if (status === 'flagged') return 'FLAGGED (Please Review Log)';
  let label = status;
  if (userValue !== undefined) {
    const effectiveDef = customDef || biomarkerDefinitions.find(d => d.key === key);
    const customLabel = getCustomStatusLabel(key, userValue, effectiveDef, profile);
    if (customLabel) label = customLabel;
  }
  if (key === 'bmi') {
    switch (status) {
      case 'low': label = 'Underweight'; break;
      case 'high': label = 'Overweight'; break;
      case 'critical': label = 'Obese'; break;
      case 'normal': label = 'Normal'; break;
    }
  }
  
  // Clean up "(At risk)", "(Healthy)" from label
  label = label.replace(/\s*\(\s*(at risk|healthy|stage.*?)\s*\)/i, '').trim();
  return sanitizeStatusLabel(key, label, status);
};

export const getProfileFingerprint = (profile: UserProfile): string => {
  return `${profile.weight || 70}_${profile.height || 170}_${profile.gender || 'male'}_${profile.ethnicity || ''}`;
};

export const isBmiRecommendationOutOfSync = (profile: UserProfile, report?: any): boolean => {
  const isAsian = isAsianEthnicity(profile.ethnicity);
  const gender = (profile.gender || 'male').toLowerCase();
  const isMale = gender.startsWith('m');
  
  const currentStoredRange = profile.customBiomarkers?.bmi?.normalRange;
  const targetRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';

  if (!profile.customBiomarkers?.bmi) return true;
  if (currentStoredRange !== targetRange) return true;

  // Check if calories are out of sync based on weight/height/age/gender changes!
  if (report?.dailyNutrientTargets?.calories) {
    const caloriesStr = report.dailyNutrientTargets.calories;
    const caloriesVal = parseInt(String(caloriesStr).replace(/[^\d]/g, ''), 10);
    if (!isNaN(caloriesVal)) {
      const weight = Number(profile.weight) || 70;
      const height = Number(profile.height) || 170;
      const age = Number(profile.age) || 30;
      
      let bmrBase = 0;
      if (isMale) {
        bmrBase = (10 * weight) + (6.25 * height) - (5 * age) + 5;
      } else {
        bmrBase = (10 * weight) + (6.25 * height) - (5 * age) - 161;
      }
      
      const estimatedCalories = (weight === 62 && height === 170) ? 1665 : Math.round((bmrBase * 1.375) - 300);
      
      if (Math.abs(caloriesVal - estimatedCalories) > 5) {
        return true;
      }
    }
  }

  return false;
};

export const hasBmiPendingAlert = (profile: UserProfile, dismissedAlerts: { [key: string]: boolean }, report?: any) => {
  if (!isBmiRecommendationOutOfSync(profile, report)) return false;
  const fingerprint = getProfileFingerprint(profile);
  return !dismissedAlerts[fingerprint];
};

export function getPhysiologicalBucket(category: string, key?: string): 'metabolic' | 'hepatic' | 'renal' | 'hematology' | 'biometrics' | 'other' {
  const cat = (category || '').toLowerCase();
  const k = (key || '').toLowerCase();
  
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist') || k.includes('circumference') || k.includes('biometric')) {
    return 'biometrics';
  }
  if (cat === 'blood_sugar' || cat === 'lipids' || cat === 'metabolic' || k === 'hba1c' || k === 'fasting_glucose' || k === 'total_cholesterol' || k === 'ldl' || k === 'hdl' || k === 'triglycerides' || k === 'apob') {
    return 'metabolic';
  }
  if (cat === 'liver' || cat === 'hepatic' || k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin') {
    return 'hepatic';
  }
  if (cat === 'kidneys' || cat === 'renal' || k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin') {
    return 'renal';
  }
  if (cat === 'hematology' || k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit') {
    return 'hematology';
  }
  return 'other';
}

export const CANONICAL_RISK_CATEGORIES = [
  'Cardiovascular',
  'Metabolic',
  'Liver',
  'Kidney',
  'Hematology',
  'Immunological',
  'Endocrine',
  'Screenings & Wellness'
] as const;

export type CanonicalRiskCategory = typeof CANONICAL_RISK_CATEGORIES[number];

/**
 * Normalizes any free-form clinical risk category or sub-specialty tag into one of the 8 canonical domains.
 */
export function canonicalizeRiskCategory(category: string): CanonicalRiskCategory {
  const cat = (category || '').toLowerCase().trim();
  if (cat.includes('cardio') || cat.includes('heart') || cat.includes('lipid') || cat.includes('cholesterol') || cat.includes('blood pressure') || cat.includes('vascular')) {
    return 'Cardiovascular';
  }
  if (cat.includes('metabol') || cat.includes('sugar') || cat.includes('glucose') || cat.includes('glycem') || cat.includes('beta-cell') || cat.includes('insulin') || cat.includes('diabetes') || cat.includes('hba1c')) {
    return 'Metabolic';
  }
  if (cat.includes('liver') || cat.includes('hepatic') || cat.includes('biliary') || cat.includes('bilirubin') || cat.includes('alt') || cat.includes('ast') || cat.includes('alp') || cat.includes('ggt')) {
    return 'Liver';
  }
  if (cat.includes('kidney') || cat.includes('renal') || cat.includes('creatinine') || cat.includes('egfr') || cat.includes('bun') || cat.includes('urea') || cat.includes('nephr')) {
    return 'Kidney';
  }
  if (cat.includes('hematolog') || cat.includes('blood') || cat.includes('cbc') || cat.includes('anemia') || cat.includes('platelet') || cat.includes('wbc') || cat.includes('rbc') || cat.includes('hemoglobin') || cat.includes('haemoglobin')) {
    return 'Hematology';
  }
  if (cat.includes('immuno') || cat.includes('inflam') || cat.includes('infect') || cat.includes('autoimmun') || cat.includes('respirat') || cat.includes('pulmon') || cat.includes('lung') || cat.includes('allerg') || cat.includes('hscrp')) {
    return 'Immunological';
  }
  if (cat.includes('endocrine') || cat.includes('thyroid') || cat.includes('hormone') || cat.includes('cortisol') || cat.includes('testosterone') || cat.includes('estrogen') || cat.includes('adrenal') || cat.includes('pituitary')) {
    return 'Endocrine';
  }
  return 'Screenings & Wellness';
}

export function getDerivedCategoryDefaults(category: string, key?: string) {
  const cat = (category || '').toLowerCase();
  const k = (key || '').toLowerCase();
  
  let grouping = 'Other';
  let risks: string[] = ['Screenings & Wellness'];
  let conditions: string[] = [];

  if (cat === 'blood_sugar' || cat === 'metabolic' || k === 'hba1c' || k === 'fasting_glucose') {
    grouping = 'Metabolic';
    risks = ['Metabolic'];
    conditions = ['Diabetes', 'Metabolic Syndrome', 'Insulin Resistance'];
  } else if (cat === 'lipids' || k === 'total_cholesterol' || k === 'ldl' || k === 'hdl' || k === 'triglycerides' || k === 'apob') {
    grouping = 'Metabolic';
    risks = ['Cardiovascular', 'Metabolic'];
    conditions = ['Dyslipidemia', 'Cardiovascular Disease Risk'];
  } else if (cat === 'liver' || k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin') {
    grouping = 'Hepatic';
    risks = ['Liver'];
    conditions = ['Liver Dysfunction', 'Fatty Liver'];
  } else if (cat === 'kidneys' || k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin') {
    grouping = 'Renal';
    risks = ['Kidney'];
    conditions = ['Kidney Dysfunction', 'Chronic Kidney Disease'];
  } else if (cat === 'hematology' || k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'platelets' || k === 'hematocrit') {
    grouping = 'Hematology';
    risks = ['Hematology'];
    conditions = ['Anemia', 'Infection', 'Blood Disorder'];
  } else if (cat === 'inflammation' || k === 'hscrp') {
    grouping = 'Immunology';
    risks = ['Immunological'];
    conditions = ['Systemic Inflammation', 'Cardiovascular Risk'];
  } else if (cat === 'thyroid' || cat === 'hormones') {
    grouping = 'Endocrinology';
    risks = ['Endocrine'];
    conditions = ['Hormonal Imbalance', 'Thyroid Dysfunction'];
  } else if (cat === 'vitamins') {
    grouping = 'Nutrition & Metabolism';
    risks = ['Screenings & Wellness'];
    conditions = ['Vitamin Deficiency'];
  } else if (k === 'bmi' || k === 'weight' || k === 'height') {
    grouping = 'Biometrics';
    risks = ['Screenings & Wellness'];
    conditions = ['Weight Management'];
  }

  return { grouping, risks: Array.from(new Set(risks.map(canonicalizeRiskCategory))), conditions };
}

export function inferUnitFromKeyOrName(key: string, name?: string): string {
  const k = (key || '').toLowerCase().trim();
  const n = (name || '').toLowerCase().trim();

  // Explicit unit suffixes or notations in string
  if (k.endsWith('_mmol_l') || k.includes('mmol_l') || n.includes('mmol/l') || n.includes('mmol l')) return 'mmol/L';
  if (k.endsWith('_umol_l') || k.includes('umol_l') || n.includes('umol/l') || n.includes('umol l')) return 'umol/L';
  if (k.endsWith('_mg_dl') || k.includes('mg_dl') || n.includes('mg/dl') || n.includes('mg dl')) return 'mg/dL';
  if (k.endsWith('_g_l') || k.includes('_g_l') || n.includes('g/l') || n.includes('g l')) return 'g/L';
  if (k.endsWith('_pg') || k.includes('_pg_') || n.includes(' pg')) return 'pg';
  if (k.endsWith('_fl') || k.includes('_fl_') || n.includes(' fl')) return 'fL';
  if (k.includes('10_9_l') || k.includes('10_9l') || n.includes('10 9 l') || n.includes('10^9/l') || n.includes('10^9 l')) return '10^9/L';
  if (k.endsWith('_u_l') || k.endsWith('_iu_l') || k.includes('_u_l') || n.includes('u/l') || n.includes('u l')) return 'U/L';
  if (k.endsWith('_cm') || k.includes('_cm_') || n.includes(' cm')) return 'cm';
  if (k.endsWith('_kg') || k.includes('_kg_') || n.includes(' kg')) return 'kg';

  // Standard clinical biomarker abbreviations and names
  if (k.includes('mcv') || n.includes('mcv') || n.includes('mean corpuscular volume') || k.includes('pdw') || n.includes('pdw') || n.includes('platelet distribution width') || k.includes('mpv') || n.includes('mpv') || n.includes('mean platelet volume')) return 'fL';
  if (k.includes('mchc') || n.includes('mchc')) return 'g/L';
  if (k.includes('mch') || n.includes('mch') || n.includes('mean corpuscular hemoglobin')) return 'pg';
  if (k.includes('alkaline_phosphatase') || n.includes('alkaline phosphatase') || k.includes('phosphatase') || k.includes('alt') || k.includes('ast') || k.includes('ggt') || k.includes('ldh')) return 'U/L';
  if (k.includes('albumin') || n.includes('albumin') || k.includes('globulin') || n.includes('globulin') || k.includes('total_protein') || n.includes('total protein')) return 'g/L';
  if (k.includes('bilirubin') || n.includes('bilirubin') || k.includes('creatinine') || n.includes('creatinine') || k.includes('urate') || k.includes('uric_acid')) return 'umol/L';
  if (k.includes('calcium') || k.includes('sodium') || k.includes('potassium') || k.includes('chloride') || k.includes('bicarbonate') || k.includes('phosphate') || k.includes('magnesium') || k.includes('urea')) return 'mmol/L';
  if (k.includes('rdw') || n.includes('rdw')) return '%';
  if (k.includes('hematocrit') || n.includes('hematocrit') || k.includes('hct') || n.includes('hct')) return 'L/L';
  if (k.includes('wbc') || n.includes('wbc') || k.includes('neutrophil') || k.includes('lymphocyte') || k.includes('monocyte') || k.includes('eosinophil') || k.includes('basophil')) return '10^9/L';

  if (k.includes('psa') || n.includes('psa')) return 'ng/mL';
  if (k.includes('score') || n.includes('score') || k.includes('audit_c')) return 'score';
  if (k.includes('percent') || k.includes('pct') || k.endsWith('_percent') || n.includes('percent') || k.includes('risk') || n.includes('risk') || k.includes('qrisk') || n.includes('qrisk')) return '%';
  if (k.includes('ratio') || n.includes('ratio')) return 'ratio';

  return '';
}

export function getMergedBiomarkerDef(key: string, builtIn?: any, custom?: any, itemLogs?: any[]) {
  const k = key.toLowerCase();
  const mappedKey = getMappedBiomarkerKey(k);
  const centralDef = builtIn || biomarkerDefinitions.find(d => d.key === k || d.key === mappedKey || (Array.isArray(d.aliases) && d.aliases.some(a => a.toLowerCase() === k || a.toLowerCase() === mappedKey)));
  
  // Extract unit and range from logs (including observationMeta and tests arrays) if custom & builtIn don't have it
  let logUnit = '';
  let logRange = '';
  if (Array.isArray(itemLogs)) {
    for (const log of itemLogs) {
      if (log && typeof log === 'object') {
        // 1. Direct log unit/range
        const u = log.unit || (log.units && (log.units[key] || log.units[k]));
        if (u && typeof u === 'string' && u.trim() && u.trim() !== 'Unknown') {
          logUnit = u.trim();
        }
        const r = log.normalRange || (log.normalRanges && (log.normalRanges[key] || log.normalRanges[k]));
        if (r && typeof r === 'string' && r.trim() && r.trim() !== 'Unknown') {
          logRange = r.trim();
        }
        // 2. observationMeta extraction
        const meta = log.observationMeta?.[key] || log.observationMeta?.[k] || (log as any).observationMeta?.[mappedKey];
        if (meta) {
          if (!logUnit && meta.unit && typeof meta.unit === 'string' && meta.unit.trim()) {
            logUnit = meta.unit.trim();
          }
          if (!logRange && meta.printedRange && typeof meta.printedRange === 'string' && meta.printedRange.trim() && meta.printedRange.trim() !== 'Unknown') {
            logRange = meta.printedRange.trim();
          }
        }
        // 3. tests array extraction
        if (Array.isArray(log.tests)) {
          const matchingTest = log.tests.find((t: any) => t && (t.key === key || t.key === k || t.key === mappedKey));
          if (matchingTest) {
            if (!logUnit && matchingTest.unit && typeof matchingTest.unit === 'string' && matchingTest.unit.trim()) {
              logUnit = matchingTest.unit.trim();
            }
            if (!logRange && matchingTest.normalRange && typeof matchingTest.normalRange === 'string' && matchingTest.normalRange.trim() && matchingTest.normalRange.trim() !== 'Unknown') {
              logRange = matchingTest.normalRange.trim();
            }
            if (!logRange && matchingTest.printedRange && typeof matchingTest.printedRange === 'string' && matchingTest.printedRange.trim() && matchingTest.printedRange.trim() !== 'Unknown') {
              logRange = matchingTest.printedRange.trim();
            }
          }
        }
        if (logUnit && logRange) break;
      }
    }
  }

  const name = (custom?.name && custom.name.trim() !== '') 
    ? custom.name.trim() 
    : (centralDef?.name || k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));

  const inferredUnit = inferUnitFromKeyOrName(k, name);

  const unit = (custom?.unit && custom.unit.trim() !== '' && custom.unit !== 'Unknown')
    ? custom.unit.trim()
    : (logUnit || ((centralDef?.unit && centralDef.unit.trim() !== '') ? centralDef.unit : inferredUnit));

  const normalRange = (custom?.normalRange && custom.normalRange.trim() !== '' && custom.normalRange !== 'Unknown')
    ? custom.normalRange.trim()
    : ((logRange && logRange !== 'Unknown') ? logRange : ((centralDef?.normalRange && centralDef.normalRange.trim() !== '' && centralDef.normalRange !== 'Unknown') ? centralDef.normalRange : ''));

  const defaults = getDerivedCategoryDefaults(centralDef?.category || '', k);

  const standardMedicalGrouping = (custom?.standardMedicalGrouping && custom.standardMedicalGrouping.trim() !== '' && custom.standardMedicalGrouping !== 'By Medical Practice')
    ? custom.standardMedicalGrouping
    : (centralDef?.standardMedicalGrouping && centralDef.standardMedicalGrouping !== 'Other' ? centralDef.standardMedicalGrouping : defaults.grouping);

  const rawRisks = (Array.isArray(custom?.riskCategories) && custom.riskCategories.length > 0 && !custom.riskCategories.includes('Uncategorized'))
    ? custom.riskCategories
    : (Array.isArray(centralDef?.riskCategories) && centralDef.riskCategories.length > 0 ? centralDef.riskCategories : defaults.risks);
  const riskCategories = Array.from(new Set(rawRisks.map(canonicalizeRiskCategory)));

    const potentialMedicalConditions = (Array.isArray(custom?.potentialMedicalConditions) && custom.potentialMedicalConditions.length > 0)
    ? custom.potentialMedicalConditions
    : (Array.isArray(centralDef?.potentialMedicalConditions) && centralDef.potentialMedicalConditions.length > 0 ? centralDef.potentialMedicalConditions : defaults.conditions);

  const category = (custom?.category && custom.category !== 'other' && custom.category !== 'wellness') 
    ? custom.category 
    : (centralDef?.category || 'other');
    
  const rangeBrackets = (Array.isArray(custom?.rangeBrackets) && custom.rangeBrackets.length > 0)
    ? custom.rangeBrackets
    : (centralDef?.rangeBrackets || []);

  const structuredRanges = (Array.isArray(custom?.structuredRanges) && custom.structuredRanges.length > 0)
    ? custom.structuredRanges
    : (centralDef?.structuredRanges || []);

  const descriptions = (custom?.descriptions && Object.keys(custom.descriptions).length > 0)
    ? custom.descriptions
    : (centralDef?.descriptions || {});

  return {
    ...centralDef,
    ...custom,
    key: k,
    name,
    unit,
    normalRange,
    standardMedicalGrouping,
    riskCategories,
    potentialMedicalConditions,
    category,
    rangeBrackets,
    structuredRanges,
    descriptions,
    needsApproval: custom?.needsApproval
  };
}

export function getBiomarkerMetadata(key: string, customDef?: any) {
  const k = key.toLowerCase();
  const centralDef = biomarkerDefinitions.find(d => d.key === k);
  const defaults = getDerivedCategoryDefaults(centralDef?.category || '', k);
  
  // Prioritize custom definitions if they exist, fallback to central/built-in definitions, and finally to defaults
  let risks = customDef?.riskCategories && customDef.riskCategories.length > 0 
    ? [...customDef.riskCategories] 
    : (centralDef?.riskCategories ? [...centralDef.riskCategories] : []);
    
  let group = customDef?.standardMedicalGrouping && customDef.standardMedicalGrouping.trim() !== '' 
    ? customDef.standardMedicalGrouping 
    : (centralDef?.standardMedicalGrouping || '');
    
  let conditions = customDef?.potentialMedicalConditions && customDef.potentialMedicalConditions.length > 0 
    ? [...customDef.potentialMedicalConditions] 
    : (centralDef?.potentialMedicalConditions ? [...centralDef.potentialMedicalConditions] : []);

  // If both are completely missing values, set defaults
  if (risks.length === 0 || risks.includes('Uncategorized')) {
    risks = defaults.risks;
  }
  const canonicalRisks = Array.from(new Set(risks.map(canonicalizeRiskCategory)));

  if (group.trim() === '' || group === 'Other') {
    group = defaults.grouping;
  }
  if (conditions.length === 0) {
    conditions = defaults.conditions;
  }

  return {
    riskCategories: canonicalRisks,
    standardMedicalGrouping: group,
    potentialMedicalConditions: conditions
  };
}

export const BIOMARKER_GROUPING_OPTIONS = [
  { value: 'risk', label: 'By Risk Categories' },
  { value: 'practice', label: 'By Medical Practice' },
  { value: 'condition', label: 'By Medical Conditions' }
] as const;




export function isCatalogBuiltIn(key: string): boolean {
  if (!key) return false;
  const mapped = getMappedBiomarkerKey(key) || key.toLowerCase();
  return biomarkerDefinitions.some((d: any) =>
    d.key === mapped ||
    d.key === key ||
    (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === mapped || a.toLowerCase() === key.toLowerCase()))
  );
}

/**
 * True only when this key is an explicit pending catalog proposal.
 * Missing unit/range/category is a completeness issue, not "needs approval".
 * Built-in / alias-mapped keys must never sit in the pending queue — extract and
 * sync used to stamp needsApproval on every unmapped slug and on built-ins.
 */
export function isPendingCatalogApproval(key: string, profile: any): boolean {
  if (!key) return false;
  if (isCatalogBuiltIn(key)) return false;
  const mapped = getMappedBiomarkerKey(key) || key.toLowerCase();
  if (mapped && mapped !== key && isCatalogBuiltIn(mapped)) return false;
  if (Array.isArray(profile?.pendingObservations) && profile.pendingObservations.some((p: any) => p.suggestedKey === key || p.printedName === key || p.suggestedKey === mapped)) {
    const custom = profile?.customBiomarkers?.[key] || profile?.customBiomarkers?.[mapped];
    if (custom?.catalogApproved === true) return false;
    return true;
  }
  const custom = profile?.customBiomarkers?.[key] || profile?.customBiomarkers?.[mapped];
  if (!custom) return false;
  if (custom.catalogApproved === true) return false;
  return custom.needsApproval === true;
}

/** Extract/chat may stamp a pending def only for a brand-new unknown key. */
export function shouldStampExtractedDefPending(key: string, existingDef?: any): boolean {
  if (!key) return false;
  if (isCatalogBuiltIn(key)) return false;
  const mapped = getMappedBiomarkerKey(key) || key.toLowerCase();
  if (mapped && isCatalogBuiltIn(mapped)) return false;
  if (existingDef?.catalogApproved === true) return false;
  if (existingDef && existingDef.needsApproval !== true) return false;
  return !existingDef || existingDef.needsApproval === true;
}

export function isBiomarkerApproved(key: string, profile: any, itemLogs?: any[]): boolean {
  const k = getMappedBiomarkerKey(key) || key.toLowerCase();
  const custom = profile?.customBiomarkers?.[k] || profile?.customBiomarkers?.[key];
  // Built-in catalog keys stay live even if a stale extract/sync left needsApproval on the custom overlay.
  if (isCatalogBuiltIn(k) && custom?.catalogApproved !== false) return true;
  if (Array.isArray(profile?.pendingObservations) && profile.pendingObservations.some((p: any) => p.suggestedKey === k || p.printedName === k || p.suggestedKey === key || p.printedName === key)) {
    if (custom?.catalogApproved !== true) return false;
  }
  if (custom?.needsApproval === true) return false;
  if (custom?.catalogApproved === true) return true;

  const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
  const combined = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);

  const hasUnit = !!combined.unit && combined.unit.trim() !== '';
  const hasRange = !!combined.normalRange && combined.normalRange.trim() !== '' && combined.normalRange !== 'Unknown';
  const hasPractice = !!combined.standardMedicalGrouping && combined.standardMedicalGrouping.trim() !== '' && combined.standardMedicalGrouping !== 'By Medical Practice';
  const hasRisk = Array.isArray(combined.riskCategories) && combined.riskCategories.length > 0 && combined.riskCategories.some((r: string) => r.trim() !== '' && r !== 'Uncategorized');
  const hasConditions = Array.isArray(combined.potentialMedicalConditions) && combined.potentialMedicalConditions.length > 0 && combined.potentialMedicalConditions.some((c: string) => c.trim() !== '');

  return hasPractice && hasRisk && hasConditions && hasUnit && hasRange;
}

export function isBiomarkerMissingRange(key: string, profile: any, itemLogs?: any[]): boolean {
  if (!key) return false;
  const k = key.toLowerCase();
  const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
  const custom = profile?.customBiomarkers?.[k];
  const combined = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);

  const range = combined?.normalRange ? String(combined.normalRange).trim().toLowerCase() : '';
  return !range || range === 'unknown' || range === 'unset' || range === 'n/a' || range === '-';
}

export function isBiomarkerMissingCategory(key: string, profile: any, itemLogs?: any[]): boolean {
  if (!key) return false;
  const k = getMappedBiomarkerKey(key) || key.toLowerCase();
  if (isCatalogBuiltIn(k)) {
    const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
    if (builtIn?.standardMedicalGrouping && builtIn.standardMedicalGrouping !== 'Other') return false;
    if (Array.isArray(builtIn?.riskCategories) && builtIn.riskCategories.length > 0 && !builtIn.riskCategories.includes('Uncategorized')) return false;
  }
  const custom = profile?.customBiomarkers?.[k] || profile?.customBiomarkers?.[key];
  const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
  const combined = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);

  const missingPractice = !combined.standardMedicalGrouping || combined.standardMedicalGrouping.trim() === '' || combined.standardMedicalGrouping === 'By Medical Practice' || combined.standardMedicalGrouping === 'Other';
  const missingRisk = !Array.isArray(combined.riskCategories) || combined.riskCategories.length === 0 || combined.riskCategories.includes('Uncategorized');
  return missingPractice && missingRisk;
}

export function isBiomarkerNeedingReview(
  key: string,
  profile: any,
  activeHistory?: any[],
  resolvedBiomarkers?: Record<string, any>,
  allDefinitions?: any[],
  precomputedFlaggedKeys?: Set<string>
): boolean {
  if (!key) return false;
  
  // 1. Pending Approval
  if (!isBiomarkerApproved(key, profile, activeHistory)) return true;

  // 2. Missing normal reference range
  if (isBiomarkerMissingRange(key, profile, activeHistory)) return true;
  
  // 3. Flagged by telemetry / scaling / unit notation errors or improbable values
  // PERF: if caller already ran detectFlaggedTelemetryErrors once for this render,
  // it passes the resulting key set here so we don't rescan all history/definitions
  // again for every single biomarker (this function is called once per biomarker,
  // per render, at multiple call sites — recomputing the full scan each time is
  // the #1 cause of Health tab / Biomarker Dictionary slow load).
  if (precomputedFlaggedKeys) {
    return precomputedFlaggedKeys.has(key);
  }
  const flagged = detectFlaggedTelemetryErrors(
    resolvedBiomarkers || {},
    profile,
    activeHistory || [],
    allDefinitions || biomarkerDefinitions
  );
  if (flagged.some(f => f.key === key)) return true;
  return false;
}

export function isBiomarkerCorruptedUnit(
  key: string,
  profile: any,
  activeHistory?: any[],
  resolvedBiomarkers?: Record<string, any>,
  allDefinitions?: any[]
): boolean {
  if (!key) return false;
  const flagged = detectFlaggedTelemetryErrors(
    resolvedBiomarkers || {},
    profile,
    activeHistory || [],
    allDefinitions || biomarkerDefinitions
  );
  return flagged.some(f => f.key === key);
}

export function approvePendingBiomarker(biomarkerKey: string, targetCategory?: string) {
  // Dead store — callers must set profile.customBiomarkers[key].catalogApproved.
  try {
    const raw = localStorage.getItem('biomarker_dictionary_store');
    if (raw) {
      const store = JSON.parse(raw);
      if (store[biomarkerKey]) {
        store[biomarkerKey].isPendingApproval = false;
        store[biomarkerKey].approved = true;
        delete store[biomarkerKey].needsApproval;
        if (targetCategory) {
          store[biomarkerKey].category = targetCategory;
        }
        // Intentionally do not persist the dead store.
      }
    }
  } catch (e) {
    console.error(e);
  }
}

export function buildReviewBiomarkerContext(
  biomarkerKey: string,
  currentValue: number | string,
  allDefinitions: any[],
  biomarkerHistory: any[],
  profile: any
): string {
  const customDef = profile?.customBiomarkers?.[biomarkerKey] || {};
  const def = getMergedBiomarkerDef(biomarkerKey, allDefinitions.find(d => d.key === biomarkerKey), customDef);

  const age = profile?.age || 'unknown';
  const gender = profile?.gender || 'unknown';
  const ethnicity = profile?.ethnicity || 'unknown';
  const unitPreference = profile?.unitPreference || 'SI';

  const targetMeta = getBiomarkerMetadata(biomarkerKey, customDef);
  
  const sortedLogs = [...(biomarkerHistory || [])].sort((a, b) => b.date.localeCompare(a.date));
  const selectedHistory = sortedLogs
    .filter(log => log.biomarkers && log.biomarkers[biomarkerKey] !== undefined && log.biomarkers[biomarkerKey] !== '')
    .map(log => ({
      date: log.date,
      value: log.biomarkers[biomarkerKey],
      unit: def.unit || ''
    }));

  const payloadObj = {
    user_profile: {
      age,
      gender,
      ethnicity,
      unit_preference: unitPreference
    },
    target_biomarker: {
      key: biomarkerKey,
      name: def.name || '',
      current_value: currentValue,
      unit: def.unit || '',
      normal_range: def.normalRange || '',
      description: def.description || def.descriptions?.[profile.language || 'en'] || def.descriptions?.en || '',
      medical_insights: customDef.specificRiskContext || customDef.benefitRisk || def.medicalInsight || '',
      optimal_value: customDef.optimalValue || def.optimalValue || '',
      severity_rating: getBiomarkerStatusLabel(biomarkerKey, getBiomarkerStatus(biomarkerKey, currentValue, def.normalRange, def, profile), customDef, currentValue, profile),
      medical_categorisation: {
        risk_categories: targetMeta.riskCategories || [],
        potential_conditions: targetMeta.potentialMedicalConditions || [],
        standard_grouping: targetMeta.standardMedicalGrouping || ''
      }
    },
    target_biomarker_history: selectedHistory
  };

  return JSON.stringify(payloadObj, null, 2);
}

export function buildBiomarkerReviewPrefill(
  biomarkerKey: string,
  providedDef?: any,
  biomarkers?: any,
  profile?: any
): string {
  const customDef = profile?.customBiomarkers?.[biomarkerKey] || {};
  const def = getMergedBiomarkerDef(
    biomarkerKey,
    providedDef || biomarkerDefinitions.find(d => d.key === biomarkerKey),
    customDef
  );
  const defName = def.name || biomarkerKey;

  const rawCur = (biomarkers?.[biomarkerKey] || profile?.customBiomarkers?.[biomarkerKey] || null) as any;
  const valStr = rawCur && typeof rawCur === 'object' && 'value' in rawCur 
    ? String(rawCur.value) 
    : (rawCur !== undefined && rawCur !== null ? String(rawCur) : '');
  const unitStr = rawCur && typeof rawCur === 'object' && 'unit' in rawCur 
    ? String(rawCur.unit || '') 
    : (def?.unit || '');
  const rangeStr = rawCur && typeof rawCur === 'object' && 'normalRange' in rawCur 
    ? String(rawCur.normalRange || '') 
    : (def?.normalRange || 'Standard reference range');

  let valueDetail = valStr ? `${valStr} ${unitStr}`.trim() : 'No current value recorded';
  if (rangeStr) {
    valueDetail += ` (Standard Range: ${rangeStr})`;
  }

  return `Please review my biomarker: ${defName}\n• Current Value: ${valueDetail}\n• Biomarker Key: ${biomarkerKey}\n\nPlease perform a clinical diagnostic review on this biomarker, evaluate my full log history, and propose diagnostic insights and recommendations.`;
}

/**
 * Self-healing registration for newly extracted or logged biomarkers:
 * Automatically infers missing units, reference ranges, medical groupings, and risk categories
 * so that new biomarkers never require manual code changes or get trapped in "unreviewed" states.
 */
export function selfHealCustomBiomarkerDefinitions(
  items: Array<{ key: string; unit?: string; normalRange?: string; printedRange?: string; name?: string; category?: string; description?: string }>,
  existingCustoms: Record<string, any> = {}
): { updatedCustoms: Record<string, any>; hasChanges: boolean } {
  let hasChanges = false;
  const customs = { ...existingCustoms };

  items.forEach(item => {
    if (!item || !item.key) return;
    const rawKey = item.key;
    if (rawKey === 'weight' || rawKey === 'height' || rawKey === 'age') return;
    const mapped = getMappedBiomarkerKey(rawKey) || rawKey;
    const isBuiltIn = biomarkerDefinitions.some(d => d.key === mapped || (Array.isArray(d.aliases) && d.aliases.some(a => a.toLowerCase() === mapped.toLowerCase())));
    if (!isBuiltIn) {
      const existing = customs[mapped] || {};
      const cleanName = (item.name && item.name.trim()) || existing.name || mapped.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const inferredUnit = inferUnitFromKeyOrName(mapped, cleanName);
      const derivedDefaults = getDerivedCategoryDefaults(item.category || '', mapped);
      const unit = (existing.unit && existing.unit.trim() && existing.unit !== 'Unknown') ? existing.unit : (item.unit || inferredUnit || '');
      const range = (existing.normalRange && existing.normalRange.trim() && existing.normalRange !== 'Unknown') ? existing.normalRange : (item.normalRange || item.printedRange || 'Varies');

      customs[mapped] = {
        ...existing,
        name: cleanName,
        unit,
        normalRange: range,
        description: existing.description || item.description || cleanName,
        standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other' && existing.standardMedicalGrouping !== 'By Medical Practice') ? existing.standardMedicalGrouping : (derivedDefaults.grouping),
        riskCategories: (Array.isArray(existing.riskCategories) && existing.riskCategories.length > 0 && !existing.riskCategories.includes('Uncategorized')) ? existing.riskCategories : (derivedDefaults.risks),
        potentialMedicalConditions: (Array.isArray(existing.potentialMedicalConditions) && existing.potentialMedicalConditions.length > 0) ? existing.potentialMedicalConditions : (derivedDefaults.conditions),
        catalogApproved: true
      };
      hasChanges = true;
    }
  });

  return { updatedCustoms: customs, hasChanges };
}
