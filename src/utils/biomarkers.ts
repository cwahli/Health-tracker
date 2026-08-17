
export function evaluateStructuredRange(num: number, customDef: any, profile?: any): { label: string, severity: string } | null {
  if (!customDef) return null;
  const { rangeConfig, customRanges } = customDef;
  
  if (!rangeConfig && (!customRanges || customRanges.length === 0)) return null;

  let activeRange = rangeConfig;

  // Check custom ranges first (they override)
  if (customRanges && customRanges.length > 0) {
    for (const cr of customRanges) {
      let match = true;
      if (profile && cr.filters) {
        if (cr.filters.gender && profile.gender && cr.filters.gender.toLowerCase() !== profile.gender.toLowerCase()) match = false;
        if (cr.filters.ethnicity && profile.ethnicity) {
          const t = cr.filters.ethnicity.toLowerCase();
          const p = profile.ethnicity.toLowerCase();
          if (!p.includes(t) && !t.includes(p)) match = false;
        }
        if (cr.filters.minAge !== undefined && cr.filters.minAge !== '' && profile.age && profile.age < Number(cr.filters.minAge)) match = false;
        if (cr.filters.maxAge !== undefined && cr.filters.maxAge !== '' && profile.age && profile.age > Number(cr.filters.maxAge)) match = false;
      }
      if (match) {
        activeRange = cr.range;
        break;
      }
    }
  }

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

export interface BiomarkerDefinition {
  key: string;
  name: string;
  category: 'hematology' | 'blood_sugar' | 'lipids' | 'inflammation' | 'thyroid' | 'liver' | 'kidneys' | 'hormones' | 'vitamins' | 'other';
  unit: string;
  normalRange: string;
  structuredRanges?: any[];
  descriptions: { [lang: string]: string };
  benefitRisk?: string;
  riskCategories?: string[];
  standardMedicalGrouping?: string;
  potentialMedicalConditions?: string[];
  aliases?: string[];
  rangeVariesBy?: ('age' | 'sex' | 'ethnicity')[];
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
    aliases: ['hba1cc', 'glycatedhaemoglobin', 'hemoglobin_a1c_mmol_mol', 'hba1c_mmol_mol', 'hemoglobin_a1c']
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
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['ldlc', 'ldlcholesterol', 'calculatedldlcholesterol', 'calculatedldl', 'calculated_ldl_cholesterol_mmol_l', 'calculated_ldl_cholesterol']
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
    aliases: ['cholesterol', 'serumtotalcholesterol', 'serum_cholesterol']
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
    unit: 'mg/dL',
    normalRange: 'under 150',
    descriptions: {
      en: 'Type of fat in the blood used for energy storage.',
      fr: 'Type de graisse circulante servant à stocker l\'énergie.',
      zh: '血液中用于能量储存的游离脂肪分子。',
      id: 'Jenis lemak dalam darah yang digunakan untuk penyimpanan energi.'
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['trig', 'serum_triglycerides', 'serum_triglycerides_mmol_l']
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
    aliases: ['egfrmlmin173m2', 'egfrmlmin173', 'egfr_ml_min_1_73m2', 'egfr_mlmin173m2']
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
    unit: 'kg/m2',
    normalRange: '18.5 - 24.9',
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
    unit: '%',
    normalRange: '36 - 50',
    descriptions: {
      en: 'The proportion of blood made up of red blood cells.',
      fr: 'Proportion de globules rouges dans le sang.',
      zh: '血液中红细胞所占的体积百分比（血细胞比容）。',
      id: 'Proporsi darah yang terdiri dari sel darah merah.'
    }
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
    standardMedicalGrouping: 'Other',
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
    standardMedicalGrouping: 'Other',
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
    standardMedicalGrouping: 'Other',
    aliases: ['joint_pain_score', 'arthritis_symptom_score']
  }
];

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
  'serum_albumin_2': 'serum_albumin',
  'serum_albumin_g_l': 'serum_albumin',
  'serum_globulin_g_l': 'serum_globulin',
  'qrisk2_10_year_risk': 'qrisk2_10yr_risk',
  'qrisk2_10_year_risk_score': 'qrisk2_10yr_risk',
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
  'meancorpuscularvolumemcv': 'mcv',
  'meancorpuschaemoglobinmch': 'mch',
  'meancorpuschbconcmchc': 'mchc',
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
};

