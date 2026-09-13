import { describe, expect, it } from 'vitest';
import {
  canonicalNutrientKey,
  getTopTargetNutrientKeys,
  isLimitNutrient,
  isNutrientGoalMet,
  isNutrientOverLimit,
  lookupByNutrientKey,
  nutrientPolarity,
  PRIMARY_NUTRIENTS,
} from './nutrients';

describe('getTopTargetNutrientKeys', () => {
  it('never uses Object.keys(dailyNutrientTargets).slice(0, 5)', () => {
    const report = {
      dailyNutrientTargets: {
        folate: '400 mcg',
        iodine: '150 mcg',
        steps: '6000 steps',
        iron: '8 mg',
        zinc: '11 mg',
        calories: '1800 kcal',
        saturatedFat: '20 g',
        sodium: '1500 mg',
      },
    };
    const keys = getTopTargetNutrientKeys(report, {});
    expect(keys).not.toContain('steps');
    expect(keys).not.toContain('folate');
    expect(keys).not.toContain('iodine');
    expect(keys).toEqual(PRIMARY_NUTRIENTS.filter((k) => k !== 'steps'));
  });

  it('uses report.topNutrientTargets with core filter', () => {
    const report = {
      topNutrientTargets: ['calories', 'protein', 'folate', 'steps', 'sodium'],
    };
    expect(getTopTargetNutrientKeys(report, {})).toEqual(['calories', 'protein', 'sodium']);
  });

  it('falls through healthBaselineCategories then profile.topNutrientsToMonitor', () => {
    const report = {
      healthBaselineCategories: [{ priorityNutrientTargets: [{ nutrientKey: 'potassium' }, 'iron'] }],
    };
    const profile = { topNutrientsToMonitor: ['sodium'] };
    expect(getTopTargetNutrientKeys(report, profile)).toEqual(['potassium', 'sodium']);
  });

  it('canonicalizes snake_case coach keys so saturated_fat is not a duplicate of saturatedFat', () => {
    const report = {
      topNutrientTargets: [
        { nutrientKey: 'calories' },
        { nutrientKey: 'saturated_fat' },
        { nutrientKey: 'protein' },
        'saturatedFat',
      ],
    };
    expect(getTopTargetNutrientKeys(report, {})).toEqual(['calories', 'saturatedFat', 'protein']);
  });
});

describe('nutrient polarity (limit vs goal)', () => {
  it('treats sat fat / sodium / calories / added sugar as limits regardless of key shape', () => {
    for (const key of [
      'saturatedFat',
      'saturated_fat',
      'Saturated_fat',
      'sat fat',
      'satFat',
      'calories',
      'sodium',
      'addedSugar',
      'added_sugars',
      'transFat',
      'trans_fat',
      'totalFat',
      'sugar',
      'cholesterol',
      'salt',
      'carbohydrates',
      'carbs',
    ]) {
      expect(isLimitNutrient(key), key).toBe(true);
      expect(nutrientPolarity(key), key).toBe('limit');
    }
  });

  it('treats protein / fibre / unsaturated fat / micronutrients / steps as goals', () => {
    for (const key of [
      'protein',
      'solubleFibre',
      'soluble_fibre',
      'totalFibre',
      'fiber',
      'unsaturatedFat',
      'omega3',
      'potassium',
      'calcium',
      'vitaminD',
      'steps',
    ]) {
      expect(isLimitNutrient(key), key).toBe(false);
      expect(nutrientPolarity(key), key).toBe('goal');
    }
  });

  it('colors overage as harm only for limit nutrients (Home sat-fat +102% case)', () => {
    expect(isNutrientOverLimit('saturated_fat', 29, 14)).toBe(true);
    expect(isNutrientGoalMet('saturated_fat', 29, 14)).toBe(false);
    expect(isNutrientOverLimit('protein', 132, 65)).toBe(false);
    expect(isNutrientGoalMet('protein', 132, 65)).toBe(true);
    expect(isNutrientOverLimit('calories', 2522, 1500)).toBe(true);
    expect(isNutrientGoalMet('calories', 2522, 1500)).toBe(false);
    expect(isNutrientOverLimit('sodium', 1831, 2000)).toBe(false);
    expect(isNutrientGoalMet('sodium', 1831, 2000)).toBe(false);
  });

  it('canonicalNutrientKey maps coach wire names onto catalog codes', () => {
    expect(canonicalNutrientKey('saturated_fat')).toBe('saturatedFat');
    expect(canonicalNutrientKey('added_sugars')).toBe('addedSugar');
    expect(canonicalNutrientKey('fiber')).toBe('totalFibre');
    expect(canonicalNutrientKey('carbs')).toBe('carbohydrates');
  });

  it('lookupByNutrientKey reads snake_case or camelCase bags', () => {
    expect(lookupByNutrientKey({ saturated_fat: '< 14 g' }, 'saturatedFat')).toBe('< 14 g');
    expect(lookupByNutrientKey({ saturatedFat: 12 }, 'saturated_fat')).toBe(12);
    expect(lookupByNutrientKey({ saturated_fat: 29 }, 'satFat')).toBe(29);
    expect(lookupByNutrientKey({ calories: 1500 }, 'calories')).toBe(1500);
  });
});
