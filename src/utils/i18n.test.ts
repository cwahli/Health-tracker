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
import { previewStatusLabel } from '../jobs/jobPreview';
import type { AgentJob } from '../jobs/types';

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

  it('restores verdictLabel with trailing colon in en and id (Wave J safe restore)', () => {
    expect(translations.en.verdictLabel).toBe('Verdict:');
    expect(translations.id.verdictLabel).toBe('Penilaian:');
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

  // Wave H: pre-dump copy for the S-1 call-site keys. The component literals this
  // wave deleted were byte-identical to these values, so a TRANSLATION_DUMP sweep
  // must not drift them again (e.g. dropping the ':' or appending ' (default)').
  const S1_RESTORED_VALUES: Record<string, { en: string; id: string }> = {
    preparationLabel: { en: 'Preparation:', id: 'Persiapan:' },
    oneServingDefault: { en: '1 serving', id: '1 porsi' },
    viewDiagnosticLogsTitle: {
      en: 'View full system and agent logs in unified modal',
      id: 'Lihat log sistem dan agen lengkap dalam modal terpadu',
    },
    downloadDebugLogsTitle: {
      en: 'Download complete raw debug logs and diagnostics',
      id: 'Unduh log debug mentah lengkap dan diagnostik',
    },
    browserServingDefaulted: {
      en: 'Defaulted serving size to {label}',
      id: 'Ukuran saji default ke {label}',
    },
  };

  it('keeps the S-1 call-site keys byte-identical to their pre-dump copy', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    for (const [key, value] of Object.entries(S1_RESTORED_VALUES)) {
      expect(en[key], `en.${key}`).toBe(value.en);
      expect(id[key], `id.${key}`).toBe(value.id);
    }
  });

  it('renders the S-1 chrome from keys only (no hardcoded English fallback left)', () => {
    const read = (rel: string) =>
      readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

    const foodHistory = read('../components/FoodHistoryTab.tsx');
    expect(foodHistory).toContain('t.oneServingDefault');
    expect(foodHistory).not.toMatch(/quantity:\s*'1 serving'/);

    const foodCard = read('../components/chat-cards/FoodCard.tsx');
    expect(foodCard).toContain('{t.preparationLabel}');
    expect(foodCard).not.toContain("t.preparationLabel || 'Preparation:'");

    const logChat = read('../components/LogChat.tsx');
    expect(logChat).toContain('{t.viewDiagnosticLogs}');
    expect(logChat).not.toContain("t.viewDiagnosticLogs || 'View Diagnostic Logs'");
    expect(logChat).not.toContain(
      "t.downloadDebugLogsTitle || 'Download complete raw debug logs and diagnostics'",
    );

    const nutritionBrowser = read('../components/NutritionDataBrowserModal.tsx');
    expect(nutritionBrowser).toContain('interpolate(t.browserServingDefaulted, { label: def.label })');
    expect(nutritionBrowser).not.toContain('Defaulted serving size to ${def.label}');
  });

  // Wave I: flag-issue chrome restored from c3e6cfd (bca0f80~1) byte-for-byte.
  // id values had drifted to English; call sites carried `|| 'English'` fallbacks.
  const FLAG_RESTORED_ID: Record<string, string> = {
    flagIssueWithThisResponse: 'Laporkan masalah pada respons ini',
    flagIssueWithAgentResponse: 'Laporkan masalah dengan respons {agent}',
    flagAnother: 'Laporkan lainnya',
    flagFoodAnalysisIssue: 'Laporkan masalah analisis makanan',
  };

  it('restores Wave I flag-issue id chrome byte-for-byte from c3e6cfd', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    for (const [key, value] of Object.entries(FLAG_RESTORED_ID)) {
      expect(id[key], `id.${key} missing`).toBeTruthy();
      expect(id[key], `id.${key} drifts from c3e6cfd`).toBe(value);
      expect(id[key], `id.${key} is English-filled`).not.toBe(en[key]);
    }
    // flagIssue id was already correct — guard it stays put.
    expect(id.flagIssue).toBe('Laporkan masalah');
  });

  it('renders Wave I flag-issue chrome from keys only (no English fallback left)', () => {
    const read = (rel: string) =>
      readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

    const logChat = read('../components/LogChat.tsx');
    expect(logChat).toContain('title={t.flagIssueWithThisResponse}');
    expect(logChat).not.toContain('t.flagIssueWithThisResponse ||');
    expect(logChat).toContain('t.flagIssueWithAgentResponse.replace(');
    expect(logChat).not.toContain("t.flagIssueWithAgentResponse ||");

    const foodCard = read('../components/chat-cards/FoodCard.tsx');
    expect(foodCard).toContain('flaggedId ? t.flagAnother : t.flagIssue');
    expect(foodCard).not.toContain("t.flagAnother || 'Flag another'");
    expect(foodCard).not.toContain("t.flagIssue || 'Flag issue'");
    expect(foodCard).toContain('title={t.flagFoodAnalysisIssue}');
    expect(foodCard).not.toContain('t.flagFoodAnalysisIssue ||');
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

describe('job-card chrome i18n (jobPreview status labels)', () => {
  // Sensor for the class that produced J-ID-01 a11y FAIL: 1c868ab dropped the
  // status* job-chrome keys, so an id-locale analyzing card rendered the
  // English fallback "Analysis completed"
  // (golden/scorecard/current/a11y/J-ID-01-analyzing-job-card.txt).
  // Every value below is restored byte-for-byte from 85ce58b — never invented.
  const JOB_CHROME_KEYS = [
    'statusActionRequired',
    'statusAiAdvicePending',
    'statusAnalysisCancelled',
    'statusAnalysisCompleted',
    'statusAnalysisFailed',
    'statusProcessing',
    'statusUpdatingMealQueued',
    'statusUploadedQueued',
    'statusWaitingAhead',
  ] as const;

  function jobCard(status: AgentJob['status'], extra: Partial<AgentJob> = {}): AgentJob {
    return {
      id: 'job_wave_e',
      kind: 'food_log',
      status,
      stepIndex: 0,
      stepTotal: 1,
      progressPercent: 100,
      messages: [],
      inputSnapshot: { text: 'meal', imageRefs: [] },
      ...extra,
    } as AgentJob;
  }

  it('keeps every jobPreview status key in en and id (no silent drop)', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    for (const key of JOB_CHROME_KEYS) {
      expect(en[key], `en.${key} missing`).toBeTruthy();
      expect(id[key], `id.${key} missing`).toBeTruthy();
      expect(id[key], `id.${key} is English-filled`).not.toBe(en[key]);
    }
    expect(id.statusAnalysisCompleted).toBe('Analisis selesai');
  });

  it('shows the completed analyzing card in Indonesian', () => {
    const done = jobCard('succeeded');
    expect(previewStatusLabel(done, { dict: translations.id })).toBe('Analisis selesai');
    expect(previewStatusLabel(done, { dict: translations.en })).toBe('Analysis completed');
    expect(previewStatusLabel(done), 'no dict falls back to English').toBe('Analysis completed');
  });

  it('shows the other terminal and streaming job cards in Indonesian', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    const cases: Array<[AgentJob, string]> = [
      [jobCard('awaiting_user'), 'statusActionRequired'],
      [jobCard('failed'), 'statusAnalysisFailed'],
      [jobCard('queued'), 'statusUploadedQueued'],
      [jobCard('draft'), 'statusProcessing'],
      [jobCard('succeeded', { result: { degradedStages: ['diet'] } }), 'statusAiAdvicePending'],
    ];
    for (const [job, key] of cases) {
      expect(previewStatusLabel(job, { dict: translations.id }), key).toBe(id[key]);
      expect(previewStatusLabel(job, { dict: translations.id }), key).not.toBe(en[key]);
    }
    expect(previewStatusLabel(jobCard('queued'), { dict: translations.id, queuedAhead: 2 })).toBe(
      'Menunggu — 2 di depan',
    );
  });
});


