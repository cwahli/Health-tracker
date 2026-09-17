import { describe, it, expect } from 'vitest';

import {
  getInitialMarkersFromText,
  getInitialMarkerDetails,
  generateSafeKey,
  resolveBiomarkerKey,
  sanitizeUnitText,
} from './agentResultParse';

const CLINICAL = [
  'Hemoglobin: 13.5 g/dL',
  'Fasting Glucose - 98 mg/dL',
  'Date: 2026-09-01',
  'This is a long conversational paragraph without numbers that should be ignored by the parser entirely because it exceeds limits',
  'See https://example.com/report 12345',
].join('\n');

describe('getInitialMarkersFromText', () => {
  it('extracts marker names from colon and dash lines', () => {
    const markers = getInitialMarkersFromText(CLINICAL);
    expect(markers).toContain('Hemoglobin');
    expect(markers).toContain('Fasting Glucose');
  });

  it('ignores long lines, urls, and date words; dedupes', () => {
    const markers = getInitialMarkersFromText(`${CLINICAL}\nHemoglobin: 13.5 g/dL`);
    expect(markers.filter((m) => m === 'Hemoglobin')).toHaveLength(1);
    expect(markers.some((m) => m.toLowerCase().includes('http'))).toBe(false);
  });

  it('returns [] for empty text', () => {
    expect(getInitialMarkersFromText('')).toEqual([]);
  });
});

describe('getInitialMarkerDetails', () => {
  it('extracts value, unit, and the date line', () => {
    const details = getInitialMarkerDetails(CLINICAL);
    const hb = details.find((d) => d.biomarker === 'Hemoglobin');
    expect(hb).toMatchObject({ value: '13.5', unit: 'g/dL', date: '2026-09-01' });
  });

  it('returns [] when no markers found', () => {
    expect(getInitialMarkerDetails('no numbers here at all')).toEqual([]);
  });
});

describe('generateSafeKey', () => {
  it('strips brackets, lowercases, underscorizes', () => {
    expect(generateSafeKey('Fasting Glucose (Serum)')).toBe('fasting_glucose');
    expect(generateSafeKey('')).toBe('');
  });
});

describe('resolveBiomarkerKey', () => {
  it('falls back to the safe key when nothing matches', () => {
    expect(resolveBiomarkerKey('', 'Something New 123', {})).toBe('something_new_123');
  });

  it('matches a custom biomarker by name', () => {
    const profile = { customBiomarkers: { my_custom: { name: 'My Custom' } } };
    expect(resolveBiomarkerKey('my_custom', 'My Custom', profile)).toBe('my_custom');
  });
});

describe('sanitizeUnitText', () => {
  it('normalizes common unit spellings', () => {
    expect(sanitizeUnitText('mg/dL')).toBe('mg/dl');
    expect(sanitizeUnitText('percent')).toBe('%');
    expect(sanitizeUnitText('ng/ml')).toBe('ug/l');
    expect(sanitizeUnitText('')).toBe('');
  });
});
