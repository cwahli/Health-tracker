import { describe, it, expect } from 'vitest';
import { ceilDisplayValue, roundValue1Dec, weeklyTargetFromDaily } from './nutrientDisplay';

/**
 * Sensor for card #2 (tag_mufs4t96_wj02x7): "Home: omega-3 weekly shows
 * 7.700000000000001g". The fix (00b8cb1) rounds weeklyTarget; this pins the
 * whole float-dust class so it cannot regress in either display path.
 */
describe('nutrientDisplay float-dust rounding (card #2 class)', () => {
  it('weeklyTargetFromDaily: 1.1 daily → 7.7 weekly, never 7.700000000000001', () => {
    expect(weeklyTargetFromDaily(1.1)).toBe(7.7);
  });

  it('weeklyTargetFromDaily keeps round semantics (not ceil)', () => {
    expect(weeklyTargetFromDaily(2)).toBe(14);
    expect(weeklyTargetFromDaily(0.557)).toBe(3.9); // 3.899 → 3.9
    expect(weeklyTargetFromDaily(0)).toBe(0);
  });

  it('ceilDisplayValue: float dust on a tenth boundary does not ceil up', () => {
    expect(ceilDisplayValue(7.700000000000001)).toBe(7.7);
    expect(ceilDisplayValue(7.699999999999999)).toBe(7.7);
    // Pre-clean collapses 0.1+0.2-style dust onto the exact tenth: no remainder, no ceil.
    expect(ceilDisplayValue(0.30000000000000004)).toBe(0.3);
  });

  it('ceilDisplayValue: >= 10 stays an integer (no 10.1 from dust)', () => {
    expect(ceilDisplayValue(10)).toBe(10);
    expect(ceilDisplayValue(10.000000000000002)).toBe(10);
    expect(ceilDisplayValue(9.999999999999998)).toBe(10);
    // >= 10 branch ceils to a whole unit: dust-cleaned 23.45 → 24.
    expect(ceilDisplayValue(23.450000000000003)).toBe(24);
  });

  it('ceilDisplayValue: genuine fractions still ceil to 1 decimal', () => {
    expect(ceilDisplayValue(7.61)).toBe(7.7);
    expect(ceilDisplayValue(0.31)).toBe(0.4);
    expect(ceilDisplayValue(12.34)).toBe(13);
  });
});
