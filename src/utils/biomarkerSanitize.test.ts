import { describe, it, expect } from 'vitest';
import {
  isBiomarkerValueImprobable,
  getBiomarkerStatus,
  sanitizeBiomarkerHistoryOnLoad,
  normalizeHistoricalTelemetryErrors,
  parseNormalRangeBounds,
} from './biomarkers';

describe('parseNormalRangeBounds', () => {
  it('parses Aim under 5.0', () => {
    const b = parseNormalRangeBounds('Aim under 5.0');
    expect(b.max).toBe(5);
  });
});

describe('isBiomarkerValueImprobable', () => {
  it('flags 195 mmol/L total cholesterol', () => {
    expect(isBiomarkerValueImprobable('total_cholesterol', 195, 'Aim under 5.0')).toBe(true);
  });
  it('flags 42.1 hematocrit as %', () => {
    expect(isBiomarkerValueImprobable('hematocrit', 42.1, '0.36-0.50')).toBe(true);
  });
  it('flags 14.5 hemoglobin as g/dL when unit is g/L', () => {
    expect(isBiomarkerValueImprobable('hemoglobin', 14.5, '120-180')).toBe(true);
  });
  it('does not flag everyday step counts as improbable', () => {
    expect(isBiomarkerValueImprobable('steps', 3095, '7000 - 12000')).toBe(false);
    expect(isBiomarkerValueImprobable('steps', 0, '7000 - 12000')).toBe(false);
    expect(isBiomarkerValueImprobable('steps', 25000, '7000 - 12000')).toBe(false);
    expect(isBiomarkerValueImprobable('steps', -10, '7000 - 12000')).toBe(true);
    expect(getBiomarkerStatus('steps', 3095, '7000 - 12000')).toBe('low');
  });
});

describe('sanitizeBiomarkerHistoryOnLoad', () => {
  it('flags 195 cholesterol but does not rewrite it', () => {
    const history = [
      {
        id: '1',
        date: '08-08-2026',
        biomarkers: { total_cholesterol: 195 },
      },
      {
        id: '2',
        date: '02-08-2026',
        biomarkers: { total_cholesterol: 6.1 },
      },
    ];
    const { history: cleaned, fixedCount, current } = sanitizeBiomarkerHistoryOnLoad(history, {});
    expect(fixedCount).toBeGreaterThan(0);
    const aug8 = cleaned.find((h) => String(h.date).includes('08'));
    expect(Number(aug8?.biomarkers?.total_cholesterol)).toBe(195);
    expect(Number(current.total_cholesterol)).toBe(195);
  });

  it('flags hematocrit 42.1 but leaves the stored value', () => {
    const history = [{ id: '1', date: '08-08-2026', biomarkers: { hematocrit: 42.1 } }];
    const { history: cleaned, fixedCount } = sanitizeBiomarkerHistoryOnLoad(history, {
      customBiomarkers: { hematocrit: { normalRange: '0.36-0.50' } }
    });
    expect(fixedCount).toBeGreaterThan(0);
    expect(Number(cleaned[0].biomarkers.hematocrit)).toBeCloseTo(42.1, 1);
  });
});
