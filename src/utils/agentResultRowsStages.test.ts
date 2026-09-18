import { describe, it, expect } from 'vitest';

import {
  buildMedicalExtractRows,
  buildAgent2Rows,
  buildAgent3Rows,
  buildAgent4Rows,
  buildDataReviewRows,
} from './agentResultRowsStages';
import { resolveBiomarkerKey } from './agentResultParse';

describe('buildMedicalExtractRows (medical_extract array-in)', () => {
  it('maps entries to new rows', () => {
    const rows = buildMedicalExtractRows({
      agentResult: [{ biomarker: 'Hemoglobin', value: '13.5', unit: 'g/dL', date: '2026-09-01' }],
      profile: {},
      biomarkerHistory: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      biomarker: 'Hemoglobin',
      date: '2026-09-01',
      value: '13.5',
      unit: 'g/dL',
      isNew: true,
      isNewBiomarker: true,
      isNotUsed: false,
      isChanged: false,
      isSynced: false,
      changeReason: 'Extracted new Hemoglobin: 13.5 g/dL',
    });
    expect(rows[0].key).toBe(resolveBiomarkerKey('hemoglobin', 'Hemoglobin', {}));
  });

  it('expands entry.tests into parsed rows', () => {
    const rows = buildMedicalExtractRows({
      agentResult: [
        {
          date: '2026-09-02',
          tests: [{ originalTestName: 'Glucose', key: 'glucose', valueNumeric: 98, unit: 'mg/dL' }],
        },
      ],
      profile: {},
      biomarkerHistory: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ biomarker: 'Glucose', value: 98, unit: 'mg/dL' });
  });
});

describe('buildAgent2Rows', () => {
  it('maps bucketMapping entries with group/category flags', () => {
    const rows = buildAgent2Rows({
      agentResult: {
        bucketMapping: {
          Hemoglobin: { standardMedicalGrouping: 'Blood', riskCategories: ['Anemia'] },
        },
      },
      profile: {},
      mergedInfo: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      biomarker: 'Hemoglobin',
      group: 'Blood',
      oldGroup: 'Other',
      isGroupChanged: true,
      categories: 'Anemia',
      isCategoryChanged: true,
      isNew: true,
      isChanged: true,
      isMerged: false,
      changeReason: 'Mapped Hemoglobin to Blood',
      severity: 1,
      isAtRisk: true,
    });
  });

  it('marks merged rows from mergedInfo', () => {
    const rows = buildAgent2Rows({
      agentResult: { bucketMapping: { Hemoglobin: {} } },
      profile: {},
      mergedInfo: { hemoglobin: { isMerged: true, mergedFrom: ['Hgb'] } },
    });
    expect(rows[0]).toMatchObject({
      isMerged: true,
      isNew: false,
      changeReason: 'Merged from: Hgb. Mapped Hemoglobin to Other',
    });
  });
});

describe('buildAgent3Rows', () => {
  it('assembles bucket biomarkers with reading counts', () => {
    const rows = buildAgent3Rows({
      agentResult: {
        buckets: [
          {
            systemName: 'Blood',
            biomarkers: [
              { name: 'Hemoglobin', history: [{ date: '2026-09-01', value: '13.5' }] },
            ],
          },
        ],
      },
      profile: {},
      biomarkerHistory: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      biomarker: 'Hemoglobin',
      group: 'Blood',
      totalReadings: 1,
      isNew: true,
      isChanged: true,
      hasNewReadings: true,
      severity: 1,
      changeReason: 'Assembled new biomarker: Hemoglobin',
    });
    expect(rows[0].isAtRisk).toBeFalsy();
  });
});

describe('buildAgent4Rows', () => {
  it('maps prioritized conditions with risk tiers', () => {
    const rows = buildAgent4Rows({
      agentResult: {
        prioritizedConditions: [
          {
            conditionName: 'Anemia',
            riskTier: 'Moderate',
            biomarkers: [{ name: 'Hemoglobin' }],
          },
        ],
      },
      profile: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      biomarker: 'Hemoglobin',
      condition: 'Anemia',
      isNew: true,
      isChanged: true,
      severity: 1,
      changeReason: 'Associated with Anemia',
      isAtRisk: true,
      riskReason: 'Assessed as Moderate Risk condition: "Anemia"',
    });
  });
});

describe('buildDataReviewRows', () => {
  it('maps reviewed biomarkers (unit pinned via customBiomarkers)', () => {
    const rows = buildDataReviewRows({
      agentResult: {
        reviewedBiomarkers: [
          { key: 'hdl', name: 'HDL', userValue: '55', unit: 'mg/dL', status: 'Optimal' },
        ],
      },
      profile: { customBiomarkers: { hdl: { name: 'HDL', unit: 'mg/dL' } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      biomarker: 'HDL',
      key: 'hdl',
      value: '55',
      unit: 'mg/dL',
      isAtRisk: false,
      isActionZone: false,
      isChanged: false,
      isNew: false,
      severity: 0,
    });
    expect(rows[0].optimalValue).toBeDefined();
  });
});
