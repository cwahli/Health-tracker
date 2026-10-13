import { describe, it, expect } from 'vitest';
import { preserveBundleFoodTotal } from '../storageUtils';

/**
 * Sensor for the bundle-poisoning half of class ALWAYS_COUNT_FALLBACK: a
 * bundle save without a meal total must never wipe a previously persisted
 * good total — every remount re-reads this value, and losing it pins meal
 * history to a few pages until a lucky pull.
 */
describe('Bundle meal-total preservation', () => {
  const bundle = (total?: number) => ({
    profile: {},
    foodLogs: [{ id: 'a' }],
    totalFoodsCount: total,
  });

  it('keeps an incoming positive total untouched', () => {
    const incoming = bundle(387);
    expect(preserveBundleFoodTotal(incoming, bundle(100))).toBe(incoming);
  });

  it('carries over a stored positive total when the save brings none', () => {
    const { totalFoodsCount, ...withoutTotal } = bundle(undefined);
    void totalFoodsCount;
    expect(preserveBundleFoodTotal(withoutTotal, bundle(387))).toEqual({
      ...withoutTotal,
      totalFoodsCount: 387,
    });
  });

  it('carries over when the save brings a non-positive total', () => {
    expect(preserveBundleFoodTotal(bundle(0), bundle(387)).totalFoodsCount).toBe(387);
  });

  it('changes nothing when neither side knows a total', () => {
    const { totalFoodsCount, ...withoutTotal } = bundle(undefined);
    void totalFoodsCount;
    expect(preserveBundleFoodTotal(withoutTotal, { foodLogs: [] })).toEqual(withoutTotal);
  });

  it('ignores non-bundle payloads', () => {
    expect(preserveBundleFoodTotal(null, bundle(387))).toBe(null);
    expect(preserveBundleFoodTotal({ a: 1 }, bundle(387))).toEqual({ a: 1 });
  });
});
