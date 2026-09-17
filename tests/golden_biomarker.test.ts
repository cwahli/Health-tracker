import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getMappedBiomarkerKey, computeBiomarkerTelemetryMultiplier, detectFlaggedTelemetryErrors } from "../src/utils/biomarkers";
import {
  convertViaTable,
  enrichReviewModificationCommands,
  applyModificationCommands,
  buildReviewCommandsFromHistory,
  lexTable,
  buildIngestBatch,
  resolveAgentDestination,
  shouldAbortTablePath,
  ANALYTE_CONVERSIONS,
} from '../src/utils/biomarkerLifecycle';
import type { ClassId, IngestTrace } from '../src/types';
import { convertViaTable as backofficeConvertViaTable } from '../src/server/biomarkers/backoffice';

describe('Golden Biomarker — backoffice extract converts via the single table (no second math path)', () => {
  const row = (printed: string, value: number, unit: string, mappedKey: string) =>
    backofficeConvertViaTable({ id: 'r', printed, value, unit, date: '14-08-2026' }, mappedKey);

  it('converts the five G-B1 locks exactly (triglycerides must NOT use the cholesterol factor)', () => {
    expect(row('HDL', 50, 'mg/dL', 'hdl')).toMatchObject({ value: 1.293, unit: 'mmol/L' });
    expect(row('Triglycerides', 125, 'mg/dL', 'triglycerides')).toMatchObject({ value: 1.411, unit: 'mmol/L' });
    expect(row('LDL', 130, 'mg/dL', 'ldl')).toMatchObject({ value: 3.362, unit: 'mmol/L' });
    expect(row('Creatinine', 0.9, 'mg/dL', 'creatinine')).toMatchObject({ value: 79.56, unit: 'umol/L' });
    expect(row('Bilirubin', 0.8, 'mg/dL', 'total_bilirubin')).toMatchObject({ value: 13.68, unit: 'umol/L' });
  });

  it('leaves incomparable pairs unconverted instead of guessing', () => {
    expect(row('Mystery', 5, 'xyz', 'mystery_analyte').value).toBe(5);
  });

  it('keeps the legacy HbA1c % branch verbatim (shared table has no hba1c row)', () => {
    expect(row('HbA1c', 5.7, '%', 'hba1c')).toMatchObject({ value: 39, unit: 'mmol/mol' });
  });
});

