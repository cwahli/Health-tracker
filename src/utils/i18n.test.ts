import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { diagnoseTelemetryIssue } from './biomarkers';

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

describe('scorecard REQUIRED_CHROME (cannot cheat via parity-only)', () => {
  const required = JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../golden/scorecard/instruction/i18n/REQUIRED_CHROME.json',
      ),
      'utf8',
    ),
  ) as { keys: string[]; loanwords_id_may_equal_en: string[] };

  function humanizeKey(key: string) {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase());
  }

  it('does not drop leak-class keys from the frozen list', () => {
    expect(required.keys).toContain('closeDialog');
    expect(required.keys).toContain('modalDialog');
    expect(required.keys).toContain('analyzingMeal');
  });

  it('keeps every frozen leftover-chrome key in en and id', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    const missing: string[] = [];
    for (const key of required.keys) {
      if (!en[key] || !id[key]) missing.push(key);
    }
    expect(missing, 'keys missing from en or id (parity cannot see keys absent from both)').toEqual([]);
  });

  it('does not leak raw keys or English-fill Indonesian chrome', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    const loan = new Set(required.loanwords_id_may_equal_en || []);
    const leak: string[] = [];
    const filled: string[] = [];
    const dump: string[] = [];
    for (const key of required.keys) {
      const ev = en[key];
      const iv = id[key];
      if (!ev || !iv) continue;
      if (ev === key || iv === key) leak.push(key);
      if (iv === ev && !loan.has(key)) filled.push(key);
      if (iv === humanizeKey(key)) dump.push(key);
    }
    expect(leak, 'LEAK_KEY: pack value equals the camelCase key').toEqual([]);
    expect(filled, 'id copy equals en (English-filled)').toEqual([]);
    expect(dump, 'id is Title-Case leftover of the key (TRANSLATION_DUMP)').toEqual([]);
  });
});

describe('L-2 seeded/demo chrome (Insights step cards + outlier preciseCause)', () => {
  // Sensor for the TRANSLATION_DUMP regression: pack values that are only the
  // Title-Case humanization of their key (in BOTH locales). It reached the pack
  // via 1c868ab (scratch_keys.json) and goes unseen because
  // REQUIRED_CHROME.json freezes 27 keys only.
  // Class size, evidence and restore plan: gemini38-meal-review/tasks/bakeoff/WAVE_C_REPORT.md
  const DUMP_RATCHET_MAX = 969; // measured 2026-09-15 after the Insights step* restore; must only shrink

  function humanizeKey(key: string) {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase());
  }

  // en copy that legitimately equals the Title-Case humanization of its key.
  // Shipped exactly like this in 85ce58b, so restore-not-invent keeps it.
  const EN_KEY_NAME_COPY_ALLOWED = new Set(['stepsCompleted']);

  // src/components/InsightsTab.tsx renders title/description/valueProposition for these cards.
  const L2_STEP_KEYS = [
    'stepAddHealthDataTitle', 'stepAddHealthDataDesc', 'stepAddHealthDataValue',
    'stepLabParserTitle', 'stepLabParserDesc', 'stepLabParserValue',
    'stepRangeCalibratorTitle', 'stepRangeCalibratorDesc', 'stepRangeCalibratorValue',
    'stepHealthCoachDesc', 'stepHealthCoachValue',
    'stepTestPlannerTitle', 'stepTestPlannerDesc', 'stepTestPlannerValue',
    'stepLiteratureTitle', 'stepLiteratureDesc', 'stepLiteratureValue',
    'stepDone', 'stepPending', 'stepToDo', 'stepToReview',
    'stepsCompleted', 'stepsLabel', 'stepsProgress',
  ] as const;

  it('keeps the Insights step cards in real EN + ID copy (no key-name leftovers)', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    for (const key of L2_STEP_KEYS) {
      expect(en[key], `en.${key} missing`).toBeTruthy();
      expect(id[key], `id.${key} missing`).toBeTruthy();
      if (!EN_KEY_NAME_COPY_ALLOWED.has(key)) {
        expect(en[key], `en.${key} is a Title-Case leftover of the key`).not.toBe(humanizeKey(key));
      }
      expect(id[key], `id.${key} is a Title-Case leftover of the key`).not.toBe(humanizeKey(key));
      expect(id[key], `id.${key} is English-filled`).not.toBe(en[key]);
    }
    expect(en.stepLiteratureTitle).toBe('Literature');
    expect(id.stepLiteratureTitle).toBe('Literatur Ilmiah');
    expect(id.stepsCompleted).toBe('Langkah Selesai');
  });

  it('follows profile.language in the outlier preciseCause (id / en / unset)', () => {
    const en = diagnoseTelemetryIssue('hematocrit', 'Hematocrit', 48, '%', '0.40 - 0.52', undefined, 'en');
    const id = diagnoseTelemetryIssue('hematocrit', 'Hematocrit', 48, '%', '0.40 - 0.52', undefined, 'id');
    const unset = diagnoseTelemetryIssue('hematocrit', 'Hematocrit', 48, '%', '0.40 - 0.52');
    expect(unset.preciseCause, 'unset profile.language falls back to English').toBe(en.preciseCause);
    expect(id.preciseCause).not.toBe(en.preciseCause);
    expect(en.preciseCause).toContain('percentage');
    expect(id.preciseCause, 'id outlier cause must be Indonesian, not English').toContain('persentase');
    expect(id.badgeLabel).toBe(t('id', 'outlierBadgeRatioPct'));
    expect(id.badgeLabel).not.toBe(t('en', 'outlierBadgeRatioPct'));
    expect(id.issueTitle).not.toBe(en.issueTitle);
  });

  it('ratchets TRANSLATION_DUMP leftovers so the class can only shrink', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    const leftovers = Object.keys(en).filter((key) => {
      if (!/[a-z0-9][A-Z]/.test(key)) return false;
      const human = humanizeKey(key);
      return en[key] === human && id[key] === human;
    });
    expect(leftovers.length, 'key-name-valued chrome — see WAVE_C_REPORT.md').toBeLessThanOrEqual(DUMP_RATCHET_MAX);
  });
});
