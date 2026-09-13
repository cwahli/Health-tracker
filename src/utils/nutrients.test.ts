import { describe, expect, it } from 'vitest';
import { getTopTargetNutrientKeys, PRIMARY_NUTRIENTS } from './nutrients';

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
});
