import { translations, type TranslationKey } from './translations';
import { nutrientDefinitions } from './nutrition';

export const SUPPORTED_LOCALES = ['en', 'id', 'fr', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Locales that must have every English key. Add a code here when a language is no longer English-fallback. */
export const REQUIRED_COMPLETE_LOCALES = ['en', 'id'] as const;
export type RequiredCompleteLocale = (typeof REQUIRED_COMPLETE_LOCALES)[number];

const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  id: 'Bahasa Indonesia',
  fr: 'French',
  zh: 'Chinese',
};

export function normalizeLocale(raw: unknown): SupportedLocale {
  const s = String(raw || '').trim().toLowerCase().replace('_', '-');
  if (s === 'id' || s.startsWith('id-')) return 'id';
  if (s === 'fr' || s.startsWith('fr-')) return 'fr';
  if (s === 'zh' || s.startsWith('zh-')) return 'zh';
  return 'en';
}

export function localeDisplayName(lang: unknown): string {
  return LOCALE_NAMES[normalizeLocale(lang)];
}

/** UI chrome: missing keys in a locale fall back to English. */
export function t(lang: unknown, key: TranslationKey): string {
  const locale = normalizeLocale(lang);
  const dict = translations[locale] as Partial<Record<TranslationKey, string>>;
  return dict[key] || translations.en[key] || String(key);
}

/** Same fallback as t(), for existing `const t = translations[lang]` call sites. */
export function dictionaryFor(lang: unknown) {
  const locale = normalizeLocale(lang);
  if (locale === 'en') return translations.en;
  return translations[locale];
}

/**
 * Prepend to agent system instructions. User-visible prose follows the UI language;
 * JSON keys, nutrient codes, biomarker keys, and enums stay English.
 */
export function agentOutputLanguageBlock(lang: unknown): string {
  const locale = normalizeLocale(lang);
  const name = localeDisplayName(locale);
  const lines = [
    '=== USER OUTPUT LANGUAGE ===',
    `The patient's UI language is ${name} (code: ${locale}).`,
    `Write every user-visible string you generate (verdicts, summaries, chat replies, dietitian lines, card titles, explanations, medicalInsight) in ${name}.`,
    'Keep JSON keys, nutrient codes, biomarker keys, enum values, and schema field names in English. User-visible nutrient labels must be in the UI language; never show raw keys like Saturated_fat to the patient.',
    'Keep numbers, units (g, kcal, mg/dL), and scientific abbreviations as-is.',
  ];
  if (locale !== 'en') {
    lines.push(`Do not reply in English unless the user wrote this turn in English and is clearly asking for English.`);
  }
  return lines.join('\n');
}

export function withAgentLanguage(instruction: string, lang: unknown): string {
  const block = agentOutputLanguageBlock(lang);
  if (!instruction) return block;
  return `${block}\n\n${instruction}`;
}

/** Scout JSON is for DB matching: keep food names as seen / culinary, not translated. */
export function scoutIdentityLanguageBlock(lang: unknown): string {
  const locale = normalizeLocale(lang);
  const name = localeDisplayName(locale);
  return [
    agentOutputLanguageBlock(locale),
    `Food identity fields (keyword, originalName, dish names, brand names) stay as observed on labels or common culinary names used for database matching. Do not translate food names into ${name}.`,
  ].join('\n');
}

export function withScoutLanguage(instruction: string, lang: unknown): string {
  const block = scoutIdentityLanguageBlock(lang);
  if (!instruction) return block;
  return `${block}\n\n${instruction}`;
}



