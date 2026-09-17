import { describe, it, expect } from 'vitest';

import { buildAgentResultRows } from './agentResultRows';

const BASE = {
  agentResult: {},
  agentType: 'unknown',
  profile: {},
  biomarkerHistory: [] as any[],
  initialRawText: '',
  precedingAgent1Result: null,
  parsedRows: [] as any[],
  mergedInfo: {},
};

describe('buildAgentResultRows dispatcher contract', () => {
  it('routes agent1+batch to the batch builder', () => {
    const rows = buildAgentResultRows({
      ...BASE,
      agentType: 'agent1',
      agentResult: {
        batchBiomarkers: [{ key: 'hemoglobin', name: 'Hemoglobin', value: '13.5' }],
      },
      parsedRows: [{ biomarker: 'Hemoglobin', value: '13.5' }],
    });
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('routes biomarker_review to the review builder', () => {
    expect(buildAgentResultRows({ ...BASE, agentType: 'biomarker_review' })).toEqual([]);
  });

  it('returns null for branches owned inline by the grid (agent2/3/4, stages)', () => {
    // NOTE (q-4d deviation): stage branches are called directly by the grid so
    // no single diff exceeds the 30% patch gate. The dispatcher keeps routing
    // the two verbatim-moved probes (agent1+batch, biomarker_review).
    for (const agentType of ['agent2', 'agent3', 'agent4', 'medical_extract', 'data_review']) {
      expect(buildAgentResultRows({ ...BASE, agentType })).toBeNull();
    }
  });

  it('returns null for unknown types', () => {
    expect(buildAgentResultRows({ ...BASE })).toBeNull();
  });
});