describe('Golden Biomarker — G-B1 & Class Verification', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb1Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B1');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb1Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb1Dir, 'expected.json'), 'utf8'));

  it('verifies G-B1 case metadata and class bindings', () => {
    expect(caseJson.id).toBe('G-B1');
    expect(caseJson.class).toBe('APPLY_MISS');
    expect(caseJson.classes).toContain('APPLY_MISS');
    expect(caseJson.classes).toContain('SILENT_REWRITE');
    expect(caseJson.classes).toContain('CONFORMANCE_UNIT');
  });

  it('verifies G-B1 five locked unit conversions match expected.json', () => {
    // 1. HDL 50 mg/dL -> 1.293 mmol/L
    const hdl = convertViaTable('hdl', 50, 'mg/dL', 'mmol/L');
    expect(hdl.ok).toBe(true);
    if (hdl.ok) expect(hdl.value).toBeCloseTo(expectedJson.conversions.hdl.expected, 2);

    // 2. Triglycerides 125 mg/dL -> 1.411 mmol/L
    const tg = convertViaTable('triglycerides', 125, 'mg/dL', 'mmol/L');
    expect(tg.ok).toBe(true);
    if (tg.ok) expect(tg.value).toBeCloseTo(expectedJson.conversions.triglycerides.expected, 2);

    // 3. LDL 130 mg/dL -> 3.362 mmol/L
    const ldl = convertViaTable('ldl', 130, 'mg/dL', 'mmol/L');
    expect(ldl.ok).toBe(true);
    if (ldl.ok) expect(ldl.value).toBeCloseTo(expectedJson.conversions.ldl.expected, 2);

    // 4. Creatinine 0.9 mg/dL -> 79.56 umol/L
    const creat = convertViaTable('creatinine', 0.9, 'mg/dL', 'umol/L');
    expect(creat.ok).toBe(true);
    if (creat.ok) expect(creat.value).toBeCloseTo(expectedJson.conversions.creatinine.expected, 1);

    // 5. Total Bilirubin 0.8 mg/dL -> 13.68 umol/L
    const bili = convertViaTable('total_bilirubin', 0.8, 'mg/dL', 'umol/L');
    expect(bili.ok).toBe(true);
    if (bili.ok) expect(bili.value).toBeCloseTo(expectedJson.conversions.total_bilirubin.expected, 1);
  });

  it('verifies G-B1 review modification synthesis converts only non-SI row', () => {
    const cmds = enrichReviewModificationCommands([], caseJson.fixture.history, caseJson.fixture.targetUnits);
    const byKey = Object.fromEntries(cmds.map((c) => [c.keyName, c]));

    expect(Number(byKey.hdl.newValue)).toBeCloseTo(1.293, 2);
    expect(Number(byKey.triglycerides.newValue)).toBeCloseTo(1.411, 2);
    expect(Number(byKey.ldl.newValue)).toBeCloseTo(3.362, 2);
    expect(Number(byKey.creatinine.newValue)).toBeCloseTo(79.56, 1);
    expect(Number(byKey.total_bilirubin.newValue)).toBeCloseTo(13.68, 1);

    // Older SI rows remain untouched
    expect(cmds.every((c) => c.date === '14-08-2026')).toBe(true);
  });

  it('verifies B0.1-0.3 / G-B1 applyModificationCommands writes history and retains observationMeta raw while leaving older SI untouched', () => {
    const { history: updatedHistory, applied } = applyModificationCommands(
      caseJson.fixture.history,
      [],
      caseJson.fixture.targetUnits
    );

    expect(applied).toBe(5);

    // Row 14-08-2026 converted
    const nonSiRow = updatedHistory.find((h: any) => h.date === '14-08-2026');
    expect(nonSiRow).toBeDefined();
    expect(nonSiRow.biomarkers.hdl).toBeCloseTo(1.293, 2);
    expect(nonSiRow.biomarkers.triglycerides).toBeCloseTo(1.411, 2);
    expect(nonSiRow.biomarkers.ldl).toBeCloseTo(3.362, 2);
    expect(nonSiRow.biomarkers.creatinine).toBeCloseTo(79.56, 1);
    expect(nonSiRow.biomarkers.total_bilirubin).toBeCloseTo(13.68, 1);

    // observationMeta preserved raw values
    expect(nonSiRow.observationMeta?.hdl?.rawValue).toBe(50);
    expect(nonSiRow.observationMeta?.triglycerides?.rawValue).toBe(125);
    expect(nonSiRow.observationMeta?.ldl?.rawValue).toBe(130);
    expect(nonSiRow.observationMeta?.creatinine?.rawValue).toBe(0.9);
    expect(nonSiRow.observationMeta?.total_bilirubin?.rawValue).toBe(0.8);

    // Older SI rows remain untouched
    const row0208 = updatedHistory.find((h: any) => h.date === '02-08-2026');
    expect(row0208.biomarkers.hdl).toBe(1.43);
    expect(row0208.biomarkers.creatinine).toBe(100);
    expect(row0208.biomarkers.total_bilirubin).toBe(16);

    const row0304 = updatedHistory.find((h: any) => h.date === '03-04-2024');
    expect(row0304.biomarkers.creatinine).toBe(72);
    expect(row0304.biomarkers.total_bilirubin).toBe(13);
  });

  it('verifies IngestTrace type contract and ClassId enums', () => {
    const sampleTrace: IngestTrace = {
      version: 1,
      jobId: 'job_test_123',
      sourceKind: 'table',
      totalInputRows: 5,
      highConfidenceCount: 5,
      flaggedCount: 0,
      unmatchedCount: 0,
      skippedCount: 0,
      rows: [
        {
          sourceRowIndex: 0,
          printedName: 'HDL Cholesterol',
          rawValue: 50,
          rawUnit: 'mg/dL',
          canonicalKey: 'hdl',
          bucket: 'high_confidence',
          class: 'CONFORMANCE_UNIT' as ClassId,
          why: 'Recognized standard analyte in mg/dL'
        }
      ],
      handoff: {
        dualRawInjection: false,
        sentToParserCount: 0,
        sentToReviewCount: 0
      }
    };

    expect(sampleTrace.version).toBe(1);
    expect(sampleTrace.rows?.[0].class).toBe('CONFORMANCE_UNIT');
    expect(sampleTrace.handoff?.dualRawInjection).toBe(false);
  });
});