export function interpolate(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  'flagged (please review log)': 'statusFlaggedReviewLog',
  'flagged (please review log).': 'statusFlaggedReviewLog',
  'flagged': 'statusFlaggedReviewLog',
  'low': 'low',
  'optimal': 'statusOptimal',
  'normal': 'normal',
  'normal weight': 'bmiNormalWeight',
  'medium': 'statusMedium',
  'high': 'high',
  'elevated': 'statusElevated',
  'critical': 'critical',
  'very low': 'statusVeryLow',
  'very high': 'statusVeryHigh',
  'underweight': 'statusUnderweight',
  'overweight': 'statusOverweight',
  'obese': 'statusObese',
  'at risk': 'statusAtRisk',
  'healthy': 'statusHealthy',
  'good': 'statusGood',
  'bad': 'statusBad',
  'no data': 'noData',
  'unknown': 'unknown',
  'on target': 'statusOnTarget',
  'no target': 'statusNoTarget',
  'target': 'target',
  '<10% over': 'statusLt10Over',
  '>10% over': 'statusGt10Over',
  '<10% under': 'statusLt10Under',
  '>10% under': 'statusGt10Under',
};

/** Translate a known English status/badge for display. Custom lab bracket names pass through. */
export function displayStatusLabel(lang: unknown, englishLabel: string | null | undefined): string {
  if (englishLabel === undefined || englishLabel === null) return '';
  const raw = String(englishLabel).trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.includes('flagged') && lower.includes('review')) {
    return t(lang, 'statusFlaggedReviewLog');
  }
  const key = STATUS_LABEL_KEYS[lower];
  if (key) return t(lang, key);
  return raw;
}

const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  Cardiovascular: 'riskCardiovascular',
  Metabolic: 'riskMetabolic',
  Liver: 'riskLiver',
  Kidney: 'riskKidney',
  Hematology: 'riskHematology',
  Immunological: 'riskImmunological',
  Endocrine: 'riskEndocrine',
  'Screenings & Wellness': 'riskScreeningsWellness',
  Hepatic: 'groupingHepatic',
  Renal: 'groupingRenal',
  Biometrics: 'groupingBiometrics',
  Other: 'groupingOther',
  'Screenings & Assessments': 'groupingScreeningsAssessments',
  Uncategorized: 'uncategorized',
  'General Health': 'generalHealth',
  all: 'categoryAll',
  All: 'categoryAll',
  'Biomarkers to Review': 'biomarkersToReview',
  'Unknown Range': 'unknown',
  metabolic: 'riskMetabolic',
  hepatic: 'groupingHepatic',
  renal: 'groupingRenal',
  hematology: 'riskHematology',
  biometrics: 'groupingBiometrics',
  other: 'groupingOther',
};

/** Translate Health-tab group headings. Internal category values stay English. */
export function displayCategoryLabel(lang: unknown, category: string | null | undefined): string {
  if (!category) return '';
  const key = CATEGORY_LABEL_KEYS[category] || CATEGORY_LABEL_KEYS[category.trim()];
  if (key) return t(lang, key);
  return category;
}

export const ETHNICITY_SELECT_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'Unknown', labelKey: 'unknown' },
  { value: 'Chinese', labelKey: 'ethnicityChineseEastAsian' },
  { value: 'Caucasian', labelKey: 'ethnicityCaucasian' },
  { value: 'South Asian', labelKey: 'ethnicitySouthAsian' },
  { value: 'African American', labelKey: 'ethnicityAfricanAmericanBlack' },
  { value: 'Hispanic', labelKey: 'ethnicityHispanicLatino' },
  { value: 'Southeast Asian', labelKey: 'ethnicitySoutheastAsian' },
  { value: 'Other', labelKey: 'ethnicityMixedOther' },
];

export function displayEthnicityOption(lang: unknown, storedValue: string | null | undefined): string {
  if (!storedValue) return t(lang, 'unknown');
  const match = ETHNICITY_SELECT_OPTIONS.find((o) => o.value === storedValue);
  if (match) return t(lang, match.labelKey);
  if (String(storedValue).toLowerCase() === 'unknown') return t(lang, 'unknown');
  return storedValue;
}

