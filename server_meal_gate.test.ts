import { describe, it, expect } from 'vitest';
import { evaluateMealGate, MealGateInput } from './server_meal_gate';

describe('evaluateMealGate', () => {
  it('passes on a balanced, consistent meal', () => {
    const input: MealGateInput = {
      mealId: 'food_101',
      name: 'Grilled Salmon with Brown Rice and Asparagus',
      weightGrams: 450,
      calories: 550,
      protein: 42,
      carbohydrates: 45,
      totalFat: 22,
      mealHasImages: true,
      imageCount: 1,
      items: [
        {
          name: 'Grilled Salmon Fillet',
          weightGrams: 200,
          calories: 360,
          protein: 38,
          carbohydrates: 0,
          totalFat: 20,
          sourceImageIndex: 0,
        },
        {
          name: 'Steamed Brown Rice',
          weightGrams: 150,
          calories: 165,
          protein: 3.5,
          carbohydrates: 35,
          totalFat: 1.5,
          sourceImageIndex: 0,
        },
        {
          name: 'Grilled Asparagus',
          weightGrams: 100,
          calories: 25,
          protein: 2.5,
          carbohydrates: 4,
          totalFat: 0.5,
          sourceImageIndex: 0,
        },
      ],
      narrative: "Great dinner! You received 42g of protein and about 550 kcal to hit your recovery goals.",
    };

    const result = evaluateMealGate(input);
    expect(result.pass).toBe(true);
    expect(result.savable).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('fails with ZERO_KCAL_WITH_MACROS when an item has 0 kcal but positive macros', () => {
    const input: MealGateInput = {
      mealId: 'food_102',
      name: 'Tofu Stir Fry',
      weightGrams: 300,
      calories: 200,
      protein: 25,
      carbohydrates: 10,
      totalFat: 12,
      items: [
        {
          name: 'Pan-Seared Tempeh',
          weightGrams: 150,
          calories: 0, // BUG: 0 kcal with 22g protein, 8g fat
          protein: 22,
          carbohydrates: 5,
          totalFat: 8,
          sourceImageIndex: 0,
        },
        {
          name: 'Stir Fry Greens',
          weightGrams: 150,
          calories: 200,
          protein: 3,
          carbohydrates: 5,
          totalFat: 4,
          sourceImageIndex: 0,
        },
      ],
    };

    const result = evaluateMealGate(input);
    expect(result.pass).toBe(false);
    expect(result.savable).toBe(false);
    expect(result.failures.some(f => f.code === 'ZERO_KCAL_WITH_MACROS')).toBe(true);
  });

  it('fails with ATWATER_DEVIATION when item calories deviate > 35% from 4*P + 4*C + 9*F on unlocked food', () => {
    const input: MealGateInput = {
      mealId: 'food_103',
      name: 'Roast Duck',
      weightGrams: 200,
      calories: 120, // Expected: 4*30 + 4*0 + 9*25 = 120 + 225 = 345 kcal. 120 is >35% off.
      protein: 30,
      carbohydrates: 0,
      totalFat: 25,
      items: [
        {
          name: 'Roast Duck Breast',
          weightGrams: 200,
          calories: 120,
          protein: 30,
          carbohydrates: 0,
          totalFat: 25,
          sourceImageIndex: 0,
        },
      ],
    };

    const result = evaluateMealGate(input);
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.code === 'ATWATER_DEVIATION')).toBe(true);
  });

  it('allows Atwater deviation if item has lockedNutrientKeys containing calories or is label/brand_official', () => {
    const input: MealGateInput = {
      mealId: 'food_104',
      name: 'Diet Fiber Bar',
      weightGrams: 50,
      calories: 90,
      protein: 15,
      carbohydrates: 20,
      totalFat: 3,
      items: [
        {
          name: 'Packaged Fiber Protein Bar',
          weightGrams: 50,
          calories: 90,
          protein: 15,
          carbohydrates: 20,
          totalFat: 3,
          lockedNutrientKeys: ['calories'],
          dbSource: 'label',
          sourceImageIndex: 0,
        },
      ],
    };

    const result = evaluateMealGate(input);
    expect(result.failures.some(f => f.code === 'ATWATER_DEVIATION')).toBe(false);
  });

  it('fails with SUM_MISMATCH when item calories do not sum to meal calories', () => {
    const input: MealGateInput = {
      mealId: 'food_105',
      name: 'Snack Plate',
      weightGrams: 100,
      calories: 500, // Meal claims 500, but sum of items is 250
      protein: 10,
      items: [
        {
          name: 'Edamame',
          weightGrams: 100,
          calories: 250,
          protein: 10,
          carbohydrates: 15,
          totalFat: 8,
          sourceImageIndex: 0,
        },
      ],
    };

    const result = evaluateMealGate(input);
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.code === 'SUM_MISMATCH')).toBe(true);
  });

  it('fails with NARRATIVE_MISMATCH when narrative claims conflicting protein or calories without staleDietNarrative flag', () => {
    const input: MealGateInput = {
      mealId: 'food_106',
      name: 'Greek Yogurt Bowl',
      weightGrams: 250,
      calories: 300,
      protein: 25,
      carbohydrates: 30,
      totalFat: 5,
      items: [
        {
          name: 'Greek Yogurt with Berries',
          weightGrams: 250,
          calories: 300,
          protein: 25,
          carbohydrates: 30,
          totalFat: 5,
          sourceImageIndex: 0,
        },
      ],
      narrative: "You logged 12g of protein and 150 kcal with this bowl.", // Conflicting with 25g P and 300 kcal
      staleDietNarrative: false,
    };

    const result = evaluateMealGate(input);
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.code === 'NARRATIVE_MISMATCH')).toBe(true);
  });

  it('fails with UNSPECIFIED_WEIGHT_MUTATION when unmentioned side changes weight', () => {
    const input: MealGateInput = {
      mealId: 'food_107',
      name: 'Steak Dinner',
      weightGrams: 400,
      calories: 600,
      protein: 40,
      previousMeal: {
        items: [
          { name: 'Ribeye Steak', weightGrams: 200, calories: 450, protein: 40, carbohydrates: 0, totalFat: 30, sourceImageIndex: 0 },
          { name: 'Potato Wedges', weightGrams: 150, calories: 150, protein: 3, carbohydrates: 25, totalFat: 4, sourceImageIndex: 0 },
        ],
      },
      commands: [
        { action: 'update_weight', itemName: 'Ribeye Steak', newWeightGrams: 250 },
      ],
      items: [
        { name: 'Ribeye Steak', weightGrams: 250, calories: 560, protein: 50, carbohydrates: 0, totalFat: 37, sourceImageIndex: 0 },
        { name: 'Potato Wedges', weightGrams: 100, calories: 100, protein: 2, carbohydrates: 17, totalFat: 2.7, sourceImageIndex: 0 }, // Mutated from 150g to 100g without command!
      ],
    };

    const result = evaluateMealGate(input);
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.code === 'UNSPECIFIED_WEIGHT_MUTATION')).toBe(true);
  });

  it('fails with CONDIMENT_HIGH_PROTEIN when condiment has unrealistic meat-like protein density', () => {
    const input: MealGateInput = {
      mealId: 'food_108',
      name: 'Salad',
      weightGrams: 250,
      calories: 300,
      protein: 16,
      items: [
        {
          name: 'Balsamic Vinaigrette Sauce',
          weightGrams: 50,
          calories: 150,
          protein: 12, // 12g protein in 50g sauce = 24% protein density! Unrealistic for vinaigrette
          carbohydrates: 5,
          totalFat: 10,
          sourceImageIndex: 0,
        },
        {
          name: 'Garden Salad',
          weightGrams: 200,
          calories: 150,
          protein: 4,
          carbohydrates: 20,
          totalFat: 3,
          sourceImageIndex: 0,
        },
      ],
    };

    const result = evaluateMealGate(input);
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.code === 'CONDIMENT_HIGH_PROTEIN')).toBe(true);
  });
});