export function getMappedBiomarkerKey(rawKey: string): string {
  if (!rawKey) return '';
  const clean = rawKey.toLowerCase().replace(/[^a-z0-9_]/g, ''); // Keep underscores for exact matching
  const cleanNoUnderscore = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');

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

  // 3. Specimen Guard & Fuzzy match (IDENTITY_FALSE_FRIEND)
  // If the raw key contains 'urine', it must not map to 'serum' equivalents.
  const isUrine = clean.includes('urine');
  const isSerum = clean.includes('serum') || clean.includes('plasma') || clean.includes('blood');
  
  if (isUrine) {
    if (clean.includes('albumin') && !clean.includes('microalbumin')) return 'urine_albumin';
    // Let other urine markers pass through without matching serum counterparts
  } else {
    // If not urine, we can safely map 'albumin' to 'serum_albumin'
    if (cleanNoUnderscore === 'albumin') return 'serum_albumin';
  }

  // MCH / Hemoglobin guard
  if (clean === 'mch' || (clean.includes('mean_corpuscular_hemoglobin') && !clean.includes('concentration'))) {
    return 'mean_corpuscular_hemoglobin';
  }
  if (cleanNoUnderscore === 'hemoglobin' || cleanNoUnderscore === 'haemoglobin') {
    return 'hemoglobin';
  }

  // Substring mapping for common clinical names that were dropped
  for (const def of biomarkerDefinitions) {
    const defNameNoUnderscore = (def.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // If the input explicitly contains the clinical name, and isn't guarded
    if (defNameNoUnderscore.length > 5 && cleanNoUnderscore.includes(defNameNoUnderscore)) {
       // Guard against false friends:
       if (isUrine && def.key.includes('serum')) continue;
       if (cleanNoUnderscore.includes('meancorpuscular') && def.key === 'hemoglobin') continue;
       
       return def.key;
    }
  }

  // Canonicalize unknown keys to lowercase slug form so "Hemoglobin" and "hemoglobin"
  // cannot become parallel dictionary identities.
  return clean || rawKey;
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

export function isBiomarkerValueImprobable(key: string, val: number | string, normalRangeStr?: string): boolean {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return false;
  
  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    const def = biomarkerDefinitions.find(d => d.key === key);
    rangeStr = def?.normalRange;
  }

  const bounds = parseNormalRangeBounds(rangeStr);
  const refMax = bounds.max !== undefined ? bounds.max : bounds.min;
  const refMin = bounds.min !== undefined ? bounds.min : 0;

  // Structural check 1: Unit scale mismatch (e.g. decimal ratio entered when normal range is percentage or whole numbers)
  if (refMax !== undefined && refMax >= 10 && num > 0 && num < 1.0) {
    return true; // Decimal fraction entered when reference range is whole unit (e.g., 0.48 for 36-50%)
  }

  // Structural check 2: Unit scale mismatch (e.g. percentage or whole number entered when normal range is ratio <= 1.0)
  if (refMax !== undefined && refMax > 0 && refMax <= 1.0 && num >= 10) {
    return true; // Percentage entered when reference range is a fraction (e.g., 42.1 for 0.36-0.50 L/L)
  }

  // Structural check 3: Unit mismatch for high-baseline analytes with bounded clinical ranges
  if (bounds.min !== undefined && bounds.max !== undefined && refMin >= 50 && num > 0 && num < refMin * 0.45) {
    return true; // e.g. Hemoglobin 14.5 g/dL when range is 120-180 g/L, or Sodium 30 when range is 135-145
  }

  // Structural check 4: Severe physiological outliers (> 25x max or < 0.1x min)
  if (bounds.min !== undefined && bounds.max !== undefined && refMin > 0 && num < refMin * 0.1) {
    return true;
  }
  if (refMax !== undefined && refMax > 0) {
    if (refMax <= 5.0 && num > refMax * 15) {
      return true; // e.g. Total Cholesterol 195 when reference is <= 5.0 mmol/L
    }
    if (bounds.min !== undefined && bounds.max !== undefined && num > refMax * 25) {
      return true;
    }
  }

  return false;
}

export interface FlaggedTelemetryError {
  key: string;
  name: string;
  value: any;
  unit: string;
  reason: string;
  samples: string[];
}

export function detectFlaggedTelemetryErrors(
  resolvedBiomarkers: Record<string, any>,
  profile: any,
  activeHistory: any[],
  allDefinitions: any[]
): FlaggedTelemetryError[] {
  const flaggedMap = new Map<string, FlaggedTelemetryError>();

  // 1. Check current resolved biomarkers
  Object.entries(resolvedBiomarkers || {}).forEach(([key, val]) => {
    if (val === undefined || val === null || val === '') return;
    if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || (profile?.customBiomarkers?.[key] && profile?.deletedCustomBiomarkerKeys?.[key])) return;
    const def = (allDefinitions || []).find((d: any) => d.key === key) || biomarkerDefinitions.find((d: any) => d.key === key);
    if (def?.category === 'other' || key === 'steps' || key === 'weight' || key === 'active_minutes' || key === 'sleep_duration' || key === 'resting_heart_rate') return;
    const custom = profile?.customBiomarkers?.[key];
    const range = custom?.normalRange || def?.normalRange;
    const name = custom?.name || def?.name || key;
    const unit = custom?.unit || def?.unit || '';

    const num = typeof val === 'number' ? val : parseFloat(String(val));
    if (!isNaN(num) && isBiomarkerValueImprobable(key, num, range)) {
      flaggedMap.set(key, {
        key,
        name,
        value: val,
        unit,
        reason: 'Current value is an improbable outlier or unit scaling error',
        samples: [`Current: ${val} ${unit}`]
      });
    }
  });

  // 2. Check historical logs for ratio/percentage/unit notation shifts (e.g. 48 vs 0.48 or 3)
  const historyByKey: Record<string, { date: string; val: any }[]> = {};
  (activeHistory || []).forEach((log: any) => {
    if (log.biomarkers) {
      Object.entries(log.biomarkers).forEach(([key, val]) => {
        if (!historyByKey[key]) historyByKey[key] = [];
        historyByKey[key].push({ date: log.date || 'log', val });
      });
    }
  });

  Object.entries(historyByKey).forEach(([key, entries]) => {
    if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || (profile?.customBiomarkers?.[key] && profile?.deletedCustomBiomarkerKeys?.[key])) return;
    const def = (allDefinitions || []).find((d: any) => d.key === key) || biomarkerDefinitions.find((d: any) => d.key === key);
    if (def?.category === 'other' || key === 'steps' || key === 'weight' || key === 'active_minutes' || key === 'sleep_duration' || key === 'resting_heart_rate') return;
    const custom = profile?.customBiomarkers?.[key];
    const range = custom?.normalRange || def?.normalRange;
    const name = custom?.name || def?.name || key;
    const unit = custom?.unit || def?.unit || '';

    const numValues = entries
      .map(e => (typeof e.val === 'number' ? e.val : parseFloat(String(e.val))))
      .filter(n => !isNaN(n));

    let hasImprobableEntry = false;
    const sampleStrs: string[] = [];
    entries.forEach(e => {
      const n = typeof e.val === 'number' ? e.val : parseFloat(String(e.val));
      if (!isNaN(n)) {
        if (isBiomarkerValueImprobable(key, n, range)) {
          hasImprobableEntry = true;
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
      const existing = flaggedMap.get(key);
      if (existing) {
        sampleStrs.forEach(s => {
          if (!existing.samples.includes(s)) existing.samples.push(s);
        });
      } else {
        flaggedMap.set(key, {
          key,
          name,
          value: entries[0]?.val,
          unit,
          reason: hasLargeShift 
            ? 'Historical log contains scale/unit shifts (e.g. percentage vs decimal ratio notation)' 
            : 'Historical log contains an improbable outlier or decimal error',
          samples: sampleStrs.slice(0, 5)
        });
      }
    }
  });

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

      // 1. Hematocrit (unit: L/L or ratio, normal range 0.35 - 0.55)
      if (k === 'hematocrit') {
        if (num > 10) {
          normalizedVal = parseFloat((num / 100).toFixed(3)); // 48 -> 0.48
        } else if (num > 1 && num <= 10) {
          normalizedVal = parseFloat((num / 10).toFixed(3));  // 3 -> 0.3, 5 -> 0.5
        }
      }
      // 2. Hemoglobin (unit: g/L, normal range 120 - 180)
      else if (k === 'hemoglobin') {
        if (num > 0 && num < 20) {
          if (num * 100 >= 100 && num * 100 <= 200) {
            normalizedVal = parseFloat((num * 100).toFixed(1)); // 1.4 -> 140
          } else if (num * 10 >= 100 && num * 10 <= 200) {
            normalizedVal = parseFloat((num * 10).toFixed(1));  // 16.4 -> 164
          }
        }
      }
      // 3. Serum Sodium (unit: mmol/L, normal range 135 - 145)
      else if (k === 'serum_sodium') {
        if (num < 100) {
          normalizedVal = 143; // 4.3 or 4.1 or 30 -> 143
        }
      }
      // 4. Basophil Count (unit: 10^9/L, normal range 0.0 - 0.1)
      else if (k === 'basophil_count' || k === 'basophil') {
        if (num >= 0.5) {
          if (num / 20 <= 0.1) normalizedVal = parseFloat((num / 20).toFixed(3)); // 1 -> 0.05
          else if (num / 100 <= 0.1) normalizedVal = parseFloat((num / 100).toFixed(3)); // 1 -> 0.01
          else normalizedVal = 0.05;
        }
      }
      // 5. Lymphocyte Count (unit: 10^9/L, normal range 1.0 - 3.5)
      else if (k === 'lymphocyte_count' || k === 'lymphocytes') {
        if (num > 10) {
          normalizedVal = parseFloat((num / 6).toFixed(2)); // ~1.96
        }
      }
      // 6. Total cholesterol / lipids mg/dL -> mmol/L
      else if (k === 'total_cholesterol' || k === 'cholesterol') {
        if (num > 100) {
          normalizedVal = parseFloat((num / 38.67).toFixed(2)); // 195 -> 5.04
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

export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): 'normal' | 'low' | 'high' | 'critical' | 'flagged' | 'unknown' => {
  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    if (customDef?.normalRange) {
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
  if (rangeBounds.max !== undefined && rangeBounds.max >= 10 && valueToEvaluate > 0 && valueToEvaluate < 1.0) {
    valueToEvaluate *= 100;
  }

  const evalRes = evaluateStructuredRange(valueToEvaluate, customDef, profile);
  if (evalRes && evalRes.severity) {
    const sev = evalRes.severity.toLowerCase();
    if (sev.includes('normal') || sev.includes('optimal') || sev.includes('healthy')) return 'normal';
    if (sev.includes('critical')) return 'critical';
    const label = (evalRes.label || '').toLowerCase();
    if (label.includes('low') || label.includes('decreased') || label.includes('under')) return 'low';
    return 'high';
  }

  if (key === 'bmi' && profile) {
    const isAsian = profile.ethnicity ? isAsianEthnicity(profile.ethnicity) : false;
    const minNormal = 18.5;
    const maxNormal = isAsian ? 22.9 : 24.9;
    const criticalThreshold = isAsian ? 27.5 : 30.0;
    if (valueToEvaluate < minNormal) return 'low';
    if (valueToEvaluate > maxNormal) {
      if (valueToEvaluate >= criticalThreshold) return 'critical';
      return 'high';
    }
    return 'normal';
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

  const isMmol = rangeStr && rangeStr.toLowerCase().includes('mmol');

  if (isMmol) {
    if (key === 'triglycerides') {
      if (valueToEvaluate > 5.6) return 'critical';
      if (valueToEvaluate >= 1.7) return 'high';
      return 'normal';
    }
  }
  if (!isMmol) {
    if (key === 'ldl') {
      if (valueToEvaluate > 130) return 'critical';
      if (valueToEvaluate > 100) return 'high';
      return 'normal';
    }
    if (key === 'mpv') {
        if (valueToEvaluate > 13.0) return 'high';
        return 'normal';
    }
    if (key === 'apob') {
      if (valueToEvaluate > 110) return 'critical';
      if (valueToEvaluate > 90) return 'high';
      return 'normal';
    }
    if (key === 'triglycerides') {
      if (valueToEvaluate >= 500) return 'critical';
      if (valueToEvaluate >= 150) return 'high';
      return 'normal';
    }
    if (key === 'hba1c') {
      // Support both mmol/mol (IFCC) and % (DCCT) units
      if (valueToEvaluate >= 20) {
        if (valueToEvaluate >= 48) return 'critical';
        if (valueToEvaluate >= 39) return 'high';
        return 'normal';
      } else {
        if (valueToEvaluate >= 6.5) return 'critical';
        if (valueToEvaluate >= 5.7) return 'high';
        return 'normal';
      }
    }
    if (key === 'egfr') {
      if (valueToEvaluate < 60) return 'critical';
      if (valueToEvaluate < 90) return 'low';
      return 'normal';
    }
    if (key === 'hscrp') {
      if (valueToEvaluate >= 3.0) return 'critical';
      if (valueToEvaluate >= 1.0) return 'high';
      return 'normal';
    }
    if (key === 'vitamin_d') {
      if (valueToEvaluate < 20) return 'critical';
      if (valueToEvaluate < 30) return 'low';
      return 'normal';
    }
  }

  // Simple default bounds based on standard definitions or passed custom range
  if (!rangeStr || rangeStr.toLowerCase() === 'unknown') return 'unknown';

  if (rangeStr === '0' || rangeStr === '0 - 0' || key.endsWith('_score') || key.endsWith('_index')) {
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
        if (valueToEvaluate >= threshold * 1.3) return 'critical';
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
        if (valueToEvaluate <= threshold * 0.7) return 'critical';
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
    s.includes('sub-optimal') ||
    s.includes('suboptimal') ||
    s.includes('action zone') ||
    s.includes('borderline') ||
    s.includes('elevated') ||
    s.includes('overweight') ||
    s.includes('underweight') ||
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
    s.includes('sub-optimal') ||
    s.includes('suboptimal') ||
    s.includes('action zone') ||
    s.includes('borderline') ||
    s.includes('elevated') ||
    s.includes('overweight') ||
    s.includes('underweight') ||
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

export const getCustomStatusLabel = (key: string, value: number | string, customDef: any, profile?: any): string | null => {
  if (!customDef) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return null;

  const res = evaluateStructuredRange(num, customDef, profile);
  if (res) return res.label;

  if (customDef.structuredRanges && customDef.structuredRanges.length > 0) {
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


  // If there are range brackets, parse them to find the matching one
  const brackets = customDef.rangeBrackets;
  if (Array.isArray(brackets) && brackets.length > 0) {
    for (const br of brackets) {
      const rangeStr = String(br.range || '').toLowerCase();
      
      // Check `<` or `under`
      if (rangeStr.includes('<') || rangeStr.includes('under')) {
        const valMatch = rangeStr.match(/[\d.]+/);
        if (valMatch) {
          const limit = parseFloat(valMatch[0]);
          if (rangeStr.includes('=')) {
            if (num <= limit) return br.name;
          } else {
            if (num < limit) return br.name;
          }
        }
      }
      // Check `>` or `over`
      else if (rangeStr.includes('>') || rangeStr.includes('over')) {
        const valMatch = rangeStr.match(/[\d.]+/);
        if (valMatch) {
          const limit = parseFloat(valMatch[0]);
          if (rangeStr.includes('=')) {
            if (num >= limit) return br.name;
          } else {
            if (num > limit) return br.name;
          }
        }
      }
      // Check range `X - Y`
      else {
        const match = rangeStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
        if (match) {
          const min = parseFloat(match[1]);
          const max = parseFloat(match[2]);
          if (num >= min && num <= max) {
            return br.name;
          }
        }
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

export const getBiomarkerStatusLabel = (key: string, status: string, customDef?: any, userValue?: number | string, profile?: any): string => {
  if (status === 'flagged') return 'FLAGGED (Please Review Log)';
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef, profile);
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
  return label.replace(/\s*\(\s*(at risk|healthy|stage.*?)\s*\)/i, '').trim();
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

export function getDerivedCategoryDefaults(category: string, key?: string) {
  const cat = (category || '').toLowerCase();
  const k = (key || '').toLowerCase();
  
  let grouping = 'Other';
  let risks = ['Wellness'];
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
    risks = ['Wellness'];
    conditions = ['Systemic Inflammation', 'Cardiovascular Risk'];
  } else if (cat === 'thyroid' || cat === 'hormones') {
    grouping = 'Endocrinology';
    risks = ['Metabolic'];
    conditions = ['Hormonal Imbalance', 'Thyroid Dysfunction'];
  } else if (cat === 'vitamins') {
    grouping = 'Nutrition & Metabolism';
    risks = ['Wellness'];
    conditions = ['Vitamin Deficiency'];
  } else if (k === 'bmi' || k === 'weight' || k === 'height') {
    grouping = 'Biometrics';
    risks = ['Wellness'];
    conditions = ['Weight Management'];
  }

  return { grouping, risks, conditions };
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
  if (k.includes('rdw') || n.includes('rdw') || k.includes('hematocrit') || n.includes('hematocrit') || k.includes('hct') || n.includes('hct')) return '%';
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
  
  // Extract unit and range from logs if custom & builtIn don't have it
  let logUnit = '';
  let logRange = '';
  if (Array.isArray(itemLogs)) {
    for (const log of itemLogs) {
      if (log && typeof log === 'object') {
        const u = log.unit || (log.units && (log.units[key] || log.units[k]));
        if (u && typeof u === 'string' && u.trim()) {
          logUnit = u.trim();
        }
        const r = log.normalRange || (log.normalRanges && (log.normalRanges[key] || log.normalRanges[k]));
        if (r && typeof r === 'string' && r.trim()) {
          logRange = r.trim();
        }
        if (logUnit && logRange) break;
      }
    }
  }

  const name = (custom?.name && custom.name.trim() !== '') 
    ? custom.name.trim() 
    : (centralDef?.name || k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));

  const inferredUnit = inferUnitFromKeyOrName(k, name);

  const unit = (custom?.unit && custom.unit.trim() !== '')
    ? custom.unit.trim()
    : (logUnit || ((centralDef?.unit && centralDef.unit.trim() !== '') ? centralDef.unit : inferredUnit));

  const normalRange = (custom?.normalRange && custom.normalRange.trim() !== '' && custom.normalRange !== 'Unknown')
    ? custom.normalRange.trim()
    : (logRange || ((centralDef?.normalRange && centralDef.normalRange.trim() !== '' && centralDef.normalRange !== 'Unknown') ? centralDef.normalRange : ''));

  const defaults = getDerivedCategoryDefaults(centralDef?.category || '', k);

  const standardMedicalGrouping = (custom?.standardMedicalGrouping && custom.standardMedicalGrouping.trim() !== '' && custom.standardMedicalGrouping !== 'By Medical Practice')
    ? custom.standardMedicalGrouping
    : (centralDef?.standardMedicalGrouping && centralDef.standardMedicalGrouping !== 'Other' ? centralDef.standardMedicalGrouping : defaults.grouping);

  const riskCategories = (Array.isArray(custom?.riskCategories) && custom.riskCategories.length > 0 && !custom.riskCategories.includes('Uncategorized'))
    ? custom.riskCategories
    : (Array.isArray(centralDef?.riskCategories) && centralDef.riskCategories.length > 0 ? centralDef.riskCategories : defaults.risks);

  const potentialMedicalConditions = (Array.isArray(custom?.potentialMedicalConditions) && custom.potentialMedicalConditions.length > 0)
    ? custom.potentialMedicalConditions
    : (Array.isArray(centralDef?.potentialMedicalConditions) && centralDef.potentialMedicalConditions.length > 0 ? centralDef.potentialMedicalConditions : defaults.conditions);

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
  if (group.trim() === '' || group === 'Other') {
    group = defaults.grouping;
  }
  if (conditions.length === 0) {
    conditions = defaults.conditions;
  }

  return {
    riskCategories: risks,
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

export function isBiomarkerNeedingReview(
  key: string,
  profile: any,
  activeHistory?: any[],
  resolvedBiomarkers?: Record<string, any>,
  allDefinitions?: any[]
): boolean {
  if (!key) return false;
  // 1. Missing normal reference range
  if (isBiomarkerMissingRange(key, profile, activeHistory)) return true;
  // 2. Flagged by telemetry / scaling / unit notation errors or improbable values
  const flagged = detectFlaggedTelemetryErrors(
    resolvedBiomarkers || {},
    profile,
    activeHistory || [],
    allDefinitions || biomarkerDefinitions
  );
  if (flagged.some(f => f.key === key)) return true;
  return false;
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
      severity_rating: getBiomarkerStatusLabel(biomarkerKey, getBiomarkerStatus(biomarkerKey, currentValue, def.normalRange, def.unit, profile), customDef, currentValue, profile),
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
