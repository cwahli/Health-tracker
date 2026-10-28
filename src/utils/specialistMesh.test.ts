import { describe, expect, it } from 'vitest';
import { aliasStoredAgent, coachReply, handoff } from './specialistMesh';

describe('specialist mesh', () => {
  it('data_entry can name the coach, and the coach can name data_entry or literature', () => {
    expect(handoff('data_entry', 'health_baseline', 'needs a test plan', { marker: 'ldl' })?.returnToCaller).toBe(true);
    expect(handoff('health_baseline', 'data_entry', 'need the lab', {})?.toAgent).toBe('data_entry');
    expect(handoff('health_baseline', 'agent7', 'check the paper', {})?.toAgent).toBe('agent7');
    expect(handoff('data_entry', 'data_entry', 'same', {})).toBeNull();
  });

  it('old ids still open', () => {
    expect(aliasStoredAgent('medical')).toBe('data_entry');
    expect(aliasStoredAgent('agent4')).toBe('health_baseline');
    expect(aliasStoredAgent('agent5')).toBe('agent7');
  });

  it('a coach reply has an allowance and a test plan', () => {
    const reply = coachReply(1800, ['LDL']);
    expect(reply.allowanceKcal).toBe(1800);
    expect(reply.testPlan).toEqual(['LDL']);
  });
});