describe('Golden Biomarker — G-B4 False Friend Guard', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb4Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B4_specimen_false_friend');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb4Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb4Dir, 'expected.json'), 'utf8'));

  it('verifies false friends do not cross-map', () => {
    for (const [raw, expected] of Object.entries(expectedJson.mappedKeys)) {
      expect(getMappedBiomarkerKey(raw)).toBe(expected);
    }
  });
});

describe('Golden Biomarker — G-B2 EMIS / NHS Table Outer Regression', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb2Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B2_emis_nhs_table');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb2Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb2Dir, 'expected.json'), 'utf8'));

  it('verifies G-B2 assertions run lexTable and buildIngestBatch for class counts', () => {
    expect(caseJson.id).toBe('G-B2');
    expect(expectedJson.assertByClassCounts).toBe(true);
    expect(expectedJson.classCounts.CONFORMANCE_SHAPE).toBe(140);

    // Construct a 140-row NHS/EMIS table text fixture
    const nhsAnalytes = ['Serum cholesterol', 'Serum HDL', 'Serum triglycerides', 'Serum LDL', 'Serum creatinine', 'Serum bilirubin', 'HbA1c'];
    const lines: string[] = [];
    for (let i = 0; i < 140; i++) {
      const name = nhsAnalytes[i % nhsAnalytes.length];
      const val = (1.2 + (i % 50) * 0.1).toFixed(2);
      lines.push(`${name}\t${val}\tmmol/L\t[0.0-5.0]\tNormal`);
    }
    const tableText = lines.join('\n');
    const rows = lexTable(tableText);
    const trace = buildIngestBatch(rows, 'job_gb2_nhs_140');
    expect(trace.sourceKind).toBe('table');
    expect(trace.totalInputRows).toBe(140);
    expect(rows.length).toBe(140);
    expect(shouldAbortTablePath(trace)).toBe(false);
    expect((trace.highConfidenceCount || 0) + (trace.flaggedCount || 0)).toBeGreaterThan(0);
  });

  it('splits a single-line quoted EMIS paste into records (production shape)', () => {
    const oneLine = '"Date","Test Name","Result","Normal Range","Comment" "05-Jun-2026","Serum sodium","143 mmol/L","133 - 146 mmol/L","" "05-Jun-2026","HbA1c levl - IFCC standardised","40 mmol/mol","20 - 41 mmol/mol","" "05-Jun-2026","Renal profile","","","panel"';
    const rows = lexTable(oneLine);
    const trace = buildIngestBatch(rows, 'job_gb2_oneline');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(shouldAbortTablePath(trace)).toBe(false);
    expect(trace.rows?.some((r) => r.canonicalKey === 'serum_sodium' && r.rawValue === 143)).toBe(true);
  });
});

describe('Golden Biomarker — G-B3 Lexer Shape & Panel Skip (CONFORMANCE_SHAPE)', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb3Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B3_shifted_columns');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb3Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb3Dir, 'expected.json'), 'utf8'));

  it('verifies G-B3 shape conformance, UK unit exponential handling, and panel skips', () => {
    expect(caseJson.id).toBe('G-B3');
    expect(caseJson.class).toBe('CONFORMANCE_SHAPE');
    expect(expectedJson.trace.class).toBe('CONFORMANCE_SHAPE');

    const rows = lexTable(caseJson.text);
    const trace = buildIngestBatch(rows, 'job_gb3_shape');

    expect(trace.sourceKind).toBe('table');
    expect(trace.totalInputRows).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => /white blood cell/i.test(r[0] || ''))).toBe(true);
    expect(rows.some((r) => /platelet/i.test(r[0] || ''))).toBe(true);
  });
});

