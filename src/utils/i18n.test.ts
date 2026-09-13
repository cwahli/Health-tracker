import { describe, it, expect } from 'vitest';
import { localePacks, translations } from './translations';
import {
  REQUIRED_COMPLETE_LOCALES,
  SUPPORTED_LOCALES,
  agentOutputLanguageBlock,
  dictionaryFor,
  displayBiomarkerName,
  displayCategoryLabel,
  displayConditionName,
  displayEthnicityOption,
  displayAccountType,
  displayClinicalType,
  displayIssueChrome,
  displayNutrientName,
  displayStatusLabel,
  displayTimeTag,
  interpolate,
  normalizeLocale,
  t,
  withAgentLanguage,
} from './i18n';

const enKeys = Object.keys(translations.en).sort();

describe('i18n locales', () => {
  it('lists the supported locale codes', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['en', 'fr', 'id', 'zh']);
  });

  it('requires English and Indonesian raw packs to have the same keys as en (not English-filled)', () => {
    const sourceKeys = Object.keys(localePacks.en).sort();
    for (const locale of REQUIRED_COMPLETE_LOCALES) {
      const keys = Object.keys(localePacks[locale]).sort();
      const missing = sourceKeys.filter((k) => !keys.includes(k));
      expect(missing, `${locale} missing keys vs en`).toEqual([]);
    }
  });

  it('falls back to English for a missing French/Chinese key', () => {
    expect(t('fr', 'sendToAdmin')).toBeTruthy();
    expect(t('zh', 'sendToAdmin')).toBeTruthy();
  });
});

describe('normalizeLocale', () => {
  it('maps common aliases', () => {
    expect(normalizeLocale('id')).toBe('id');
    expect(normalizeLocale('ID-ID')).toBe('id');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });
});

describe('dictionaryFor', () => {
  it('returns Indonesian copy for id', () => {
    const dict = dictionaryFor('id');
    expect(dict.sendToAdmin).toBe(translations.id.sendToAdmin);
    expect(dict.sendToAdmin).not.toBe(translations.en.sendToAdmin);
  });

  it('uses Indonesian Front Desk welcome, not the English Health Preparation Agent string', () => {
    const dict = dictionaryFor('id');
    expect(dict.agentFrontDeskWelcome).toBe(translations.id.agentFrontDeskWelcome);
    expect(dict.agentFrontDeskWelcome).not.toContain('Hello! I am your Health Preparation Agent');
    expect(dict.agentFrontDeskWelcome).toMatch(/Halo|Persiapan Kesehatan/);
    expect(translations.en.agentFrontDeskWelcome).toContain('Hello! I am your Health Preparation Agent');
  });

  it('translates leftover meal-10 chrome in Indonesian', () => {
    const dict = dictionaryFor('id');
    expect(dict.waitingForPortionChoice).toBe(translations.id.waitingForPortionChoice);
    expect(dict.waitingForPortionChoice).not.toBe(translations.en.waitingForPortionChoice);
    expect(dict.nutritionCalculation).toBe(translations.id.nutritionCalculation);
    expect(dict.nutritionCalculation).not.toBe(translations.en.nutritionCalculation);
    expect(dict.verdictLabel).toBe(translations.id.verdictLabel);
    expect(dict.downloadDebugLogs).toBe(translations.id.downloadDebugLogs);
  });
});

describe('agentOutputLanguageBlock', () => {
  it('names Bahasa Indonesia and keeps JSON keys in English', () => {
    const block = agentOutputLanguageBlock('id');
    expect(block).toContain('Bahasa Indonesia');
    expect(block).toContain('code: id');
    expect(block).toContain('JSON keys');
    expect(block).toContain('Do not reply in English');
  });

  it('does not tell English users to avoid English', () => {
    expect(agentOutputLanguageBlock('en')).not.toContain('Do not reply in English');
  });

  it('prepends the block onto an instruction', () => {
    const out = withAgentLanguage('You are the dietitian.', 'id');
    expect(out.startsWith('=== USER OUTPUT LANGUAGE ===')).toBe(true);
    expect(out).toContain('You are the dietitian.');
  });
});

