import { UserProfile } from '../types';

export interface BiomarkerDefinition {
  key: string;
  name: string;
  category: 'hematology' | 'blood_sugar' | 'lipids' | 'inflammation' | 'thyroid' | 'liver' | 'kidneys' | 'hormones' | 'vitamins' | 'other';
  unit: string;
  normalRange: string;
  descriptions: { [lang: string]: string };
  benefitRisk?: string;
  riskCategories?: string[];
  standardMedicalGrouping?: string;
  potentialMedicalConditions?: string[];
}

export const biomarkerDefinitions: BiomarkerDefinition[] = [
  // Blood Sugar
  {
    key: 'hba1c',
    name: 'HbA1c',
    category: 'blood_sugar',
    unit: '%',
    normalRange: '4.0 - 5.6',
    descriptions: {
      en: 'Average blood glucose levels over the past 2-3 months.',
      fr: 'Moyenne de la glycémie sur les 2-3 derniers mois.',
      zh: '过去2-3个月的平均血糖水平。',
      id: 'Rata-rata kadar glukosa darah selama 2-3 bulan terakhir.'
    }
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
    }
  },
  {
    key: 'fasting_insulin',
    name: 'Fasting Insulin',
    category: 'blood_sugar',
    unit: 'uIU/mL',
    normalRange: '2.0 - 10.0',
    descriptions: {
      en: 'Level of insulin hormone; early warning for insulin resistance.',
      fr: 'Taux d\'insuline; indicateur précoce de résistance à l\'insuline.',
      zh: '胰岛素水平；胰岛素抵抗的早期预警指标。',
      id: 'Kadar hormon insulin; deteksi dini resistensi insulin.'
    }
  },

  // Lipids
  {
    key: 'ldl',
    name: 'LDL-C',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: 'under 100',
    descriptions: {
      en: 'Low-Density Lipoprotein, the "bad" cholesterol linked to heart disease.',
      fr: 'Cholestérol LDL, dit "mauvais" cholestérol lié aux risques cardiovasculaires.',
      zh: '低密度脂蛋白胆固醇（“坏”胆固醇），与心血管风险高度相关。',
      id: 'Low-Density Lipoprotein, kolesterol "jahat" terkait risiko jantung.'
    }
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
    }
  },
  {
    key: 'total_cholesterol',
    name: 'Total Cholesterol',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: '125 - 200',
    descriptions: {
      en: 'Total amount of cholesterol in the blood.',
      fr: 'Quantité totale de cholestérol dans le sang.',
      zh: '血液中的总胆固醇含量。',
      id: 'Jumlah total kolesterol dalam darah.'
    }
  },
  {
    key: 'hdl',
    name: 'HDL-C',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: 'over 40',
    descriptions: {
      en: 'High-Density Lipoprotein, the "good" cholesterol removing excess lipids.',
      fr: 'Cholestérol HDL, dit "bon" cholestérol favorisant le retour des lipides.',
      zh: '高密度脂蛋白胆固醇（“好”胆固醇），协助清除血管内多余脂质。',
      id: 'High-Density Lipoprotein, kolesterol "baik" pembersih lipid berlebih.'
    }
  },
  {
    key: 'triglycerides',
    name: 'Triglycerides',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: 'under 150',
    descriptions: {
      en: 'Type of fat in the blood used for energy storage.',
      fr: 'Type de graisse circulante servant à stocker l\'énergie.',
      zh: '血液中用于能量储存的游离脂肪分子。',
      id: 'Jenis lemak dalam darah yang digunakan untuk penyimpanan energi.'
    }
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
    }
  },
  {
    key: 'creatinine',
    name: 'Creatinine',
    category: 'kidneys',
    unit: 'mg/dL',
    normalRange: '0.6 - 1.2',
    descriptions: {
      en: 'Waste product from muscle wear, filtered out by kidneys.',
      fr: 'Déchet musculaire éliminé par les reins.',
      zh: '肌肉代谢废物，由肾脏过滤排出。',
      id: 'Produk sisa otot yang disaring dan dibuang oleh ginjal.'
    }
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

  // Hematology
  {
    key: 'hgb',
    name: 'Hemoglobin (Hgb)',
    category: 'hematology',
    unit: 'g/dL',
    normalRange: '13.5 - 17.5',
    descriptions: {
      en: 'Iron-containing protein in red blood cells carrying oxygen.',
      fr: 'Protéine transporteuse d\'oxygène dans les globules rouges.',
      zh: '红细胞中富含铁的氧气运输蛋白。',
      id: 'Protein pengikat zat besi dalam sel darah merah yang membawa oksigen.'
    }
  },
  {
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
    }
  },
  {
    key: 'wbc',
    name: 'White Blood Cell (WBC)',
    category: 'hematology',
    unit: 'K/uL',
    normalRange: '4.5 - 11.0',
    descriptions: {
      en: 'Immune cells protecting against infections.',
      fr: 'Globules blancs, acteurs clés de l\'immunité.',
      zh: '白细胞总数，反映机体免疫和炎症防守状态。',
      id: 'Sel darah putih, agen utama sistem imun.'
    }
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
      id: 'Keping darah, agen pembekuan darah dan penutupan luka.'
    }
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
    }
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
    }
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
    unit: 'kg/m²',
    normalRange: '18.5 - 24.9',
    descriptions: {
      en: 'A measure of body fat based on height and weight.',
      fr: 'Une mesure de la corpulence basée sur la taille et le poids.',
      zh: '基于身高和体重的身体质量指数。',
      id: 'Ukuran lemak tubuh berdasarkan tinggi dan berat badan.'
    }
  }
];
export const categoryLabels: { [key: string]: { [lang: string]: string } } = {
  blood_sugar: { en: 'Blood Sugar', fr: 'Glycémie', zh: '血糖管理', id: 'Gula Darah' },
  lipids: { en: 'Cardiovascular Lipids', fr: 'Lipides & Cardiovasculaire', zh: '心血管与血脂', id: 'Profil Lipid' },
  kidneys: { en: 'Kidney Function', fr: 'Fonction Rénale', zh: '肾脏功排毒', id: 'Fungsi Ginjal' },
  hematology: { en: 'Hematology (CBC)', fr: 'Hématologie (NFS)', zh: '血常规与红细胞', id: 'Hematologi' },
  inflammation: { en: 'Inflammation markers', fr: 'Marqueurs Inflammatoires', zh: '机体炎性指标', id: 'Penanda Inflamasi' },
  hormones: { en: 'Endocrine Hormones', fr: 'Hormones Endocriniennes', zh: '内分泌与激素', id: 'Hormon Endokrin' },
  vitamins: { en: 'Vitamins & Micronutrients', fr: 'Vitamines & Micronutriments', zh: '维生素与微量元素', id: 'Vitamin & Mikro' }
};
export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string): 'normal' | 'low' | 'high' | 'critical' | 'unknown' => {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return 'unknown';

  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    const def = biomarkerDefinitions.find(d => d.key === key);
    rangeStr = def?.normalRange;
  }

  const isMmol = rangeStr && rangeStr.toLowerCase().includes('mmol');

  if (!isMmol) {
    if (key === 'ldl') {
      if (num > 130) return 'critical';
      if (num > 100) return 'high';
      return 'normal';
    }
    if (key === 'apob') {
      if (num > 110) return 'critical';
      if (num > 90) return 'high';
      return 'normal';
    }
    if (key === 'hba1c') {
      if (num >= 6.5) return 'critical';
      if (num >= 5.7) return 'high';
      return 'normal';
    }
    if (key === 'egfr') {
      if (num < 60) return 'critical';
      if (num < 90) return 'low';
      return 'normal';
    }
    if (key === 'hscrp') {
      if (num >= 3.0) return 'critical';
      if (num >= 1.0) return 'high';
      return 'normal';
    }
    if (key === 'vitamin_d') {
      if (num < 20) return 'critical';
      if (num < 30) return 'low';
      return 'normal';
    }
  }

  // Simple default bounds based on standard definitions or passed custom range
  if (!rangeStr || rangeStr.toLowerCase() === 'unknown') return 'unknown';

  const match = rangeStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (match) {
    const min = parseFloat(match[1]);
    const max = parseFloat(match[2]);
    if (num < min) return 'low';
    if (num > max) return 'high';
    return 'normal';
  }

  // Handle single sided ranges like "< 100", "> 50", "under 150"
  if (rangeStr.includes('<') || rangeStr.toLowerCase().includes('under')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (num > threshold) {
        if (num >= threshold * 1.3) return 'critical';
        return 'high';
      }
      return 'normal';
    }
  }
  if (rangeStr.includes('>') || rangeStr.toLowerCase().includes('over')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (num < threshold) {
        if (num <= threshold * 0.7) return 'critical';
        return 'low';
      }
      return 'normal';
    }
  }

  return 'unknown';
};
export const isAsianEthnicity = (eth?: string): boolean => {
  if (!eth) return false;
  const lower = eth.toLowerCase();
  return lower.includes('asian') || lower.includes('china') || lower.includes('chinese') || lower.includes('india') || lower.includes('indian') || lower.includes('japan') || lower.includes('japanese') || lower.includes('korea') || lower.includes('korean');
};
export const getBiomarkerColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'unknown'): string => {
  switch (status) {
    case 'normal': return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30';
    case 'low': return 'text-amber-500 bg-amber-50 dark:bg-amber-950/30';
    case 'high': return 'text-amber-500 bg-amber-50 dark:bg-amber-950/30';
    case 'critical': return 'text-rose-500 bg-rose-50 dark:bg-rose-950/30';
    default: return 'text-slate-400 bg-slate-50 dark:bg-slate-950/30';
  }
};
export const getBiomarkerBorderColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'unknown'): string => {
  switch (status) {
    case 'normal': return 'border-emerald-500/20';
    case 'low': return 'border-amber-500/20';
    case 'high': return 'border-amber-500/20';
    case 'critical': return 'border-rose-500/20';
    default: return 'border-slate-500/10';
  }
};