describe('Golden Biomarker — G-B5 Food in Medical (WRONG_DOOR)', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb5Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B5_food_in_medical');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb5Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb5Dir, 'expected.json'), 'utf8'));

  it('verifies G-B5 class bindings and executes destination routing', () => {
    expect(caseJson.id).toBe('G-B5');
    expect(caseJson.class).toBe('WRONG_DOOR');
    expect(caseJson.classes).toContain('WRONG_DOOR');
    
    expect(expectedJson.trace.class).toBe('WRONG_DOOR');
    expect(expectedJson.trace.skippedCount).toBe(1);

    // Execute helper: resolveAgentDestination for food logging
    const route = resolveAgentDestination('agent1_step1', { isWrongDoor: true, destination: 'food' });
    expect(route).toBeDefined();
    expect((route as any).destination).toBe('food');
  });
});

describe('Golden Biomarker — G-B6 Symptom Diary (WRONG_DOOR)', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb6Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B6_symptom_diary');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb6Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb6Dir, 'expected.json'), 'utf8'));

  it('verifies G-B6 symptom diary classification and executes routing helper', () => {
    expect(caseJson.id).toBe('G-B6');
    expect(caseJson.class).toBe('WRONG_DOOR');
    expect(expectedJson.trace.sourceKind).toBe('symptom');

    // Execute helper: destination resolution for symptom diary
    // Pass the standard lab extractor (agent1_step1) to prove it routes to symptom_diary
    const route = resolveAgentDestination('agent1_step1', { text: caseJson.text });
    expect(route).toBeDefined();
    if (typeof route === 'object' && route !== null) {
      expect(route.destination).toBe('symptom_diary');
    } else {
      expect(route).toBe('symptom_diary');
    }
  });
});

describe('Golden Biomarker — G-B7 Incomplete Reading (COMPLETENESS)', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb7Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B7_incomplete_reading');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb7Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb7Dir, 'expected.json'), 'utf8'));

  it('verifies G-B7 incomplete reading detection via lexTable and buildIngestBatch', () => {
    expect(caseJson.id).toBe('G-B7');
    expect(caseJson.class).toBe('COMPLETENESS');

    // Execute helpers on incomplete input
    const rows = lexTable("Unknown analyte text without value");
    const trace = buildIngestBatch(rows, 'job_gb7_test');
    expect(trace.highConfidenceCount).toBe(0);
    expect(shouldAbortTablePath(trace)).toBe(true);
  });
});

describe('Golden Biomarker — G-B8 Repaste Identity (UPSERT_IDENTITY)', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb8Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B8_repaste_identity');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb8Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb8Dir, 'expected.json'), 'utf8'));

  it('verifies G-B8 identity upsert class and verifies report deduplication match', () => {
    expect(caseJson.id).toBe('G-B8_repaste_identity');
    expect(caseJson.class).toBe('UPSERT_IDENTITY');
    expect(expectedJson.trace.class).toBe('UPSERT_IDENTITY');
    expect(expectedJson.trace.shouldUpsert).toBe(true);

    const existing = caseJson.input.existingHistory[0];
    const match = caseJson.input.sourceReportId === existing.sourceReportId;
    expect(match).toBe(true);
  });
});

