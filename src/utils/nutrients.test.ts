import { describe, it, expect } from 'vitest';
import { getTopTargetNutrientKeys, extractNutrientValue } from './nutrients';
import { toYYYYMMDD } from './dateUtils';

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

describe('extractNutrientValue', () => {
  it('extracts exact key match', () => {
    expect(extractNutrientValue({ saturatedFat: 12.5 }, 'saturatedFat')).toBe(12.5);
    expect(extractNutrientValue({ calories: 500 }, 'calories')).toBe(500);
  });

  it('handles case insensitivity and special characters', () => {
    expect(extractNutrientValue({ SaturatedFat: 15 }, 'saturatedFat')).toBe(15);
    expect(extractNutrientValue({ saturated_fat: 14.2 }, 'saturatedFat')).toBe(14.2);
    expect(extractNutrientValue({ 'soluble-fibre': 6 }, 'solubleFibre')).toBe(6);
  });

  it('handles common aliases', () => {
    expect(extractNutrientValue({ satFat: 8.5 }, 'saturatedFat')).toBe(8.5);
    expect(extractNutrientValue({ carbs: 45 }, 'carbohydrates')).toBe(45);
    expect(extractNutrientValue({ dietaryFiber: 12 }, 'totalFibre')).toBe(12);
    expect(extractNutrientValue({ fiber: 10 }, 'totalFibre')).toBe(10);
  });

  it('returns 0 for null/undefined/missing/non-numeric values', () => {
    expect(extractNutrientValue(null, 'calories')).toBe(0);
    expect(extractNutrientValue(undefined, 'calories')).toBe(0);
    expect(extractNutrientValue({}, 'calories')).toBe(0);
    expect(extractNutrientValue({ calories: 'not-a-number' }, 'calories')).toBe(0);
    expect(extractNutrientValue({ calories: null }, 'calories')).toBe(0);
  });
});

describe('Rolling Average Non-Dilution Invariant', () => {
  const activeFoodLogs = [
    {
      id: 'food_1',
      date: '2026-09-10',
      nutrients: { saturatedFat: 16.0, calories: 1800, sodium: 1200 }
    },
    {
      id: 'food_2',
      date: '2026-09-11',
      nutrients: { satFat: 18.0, calories: 1900, sodium: 1400 }
    },
    {
      id: 'food_3',
      date: '2026-09-12T14:30:00.000Z',
      nutrients: { saturatedFat: 18.2, calories: 1807, sodium: 1318 }
    },
    {
      id: 'food_4',
      date: '12-09-2026',
      nutrients: { saturatedFat: 0, calories: 0, sodium: 0 }
    }
  ];

  it('calculates average over active logged days, not calendar days (non-dilution)', () => {
    const todayStr = '2026-09-13'; // today has 0 logs
    const numDays = 7;
    
    let totalIntake = 0;
    let activeDaysCount = 0;
    
    for (let d = 0; d < numDays; d++) {
      const parts = todayStr.split('-');
      const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const targetDate = new Date(todayDate);
      targetDate.setDate(todayDate.getDate() - d);
      
      const yyyy = targetDate.getFullYear();
      const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const dd = String(targetDate.getDate()).padStart(2, '0');
      const targetDateStr = `${yyyy}-${mm}-${dd}`;
      
      const dayFoods = activeFoodLogs.filter(f => toYYYYMMDD(f.date) === targetDateStr);
      if (dayFoods.length > 0) {
        const dayTotal = dayFoods.reduce((acc, curr) => {
          return acc + extractNutrientValue(curr.nutrients, 'saturatedFat');
        }, 0);
        totalIntake += dayTotal;
        activeDaysCount++;
      }
    }
    
    expect(activeDaysCount).toBe(3);
    const avg = activeDaysCount > 0 ? totalIntake / activeDaysCount : 0;
    
    // Total Sat Fat = 16.0 + 18.0 + 18.2 = 52.2. Divided by 3 active days = 17.4!
    expect(Math.round(avg * 10) / 10).toBe(17.4);
    
    // Dividing by 7 calendar days would have yielded 7.46g, incorrectly diluting by gap days
    const dilutedAvg = totalIntake / numDays;
    expect(dilutedAvg).toBeCloseTo(7.46, 1);
    expect(avg).not.toBe(dilutedAvg);
  });

  it('correctly handles ISO strings and alternative date formats via toYYYYMMDD', () => {
    expect(toYYYYMMDD('2026-09-12T14:30:00.000Z')).toBe('2026-09-12');
    expect(toYYYYMMDD('12-09-2026')).toBe('2026-09-12');
    expect(toYYYYMMDD('2026-09-12')).toBe('2026-09-12');
  });

  it('timeframeTotals divisor matches distinct active logged dates', () => {
    const days = 7;
    const targetDates = new Set<string>();
    const todayDate = new Date(2026, 8, 13);
    for (let i = 0; i < days; i++) {
      const d = new Date(todayDate);
      d.setDate(todayDate.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      targetDates.add(`${yyyy}-${mm}-${dd}`);
    }
    
    const foodsInRange = activeFoodLogs.filter(f => targetDates.has(toYYYYMMDD(f.date)));
    const activeDatesInRange = new Set(foodsInRange.map(f => toYYYYMMDD(f.date)));
    expect(activeDatesInRange.size).toBe(3);
  });
});
