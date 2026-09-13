import { describe, it, expect } from 'vitest';
import { getTopTargetNutrientKeys } from './nutrients';

describe('getTopTargetNutrientKeys', () => {
  it('unifies topNutrientTargets and category targets preserving priority', () => {
    const report = {
      topNutrientTargets: ['saturatedFat', 'addedSugar'],
      healthBaselineCategories: [
        {
          priorityNutrientTargets: [{ nutrientKey: 'calories' }, { nutrientKey: 'solubleFibre' }]
        },
        {
          nutrientTargets: ['sodium']
        }
      ]
    };
    const profile = {
      topNutrientsToMonitor: ['protein']
    };
    const keys = getTopTargetNutrientKeys(report, profile);
    expect(keys).toEqual(['saturatedFat', 'addedSugar', 'calories', 'solubleFibre', 'sodium', 'protein']);
  });

  it('strictly excludes steps and non-core nutrients', () => {
    const report = {
      topNutrientTargets: ['steps', 'saturatedFat', 'vitaminD', 'addedSugar'],
      riskCategories: [
        {
          nutrientTargets: ['steps', 'calories']
        }
      ]
    };
    const profile = {
      topNutrientsToMonitor: ['steps', 'magnesium']
    };
    const keys = getTopTargetNutrientKeys(report, profile);
    expect(keys).toEqual(['saturatedFat', 'addedSugar', 'calories']);
    expect(keys).not.toContain('steps');
    expect(keys).not.toContain('vitaminD');
    expect(keys).not.toContain('magnesium');
  });

  it('falls back to PRIMARY_NUTRIENTS when inputs are empty', () => {
    expect(getTopTargetNutrientKeys(null, null)).toEqual(['calories', 'saturatedFat', 'sodium']);
    expect(getTopTargetNutrientKeys({}, {})).toEqual(['calories', 'saturatedFat', 'sodium']);
  });

  it('handles string items and object items with key/nutrientKey', () => {
    const report = {
      topNutrientTargets: [
        { nutrientKey: 'saturatedFat' },
        { key: 'addedSugar' },
        'calories'
      ]
    };
    const keys = getTopTargetNutrientKeys(report);
    expect(keys).toEqual(['saturatedFat', 'addedSugar', 'calories']);
  });
});
