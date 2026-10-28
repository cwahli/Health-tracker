import { describe, expect, it } from 'vitest';
import { buildHealthCoachSystemInstruction } from './instruction';

describe('health coach record reply', () => {
  it('contains an allowance and a test plan', () => {
    const text = buildHealthCoachSystemInstruction({ language: 'en' });
    expect(text).toContain('"allowanceKcal"');
    expect(text).toContain('"testPlan"');
    expect(text).toContain('"agentType": "health_baseline"');
  });
});