/** Nutrient chrome labels. Codes stay English; short form is for dense chips (Sat Fat). */
export function displayNutrientName(lang: unknown, nutrientKey: string, opts?: { short?: boolean }): string {
  const locale = normalizeLocale(lang);
  if (opts?.short) {
    if (nutrientKey === 'calories') return t(locale, 'caloriesLabel');
    if (nutrientKey === 'saturatedFat') return t(locale, 'satFatLabel');
    if (nutrientKey === 'sodium') return t(locale, 'sodiumLabel');
  }
  const nut = nutrientDefinitions.find((n) => n.key === nutrientKey);
  if (nut) return nut.labels[locale] || nut.labels.en;
  return nutrientKey.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

const CLINICAL_TYPE_KEYS: Record<string, TranslationKey> = {
  'Clinical Test': 'clinicalTypeClinicalTest',
  'Physician Consultation': 'clinicalTypePhysicianConsultation',
};

/** Translate clinical-action TYPE chrome. Seeded test names pass through. */
export function displayClinicalType(lang: unknown, englishName: string | null | undefined): string {
  if (!englishName) return '';
  const key = CLINICAL_TYPE_KEYS[englishName] || CLINICAL_TYPE_KEYS[englishName.trim()];
  if (key) return t(lang, key);
  return englishName;
}

/** Translate "in 3-6 months" / "in N months" timing chrome. Other tags pass through. */
export function displayTimeTag(lang: unknown, englishLabel: string | null | undefined): string {
  if (!englishLabel) return '';
  const raw = String(englishLabel).trim();
  const range = raw.match(/^in (\d+)-(\d+) months$/i);
  if (range) return interpolate(t(lang, 'inMonthsRange'), { min: range[1], max: range[2] });
  const single = raw.match(/^in (\d+) months?$/i);
  if (single) return interpolate(t(lang, 'inMonths'), { n: single[1] });
  return raw;
}

const ISSUE_CHROME_PREFIXES: [string, TranslationKey][] = [
  ['Outlier:', 'outlierColon'],
  ['Current:', 'currentColon'],
  ['Unit:', 'unitColon'],
];

/** Localize issue-card chrome prefixes; keep numeric / generated tails. */
export function displayIssueChrome(lang: unknown, text: string | null | undefined): string {
  if (!text) return '';
  const raw = String(text);
  for (const [en, key] of ISSUE_CHROME_PREFIXES) {
    if (raw.startsWith(en)) {
      return t(lang, key) + raw.slice(en.length);
    }
  }
  return raw;
}

export function displayAccountType(lang: unknown, userType: string | null | undefined): string {
  const raw = String(userType || '').trim().toLowerCase();
  if (raw === 'demo') return t(lang, 'accountTypeDemo');
  if (raw === 'admin') return t(lang, 'accountTypeAdmin');
  return t(lang, 'accountTypeStandard');
}

/** Indonesian display labels for the biomarker catalog. Stored keys stay English. */
const BIOMARKER_NAME_ID: Record<string, string> = {
  hba1c: 'HbA1c',
  fasting_glucose: 'Glukosa Puasa',
  insulin: 'Insulin Puasa',
  ldl: 'LDL-C',
  apob: 'ApoB',
  total_cholesterol: 'Kolesterol Total',
  hdl: 'HDL-C',
  triglycerides: 'Trigliserida',
  egfr: 'eGFR',
  bun: 'BUN (Nitrogen Urea Darah)',
  rbc: 'Sel Darah Merah (RBC)',
  platelets: 'Trombosit',
  hscrp: 'hs-CRP',
  testosterone: 'Testosteron (Total)',
  vitamin_d: 'Vitamin D (25-OH)',
  vitamin_b12: 'Vitamin B12',
  bmi: 'Indeks Massa Tubuh (BMI)',
  creatinine: 'Kreatinin',
  hematocrit: 'Hematokrit',
  hemoglobin: 'Hemoglobin',
  mean_corpuscular_hemoglobin: 'Hemoglobin Korpuskular Rata-rata (MCH)',
  mean_corpuscular_volume: 'Volume Korpuskular Rata-rata (MCV)',
  mean_corpuscular_hemoglobin_concentration: 'Konsentrasi Hemoglobin Korpuskular Rata-rata (MCHC)',
  rdw: 'Lebar Distribusi Sel Darah Merah (RDW)',
  serum_albumin: 'Albumin Serum',
  total_protein: 'Protein Total',
  audit_total_score: 'Skor Total AUDIT',
  wbc: 'Sel Darah Putih (WBC)',
  neutrophil_count: 'Neutrofil',
  lymphocyte_count: 'Limfosit',
  monocyte_count: 'Hitung Monosit',
  eosinophil_count: 'Eosinofil',
  basophil_count: 'Basofil',
  alt: 'ALT (SGPT)',
  ast: 'AST (SGOT)',
  steps: 'Langkah Harian',
  weight: 'Berat Badan',
  hemorrhoidal_symptom_score: 'Skor Gejala Penyakit Hemoroid (HDSS)',
  gerd_symptom_score: 'Skor Gejala Refluks Gastroesofagus (GERD-SS)',
  joint_pain_severity_score: 'Skor Keparahan Nyeri Sendi',
  blood_pressure: 'Tekanan Darah',
  systolic_blood_pressure: 'Tekanan Darah Sistolik',
  diastolic_blood_pressure: 'Tekanan Darah Diastolik',
  audit_c_total_score: 'Skor Konsumsi Alkohol AUDIT-C',
  ideal_body_weight: 'Berat Badan Ideal (Target)',
  apoa1: 'ApoA1',
  gamma_gt: 'Gamma GT (GGT)',
  mpv: 'Volume Trombosit Rata-rata (MPV)',
  qrisk2: 'QRISK2 Risiko Kardiovaskular 10-Tahun',
  audit_score: 'Skor AUDIT (Total)',
  audit_score_frequency_drinking: 'Skor Frekuensi Minum AUDIT',
  audit_binge_drinking_score: 'Skor Minum Berlebihan AUDIT',
  audit_score_typical_day_units: 'Skor Unit Tipikal AUDIT',
  qdiabetes: 'Skor Risiko QDiabetes 10-Tahun',
  fast_alcohol_score: 'Skor Alkohol FAST',
  weekly_alcohol_consumption: 'Konsumsi Alkohol Mingguan',
};

/** Indonesian display labels for medical-condition names. Stored values stay English. */
const CONDITION_NAME_ID: Record<string, string> = {
  Diabetes: 'Diabetes',
  'Metabolic Syndrome': 'Sindrom Metabolik',
  'Insulin Resistance': 'Resistensi Insulin',
  Dyslipidemia: 'Dislipidemia',
  'Cardiovascular Disease Risk': 'Risiko Penyakit Kardiovaskular',
  'Liver Dysfunction': 'Gangguan Hati',
  'Fatty Liver': 'Hati Berlemak',
  'Kidney Dysfunction': 'Gangguan Ginjal',
  'Chronic Kidney Disease': 'Penyakit Ginjal Kronis',
  Anemia: 'Anemia',
  Infection: 'Infeksi',
  'Blood Disorder': 'Kelainan Darah',
  'Systemic Inflammation': 'Peradangan Sistemik',
  'Cardiovascular Risk': 'Risiko Kardiovaskular',
  'Hormonal Imbalance': 'Ketidakseimbangan Hormon',
  'Thyroid Dysfunction': 'Gangguan Tiroid',
  'Vitamin Deficiency': 'Defisiensi Vitamin',
  'Weight Management': 'Pengelolaan Berat Badan',
};

/** Translate a biomarker catalog display name. Catalog keys and custom names pass through for other locales. */
export function displayBiomarkerName(lang: unknown, key: string | null | undefined, fallbackName?: string | null): string {
  if (!key) return fallbackName || '';
  if (normalizeLocale(lang) === 'id') return BIOMARKER_NAME_ID[key] || BIOMARKER_NAME_ID[String(key).trim()] || fallbackName || String(key);
  return fallbackName || String(key);
}

/** Translate a medical-condition display name. Stored condition strings stay English. */
export function displayConditionName(lang: unknown, name: string | null | undefined): string {
  if (!name) return '';
  if (normalizeLocale(lang) === 'id') return CONDITION_NAME_ID[name] || CONDITION_NAME_ID[String(name).trim()] || String(name);
  return String(name);
}
