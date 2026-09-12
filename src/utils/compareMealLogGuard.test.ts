import { describe, it, expect } from 'vitest';
import { isCompareOnlyResult } from './compareMealLogGuard';

describe('isCompareOnlyResult (Mode D meal boundary)', () => {
  it('flags evaluation+comparison results as never-a-meal', () => {
    expect(isCompareOnlyResult({ mode: 'evaluation', comparison: { groups: [{ groupName: 'g' }] } })).toBe(true);
    expect(isCompareOnlyResult({ mode: 'compare', comparison: { groups: [{ groupName: 'g' }] } })).toBe(true);
    expect(isCompareOnlyResult({ kind: 'food_compare', comparison: { groups: [{ groupName: 'g' }] } })).toBe(true);
    expect(isCompareOnlyResult({ mode: 'compare', groups: [{ groupName: 'g' }] })).toBe(true);
    expect(isCompareOnlyResult({ mode: 'compare', comparisonTitle: 'Menu Options' })).toBe(true);
  });

  it('passes meal modes through (new_log / modify / portion_clarify)', () => {
    expect(isCompareOnlyResult({ mode: 'new_log', items: [{ name: 'Rice' }] })).toBe(false);
    expect(isCompareOnlyResult({ mode: 'modify', pendingFoodLog: { name: 'Meal' } })).toBe(false);
    expect(isCompareOnlyResult({ mode: 'portion_clarify' })).toBe(false);
  });

  it('requires BOTH evaluation mode and a comparison object', () => {
    expect(isCompareOnlyResult({ mode: 'evaluation' })).toBe(false);
    expect(isCompareOnlyResult({ comparison: { groups: [] } })).toBe(false);
    expect(isCompareOnlyResult(null)).toBe(false);
    expect(isCompareOnlyResult(undefined)).toBe(false);
  });
});