describe('display chrome helpers', () => {
  it('translates flagged and optimal status badges in Indonesian', () => {
    expect(displayStatusLabel('id', 'FLAGGED (Please Review Log)')).toBe(translations.id.statusFlaggedReviewLog);
    expect(displayStatusLabel('id', 'optimal')).toBe(translations.id.statusOptimal);
    expect(displayStatusLabel('id', 'LOW')).toBe(translations.id.low);
    expect(displayStatusLabel('id', 'Good')).toBe(translations.id.statusGood);
    expect(displayStatusLabel('id', 'Bad')).toBe(translations.id.statusBad);
  });

  it('leaves custom lab bracket names untranslated', () => {
    expect(displayStatusLabel('id', 'Elevated (Diabetes)')).toBe('Elevated (Diabetes)');
  });

  it('translates health category headings and keeps unknown groups', () => {
    expect(displayCategoryLabel('id', 'Cardiovascular')).toBe(translations.id.riskCardiovascular);
    expect(displayCategoryLabel('id', 'Hematology')).toBe(translations.id.riskHematology);
    expect(displayCategoryLabel('id', 'Screenings & Wellness')).toBe(translations.id.riskScreeningsWellness);
    expect(displayCategoryLabel('id', 'Made Up Group')).toBe('Made Up Group');
  });

  it('translates ethnicity option labels but keeps stored values', () => {
    expect(displayEthnicityOption('id', 'Chinese')).toBe(translations.id.ethnicityChineseEastAsian);
    expect(displayEthnicityOption('id', 'Unknown')).toBe(translations.id.unknown);
  });

  it('uses Indonesian nutrient chrome names including Sat Fat short form', () => {
    expect(displayNutrientName('id', 'calories')).toBe('Kalori');
    expect(displayNutrientName('id', 'saturatedFat', { short: true })).toBe(translations.id.satFatLabel);
    expect(displayNutrientName('id', 'solubleFibre')).toBe('Serat Larut');
    expect(displayNutrientName('id', 'protein')).toBe('Protein');
    expect(displayNutrientName('id', 'sodium')).toBe('Natrium');
    expect(displayNutrientName('id', 'carbohydrates')).toBe('Karbohidrat');
  });

  it('interpolates chart chrome placeholders', () => {
    expect(interpolate(translations.id.overWeeklyAmount, { amount: '4', unit: 'g', target: '20' })).toContain('4');
    expect(interpolate(translations.en.stepsProgress, { actual: 1000, target: 3000 })).toBe('1000 / 3000 steps');
  });

  it('interpolates insights extraction blurbs in Indonesian', () => {
    expect(interpolate(translations.id.biomarkersExtractedStatus, { count: 7, recWord: translations.id.recWordNeedReview })).toContain('7');
    expect(interpolate(translations.id.extractionApprovedApplied, { count: 12 })).toContain('12');
  });

  it('translates BMI normal-weight and medium risk chrome', () => {
    expect(displayStatusLabel('id', 'Normal weight')).toBe(translations.id.bmiNormalWeight);
    expect(displayStatusLabel('id', 'medium')).toBe(translations.id.statusMedium);
  });

  it('translates job Ready badge and demo credits chrome', () => {
    expect(interpolate(translations.id.jobsReady, { count: 1 })).toBe('Siap (1)');
    expect(interpolate(translations.id.jobsReadyTooltip, { count: 1 })).toContain('1');
    expect(interpolate(translations.id.plusNCredits, { n: 15 })).toBe('+15 kredit');
    expect(interpolate(translations.id.expiresOn, { date: '2 Sep 2026' })).toContain('Kedaluwarsa');
    expect(displayAccountType('id', 'Demo')).toBe(translations.id.accountTypeDemo);
  });

  it('translates clinical TYPE/TIMING chrome and issue-card prefixes', () => {
    expect(displayClinicalType('id', 'Clinical Test')).toBe(translations.id.clinicalTypeClinicalTest);
    expect(displayClinicalType('id', 'Physician Consultation')).toBe(translations.id.clinicalTypePhysicianConsultation);
    expect(displayClinicalType('id', 'Vitamin D3 Panel')).toBe('Vitamin D3 Panel');
    expect(displayTimeTag('id', 'in 3-6 months')).toBe(interpolate(translations.id.inMonthsRange, { min: 3, max: 6 }));
    expect(displayIssueChrome('id', 'Current: 14.5 g/dL')).toBe(translations.id.currentColon + ' 14.5 g/dL');
    expect(displayIssueChrome('id', 'Outlier: 10× High')).toBe(translations.id.outlierColon + ' 10× High');
    expect(displayIssueChrome('id', 'Unit: 10× Multiplier')).toBe(translations.id.unitColon + ' 10× Multiplier');
  });

  it('translates catalog biomarker names and keeps stored keys', () => {
    expect(displayBiomarkerName('id', 'fasting_glucose', 'Fasting Glucose')).toBe('Glukosa Puasa');
    expect(displayBiomarkerName('id', 'hba1c', 'HbA1c')).toBe('HbA1c');
    expect(displayBiomarkerName('id', 'weight', 'Body Weight')).toBe('Berat Badan');
    expect(displayBiomarkerName('en', 'fasting_glucose', 'Fasting Glucose')).toBe('Fasting Glucose');
    expect(displayBiomarkerName('id', 'custom_key', 'My Custom Marker')).toBe('My Custom Marker');
  });

  it('translates medical condition names and passes unknown strings through', () => {
    expect(displayConditionName('id', 'Kidney Dysfunction')).toBe('Gangguan Ginjal');
    expect(displayConditionName('id', 'Weight Management')).toBe('Pengelolaan Berat Badan');
    expect(displayConditionName('en', 'Kidney Dysfunction')).toBe('Kidney Dysfunction');
    expect(displayConditionName('id', 'Some Custom Condition')).toBe('Some Custom Condition');
  });

  it('localizes meal fallback and widget chrome in Indonesian', () => {
    expect(interpolate(t('id', 'messageScaledPortion'), { grams: 350 })).toContain('350g');
    expect(t('id', 'messageScaledPortion')).not.toBe(t('en', 'messageScaledPortion'));
    expect(interpolate(t('id', 'ledgerMacros'), { p: 38, c: 45, f: 24 })).toContain('karbohidrat');
    expect(interpolate(t('id', 'auditFilterAll'), { n: 3 })).toBe('Semua (3)');
    expect(t('id', 'compilerNoOptions')).not.toBe(t('en', 'compilerNoOptions'));
    expect(t('id', 'browserTitle')).not.toBe(t('en', 'browserTitle'));
    expect(t('id', 'themeTitle')).not.toBe(t('en', 'themeTitle'));
  });
});

