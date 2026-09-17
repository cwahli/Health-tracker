import { describe, it, expect } from 'vitest';
import { resolveMealVerdict, getVerdictColorClass } from './verdictUtils';

describe('verdictUtils', () => {
  it('returns null for empty or invalid source', () => {
    expect(resolveMealVerdict(null)).toBeNull();
    expect(resolveMealVerdict(undefined)).toBeNull();
    expect(resolveMealVerdict({})).toBeNull();
  });

  it('resolves direct object verdict', () => {
    const res = resolveMealVerdict({
      verdict: { label: 'Lean Muscle Support', level: 'good' },
    });
    expect(res).toEqual({
      label: 'Lean Muscle Support',
      level: 'good',
    });
  });

  it('resolves serialized JSON string verdict', () => {
    const res = resolveMealVerdict({
      verdict: JSON.stringify({ label: 'High Glycemic Sugar', level: 'alert' }),
    });
    expect(res).toEqual({
      label: 'High Glycemic Sugar',
      level: 'alert',
    });
  });

  it('resolves string verdict and infers level', () => {
    const res = resolveMealVerdict({
      verdict: 'Excess Saturated Fat',
    });
    expect(res?.label).toBe('Excess Saturated Fat');
    expect(res?.level).toBe('alert');
  });

  it('resolves nested verdict in agentResult or pendingFoodLog', () => {
    const fromAgent = resolveMealVerdict({
      agentResult: { verdict: { label: 'Portion Control', level: 'warning' } },
    });
    expect(fromAgent).toEqual({ label: 'Portion Control', level: 'warning' });

    const fromPending = resolveMealVerdict({
      pendingFoodLog: { verdict: { label: 'Healthy Balance', level: 'good' } },
    });
    expect(fromPending).toEqual({ label: 'Healthy Balance', level: 'good' });
  });

  it('falls back to recommendation when verdict is absent', () => {
    const fromRec = resolveMealVerdict({
      recommendation: 'good',
    });
    expect(fromRec?.level).toBe('good');
    expect(fromRec?.label).toBeTruthy();
  });

  it('localizes canonical verdict labels when language is provided', () => {
    const resId = resolveMealVerdict(
      { verdict: { label: 'High Glycemic Sugar', level: 'alert' } },
      'id'
    );
    expect(resId?.label).toBe('Gula Glikemik Tinggi');
    expect(resId?.level).toBe('alert');
  });

  it('assigns appropriate Tailwind color classes', () => {
    expect(getVerdictColorClass('alert')).toContain('rose');
    expect(getVerdictColorClass('warning')).toContain('amber');
    expect(getVerdictColorClass('good')).toContain('emerald');
  });
});