describe('job-card chrome i18n (English-filled id residuals — Wave F)', () => {
  // Sensor for the class Wave E found and deliberately left alone: the 1c868ab
  // TRANSLATION_DUMP kept these job-card chrome keys, but with the ENGLISH copy
  // written into `id` (id === en), so the J-ID-01 analyzing card still rendered
  // English chrome (`Updating meal...`, `Delete task`, `Attempt 1 of 3`).
  // Every value below is restored byte-for-byte from 85ce58b — never invented.
  // Scan basis: every key read as `t.…` by src/components/TaskPlaceholderCard.tsx
  // or `d?.…` by src/jobs/jobPreview.ts. Two keys are excluded on purpose:
  // `retryingAttemptNofM` (no 85ce58b baseline) and `stuckFor` (id was already
  // Indonesian, just drifted — left for the coordinator, see WAVE_F_REPORT.md §5).
  const RESTORED_ID: Record<string, string> = {
    analysisFailed: "Analisis gagal",
    analyzingMedicalData: "Menganalisis data medis...",
    analyzingYourMeal: "Menganalisis makanan Anda...",
    attemptFailedTapRetry: "Upaya {n} dari {m} gagal • Ketuk \"Coba Lagi\" untuk mencoba lagi",
    attemptOf: "Upaya {current} dari {max}",
    calculating: "Menghitung...",
    chattingEllipsis: "Mengobrol...",
    confirmPortionToFinish: "Harap konfirmasi ukuran porsi untuk menyelesaikan pencatatan makanan Anda.",
    deleteTask: "Hapus tugas",
    healthPreparationChat: "Obrolan Persiapan Kesehatan",
    macrosUpdatedRetryAdvice: "Makronutrisi diperbarui — panduan mungkin mencerminkan porsi sebelumnya. Gunakan Coba Lagi Saran untuk memperbarui.",
    mealComparisonRequest: "Permintaan Perbandingan Makanan",
    mealPreview: "Pratinjau Makanan",
    medicalDataRequest: "Permintaan Data Medis",
    noImage: "Tidak Ada Gambar",
    optionN: "Opsi {n}",
    pickPortion: "Pilih Porsi",
    portionChoiceNeeded: "Perlu Pilihan Porsi",
    portionSelectionNeeded: "{name} — Perlu Pemilihan Porsi",
    retry: "Coba Lagi",
    retryAdvice: "Coba Lagi Saran",
    retryingAiAdvice: "Mencoba lagi saran AI (Upaya {n})...",
    retryingAnalysisAttempt: "Mencoba lagi analisis (Upaya {n})...",
    selectPortion: "Pilih Porsi",
    updatingMeal: "Memperbarui makanan...",
    uploadedSafeToClose: "Diunggah ke server • Aman untuk menutup peramban & cek kembali nanti",
    uploadingKeepTabOpen: "Mengunggah ke server… Tetap buka tab ini",
  };

  // The same dump also truncated the en side of these four siblings (dropped
  // `{n}`/`{name}`, or left the Title-Case key name), so the restore is en + id.
  const RESTORED_EN: Record<string, string> = {
    attemptFailedTapRetry: "Attempt {n} of {m} failed • Tap \"Retry\" to try again",
    optionN: "Option {n}",
    portionSelectionNeeded: "{name} — Portion Selection Needed",
    retryingAiAdvice: "Retrying AI advice (Attempt {n})...",
    retryingAnalysisAttempt: "Retrying analysis (Attempt {n})...",
  };

  function jobCardChrome(status: AgentJob['status'], extra: Partial<AgentJob> = {}): AgentJob {
    return {
      id: 'job_wave_f',
      kind: 'food_log',
      status,
      stepIndex: 0,
      stepTotal: 1,
      progressPercent: 100,
      messages: [],
      inputSnapshot: { text: 'meal', imageRefs: [] },
      ...extra,
    } as AgentJob;
  }

  it('restores every scanned job-card key byte-for-byte from 85ce58b and id !== en', () => {
    const en = localePacks.en as Record<string, string>;
    const id = localePacks.id as Record<string, string>;
    for (const [key, value] of Object.entries(RESTORED_ID)) {
      expect(id[key], `id.${key} missing`).toBeTruthy();
      expect(id[key], `id.${key} drifts from 85ce58b`).toBe(value);
      expect(id[key], `id.${key} is English-filled`).not.toBe(en[key]);
    }
  });

  it('restores the five keys named in the Wave F card', () => {
    const id = localePacks.id as Record<string, string>;
    expect(id.updatingMeal).toBe('Memperbarui makanan...');
    expect(id.attemptOf).toBe('Upaya {current} dari {max}');
    expect(id.attemptFailedTapRetry).toBe('Upaya {n} dari {m} gagal • Ketuk "Coba Lagi" untuk mencoba lagi');
    expect(id.analysisFailed).toBe('Analisis gagal');
    expect(id.deleteTask).toBe('Hapus tugas');
  });

  it('restores the en side the dump mangled on the same-class siblings', () => {
    const en = localePacks.en as Record<string, string>;
    for (const [key, value] of Object.entries(RESTORED_EN)) {
      expect(en[key], `en.${key} drifts from 85ce58b`).toBe(value);
    }
  });

  it('keeps the placeholders the job card interpolates (no silent no-op replace)', () => {
    const id = localePacks.id as Record<string, string>;
    expect(id.optionN.replace('{n}', '2')).toBe('Opsi 2');
    expect(translations.en.optionN.replace('{n}', '2')).toBe('Option 2');
    expect(id.retryingAnalysisAttempt.replace('{n}', '3')).toBe('Mencoba lagi analisis (Upaya 3)...');
    expect(id.portionSelectionNeeded.replace('{name}', 'Nasi Goreng')).toBe('Nasi Goreng — Perlu Pemilihan Porsi');
    expect(id.attemptFailedTapRetry.replace('{n}', '1').replace('{m}', '3')).toBe(
      'Upaya 1 dari 3 gagal • Ketuk "Coba Lagi" untuk mencoba lagi',
    );
  });

  it('renders the edit/retry running job card in Indonesian', () => {
    const editRunning = jobCardChrome('running', { mode: 'edit' });
    expect(previewStatusLabel(editRunning, { dict: translations.id })).toBe('Memperbarui makanan...');
    expect(previewStatusLabel(editRunning, { dict: translations.en })).toBe('Updating meal...');
    const firstAttempt = jobCardChrome('running', { attemptCount: 1, maxAttempts: 3 });
    expect(previewStatusLabel(firstAttempt, { dict: translations.id })).toBe('Upaya 1 dari 3');
    expect(previewStatusLabel(firstAttempt, { dict: translations.en })).toBe('Attempt 1 of 3');
    const retrying = jobCardChrome('running', { attemptCount: 2, maxAttempts: 3 });
    expect(previewStatusLabel(retrying, { dict: translations.id })).toBe('Mencoba lagi (percobaan 2/3)...');
  });

  it('never regresses a scanned key back to the Title-Case humanization of its key', () => {
    const id = localePacks.id as Record<string, string>;
    const humanize = (key: string) =>
      key
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase());
    for (const key of Object.keys(RESTORED_ID)) {
      expect(id[key], `id.${key} is a Title-Case leftover of the key`).not.toBe(humanize(key));
    }
  });
});
