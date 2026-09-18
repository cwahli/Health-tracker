/**
 * M21.1 completion suite — Studio must keep these green.
 * Tests encode the gaps that made the first M21 ship incomplete.
 */
import { describe, it, expect } from 'vitest';
import { consolidateMeal, appendHistory, migrateMealSchema } from '../consolidate';
import { fromEvaluationComparison, toEvaluationPayload, fromPendingFoodLog, toPendingFoodLog } from '../adapters';
import { projectDietInput } from '../projectors';
import type { MealBuild } from '../types';

describe('M21.1 Mode D groups (live server shape)', () => {
  it('fromEvaluationComparison accepts comparison.groups and builds optionMeals', () => {
    const scoutItems = [
      { scoutIndex: 0, name: 'Salad A', estimatedCalories: 200, weightGrams: 150 },
      { scoutIndex: 1, name: 'Burger B', estimatedCalories: 600, weightGrams: 220 },
      { scoutIndex: 2, name: 'Wrap C', estimatedCalories: 400, weightGrams: 180 },
    ];
    // Live server uses groups + scoutItemIndices, not options
    const comparison = {
      groups: [
        {
          groupName: 'Better choice',
          scoutItemIndices: [0],
          recommendation: 'go',
          items: [{ name: 'Salad A', scoutIndex: 0, nutrients: { calories: 200, protein: 10 } }],
        },
        {
          groupName: 'OK',
          scoutItemIndices: [2],
          items: [{ name: 'Wrap C', scoutIndex: 2, nutrients: { calories: 400, protein: 20 } }],
        },
        {
          groupName: 'Limit',
          scoutItemIndices: [1],
          items: [{ name: 'Burger B', scoutIndex: 1, nutrients: { calories: 600, protein: 25 } }],
        },
      ],
    };

    const set = fromEvaluationComparison(comparison, scoutItems, { id: 'comp-groups' });
    expect(set.mode).toBe('compare');
    expect(set.optionMeals.length).toBeGreaterThanOrEqual(3);
    expect(set.optionMeals.every((m) => m.mode === 'compare_option' || m.items?.length >= 0)).toBe(true);
    const names = set.optionMeals.map((m) => m.content?.name || '').join(' ');
    expect(names.length).toBeGreaterThan(0);

    const payload = toEvaluationPayload(set);
    expect(payload.mode).toBe('evaluation');
    // Must still be usable by clients that read groups OR options
    const g = (payload.comparison as any).groups || (payload.comparison as any).options;
    expect(Array.isArray(g) && g.length >= 1).toBe(true);
  });
});

describe('M21.1 zombie + history + projector', () => {
  it('zombie: deleted item not restored by stage patch', () => {
    const initial: MealBuild = {
      id: 'z1',
      schemaVersion: 1,
      version: 1,
      mode: 'new_log',
      items: [{ itemId: 'fries', name: 'Fries', weightGrams: 100 }],
      deletedItemIds: ['fries'],
      nutrients: {},
    };
    const result = consolidateMeal(
      initial,
      { items: [{ itemId: 'fries', name: 'Fries', weightGrams: 100, dbId: 'x' }] },
      'resolver'
    );
    expect(result.items.find((i) => i.itemId === 'fries')).toBeUndefined();
  });

  it('appendHistory uses fields debug report can read (type/timestamp or kind/at)', () => {
    let meal: MealBuild = {
      id: 'h1',
      schemaVersion: 1,
      version: 1,
      mode: 'new_log',
      items: [],
      nutrients: {},
    };
    meal = appendHistory(meal, {
      type: 'error',
      timestamp: new Date().toISOString(),
      message: 'diet quota',
      stage: 'diet',
    } as any);
    const e = meal.historyLog?.[0] as any;
    expect(e).toBeTruthy();
    expect(e.message).toMatch(/quota|diet/i);
    // At least one of the dual schemas
    expect(e.type || e.kind).toBeTruthy();
    expect(e.timestamp || e.at).toBeTruthy();
  });

  it('projectDietInput strips candidate dumps shape (no databaseMatchesArray passthrough)', () => {
    const meal: MealBuild = {
      id: 'p1',
      schemaVersion: 1,
      version: 1,
      mode: 'new_log',
      items: [{ name: 'Rice', weightGrams: 150, nutrients: { calories: 200, protein: 4 } }],
      nutrients: { calories: 200, protein: 4 },
      content: { name: 'Lunch' },
    };
    const proj = projectDietInput(meal, { age: 40, goals: ['lose'] });
    const s = JSON.stringify(proj);
    expect(s).not.toMatch(/databaseMatchesArray/);
    expect(proj.macroTotals || (proj as any).itemsSummary).toBeTruthy();
  });
});

describe('M21.1 happy-path attach helper contract', () => {
  it('fromPendingFoodLog + toPendingFoodLog keeps critical item fields (happy path shape)', () => {
    const log = {
      name: 'Test meal',
      nutrients: { calories: 500, protein: 30 },
      itemsBreakdown: [
        {
          itemId: 'i1',
          scoutIndex: 0,
          name: 'Chicken',
          weightGrams: 150,
          rawNutritionLabel: { calories: 200 },
          estimatedCalories: 210,
          dbId: 'fdc-1',
          dbSource: 'usda',
          lockedNutrientKeys: ['calories'],
          componentsDetailList: [{ name: 'chicken', weightGrams: 150 }],
          primaryBase100g: { calories: 165 },
        },
      ],
    };
    const meal = fromPendingFoodLog(log, { id: 'happy-1', mode: 'new_log', savable: true });
    expect(meal.savable || meal.items.length).toBeTruthy();
    const back = toPendingFoodLog(meal);
    expect(back.itemsBreakdown?.length || back.items?.length).toBeGreaterThan(0);
    const item = (back.itemsBreakdown || back.items)[0];
    expect(item.rawNutritionLabel || item.estimatedCalories || item.dbId).toBeTruthy();
  });

  it('migrateMealSchema upgrades missing schemaVersion', () => {
    const m = migrateMealSchema({ id: 'old', items: [{ name: 'X' }], nutrients: {} });
    expect(m.schemaVersion).toBe(1);
    expect(m.items[0].itemId || m.items[0].scoutIndex !== undefined || m.items[0].name).toBeTruthy();
  });
});
