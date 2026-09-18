import { describe, it, expect } from 'vitest';
import { buildScorecardContract } from './scorecardContract';

describe('scorecard live contract (cannot swap inventories)', () => {
  it('echoes frozen Top Targets fallback and polarity lists', () => {
    const contract = buildScorecardContract();
    expect(contract.inventories.top_targets.helper).toBe('getTopTargetNutrientKeys');
    expect(contract.inventories.top_targets.polarity_helper).toBe('isLimitNutrient');
    expect(contract.inventories.top_targets.fallback).toEqual(['calories', 'saturatedFat', 'sodium']);
    expect(contract.inventories.top_targets.exclude).toEqual(['steps']);
    expect(contract.inventories.top_targets.limit_keys).toEqual([
      'calories',
      'totalFat',
      'saturatedFat',
      'transFat',
      'cholesterol',
      'sodium',
      'salt',
      'sugar',
      'addedSugar',
      'carbohydrates',
    ]);
  });

  it('keeps the 32-key meal ledger and kcal writer name', () => {
    const contract = buildScorecardContract();
    expect(contract.inventories.meal_ledger.kcal_writer).toBe('finalizeDishLedger');
    expect(contract.inventories.meal_ledger.nutrient_keys.length).toBe(32);
    expect(contract.inventories.meal_ledger.nutrient_key_count).toBe(32);
  });

  it('locks B0 convert multipliers and apply outputs', () => {
    const contract = buildScorecardContract();
    expect(contract.inventories.biomarkers.convert_via).toBe('ANALYTE_CONVERSIONS');
    expect(contract.inventories.biomarkers.multiply).toEqual({
      hdl: 0.02586,
      ldl: 0.02586,
      triglycerides: 0.01129,
      creatinine: 88.4,
      total_bilirubin: 17.1,
    });
    expect(contract.inventories.biomarkers.locked_apply).toEqual({
      hdl: 1.293,
      tg: 1.411,
      ldl: 3.362,
      creat: 79.56,
      bili: 13.68,
    });
  });
});
