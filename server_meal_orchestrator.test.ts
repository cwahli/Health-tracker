/**
 * Live regression: job_1791044439374_4x4srekyi attached an empty meal as
 * savable. The edit executor now refuses to empty a meal, and this is the second
 * line of defence — whatever reaches finalize, a meal with zero items is never
 * savable, keeps no verdict, and reports why.
 */
import { describe, it, expect } from 'vitest';
import { attachHappyPathMealBuild } from './server_meal_orchestrator';

const BEER_ITEM = {
  scoutIndex: 0,
  name: 'Desperados Original Beer',
  canonicalDbName: 'Desperados Original Beer',
  originalName: 'Desperados Original Beer',
  weightGrams: 440,
  calories: 88,
  nutrients: { calories: 88, protein: 0, carbohydrates: 22, totalFat: 0 },
  sourceImageIndex: 0,
};

const EMPTY_PARSED = {
  id: 'meal_1791044454688',
  name: 'Desperados Beer',
  title: 'Desperados Beer',
  quantity: '1 serving',
  weightGrams: 0,
  calories: 0,
  items: [],
  itemsBreakdown: [],
  scoutItems: [],
  nutrients: {},
  verdict: { label: 'Supports sustained metabolic energy', level: 'good' },
  receiptTable: '### 🧾 Nutrition calculation\n\n| **🏆 GRAND MEAL TOTAL - 0g** | **0** |',
  savable: true,
};

const FULL_PARSED = {
  id: 'meal_1791044454688',
  name: 'Desperados Beer',
  quantity: '1 serving',
  weightGrams: 440,
  calories: 88,
  items: [BEER_ITEM],
  itemsBreakdown: [BEER_ITEM],
  nutrients: { calories: 88, protein: 0, carbohydrates: 22, totalFat: 0 },
  verdict: { label: 'High Alcohol and Sugar Load', level: 'alert' },
  savable: true,
};

describe('attachHappyPathMealBuild — empty meal refused', () => {
  it('live failure shape: an emptied meal is not savable and keeps no verdict', () => {
    const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
      parsedData: EMPTY_PARSED,
      jobId: 'job_1791044439374_4x4srekyi',
    });

    expect(mealBuild.savable).toBe(false);
    expect(pendingFoodLog.savable).toBe(false);
    expect(mealBuild.items).toEqual([]);
    expect(pendingFoodLog.calories).toBe(0);
  });

  it('the stale identity of a meal with no food is stripped, not carried forward', () => {
    const { pendingFoodLog } = attachHappyPathMealBuild({
      parsedData: EMPTY_PARSED,
      jobId: 'job_1791044439374_4x4srekyi',
    });
    expect(pendingFoodLog.quantity).toBe('');
    expect(pendingFoodLog.weightGrams).toBe(0);
    expect(pendingFoodLog.receiptTable).toBeFalsy();
  });

  it('an empty meal records why instead of a happy-path stage completion', () => {
    const { mealBuild } = attachHappyPathMealBuild({ parsedData: EMPTY_PARSED });
    expect(mealBuild.degradedStages).toContain('empty_meal');
    expect(mealBuild.lastCompletedStage).toBe('calculation');
    expect(mealBuild.historyLog?.some((h: any) => h.type === 'error')).toBe(true);
    expect(mealBuild.historyLog?.some((h: any) => /Happy-path meal attached/.test(h.message || ''))).toBe(false);
  });

  it('a real meal is unaffected and still logs the happy path', () => {
    const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({ parsedData: FULL_PARSED });
    expect(mealBuild.savable).toBe(true);
    expect(pendingFoodLog.savable).toBe(true);
    expect(mealBuild.items.length).toBe(1);
    expect(mealBuild.degradedStages).not.toContain('empty_meal');
    expect(pendingFoodLog.quantity).toBe('1 serving');
    expect(mealBuild.historyLog?.some((h: any) => /Happy-path meal attached/.test(h.message || ''))).toBe(true);
  });

  it('an edit that empties a populated active meal is refused too', () => {
    const activeMeal = {
      id: 'meal_1791044454688',
      name: 'Desperados Beer',
      itemsBreakdown: [BEER_ITEM],
      items: [BEER_ITEM],
      quantity: '1 serving',
      weightGrams: 440,
    };
    const { mealBuild } = attachHappyPathMealBuild({ parsedData: EMPTY_PARSED, activeMeal });
    expect(mealBuild.savable).toBe(false);
    expect(mealBuild.degradedStages).toContain('empty_meal');
  });

  it('a scout partial read is reported as degraded rather than a clean run', () => {
    const { mealBuild } = attachHappyPathMealBuild({
      parsedData: FULL_PARSED,
      degradedStages: ['scout_partial_read'],
    });
    expect(mealBuild.degradedStages).toContain('scout_partial_read');
    expect(mealBuild.lastCompletedStage).toBe('calculation');
    expect(mealBuild.savable).toBe(true);
  });
});
