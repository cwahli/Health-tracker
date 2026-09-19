import { describe, it, expect } from 'vitest';
import { buildMealFromFinalizeLedgers, sumItemNutrients, ledgerToFoodItem } from './server_meal_from_finalize';

describe('buildMealFromFinalizeLedgers', () => {
  const iceCreamLedger = {
    scoutIndex: 0,
    originalName: 'Soft Serve Ice Cream Cone',
    keyword: 'ice cream',
    weightGrams: 120,
    nutrients: {
      calories: 253,
      protein: 4.5,
      totalFat: 8.3,
      saturatedFat: 5.5,
      carbohydrates: 40,
      sodium: 90,
    },
    dbSource: 'estimated',
    lockedNutrientKeys: [],
    boundingBox2D: [10, 20, 30, 40],
    sourceImageIndex: 2,
    componentsDetailList: [
      { name: 'Vanilla Soft Serve Ice Cream', weightGrams: 95, calories: 168, protein: 3, totalFat: 7.5, carbohydrates: 22 },
      { name: 'Waffle Cone', weightGrams: 25, calories: 85, protein: 1.5, totalFat: 0.8, carbohydrates: 18 },
    ],
  };

  it('maps finalize ledgers to items once — calories come from the ledger, not a second book', () => {
    const meal = buildMealFromFinalizeLedgers([iceCreamLedger], { mealName: 'Dessert' });
    expect(meal.items).toHaveLength(1);
    expect(meal.items[0].calories).toBe(253);
    expect(meal.items[0].nutrients.calories).toBe(253);
    expect(meal.nutrients.calories).toBe(253);
    expect(meal.weightGrams).toBe(120);
    expect(meal.receiptTable).toContain('253');
    expect(meal.receiptTable).toContain('GRAND MEAL TOTAL');
    expect(meal.items[0].sourceImageIndex).toBe(2);
    expect(meal.items[0].boundingBox2D).toEqual([10, 20, 30, 40]);
  });

  it('applies diet correctedNutrients without rebuilding the item list', () => {
    const meal = buildMealFromFinalizeLedgers([iceCreamLedger], {
      dietItems: [{
        scoutIndex: 0,
        canonicalDbName: 'Soft Serve Ice Cream Cone',
        weightGrams: 120,
        correctedNutrients: { sodium: 110 },
        clinicalCorrectionNote: 'Label sodium slightly higher',
      }],
    });
    expect(meal.items).toHaveLength(1);
    expect(meal.items[0].clinicalCorrectionNote).toMatch(/sodium/);
    expect(meal.items[0].nutrients.sodium).toBe(110);
  });

  it('sumItemNutrients matches item calories', () => {
    const a = ledgerToFoodItem({ originalName: 'A', weightGrams: 100, nutrients: { calories: 100, protein: 10, carbohydrates: 5, totalFat: 4 } });
    const b = ledgerToFoodItem({ originalName: 'B', weightGrams: 50, nutrients: { calories: 80, protein: 2, carbohydrates: 10, totalFat: 3 } });
    const sum = sumItemNutrients([a, b]);
    expect(sum.calories).toBe(180);
    expect(sum.protein).toBe(12);
  });
});

describe('label OCR evidence passthrough', () => {
  it('keeps rawNutritionLabel and labelNutrientsPerServing on the savable item', () => {
    const item = ledgerToFoodItem({
      originalName: 'Mr. Oat Quick Cook Oatmeal',
      weightGrams: 130,
      nutrients: { calories: 498, protein: 16.4 },
      dbSource: 'label',
      rawNutritionLabel: { servingSize: '130g', calories: '498' },
      labelNutrientsPerServing: { calories: 498, protein: 16.4 },
    });
    expect(item.dbSource).toBe('label');
    expect(item.rawNutritionLabel).toEqual({ servingSize: '130g', calories: '498' });
    expect(item.labelNutrientsPerServing).toEqual({ calories: 498, protein: 16.4 });
  });

  it('leaves estimated items without invented evidence', () => {
    const item = ledgerToFoodItem({ originalName: 'A', weightGrams: 100, nutrients: { calories: 100 } });
    expect(item.rawNutritionLabel).toBeNull();
    expect(item.labelNutrientsPerServing).toBeNull();
  });
});
