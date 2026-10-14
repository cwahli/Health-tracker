import { describe, it, expect } from 'vitest';
import {
  dishKeyFor,
  stagedPortionKey,
  resolveBreakdownIndex,
  combineStagedDishWeight,
  staticBaseWeight,
} from './portionStaging';

/**
 * Sensor for class PORTION_MIXUP: multi-dropdown portion selection on the
 * meal card must address the right dish and recalculate exactly once, when
 * the selection set is complete.
 */
describe('portionStaging (PORTION_MIXUP sensor)', () => {
  // Two dishes with the same visible name, as rendered by FoodCard: each open
  // dish mounts NutritionLabelTable with a single-item list, so a positional
  // render index is always 0 for both.
  const dishA = { scoutIndex: 0, keyword: 'Nasi Goreng', weightGrams: 300 };
  const dishB = { scoutIndex: 1, keyword: 'Nasi Goreng', weightGrams: 200 };

  it('gives two same-named dishes distinct keys (old keyword||index key collides)', () => {
    // The old derivation: rootItem.id || rootItem.keyword || String(i),
    // with i === 0 in the single-dish tab view for BOTH dishes.
    const oldKeyFor = (item: any, i: number) => item.id || item.keyword || String(i);
    expect(oldKeyFor(dishA, 0)).toBe(oldKeyFor(dishB, 0)); // documents the bug

    expect(dishKeyFor(dishA, 0)).not.toBe(dishKeyFor(dishB, 0));
    expect(dishKeyFor(dishA, 0)).toBe('scout:0');
    expect(dishKeyFor(dishB, 0)).toBe('scout:1');
  });

  it('staged keys are namespaced per dish — dish B cannot shadow dish A', () => {
    const keyA = stagedPortionKey(dishKeyFor(dishA, 0), 1);
    const keyB = stagedPortionKey(dishKeyFor(dishB, 0), 1);
    expect(keyA).not.toBe(keyB);
    const staged: Record<string, number> = { [keyB]: 250 };
    expect(staged[keyA]).toBeUndefined();
  });

  it('resolves a displayed position past flattened component rows (old positional index hits the wrong row)', () => {
    const breakdown = [
      { scoutIndex: 0, name: 'Nasi Goreng', weightGrams: 300 },
      { scoutIndex: 0, name: 'Sambal', weightGrams: 20, role: 'component', isFlattenedComponent: true },
      { scoutIndex: 1, name: 'Ayam Goreng', weightGrams: 200 },
    ];
    // Displayed list filters the component row: [Nasi Goreng, Ayam Goreng].
    // Old code passed displayed index 1 straight into itemsBreakdown[1]
    // (the Sambal component row) — wrong dish scaled.
    expect(breakdown[1].name).toBe('Sambal');

    expect(resolveBreakdownIndex(breakdown, dishKeyFor(dishB, 1), 1)).toBe(2);
    expect(resolveBreakdownIndex(breakdown, dishKeyFor(dishA, 0), 0)).toBe(0);
  });

  it('falls back to the positional index only when identity matches nothing', () => {
    const breakdown = [{ name: 'Solo', weightGrams: 100 }];
    expect(resolveBreakdownIndex(breakdown, 'scout:99', 0)).toBe(0);
    expect(resolveBreakdownIndex(breakdown, 'scout:99', 7)).toBe(-1);
    expect(resolveBreakdownIndex(null, 'scout:0', 0)).toBe(-1);
  });

  const comps = [{ name: 'Rice' }, { name: 'Chicken' }];
  const defaultWeight = (c: any, total: number, n: number) => Math.round(total / n);

  it('partial staging is not a complete selection: no recalculation yet', () => {
    const dishKey = dishKeyFor({ scoutIndex: 5, keyword: 'Combo' }, 0);
    const staged: Record<string, number> = {
      [stagedPortionKey(dishKey, 1)]: 250, // Rice chosen; Chicken untouched
    };
    const res = combineStagedDishWeight(comps, staged, dishKey, 300, 300, defaultWeight);
    expect(res.selectedCount).toBe(1);
    expect(res.allSelected).toBe(false);
    // Preview mixes the staged pick with the untouched default — display only.
    expect(res.totalGrams).toBe(250 + 150);
  });

  it('full staging completes the selection: exactly one recalculation with the combined total', () => {
    const dishKey = dishKeyFor({ scoutIndex: 5, keyword: 'Combo' }, 0);
    const staged: Record<string, number> = {
      [stagedPortionKey(dishKey, 1)]: 250,
      [stagedPortionKey(dishKey, 2)]: 120,
    };
    const res = combineStagedDishWeight(comps, staged, dishKey, 300, 300, defaultWeight);
    expect(res.allSelected).toBe(true);
    expect(res.totalGrams).toBe(370);
    expect(res.dirty).toBe(true);
    // Parent applies ONE ratio for the whole dish: 370 / static 300.
    expect(Math.round((res.totalGrams / 300) * 1000) / 1000).toBe(1.233);
  });

  it('whole-dish override counts as a complete selection', () => {
    const dishKey = dishKeyFor({ scoutIndex: 5, keyword: 'Combo' }, 0);
    const res = combineStagedDishWeight(comps, {}, dishKey, 300, 300, defaultWeight, 450);
    expect(res.allSelected).toBe(true);
    expect(res.totalGrams).toBe(450);
    expect(res.dirty).toBe(true);
  });

  it('clean (unstaged) dish is not dirty', () => {
    const dishKey = dishKeyFor({ scoutIndex: 5, keyword: 'Combo' }, 0);
    const res = combineStagedDishWeight(comps, {}, dishKey, 300, 300, defaultWeight);
    expect(res.allSelected).toBe(false);
    expect(res.dirty).toBe(false);
  });

  it('derives the stable base from the live weight and its ratio (no compounding)', () => {
    expect(staticBaseWeight(220, 1.0)).toBe(220);
    expect(staticBaseWeight(330, 1.5)).toBe(220);
    expect(staticBaseWeight(165, 1.5)).toBe(110);
    expect(staticBaseWeight(165, undefined)).toBe(165);
    expect(staticBaseWeight(0, 1.5)).toBe(100);
  });
});