export const getBiomarkerStatusLabel = (key: string, status: string): string => {
  if (key === 'bmi') {
    switch (status) {
      case 'low': return 'Underweight';
      case 'high': return 'Overweight';
      case 'critical': return 'Obese';
      case 'normal': return 'Normal';
      default: return status;
    }
  }
  return status;
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

export function getBiomarkerMetadata(key: string, customDef?: any) {
  const k = key.toLowerCase();
  
  if (customDef) {
    return {
      riskCategories: customDef.riskCategories || getFallbackRiskCategories(k),
      standardMedicalGrouping: customDef.standardMedicalGrouping || getFallbackMedicalGrouping(k),
      potentialMedicalConditions: customDef.potentialMedicalConditions || getFallbackMedicalConditions(k)
    };
  }

  return {
    riskCategories: getFallbackRiskCategories(k),
    standardMedicalGrouping: getFallbackMedicalGrouping(k),
    potentialMedicalConditions: getFallbackMedicalConditions(k)
  };
}

function getFallbackRiskCategories(key: string): string[] {
  const k = key.toLowerCase();
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist') || k.includes('fat')) {
    return ['Metabolic & glycemic'];
  }
  if (k === 'hba1c' || k === 'fasting_glucose' || k === 'fasting_insulin' || k.includes('glucose') || k.includes('sugar') || k.includes('insulin')) {
    return ['Metabolic & glycemic'];
  }
  if (k === 'ldl' || k === 'apob' || k === 'hdl' || k === 'triglycerides' || k === 'total_cholesterol' || k === 'hscrp' || k.includes('cholesterol') || k.includes('lipid') || k.includes('crp')) {
    return ['Cardiovascular'];
  }
  if (k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin' || k.includes('kidney') || k.includes('renal') || k.includes('urine')) {
    return ['Kidney & hydration'];
  }
  if (k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin' || k.includes('liver') || k.includes('hepatic') || k.includes('transaminase')) {
    return ['Liver & hepatitis stress'];
  }
  if (k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit' || k.includes('cell') || k.includes('blood count') || k.includes('haem')) {
    return ['Hematology'];
  }
  return ['Other'];
}

