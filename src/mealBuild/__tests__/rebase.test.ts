import { describe, it, expect } from 'vitest';
import { consolidateMeal, rebaseUserEdit } from '../consolidate';
import { fromEvaluationComparison, toEvaluationPayload, fromPendingFoodLog, toPendingFoodLog } from '../adapters';
import { MealBuild, ComparisonSet } from '../types';

describe('Phase 6: 409 OCC Rebase & Tombstones', () => {
  it('rebases user edit onto authoritative server meal with version increment', () => {
    const serverMeal: MealBuild = {
      id: 'meal-100',
      schemaVersion: 1,
      version: 3,
      mode: 'edit',
      items: [
        { itemId: 'item-1', name: 'Steak', weightGrams: 200, calories: 500 },
        { itemId: 'item-2', name: 'Rice', weightGrams: 150, calories: 200 }
      ],
      nutrients: { calories: 700 }
    };

    const localUserPatch: Partial<MealBuild> = {
      items: [
        { itemId: 'item-1', name: 'Steak', weightGrams: 250 } // User edited steak weight
      ]
    };

    const { rebasedMeal, success } = rebaseUserEdit(serverMeal, localUserPatch, 1);

    expect(success).toBe(true);
    expect(rebasedMeal.version).toBe(4);
    expect(rebasedMeal.items.find(i => i.itemId === 'item-1')?.weightGrams).toBe(250);
    // Rice is preserved untouched from server
    expect(rebasedMeal.items.find(i => i.itemId === 'item-2')?.weightGrams).toBe(150);
    expect(rebasedMeal.staleDietNarrative).toBe(true);
  });

  it('preserves deletedItemIds tombstones during rebase and prevents zombie items', () => {
    const serverMeal: MealBuild = {
      id: 'meal-101',
      schemaVersion: 1,
      version: 2,
      mode: 'edit',
      items: [
        { itemId: 'item-1', name: 'Chicken', weightGrams: 150 },
        { itemId: 'item-2', name: 'Soda', weightGrams: 350 }
      ],
      deletedItemIds: ['item-2'],
      nutrients: {}
    };

    const localUserPatch: Partial<MealBuild> = {
      items: [
        { itemId: 'item-2', name: 'Soda', weightGrams: 350 } // Server background stage tried sending soda back
      ],
      deletedItemIds: ['item-2']
    };

    const { rebasedMeal, success } = rebaseUserEdit(serverMeal, localUserPatch, 1);

    expect(success).toBe(true);
    expect(rebasedMeal.deletedItemIds).toContain('item-2');
    expect(rebasedMeal.items.find(i => i.itemId === 'item-2')).toBeUndefined();
  });

  it('fails rebase gracefully and records error after max 3 attempts', () => {
    const serverMeal: MealBuild = {
      id: 'meal-102',
      schemaVersion: 1,
      version: 5,
      mode: 'edit',
      items: [{ itemId: 'item-1', name: 'Salad', weightGrams: 100 }],
      nutrients: {}
    };

    const { rebasedMeal, success } = rebaseUserEdit(serverMeal, { items: [{ itemId: 'item-1', weightGrams: 120 }] }, 4);

    expect(success).toBe(false);
    expect(rebasedMeal.historyLog).toBeDefined();
    const lastHistory = rebasedMeal.historyLog?.[rebasedMeal.historyLog.length - 1];
    expect(lastHistory?.type).toBe('error');
    expect(lastHistory?.message).toContain('3 rebase attempts');
  });
});

describe('Phase 2 & 3: Stage Ledger & Roundtrip Persistence', () => {
  it('appends stage ledger records cleanly and preserves through adapters', () => {
    const initialMeal: MealBuild = {
      id: 'meal-200',
      schemaVersion: 1,
      version: 1,
      mode: 'new_log',
      items: [{ itemId: 'item-1', name: 'Oatmeal', weightGrams: 200 }],
      nutrients: { calories: 300 },
      stageLedger: [
        { stageKey: '1_scout_1', stage: 'scout', attempt: 1, timestamp: '2026-08-09T10:00:00Z', status: 'success' }
      ]
    };

    const updated = consolidateMeal(initialMeal, {}, 'calc', { stageKey: '1_calc_1' });
    expect(updated.stageLedger?.length).toBe(2);
    expect(updated.stageLedger?.[1].stageKey).toBe('1_calc_1');

    const pendingLog = toPendingFoodLog(updated);
    expect(pendingLog.itemsBreakdown.length).toBe(1);

    const roundTripped = fromPendingFoodLog(pendingLog, { stageLedger: updated.stageLedger });
    expect(roundTripped.stageLedger?.length).toBe(2);
  });
});

describe('Phase 5: Mode D Multi-Meal ComparisonSet', () => {
  it('builds ComparisonSet from evaluation payload and exports roundtrip payload', () => {
    const rawComparison = {
      options: [
        { name: 'Option A - Grilled Salmon', items: [{ name: 'Salmon', weightGrams: 180 }], nutrients: { calories: 350, protein: 34 } },
        { name: 'Option B - Turkey Breast', items: [{ name: 'Turkey', weightGrams: 200 }], nutrients: { calories: 280, protein: 42 } }
      ]
    };

    const scoutItems = [
      { name: 'Salmon', scoutIndex: 0 },
      { name: 'Turkey', scoutIndex: 1 }
    ];

    const comparisonSet: ComparisonSet = fromEvaluationComparison(rawComparison, scoutItems, { id: 'comp-500' });
    expect(comparisonSet.mode).toBe('compare');
    expect(comparisonSet.optionMeals.length).toBe(2);
    expect(comparisonSet.optionMeals[0].content?.name).toBe('Option A - Grilled Salmon');
    expect(comparisonSet.optionMeals[1].content?.name).toBe('Option B - Turkey Breast');

    const payload = toEvaluationPayload(comparisonSet);
    expect(payload.mode).toBe('evaluation');
    expect(payload.comparison.options.length).toBe(2);
    expect(payload.comparison.options[0].name).toBe('Option A - Grilled Salmon');
    expect(payload.scoutItems?.length).toBe(2);
  });
});
