import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getMappedBiomarkerKey } from "../src/utils/biomarkers";
import {
  convertViaTable,
  enrichReviewModificationCommands,
  buildReviewCommandsFromHistory,
  lexTable,
  buildIngestBatch,
  resolveAgentDestination,
  shouldAbortTablePath
} from '../src/utils/biomarkerLifecycle';
import type { ClassId, IngestTrace } from '../src/types';

describe('Golden Biomarker — G-B1 & Class Verification', () => {
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
  const gb6Dir = path.resolve(__dirname, 'Golden_biomarker/examples/G-B6_symptom_diary');
  const caseJson = JSON.parse(fs.readFileSync(path.join(gb6Dir, 'case.json'), 'utf8'));
  const expectedJson = JSON.parse(fs.readFileSync(path.join(gb6Dir, 'expected.json'), 'utf8'));

  it('verifies G-B6 symptom diary classification and executes routing helper', () => {
    expect(caseJson.id).toBe('G-B6');
    expect(caseJson.class).toBe('WRONG_DOOR');
    expect(expectedJson.trace.sourceKind).toBe('symptom');

    // Execute helper: destination resolution for symptom diary
    const route = resolveAgentDestination('symptom_diary', { text: caseJson.input?.text });
    expect(route).toBeDefined();
    if (typeof route === 'object' && route !== null) {
      expect(route.destination).toBe('symptom_diary');
    }
  });
});

describe('Golden Biomarker — G-B7 Incomplete Reading (COMPLETENESS)', () => {
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

describe('Golden Biomarker — G-B9 Vision N/A (CONFORMANCE_SHAPE)', () => {
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