function getFallbackMedicalGrouping(key: string): string {
  const k = key.toLowerCase();
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist')) return 'Biometrics';
  if (k === 'hba1c' || k === 'fasting_glucose' || k === 'fasting_insulin' || k.includes('glucose') || k.includes('sugar') || k.includes('insulin') || k === 'ldl' || k === 'apob' || k === 'hdl' || k === 'triglycerides' || k === 'total_cholesterol' || k === 'hscrp' || k.includes('cholesterol') || k.includes('lipid')) {
    return 'Metabolic';
  }
  if (k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin' || k.includes('kidney') || k.includes('renal')) {
    return 'Renal';
  }
  if (k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin' || k.includes('liver') || k.includes('hepatic')) {
    return 'Hepatic';
  }
  if (k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit' || k.includes('cell') || k.includes('blood count') || k.includes('haem')) {
    return 'Hematology';
  }
  return 'Other';
}

function getFallbackMedicalConditions(key: string): string[] {
  const k = key.toLowerCase();
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist')) return ['Obesity', 'Metabolic Syndrome'];
  if (k === 'hba1c' || k === 'fasting_glucose' || k === 'fasting_insulin' || k.includes('glucose') || k.includes('sugar') || k.includes('insulin')) {
    return ['Diabetes Risk', 'Insulin Resistance'];
  }
  if (k === 'ldl' || k === 'apob' || k === 'hdl' || k === 'triglycerides' || k === 'total_cholesterol' || k.includes('cholesterol') || k.includes('lipid')) {
    return ['Hyperlipidemia', 'Atherosclerosis Risk', 'Cardiovascular Disease'];
  }
  if (k === 'hscrp' || k.includes('crp')) return ['Systemic Inflammation', 'Cardiovascular Risk'];
  if (k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin' || k.includes('kidney') || k.includes('renal')) {
    return ['Chronic Kidney Disease', 'Dehydration', 'Impaired Renal Function'];
  }
  if (k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin' || k.includes('liver') || k.includes('hepatic')) {
    return ['Fatty Liver', 'Hepatitis Stress', 'Liver Dysfunction'];
  }
  if (k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit' || k.includes('cell') || k.includes('blood count') || k.includes('haem')) {
    if (k.includes('wbc') || k.includes('white')) return ['Immune Response', 'Infection Risk'];
    if (k.includes('platelet')) return ['Thrombocytopenia', 'Clotting Risk'];
    return ['Anemia', 'Oxygen Transport Capacity'];
  }
  return ['General Health'];
}



