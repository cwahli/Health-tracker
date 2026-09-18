import { describe, it, expect } from 'vitest';

import { buildAgentResultRows } from './agentResultRows';
import {
  buildAgent1BatchRows,
  computeMergedInfoForStep2,
  isKeyMarkedNotUsed,
} from './agentResultRowsBatch';
import { resolveBiomarkerKey } from './agentResultParse';

const PARSED = [
  {
    key: 'hemoglobin',
    name: 'Hemoglobin',
    biomarker: 'Hemoglobin',
    value: '13.5',
    unit: 'g/dL',
  },
];

const AGENT_RESULT = {
  batchBiomarkers: [{ key: 'hemoglobin', name: 'Hemoglobin', value: '13.5', unit: 'g/dL' }],
};

const ARGS = {
  agentResult: AGENT_RESULT,
  agentType: 'agent1',
  profile: {},
  biomarkerHistory: [],
  initialRawText: '',
  precedingAgent1Result: null,
  parsedRows: PARSED,
  mergedInfo: {},
};

describe('buildAgent1BatchRows (agent1 batch path)', () => {
  it('maps one raw item to one primary row with stable flags', () => {
    const rows = buildAgent1BatchRows({ ...ARGS });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      biomarker: 'Hemoglobin',
      oldName: 'Hemoglobin',
      value: '13.5',
      unit: 'g/dL',
      date: 'N/A',
      isUnitChanged: false,
      isNew: true,
      isNewBiomarker: true,
      isNotUsed: false,
      isChanged: false,
      isAtRisk: false,
      isMerged: false,
      isPrimary: true,
      changeReason: 'Extracted new biomarker reading.',
    });
    // Key goes through the same resolver the grid used (definitions content-agnostic).
    expect(row.key).toBe(resolveBiomarkerKey('hemoglobin', 'Hemoglobin', {}));
    // Verbatim quirk: `false || undefined` — renamed flag is undefined, not false.
    expect(row.isRenamed).toBeFalsy();
  });

  it('marks duplicate raw items merged + secondary', () => {
    const rows = buildAgent1BatchRows({
      ...ARGS,
      agentResult: {
        batchBiomarkers: [
          { key: 'hemoglobin', name: 'Hemoglobin', value: '13.5', unit: 'g/dL' },
          { key: 'hemoglobin_2', name: 'Hemoglobin duplicate', value: '13.6', unit: 'g/dL' },
        ],
      },
    });
    const primary = rows.filter((r: any) => r.isPrimary);
    const secondary = rows.filter((r: any) => r.isSecondary);
    expect(primary).toHaveLength(1);
    expect(primary[0].isMerged).toBe(true);
    expect(primary[0].mergedFrom).toEqual(['Hemoglobin duplicate']);
    expect(secondary).toHaveLength(1);
    expect(secondary[0].status).toBe('To Delete');
  });

  it('sends unmatched raw items to "To Delete" (which suppresses their Missing row)', () => {
    const rows = buildAgent1BatchRows({
      ...ARGS,
      agentResult: {
        batchBiomarkers: [
          { key: 'hemoglobin', name: 'Hemoglobin', value: '13.5', unit: 'g/dL' },
          { key: 'zzz_unknown', name: 'Zzz Unknown', value: '1', unit: 'x' },
        ],
      },
    });
    const unmapped = rows.filter((r: any) => r.key === 'zzz_unknown');
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toMatchObject({
      status: 'To Delete',
      biomarker: 'Zzz Unknown',
      isSecondary: true,
    });
    // The To Delete row covers the raw name, so no separate Missing row appears.
    expect(rows.filter((r: any) => r.isMissing)).toHaveLength(0);
  });
});

describe('buildAgentResultRows dispatcher (batch case)', () => {
  it('routes agent1+batch to the batch builder', () => {
    const rows = buildAgentResultRows({ ...ARGS });
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('returns null for not-yet-moved branches', () => {
    expect(buildAgentResultRows({ ...ARGS, agentType: 'agent2' })).toBeNull();
    expect(
      buildAgentResultRows({ ...ARGS, agentResult: {} }),
    ).toBeNull();
  });
});

describe('computeMergedInfoForStep2', () => {
  it('returns {} outside agent2', () => {
    expect(computeMergedInfoForStep2('agent1', { extractedData: 'x' }, {})).toEqual({});
    expect(computeMergedInfoForStep2('agent2', null, {})).toEqual({});
  });

  it('replays Step-1 YAML grouping into mergedFrom', () => {
    const preceding = {
      extractedData: '```yaml\n[{"key":"a","name":"Alpha","value":1}]\n```',
      batchBiomarkers: [
        { key: 'a', name: 'Alpha', value: 1 },
        { key: 'a2', name: 'Alpha variant', value: 1 },
      ],
    };
    const map = computeMergedInfoForStep2('agent2', preceding, {});
    const keys = Object.keys(map);
    expect(keys).toHaveLength(1);
    expect(map[keys[0]]).toEqual({ isMerged: true, mergedFrom: ['Alpha variant'] });
  });
});

describe('isKeyMarkedNotUsed', () => {
  it('matches exact, case-insensitive, and name-derived keys', () => {
    expect(isKeyMarkedNotUsed('hdl', undefined, { notUsedBiomarkers: { hdl: true } })).toBe(true);
    expect(isKeyMarkedNotUsed('HDL', undefined, { notUsedBiomarkers: { hdl: true } })).toBe(true);
    expect(
      isKeyMarkedNotUsed('x', 'Fasting Glucose', { notUsedBiomarkers: { fasting_glucose: true } }),
    ).toBe(true);
    expect(isKeyMarkedNotUsed('hdl', undefined, {})).toBe(false);
    expect(isKeyMarkedNotUsed('hdl', undefined, undefined)).toBe(false);
  });

  it('also consults notUsedInMedicalHistory', () => {
    expect(
      isKeyMarkedNotUsed('crp', undefined, { notUsedInMedicalHistory: { crp: true } }),
    ).toBe(true);
  });
});
