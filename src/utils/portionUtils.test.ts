import { describe, it, expect } from 'vitest';
import { scaleMealPortion, scaleSingleDishPortion, applyPortionChoicesToLog, applyStagedComponentWeights } from './portionUtils';

describe('portionUtils', () => {
  const sampleLog: any = {
    weightGrams: 200,
    calories: 400,
    portionRatio: 1.0,
    portionAccepted: false,
    message: 'This meal provides 400 calories and 30g of protein.',
    nutrients: {
      calories: 400,
      proteinGrams: 30,
      carbsGrams: 40,
      fatGrams: 15,
    },
    itemsBreakdown: [
      {
        name: 'Grilled Chicken',
        weightGrams: 150,
        calories: 250,
        portionRatio: 1.0,
        nutrients: {
          calories: 250,
          proteinGrams: 25,
          carbsGrams: 0,
          fatGrams: 5,
        },
      },
      {
        name: 'Steamed Rice',
        weightGrams: 50,
        calories: 150,
        portionRatio: 1.0,
        nutrients: {
          calories: 150,
          proteinGrams: 5,
          carbsGrams: 40,
          fatGrams: 10,
        },
      },
    ],
  };

  it('scales total meal portion to custom ratio correctly', () => {
    // 1.5 ratio scaling (300g target)
    const scaled = scaleMealPortion(sampleLog, 1.5);

    expect(scaled.portionRatio).toBe(1.5);
    expect(scaled.weightGrams).toBe(300);
    expect(scaled.nutrients?.calories).toBe(600); // 400 * 1.5
    expect(scaled.itemsBreakdown[0].weightGrams).toBe(225); // 150 * 1.5
    expect(scaled.itemsBreakdown[1].weightGrams).toBe(75); // 50 * 1.5
    expect(scaled.receiptTable).toContain('GRAND MEAL TOTAL - 300g');
    expect(scaled.receiptTable).toContain('225g');
    expect(scaled.message).toContain('600 calories');
    expect(scaled.message).toContain('45g of protein');
  });

  it('scales single dish portion independently', () => {
    // Scale dish 0 (Grilled Chicken) to 2.0 ratio (300g)
    const scaled = scaleSingleDishPortion(sampleLog, 0, 2.0);

    expect(scaled.itemsBreakdown[0].portionRatio).toBe(2.0);
    expect(scaled.itemsBreakdown[0].weightGrams).toBe(300);
    expect(scaled.itemsBreakdown[0].calories).toBe(500); // 250 * 2
    expect(scaled.itemsBreakdown[1].weightGrams).toBe(50); // unchanged
    expect(scaled.weightGrams).toBe(350); // 300 + 50
    expect(scaled.receiptTable).toContain('300g');
    expect(scaled.receiptTable).toContain('GRAND MEAL TOTAL - 350g');
  });

  it('forces agent review when the current ledger density is physically impossible', () => {
    const insane: any = {
      weightGrams: 70,
      calories: 6300,
      nutrients: { calories: 6300, totalFat: 1750, protein: 2 },
      itemsBreakdown: [{ scoutIndex: 0, name: 'Pia 100 Nanas', weightGrams: 70, estimatedWeightGrams: 70, calories: 6300, nutrients: { calories: 6300, totalFat: 1750 } }],
    };
    const res = applyPortionChoicesToLog(insane, { '0': 70 });
    expect(res.isOverThreshold).toBe(true);
  });

  describe('applyStagedComponentWeights (PORTION_MIXUP sensor)', () => {
    const compositeLog: any = {
      weightGrams: 500,
      calories: 1100,
      portionRatio: 1.0,
      message: 'This meal provides 1100 calories and 50g of protein.',
      nutrients: { calories: 1100, protein: 50, carbohydrates: 80, totalFat: 40, saturatedFat: 13, sodium: 1400 },
      itemsBreakdown: [
        {
          scoutIndex: 0,
          name: 'Nasi Goreng',
          weightGrams: 300,
          estimatedWeightGrams: 300,
          portionRatio: 1.0,
          calories: 600,
          nutrients: { calories: 600, protein: 20, carbohydrates: 70, totalFat: 15, saturatedFat: 5, sodium: 800 },
          components: [
            { name: 'Rice', weightGrams: 200, estimatedWeightGrams: 200, calories: 260, nutrients: { calories: 260, protein: 5, carbohydrates: 56, totalFat: 1, saturatedFat: 0, sodium: 10 } },
            { name: 'Chicken', weightGrams: 100, estimatedWeightGrams: 100, calories: 340, nutrients: { calories: 340, protein: 15, carbohydrates: 14, totalFat: 14, saturatedFat: 5, sodium: 790 } },
          ],
        },
        {
          scoutIndex: 1,
          name: 'Ayam Goreng',
          weightGrams: 200,
          estimatedWeightGrams: 200,
          portionRatio: 1.0,
          calories: 500,
          nutrients: { calories: 500, protein: 30, carbohydrates: 10, totalFat: 25, saturatedFat: 8, sodium: 600 },
        },
      ],
    };

    it('applies every staged component in one pass — dish total is the sum of its parts', () => {
      const out = applyStagedComponentWeights(compositeLog, 0, { 0: 200, 1: 150 });
      const dish = out.itemsBreakdown[0];
      expect(dish.weightGrams).toBe(350);
      // Chicken rescaled to its staged grams (same single-scaler math):
      // 340 kcal @100g -> 510 kcal @150g.
      expect(dish.components[1].weightGrams).toBe(150);
      expect(dish.components[1].calories).toBe(510);
      expect(dish.components[0].weightGrams).toBe(200);
      // Dish is the sum of its parts — not a uniform dilution.
      expect(dish.calories).toBe(260 + 510);
      // Meal totals recompute once from the updated rows.
      expect(out.weightGrams).toBe(350 + 200);
      expect(out.calories).toBe(770 + 500);
      expect(out.receiptTable).toContain('GRAND MEAL TOTAL - 550g');
    });

    it('leaves unstaged components and other dishes untouched', () => {
      const out = applyStagedComponentWeights(compositeLog, 0, { 1: 150 });
      const dish = out.itemsBreakdown[0];
      expect(dish.weightGrams).toBe(350);
      expect(dish.components[0].weightGrams).toBe(200);
      expect(out.itemsBreakdown[1].weightGrams).toBe(200);
      expect(out.itemsBreakdown[1].calories).toBe(500);
    });

    it('is a no-op without staged entries or with an unknown dish', () => {
      expect(applyStagedComponentWeights(compositeLog, 0, {})).toBe(compositeLog);
      expect(applyStagedComponentWeights(compositeLog, 9, { 0: 100 })).toBe(compositeLog);
    });
  });
});

