import { describe, it, expect } from 'vitest';
import { fromPendingFoodLog, toPendingFoodLog, fromEvaluationComparison, toEvaluationPayload } from '../adapters';

describe('adapters roundtrip', () => {
  it('fixture with full item survives round-trip', () => {
    const fixture = {
      itemsBreakdown: [{
        itemId: '123',
        scoutIndex: 1,
        name: 'Full Item',
        dbId: 'db-1',
        primaryBase100g: { calories: 200 },
        componentsDetailList: [{ name: 'Comp1' }],
        rawNutritionLabel: { calories: 300 },
        estimatedCalories: 400
      }],
      items: [],
      nutrients: { calories: 400 },
      name: 'My Meal',
      title: 'My Meal',
      imageUrls: ['img.jpg']
    };
    
    const meal = fromPendingFoodLog(fixture);
    const roundTripped = toPendingFoodLog(meal);
    
    expect(roundTripped.itemsBreakdown[0].dbId).toBe('db-1');
    expect(roundTripped.itemsBreakdown[0].primaryBase100g).toEqual({ calories: 200 });
    expect(roundTripped.itemsBreakdown[0].componentsDetailList).toEqual([{ name: 'Comp1' }]);
    expect(roundTripped.itemsBreakdown[0].rawNutritionLabel).toEqual({ calories: 300 });
    expect(roundTripped.itemsBreakdown[0].estimatedCalories).toBe(400);
    expect(roundTripped.itemsBreakdown[0].scoutIndex).toBe(1);
    expect(roundTripped.name).toBe('My Meal');
    expect(roundTripped.imageUrls).toEqual(['img.jpg']);
  });
  
  it('Mode D: two option meals independent', () => {
    const comparison = {
      options: [
        { name: 'Opt 1', items: [{ name: 'Item A' }], nutrients: { calories: 100 } },
        { name: 'Opt 2', items: [{ name: 'Item B' }], nutrients: { calories: 200 } }
      ]
    };
    
    const set = fromEvaluationComparison(comparison, []);
    expect(set.optionMeals.length).toBe(2);
    expect(set.optionMeals[0].content?.name).toBe('Opt 1');
    expect(set.optionMeals[1].content?.name).toBe('Opt 2');
    
    const payload = toEvaluationPayload(set);
    expect(payload.mode).toBe('evaluation');
    expect(payload.comparison.options.length).toBe(2);
    expect(payload.comparison.options[0].name).toBe('Opt 1');
    expect(payload.scoutItems?.length).toBe(2);
  });
});
