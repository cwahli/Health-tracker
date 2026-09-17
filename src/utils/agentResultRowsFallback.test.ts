import { describe, it, expect } from 'vitest';

import { buildAgentResultRows } from './agentResultRows';
import {
  parseAgent1Json,
  buildAgent1FallbackRows,
  buildBiomarkerReviewRows,
} from './agentResultRowsFallback';

const PARSE_ARGS = {
  agentResult: {},
  profile: {},
  biomarkerHistory: [] as any[],
  initialRawText: '',
};

describe('parseAgent1Json', () => {
  it('passes array input through (with numeric_value normalization)', () => {
    const { parsedRows } = parseAgent1Json({
      ...PARSE_ARGS,
      agentResult: {
        filledRows: [
          { biomarker: 'Hemoglobin', value: '13.5', unit: 'g/dL' },
          { biomarker: 'Zinc', numeric_value: '90', unit: 'ug/dL' },
        ],
      },
    });
    expect(parsedRows).toHaveLength(2);
    expect(parsedRows[1].value).toBe('90');
  });

  it('parses fenced yaml/json strings', () => {
    const { parsedRows } = parseAgent1Json({
      ...PARSE_ARGS,
      agentResult: { extractedData: '```yaml\n[{"biomarker":"Glucose","value":"98"}]\n```' },
    });
    expect(parsedRows).toEqual([{ biomarker: 'Glucose', value: '98' }]);
  });

  it('falls back to initialRawText details when empty', () => {
    const { parsedRows } = parseAgent1Json({
      ...PARSE_ARGS,
      agentResult: {},
      initialRawText: 'Hemoglobin: 13.5 g/dL',
    });
    expect(parsedRows).toHaveLength(1);
    expect(parsedRows[0]).toMatchObject({ biomarker: 'Hemoglobin', noChangeNeeded: true });
  });

  it('falls back to latest history entries when empty and no raw text', () => {
    const { parsedRows } = parseAgent1Json({
      ...PARSE_ARGS,
      agentResult: {},
      biomarkerHistory: [
        { date: '2026-01-01', biomarkers: { hdl: 50 } },
        { date: '2026-01-02', biomarkers: { hdl: 55 } },
      ],
    });
    expect(parsedRows).toEqual([
      { biomarker: 'HDL', date: '2026-01-02', value: 55, unit: '', noChangeNeeded: true },
    ]);
  });
});

const HB_PARSED = [{ biomarker: 'Hemoglobin', value: '13.5', unit: 'g/dL' }];

const FALLBACK_ARGS = {
  agentResult: {},
  parsedRows: HB_PARSED,
  profile: {},
  biomarkerHistory: [] as any[],
  initialRawText: '',
};

describe('buildAgent1FallbackRows', () => {
  it('maps parsed rows to new rows', () => {
    const rows = buildAgent1FallbackRows({ ...FALLBACK_ARGS });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      biomarker: 'Hemoglobin',
      value: '13.5',
      unit: 'g/dL',
      isNew: true,
      isChanged: false,
      changeReason: 'Extracted new Hemoglobin: 13.5 g/dL',
    });
    // Fallback rows carry no merge flag key at all (unlike batch primary rows).
    expect('isMerged' in rows[0]).toBe(false);
  });

  it('appends Missing rows for raw-text markers absent from rows', () => {
    const rows = buildAgent1FallbackRows({
      ...FALLBACK_ARGS,
      initialRawText: 'Hemoglobin: 13.5 g/dL\nVitamin D - 20 ng/mL',
    });
    expect(rows).toHaveLength(2);
    const missing = rows.filter((r: any) => r.isMissing);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      key: 'vitamin_d',
      biomarker: 'Vitamin D',
      status: 'Missing',
      value: 'N/A',
    });
  });

  it('appends unmappedTests as New rows', () => {
    const rows = buildAgent1FallbackRows({
      ...FALLBACK_ARGS,
      agentResult: { unmappedTests: [{ raw_name: 'Zinc', numeric_value: '90', unit: 'ug/dL' }] },
    });
    const added = rows.filter((r: any) => r.key === 'zinc');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      status: 'New',
      isNew: true,
      isNewBiomarker: true,
      value: '90',
    });
  });
});

describe('buildBiomarkerReviewRows', () => {
  it('maps a calibration proposal to a Calibrated row', () => {
    const rows = buildBiomarkerReviewRows({
      agentResult: {
        proposal: { key: 'hdl', name: 'HDL', value: '55', unit: 'mg/dL', date: '2026-01-01' },
      },
      profile: {},
      biomarkerHistory: [],
      initialRawText: '',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      biomarker: 'HDL',
      key: 'hdl',
      date: '2026-01-01',
      value: '55',
      unit: 'mg/dL',
      isChanged: true,
      isNew: false,
      status: 'Calibrated',
    });
  });

  it('returns [] when there is nothing to review', () => {
    expect(
      buildBiomarkerReviewRows({
        agentResult: {},
        profile: {},
        biomarkerHistory: [],
        initialRawText: '',
      }),
    ).toEqual([]);
  });
});

describe('buildAgentResultRows dispatcher (biomarker_review case)', () => {
  it('routes biomarker_review to the review builder', () => {
    const rows = buildAgentResultRows({
      agentResult: {},
      agentType: 'biomarker_review',
      profile: {},
      biomarkerHistory: [],
      initialRawText: '',
      precedingAgent1Result: null,
      parsedRows: [],
      mergedInfo: {},
    });
    expect(rows).toEqual([]);
  });
});
