import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { getMappedBiomarkerKey, biomarkerDefinitions } from '../../src/utils/biomarkers';

test.describe('Biomarker End-to-End Sanitize Journey', () => {
  const rootDir = process.cwd();
  const inputLogsCsv = fs.readFileSync(path.join(rootDir, 'golden/biomarker/input/raw_biomarker_logs.csv'), 'utf-8');
  const inputDictCsv = fs.readFileSync(path.join(rootDir, 'golden/biomarker/input/raw_biomarker_dictionary.csv'), 'utf-8');

  const goldenLogsCsv = fs.readFileSync(path.join(rootDir, 'golden/biomarker/result/clean_biomarker_logs.csv'), 'utf-8');
  const goldenDictCsv = fs.readFileSync(path.join(rootDir, 'golden/biomarker/result/clean_biomarker_dictionary.csv'), 'utf-8');

  const rawLogs = Papa.parse(inputLogsCsv, { header: true }).data.filter((r: any) => r.Date && r.Biomarker);
  const rawDict = Papa.parse(inputDictCsv, { header: true }).data.filter((r: any) => r['Biomarker Name']);

  const customBiomarkers: Record<string, any> = {};
  rawDict.forEach((d: any) => {
    customBiomarkers[d.Key] = {
      name: d['Biomarker Name'],
      unit: d.Unit,
      normalRange: d['Normal Range'],
      description: d.Description,
      standardMedicalGrouping: d['Medical Practice'],
      riskCategories: d['Risk Categories'] ? d['Risk Categories'].split('; ') : [],
      potentialMedicalConditions: d['Medical Conditions'] ? d['Medical Conditions'].split('; ') : [],
    };
  });

  const normalizeBiomarkerKey = (raw: string) => {
    const dictMatch = rawDict.find((x: any) => x['Biomarker Name'].toLowerCase() === raw.toLowerCase());
    if (dictMatch) return dictMatch.Key;
    const mapped = getMappedBiomarkerKey(raw);
    if (biomarkerDefinitions.some(d => d.key === mapped)) return mapped;
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  };

  const historyMap = new Map<string, any>();
  rawLogs.forEach((r: any) => {
    const d = r.Date;
    if (!historyMap.has(d)) {
      historyMap.set(d, {
        id: 'log_' + d,
        date: d,
        biomarkers: {},
        note: r.Comment || '',
        tests: []
      });
    }
    const h = historyMap.get(d);
    const key = normalizeBiomarkerKey(r.Biomarker);
    const numVal = isNaN(Number(r.Value)) ? r.Value : Number(r.Value);
    h.biomarkers[key] = numVal;
    if (r.Comment && !h.note) h.note = r.Comment;
    if (r.Comment) {
      h.tests.push({ key, originalTestName: r.Biomarker, doctorComment: r.Comment, unit: r.Unit });
    }
  });

  const biomarkerHistory = Array.from(historyMap.values());
  const biomarkers: Record<string, any> = {};
  rawDict.forEach((d: any) => {
    const statusStr = d['Current Evaluation Status'] || '';
    const match = statusStr.match(/Value:\s*([^|]+)\s*\|/);
    if (match) {
      const v = match[1].trim();
      biomarkers[d.Key] = isNaN(Number(v)) ? v : Number(v);
    }
  });

  const seedPayload = {
    profile: {
      nickname: 'Healthy User',
      photoUrl: '',
      email: 'demo@healthcockpit.com',
      age: 43,
      ethnicity: 'Asian',
      weight: 61.9,
      height: 164,
      gender: 'Male',
      language: 'en',
      userType: 'Demo',
      customBiomarkers,
      notUsedInMedicalHistory: {},
      notUsedBiomarkers: {},
      deletedBiomarkerLogIds: {}
    },
    biomarkers,
    biomarkerHistory,
    foodLogs: [],
    actions: [],
    dailyBenefits: [],
    report: null
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const navTab = page.locator('#nav-tab-home');
    const demoBtn = page.locator('#demo-login-btn');

    await Promise.race([
      navTab.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {}),
      demoBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
    ]);

    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click();
    }

    await navTab.waitFor({ state: 'attached', timeout: 20000 });
  });

  test('Journey: Seed raw biomarker data, sanitize via UI modal, download exports, and verify 100% against golden benchmark', async ({ page }) => {
    // 1. Navigate to Health tab
    const healthTab = page.locator('#nav-tab-health');
    await expect(healthTab).toBeVisible({ timeout: 15000 });
    await healthTab.click();

    // Let the initial login settling finish, then seed the exact benchmark data
    await page.waitForTimeout(1500);
    await page.evaluate((payload) => {
      window.dispatchEvent(new CustomEvent('seed-biomarker-test-data', { detail: payload }));
    }, seedPayload);
    await page.waitForTimeout(500);

    // 2. Locate Clean & Sanitize button and click it
    const sanitizeBtn = page.locator('#sanitize-data-btn');
    await expect(sanitizeBtn).toBeVisible({ timeout: 15000 });
    await sanitizeBtn.click();

    // 3. Approval Modal appears with detected proposals
    const applyBtn = page.locator('#apply-sanitize-proposals-btn');
    await expect(applyBtn).toBeVisible({ timeout: 15000 });

    // Verify modal content includes proposals for transposed dates, canonical backfill, and archiving
    const modalContent = (await page.locator('#apply-sanitize-proposals-btn').locator('xpath=ancestor::div[contains(@class, "fixed") or contains(@class, "z-50")]').first().innerText()).toLowerCase();
    expect(modalContent).toContain('transposed');
    expect(modalContent).toContain('reference range');

    // 4. Click Apply Changes
    await applyBtn.click();

    // Modal should close after application
    await expect(applyBtn).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // 5. Trigger download for biomarker logs CSV
    const logsDownloadBtn = page.locator('#download-logs-csv-btn');
    await expect(logsDownloadBtn).toBeVisible({ timeout: 10000 });

    const [logsDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      logsDownloadBtn.click(),
    ]);

    const downloadedLogsPath = await logsDownload.path();
    const downloadedLogsContent = downloadedLogsPath ? fs.readFileSync(downloadedLogsPath, 'utf-8') : '';

    // 6. Trigger download for biomarker dictionary CSV
    const dictDownloadBtn = page.locator('#download-biomarkers-csv-btn');
    await expect(dictDownloadBtn).toBeVisible({ timeout: 10000 });

    const [dictDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      dictDownloadBtn.click(),
    ]);

    const downloadedDictPath = await dictDownload.path();
    const downloadedDictContent = downloadedDictPath ? fs.readFileSync(downloadedDictPath, 'utf-8') : '';

    // 7. Verification: Parse downloaded CSVs
    const parsedDownloadedLogs = Papa.parse(downloadedLogsContent, { header: true }).data.filter((r: any) => r.Date && r.Biomarker);
    const parsedGoldenLogs = Papa.parse(goldenLogsCsv, { header: true }).data.filter((r: any) => r.Date && r.Biomarker);

    const parsedDownloadedDict = Papa.parse(downloadedDictContent, { header: true }).data.filter((r: any) => r['Biomarker Name']);
    const parsedGoldenDict = Papa.parse(goldenDictCsv, { header: true }).data.filter((r: any) => r['Biomarker Name']);

    console.log(`[Journey Test] Downloaded logs count: ${parsedDownloadedLogs.length}, Golden logs count: ${parsedGoldenLogs.length}`);
    console.log(`[Journey Test] Downloaded dict count: ${parsedDownloadedDict.length}, Golden dict count: ${parsedGoldenDict.length}`);
    const goldenKeys = new Set(parsedGoldenDict.map((r: any) => r.Key));
    const downloadedKeys = new Set(parsedDownloadedDict.map((r: any) => r.Key));
    const extraKeys = [...downloadedKeys].filter(k => !goldenKeys.has(k));
    const missingKeys = [...goldenKeys].filter(k => !downloadedKeys.has(k));
    console.log('[Journey Test] Extra keys in downloaded:', extraKeys);
    console.log('[Journey Test] Missing keys in downloaded:', missingKeys);
    console.log('[Journey Test] All Downloaded Dict Keys & Not Used:', parsedDownloadedDict.map((d: any) => ({ key: d.Key, notUsed: d['Not Used'] })));

    // Check row counts match benchmark
    expect(parsedDownloadedLogs.length).toBe(parsedGoldenLogs.length);
    expect(parsedDownloadedDict.length).toBe(parsedGoldenDict.length);

    // Verify transposed dates are eliminated
    const downloadedDates = new Set(parsedDownloadedLogs.map((r: any) => r.Date));
    expect(downloadedDates.has('04-02-2024')).toBe(false);
    expect(downloadedDates.has('04-03-2024')).toBe(false);
    expect(downloadedDates.has('07-11-2026')).toBe(false);
    expect(downloadedDates.has('02-04-2024')).toBe(true);
    expect(downloadedDates.has('03-04-2024')).toBe(true);
    expect(downloadedDates.has('11-07-2026')).toBe(true);

    // Verify 13 canonical reference ranges in downloaded dictionary
    const checkKeys = [
      { key: 'serum_adjusted_calcium', expectedRange: '2.20 - 2.60', expectedUnit: 'mmol/L', expectedPractice: 'Bone & Mineral / Electrolytes' },
      { key: 'prostate_specific_antigen', expectedRange: '< 2.5', expectedUnit: 'ug/L', expectedPractice: 'Screenings & Wellness' },
      { key: 'platelet_distribution_width', expectedRange: '8.3 - 18.0', expectedUnit: 'fL', expectedPractice: 'Hematology' },
      { key: 'alkaline_phosphatase', expectedRange: '30 - 130', expectedUnit: 'U/L', expectedPractice: 'Hepatic / Liver' },
      { key: 'serum_inorganic_phosphate', expectedRange: '0.80 - 1.50', expectedUnit: 'mmol/L', expectedPractice: 'Bone & Mineral / Electrolytes' },
      { key: 'serum_potassium', expectedRange: '3.5 - 5.0', expectedUnit: 'mmol/L', expectedPractice: 'Renal / Electrolytes' },
      { key: 'non_hdl_cholesterol', expectedRange: '< 3.8', expectedUnit: 'mmol/L', expectedPractice: 'Cardiovascular / Lipids' },
      { key: 'serum_sodium', expectedRange: '135 - 145', expectedUnit: 'mmol/L', expectedPractice: 'Renal / Electrolytes' },
      { key: 'total_bilirubin', expectedRange: '3 - 21', expectedUnit: 'umol/L', expectedPractice: 'Hepatic / Liver' },
      { key: 'nucleated_red_blood_cell_count', expectedRange: '0.00 - 0.01', expectedUnit: '10^9/L', expectedPractice: 'Hematology' },
      { key: 'cholesterol_hdl_ratio', expectedRange: '< 4.0', expectedUnit: 'ratio', expectedPractice: 'Cardiovascular / Lipids' },
      { key: 'serum_globulin', expectedRange: '20 - 35', expectedUnit: 'g/L', expectedPractice: 'Hepatic / Proteins' },
      { key: 'serum_calcium', expectedRange: '2.15 - 2.55', expectedUnit: 'mmol/L', expectedPractice: 'Bone & Mineral / Electrolytes' },
    ];

    for (const c of checkKeys) {
      const row = parsedDownloadedDict.find((d: any) => d.Key === c.key);
      expect(row, `Dictionary row for ${c.key} must exist`).toBeDefined();
      expect(row['Normal Range']).toBe(c.expectedRange);
      expect(row['Unit']).toBe(c.expectedUnit);
      expect(row['Medical Practice']).toBe(c.expectedPractice);
      expect(row['Current Evaluation Status']).not.toContain('unknown');
      expect(row['Medical Insight']).not.toContain('range of Unknown');
      expect(row['Not Used']).toBe('FALSE');
    }

    // Verify qualitative and granular survey items are marked Not Used: "TRUE"
    const sarsRow = parsedDownloadedDict.find((d: any) => d.Key === 'sars_cov_2_rna_detection');
    expect(sarsRow).toBeDefined();
    expect(sarsRow['Not Used']).toBe('TRUE');

    const auditFreqRow = parsedDownloadedDict.find((d: any) => d.Key === 'audit_score_frequency_drinking');
    expect(auditFreqRow).toBeDefined();
    expect(auditFreqRow['Not Used']).toBe('TRUE');

    // Deep parity assertion: Every row in parsedGoldenLogs matches downloadedLogs
    for (let i = 0; i < parsedGoldenLogs.length; i++) {
      const goldenRow = parsedGoldenLogs[i];
      const downloadedRow = parsedDownloadedLogs[i];
      if (downloadedRow.Unit !== goldenRow.Unit) {
        console.log(`[Log Parity Mismatch at idx ${i}] Biomarker: ${goldenRow.Biomarker}, Date: ${goldenRow.Date}, Expected Unit: "${goldenRow.Unit}", Got Unit: "${downloadedRow.Unit}"`);
      }
      expect(downloadedRow.Biomarker).toBe(goldenRow.Biomarker);
      expect(downloadedRow.Date).toBe(goldenRow.Date);
      expect(downloadedRow.Value).toBe(goldenRow.Value);
      expect(downloadedRow.Unit).toBe(goldenRow.Unit);
      expect(downloadedRow.Comment).toBe(goldenRow.Comment);
    }

    // Deep parity assertion: Every row in parsedGoldenDict matches downloadedDict
    for (let i = 0; i < parsedGoldenDict.length; i++) {
      const goldenRow = parsedGoldenDict[i];
      const downloadedRow = parsedDownloadedDict.find((d: any) => d.Key === goldenRow.Key);
      expect(downloadedRow, `Row for key ${goldenRow.Key} should exist`).toBeDefined();
      expect(downloadedRow['Biomarker Name']).toBe(goldenRow['Biomarker Name']);
      expect(downloadedRow['Unit']).toBe(goldenRow['Unit']);
      expect(downloadedRow['Normal Range']).toBe(goldenRow['Normal Range']);
      expect(downloadedRow['Medical Practice']).toBe(goldenRow['Medical Practice']);
      expect(downloadedRow['Not Used']).toBe(goldenRow['Not Used']);
      expect(downloadedRow['Risk Categories']).toBe(goldenRow['Risk Categories']);
      expect(downloadedRow['Current Evaluation Status']).toBe(goldenRow['Current Evaluation Status']);
    }

    console.log('[Journey Test] All golden benchmark assertions verified 100% green!');
  });
});