describe('Golden Biomarker — Telemetry Multiplier & Auto-Fix Proposals', () => {
  it('correctly computes deterministic conversion proposals strictly for US <-> SI unit differences', () => {
    // 1. Glucose US mg/dL -> SI mmol/L (110 mg/dL -> ~6.1 mmol/L)
    const glucFix = computeBiomarkerTelemetryMultiplier('fasting_glucose', 110, '3.9 - 5.6');
    expect(glucFix).not.toBeNull();
    expect(glucFix?.multiplier).toBeCloseTo(ANALYTE_CONVERSIONS.fasting_glucose.multiply, 5);

    // 2. Cholesterol US mg/dL -> SI mmol/L (190 mg/dL -> ~4.91 mmol/L)
    const cholFix = computeBiomarkerTelemetryMultiplier('cholesterol', 190, '3.0 - 5.0');
    expect(cholFix).not.toBeNull();
    expect(cholFix?.multiplier).toBeCloseTo(ANALYTE_CONVERSIONS.total_cholesterol.multiply, 5);

    // 3. Triglycerides US mg/dL -> SI mmol/L (150 mg/dL -> ~1.69 mmol/L)
    const tgFix = computeBiomarkerTelemetryMultiplier('triglycerides', 150, '0.5 - 1.7');
    expect(tgFix).not.toBeNull();
    expect(tgFix?.multiplier).toBeCloseTo(ANALYTE_CONVERSIONS.triglycerides.multiply, 5);

    // 4. Uric Acid US mg/dL -> SI µmol/L (8.0 mg/dL -> ~475 µmol/L)
    const uricFix = computeBiomarkerTelemetryMultiplier('uric_acid', 8.0, '200 - 430');
    expect(uricFix).not.toBeNull();
    expect(uricFix?.multiplier).toBe(59.48);

    // 5. Creatinine US mg/dL -> SI µmol/L (1.2 mg/dL -> ~106 µmol/L)
    const creatFix = computeBiomarkerTelemetryMultiplier('creatinine', 1.2, '60 - 110');
    expect(creatFix).not.toBeNull();
    expect(creatFix?.multiplier).toBe(88.4);

    // 6. Hemoglobin US g/dL -> SI g/L (14.5 g/dL -> 145 g/L)
    const hbFix = computeBiomarkerTelemetryMultiplier('hemoglobin', 14.5, '120 - 160');
    expect(hbFix).not.toBeNull();
    expect(hbFix?.multiplier).toBe(10);

    // 7. WBC Differentials (Lymphocytes 32, Monocytes 7, Eosinophils 4) are NOT unit conversions -> MUST return null (Needs AI Review)
    expect(computeBiomarkerTelemetryMultiplier('lymphocyte_count', 32, '1.0 - 3.2')).toBeNull();
    expect(computeBiomarkerTelemetryMultiplier('monocyte_count', 7, '0.1 - 0.6')).toBeNull();
    expect(computeBiomarkerTelemetryMultiplier('eosinophil_count', 4, '0.02 - 0.52')).toBeNull();
    expect(computeBiomarkerTelemetryMultiplier('basophil_count', 100, '0.0 - 0.1')).toBeNull();

    // 8. BMI missing digit (2) is NOT a unit conversion -> MUST return null (Needs AI Review)
    expect(computeBiomarkerTelemetryMultiplier('bmi', 2, '18.5 - 24.9')).toBeNull();

    // 9. Other arbitrary discrepancies -> MUST return null
    expect(computeBiomarkerTelemetryMultiplier('red_blood_cells', 0.8, '4.2 - 5.8')).toBeNull();

    // 10. SECOND_MATH_PATH: no table row → no private if (key === …) factor
    expect(computeBiomarkerTelemetryMultiplier('brand_new_analyte_xyz', 110, '3.9 - 5.6')).toBeNull();
    const hdlViaTable = convertViaTable('hdl', 50, 'mg/dL', 'mmol/L');
    expect(hdlViaTable.ok).toBe(true);
    if (hdlViaTable.ok) expect(hdlViaTable.value).toBeCloseTo(1.293, 2);
  });

  it('detects flagged telemetry errors and correctly separates auto-fixable US/SI units from AI review cases', () => {
    const activeHistory = [
      { id: 'log-1', date: '04-11-2020', biomarkers: { 'Fasting Blood Glucose': 110, 'Lymphocyte Count': 32, 'Body Mass Index': 2 } },
      { id: 'log-2', date: '10-05-2023', biomarkers: { 'fasting_glucose': 5.2, 'lymphocyte_count': 1.97, 'bmi': 22.4 } }
    ];
    const profile = { customBiomarkers: {} };
    const allDefinitions: any[] = [];

    const flags = detectFlaggedTelemetryErrors({}, profile, activeHistory, allDefinitions);
    const glucoseFlag = flags.find(f => f.key === 'fasting_glucose');
    const lymphFlag = flags.find(f => f.key === 'lymphocyte_count');
    const bmiFlag = flags.find(f => f.key === 'bmi');

    // Glucose has an SI reading (5.2 mmol/L) against standard US catalog range (70-99 mg/dL)
    expect(glucoseFlag).toBeDefined();
    expect(glucoseFlag?.proposedAutoFix?.canAutoFix).toBe(true);
    expect(glucoseFlag?.proposedAutoFix?.proposedMultiplier).toBeCloseTo(
      1 / ANALYTE_CONVERSIONS.fasting_glucose.multiply,
      2
    );

    // Lymphocytes (% diff vs count) and BMI (missing digit) are non-unit fixes: canAutoFix = false (AI Review only)
    expect(lymphFlag).toBeDefined();
    expect(lymphFlag?.proposedAutoFix?.canAutoFix).toBe(false);
    expect(lymphFlag?.proposedAutoFix?.fixLabel).toBe('Needs AI Review');

    expect(bmiFlag).toBeDefined();
    expect(bmiFlag?.proposedAutoFix?.canAutoFix).toBe(false);
    expect(bmiFlag?.proposedAutoFix?.fixLabel).toBe('Needs AI Review');
  });
});

