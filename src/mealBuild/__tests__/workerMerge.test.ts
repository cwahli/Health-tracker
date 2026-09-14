import { describe, it, expect } from 'vitest';
import {
  buildWorkerTask,
  mergeWorkerDishResults,
  LeadDishItem,
  WorkerDishResult,
} from '../workerMerge';

describe('workerMerge (F-10.3)', () => {
  it('buildWorkerTask locks grams and isolates crop without re-estimating grams', () => {
    const lead: LeadDishItem = {
      dishId: 'dish_1',
      originalName: 'Crispy Pork Belly',
      weightGrams: 180,
      boundingBox2D: [120, 200, 450, 600],
      sourceImageIndex: 0,
      packageLabelText: null,
    };

    const task = buildWorkerTask(lead);
    expect(task.dishId).toBe('dish_1');
    expect(task.originalName).toBe('Crispy Pork Belly');
    expect(task.lockedWeightGrams).toBe(180);
    expect(task.boundingBox2D).toEqual([120, 200, 450, 600]);
    expect(task.sourceImageIndex).toBe(0);
  });

  it('merges worker nutrients strictly by dishId, preserving locked grams and computing Atwater calories', () => {
    const leadItems: LeadDishItem[] = [
      {
        dishId: 'dish_1',
        originalName: 'Tom Yum Soup',
        weightGrams: 350,
        lockedWeightGrams: 350,
        nutrients: { protein: 10, carbohydrates: 15, totalFat: 8 },
        ingredients: ['shrimp', 'broth'],
      },
      {
        dishId: 'dish_2',
        originalName: 'Steamed Rice',
        weightGrams: 200,
        lockedWeightGrams: 200,
        nutrients: { protein: 5, carbohydrates: 56, totalFat: 1 },
        ingredients: ['jasmine rice'],
      },
    ];

    // Worker provides refined nutrients for Tom Yum (e.g. 18g P, 12g C, 6g F, 1200mg sodium)
    const workerResults: WorkerDishResult[] = [
      {
        dishId: 'dish_1',
        nutrients: {
          protein: 18,
          carbohydrates: 12,
          totalFat: 6,
          saturatedFat: 2,
          transFat: 0,
          sodium: 1200,
        },
        ingredients: ['jumbo prawns', 'lemongrass', 'kaffir lime', 'chili broth'],
        cookingMethod: 'boiled',
        verdict: 'High-protein spicy Thai broth',
      },
    ];

    const merged = mergeWorkerDishResults(leadItems, workerResults);

    // Tom Yum was merged
    const tomYum = merged.find((d) => d.dishId === 'dish_1')!;
    expect(tomYum).toBeDefined();
    expect(tomYum.lockedWeightGrams).toBe(350);
    expect(tomYum.weightGrams).toBe(350);
    expect(tomYum.nutrients?.protein).toBe(18);
    expect(tomYum.nutrients?.carbohydrates).toBe(12);
    expect(tomYum.nutrients?.totalFat).toBe(6);
    // Atwater calories: 4*18 + 4*12 + 9*6 = 72 + 48 + 54 = 174 kcal
    expect(tomYum.nutrients?.calories).toBe(174);
    expect(tomYum.nutrients?.unsaturatedFat).toBe(4); // 6 - 2 = 4
    expect(tomYum.nutrients?.salt).toBe(3.05); // 1200 * 2.54 / 1000 = 3.05
    expect(tomYum.ingredients).toEqual(['jumbo prawns', 'lemongrass', 'kaffir lime', 'chili broth']);
    expect(tomYum.cookingMethod).toBe('boiled');
    expect(tomYum.workerMerged).toBe(true);

    // Rice was untouched
    const rice = merged.find((d) => d.dishId === 'dish_2')!;
    expect(rice).toBeDefined();
    expect(rice.weightGrams).toBe(200);
    expect(rice.nutrients?.protein).toBe(5);
    expect(rice.workerMerged).toBeUndefined();
  });
});