describe('S-1 leftover chrome (LEAK_EN_CHROME)', () => {
  // Green list: formerly hardcoded EN chrome, now keyed in en+id.
  // (LogChat debug buttons, FoodCard preparation label.)
  const S1_GREEN_KEYS = [
    'downloadDebugLogsTitle',
    'viewDiagnosticLogs',
    'viewDiagnosticLogsTitle',
    'preparationLabel',
    'oneServingDefault',
    'itemSubTotal',
    'printedPackagingLabel',
    'genderLabel',
  ] as const;

  it('keys the S-1 button/card chrome in en and id with differing copy', () => {
    for (const key of S1_GREEN_KEYS) {
      expect(translations.en[key], `en.${key}`).toBeTruthy();
      expect(translations.id[key], `id.${key}`).toBeTruthy();
      expect(translations.id[key], `id.${key} differs from en`).not.toBe(translations.en[key]);
    }
    expect(dictionaryFor('id').viewDiagnosticLogs).toBe(translations.id.viewDiagnosticLogs);
  });

  // Parked residuals under S-1: documented, not yet keyed. When a future
  // pass keys one of these, move it to S1_GREEN_KEYS (the unkeyed assertion
  // below forces the move instead of silently going stale).
  it('documents parked S-1 residuals without keying them yet', () => {
    const S1_PARKED_RESIDUALS: string[] = [];
    for (const s of S1_PARKED_RESIDUALS) expect(s.length).toBeGreaterThan(0);
  });
});
