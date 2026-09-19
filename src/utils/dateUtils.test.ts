import { describe, it, expect } from 'vitest';
import { extractMostRecentImageDate, normalizeBiomarkerHistory, formatLogDateTime } from './dateUtils';

describe('extractMostRecentImageDate', () => {
  it('returns null for empty, undefined, or non-array inputs', () => {
    expect(extractMostRecentImageDate(undefined)).toBeNull();
    expect(extractMostRecentImageDate([])).toBeNull();
    expect(extractMostRecentImageDate(['', '   '])).toBeNull();
  });

  it('correctly parses EXIF format YYYY:MM:DD HH:MM:SS', () => {
    const dates = ['2026:05:14 18:30:00'];
    expect(extractMostRecentImageDate(dates)).toBe('2026-05-14');
  });

  it('correctly parses ISO strings', () => {
    const dates = ['2026-06-20T10:15:30.000Z'];
    expect(extractMostRecentImageDate(dates)).toBe('2026-06-20');
  });

  it('selects the most recent date when multiple image dates are provided', () => {
    const dates = [
      '2026-01-10T12:00:00Z',
      '2026:08:15 14:22:00',
      '2026-03-05T08:00:00Z'
    ];
    expect(extractMostRecentImageDate(dates)).toBe('2026-08-15');
  });

  it('handles numeric epoch timestamps', () => {
    const timestamp = new Date('2026-07-04T12:00:00Z').getTime();
    expect(extractMostRecentImageDate([timestamp])).toBe('2026-07-04');
  });
});

describe('normalizeBiomarkerHistory deduplication & merging', () => {
  it('deduplicates identical biomarker readings on the same date', () => {
    const logs = [
      { id: '1', date: '05-06-2026', biomarkers: { hematocrit: 48 }, note: 'Run 1' },
      { id: '2', date: '05-06-2026', biomarkers: { hematocrit: 48 }, note: 'Run 2' },
      { id: '3', date: '05-06-2026', biomarkers: { hematocrit: 48 }, note: 'Run 3' },
      { id: '4', date: '05-06-2026', biomarkers: { hematocrit: 48 }, note: 'Run 4' },
      { id: '5', date: '25-06-2025', biomarkers: { hematocrit: 30 } },
      { id: '6', date: '25-06-2025', biomarkers: { hematocrit: 30 } },
      { id: '7', date: '25-06-2025', biomarkers: { hematocrit: 30 } }
    ];

    const result = normalizeBiomarkerHistory(logs);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('05-06-2026');
    expect(result[0].biomarkers.hematocrit).toBe(48);
    expect(result[0].note).toContain('Run 1');
    expect(result[0].note).toContain('Run 2');
    expect(result[1].date).toBe('25-06-2025');
    expect(result[1].biomarkers.hematocrit).toBe(30);
  });

  it('merges non-conflicting biomarkers recorded on the same date', () => {
    const logs = [
      { id: '1', date: '2026-06-05', biomarkers: { hematocrit: 48 } },
      { id: '2', date: '05-06-2026', biomarkers: { hemoglobin: 15.2 } }
    ];

    const result = normalizeBiomarkerHistory(logs);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('05-06-2026');
    expect(result[0].biomarkers).toEqual({
      hematocrit: 48,
      hemoglobin: 15.2
    });
  });

  it('normalizes YYYY-MM-DD and DD-MM-YYYY dates and sorts newest first', () => {
    const logs = [
      { id: '1', date: '2024-04-02', biomarkers: { hematocrit: 48.8 } },
      { id: '2', date: '16-08-2026', biomarkers: { hematocrit: 42.1 } },
      { id: '3', date: '2025-06-25', biomarkers: { hematocrit: 30 } }
    ];

    const result = normalizeBiomarkerHistory(logs);
    expect(result.map(r => r.date)).toEqual(['16-08-2026', '25-06-2025', '02-04-2024']);
  });
});

describe('formatLogDateTime', () => {
  it('formats day, short month and 24h time in the given timezone', () => {
    expect(formatLogDateTime('2026-09-19', '2026-09-19T19:57:00Z', 'UTC')).toBe('19 sep 19:57');
    expect(formatLogDateTime('2026-09-19', Date.parse('2026-09-19T19:57:00Z'), 'UTC')).toBe('19 sep 19:57');
  });

  it('keeps day/month/time consistent from one instant across midnight', () => {
    // 00:30 UTC is still the previous day in New York — all three parts agree.
    expect(formatLogDateTime('2026-09-19', '2026-09-19T00:30:00Z', 'America/New_York')).toBe('18 sep 20:30');
  });

  it('renders midnight as 00:xx, never 24:xx', () => {
    expect(formatLogDateTime('2026-09-19', '2026-09-19T00:05:00Z', 'UTC')).toBe('19 sep 00:05');
  });

  it('falls back to the bare day without a timestamp', () => {
    expect(formatLogDateTime('2026-09-16', null, 'UTC')).toBe('16 sep');
    expect(formatLogDateTime('2026-09-16')).toBe('16 sep');
  });

  it('passes garbage through and returns empty for nothing', () => {
    expect(formatLogDateTime('not-a-date', 'garbage', 'UTC')).toBe('not-a-date');
    expect(formatLogDateTime('', null, 'UTC')).toBe('');
  });
});