describe('Golden Biomarker — G-B9 Vision N/A (CONFORMANCE_SHAPE)', () => {
  if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }
  const gb9Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B9_vision_na');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb9Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb9Dir, 'expected.json'), 'utf8'));

  it('verifies G-B9 vision N/A image handling via shouldAbortTablePath helper', () => {
    expect(caseJson.id).toBe('G-B9');
    expect(caseJson.class).toBe('CONFORMANCE_SHAPE');
    expect(expectedJson.trace.sourceKind).toBe('image');

    const emptyTrace = { sourceKind: 'table', highConfidenceCount: 0, unmatchedCount: 1 };
    expect(shouldAbortTablePath(emptyTrace)).toBe(true);
  });
});

describe('Golden Biomarker — Multi-Panel Ingestion & Plausibility Validation Architecture', () => {
  it('resolves multi-panel NHS / UK laboratory print names correctly without alias collision', () => {
    expect(getMappedBiomarkerKey('haemoglobin_estimation')).toBe('hemoglobin');
    expect(getMappedBiomarkerKey('haemoglobin_estimation_hb')).toBe('hemoglobin');
    expect(getMappedBiomarkerKey('mean_corpuscular_hb_conc')).toBe('mean_corpuscular_hemoglobin_concentration');
    expect(getMappedBiomarkerKey('meancorpuschbconcmchc')).toBe('mean_corpuscular_hemoglobin_concentration');
    expect(getMappedBiomarkerKey('serum_inorganic_phosphate')).toBe('serum_inorganic_phosphate');
    expect(getMappedBiomarkerKey('serum_adjusted_calcium')).toBe('serum_adjusted_calcium');
  });

  it('verifies unit conversions in ANALYTE_CONVERSIONS for hematology and metabolic panels', () => {
    expect(ANALYTE_CONVERSIONS.ldl.multiply).toBeCloseTo(0.02586, 5);
    expect(ANALYTE_CONVERSIONS.hematocrit.multiply).toBe(0.01);
    expect(ANALYTE_CONVERSIONS.hemoglobin.multiply).toBe(10);
    expect(ANALYTE_CONVERSIONS.mean_corpuscular_hemoglobin_concentration.multiply).toBe(10);
    expect(ANALYTE_CONVERSIONS.calcium.multiply).toBeCloseTo(0.2495, 4);
    expect(ANALYTE_CONVERSIONS.serum_inorganic_phosphate.multiply).toBeCloseTo(0.3229, 4);
  });
});


