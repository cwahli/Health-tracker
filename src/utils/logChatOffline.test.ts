import { describe, it, expect } from 'vitest';
import {
  isValidFoodLog,
  resolvePendingFoodLog,
  isValidValue,
  formatNutrientValue,
  safeJSONStringify,
  parseJsonOffline,
  getOfflineCategorization,
  performOfflineDataAssembly,
  extractBiomarkerKeysFromJson,
  extractBiomarkerKeysFromPrioritizedConditions,
  detectBiomarkersInText,
} from './logChatOffline';

describe('q-9 Node2 logChatOffline parity (verbatim extract)', () => {
  it('isValidFoodLog accepts names/items/nutrients, rejects junk', () => {
    expect(isValidFoodLog(null)).toBe(false);
    expect(isValidFoodLog({ name: 'Nasi Uduk' })).toBe(true);
    expect(isValidFoodLog({ itemsBreakdown: [{ name: 'rice' }] })).toBe(true);
    expect(isValidFoodLog({ nutrients: { protein: 10 } })).toBe(true);
    expect(isValidFoodLog({})).toBe(false);
  });

  it('resolvePendingFoodLog returns null for empty/compare, log for meals', () => {
    expect(resolvePendingFoodLog(null)).toBeNull();
    expect(resolvePendingFoodLog({})).toBeNull();
    const job = { result: { pendingFoodLog: { name: 'Meal', nutrients: { protein: 5 } } } };
    expect(resolvePendingFoodLog(job)).toMatchObject({ name: 'Meal' });
  });

  it('isValidValue/formatNutrientValue mirror inline semantics', () => {
    expect(isValidValue(null)).toBe(false);
    expect(isValidValue('N/A')).toBe(false);
    expect(isValidValue('rice')).toBe(true);
    expect(formatNutrientValue(null, 'g')).toBe('—');
  });

  it('safeJSONStringify drops circular refs without throwing', () => {
    const a: any = { x: 1 };
    a.self = a;
    expect(() => safeJSONStringify(a)).not.toThrow();
    expect(safeJSONStringify({ x: 1 })).toContain('"x":1');
  });

  it('parseJsonOffline parses biomarker arrays + regex fallback', () => {
    const arr = parseJsonOffline(JSON.stringify([{ biomarker: 'glucose', date: '2026-09-01', value: 95, unit: 'mg/dL' }]));
    expect(arr).toHaveLength(1);
    expect(arr[0]).toMatchObject({ biomarker: 'glucose' });
    expect(parseJsonOffline('')).toEqual([]);
  });

  it('offline categorization + assembly bucketize', () => {
    expect(getOfflineCategorization('ALT liver enzyme').standardMedicalGrouping).toBe('Hepatic');
    const asm = performOfflineDataAssembly(
      JSON.stringify([{ biomarker: 'glucose', date: '2026-09-01', value: 95, unit: 'mg/dL' }]),
      {},
    );
    expect(asm.entriesCount).toBe(1);
    expect(asm.buckets.length).toBeGreaterThan(0);
  });

  it('key extractors return string lists', () => {
    expect(extractBiomarkerKeysFromJson('')).toEqual([]);
    expect(extractBiomarkerKeysFromPrioritizedConditions([{ biomarkers: [{ key: 'glucose' }], biomarkerKeys: ['hdl'] }])).toEqual(
      expect.arrayContaining(['glucose', 'hdl']),
    );
    expect(Array.isArray(detectBiomarkersInText('fasting glucose 95'))).toBe(true);
  });
});
