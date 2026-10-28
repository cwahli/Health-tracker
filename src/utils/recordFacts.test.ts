import { describe, expect, it } from 'vitest';
import { buildDebugMarkdownReport } from './debugPayload';
import { confirmedRecordFacts, mealRecordPayload } from './recordFacts';

describe('record facts', () => {
  it('builds a hemorrhoid flag and a sleep note and leaves a staged number off the meal payload', () => {
    const profile = {
      symptomDiaries: [
        { id: 'hemorrhoid', events: [{ confirmed: true, cells: [{ columnId: 'flag', value: 1 }] }] },
        { id: 'sleep', events: [{ confirmed: true, cells: [{ columnId: 'note', value: 'poor sleep' }] }] },
        { id: 'batch', events: [{ confirmed: false, cells: [{ columnId: 'hdl', value: 50 }] }] },
      ],
    };
    const payload = mealRecordPayload(profile);
    expect(confirmedRecordFacts(profile).filter((fact) => fact.confirmed).map((fact) => fact.label)).toEqual([
      'hemorrhoid diary',
      'poor sleep',
    ]);
    expect(payload.facts).toEqual(['hemorrhoid diary', 'poor sleep']);
    expect(payload.stagedLabNumbers).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('50');
    const markdown = buildDebugMarkdownReport({ jobId: 'job-record', patientContext: profile });
    expect(markdown).toContain('Record facts:');
    expect(markdown).toContain('hemorrhoid diary');
    expect(markdown).toContain('poor sleep');
  });
});
