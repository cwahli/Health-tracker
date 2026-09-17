import { describe, it, expect } from 'vitest';
import { isDeepEqual, sanitizeProfile, pushPendingObservation, createDefaultProfile } from './appProfileUtils';

describe('appProfileUtils', () => {
  it('correctly compares deep equality', () => {
    expect(isDeepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(isDeepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } })).toBe(false);
    expect(isDeepEqual(null, null)).toBe(true);
    expect(isDeepEqual(null, {})).toBe(false);
  });

  it('sanitizes empty profile to valid default profile', () => {
    const p = sanitizeProfile(null);
    expect(p.name).toBe('Demo User');
    expect(p.email).toBe('demo@healthcockpit.com');
    expect(p.bmi).toBe(22.9);
  });

  it('calculates BMI when weight and height provided', () => {
    const p = sanitizeProfile({ weight: 80, height: 200 });
    expect(p.bmi).toBe(20.0);
  });

  it('pushes pending observations immutably', () => {
    const initial = createDefaultProfile();
    const updated = pushPendingObservation(initial, { id: 'obs_1', type: 'food' } as any);
    expect(updated.pendingObservations).toHaveLength(1);
    expect(initial.pendingObservations).toHaveLength(0);
  });
});
