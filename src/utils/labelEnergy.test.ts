/**
 * Sensor for the printed-label energy class. Live:
 * job_1791044439374_4x4srekyi logged a 440 ml beer labelled "Energy: 54 kcal per
 * 100ml" at 88 kcal (22 g carbohydrate × 4) — a 63% understatement, because
 * Atwater cannot express alcohol energy.
 */
import { describe, it, expect } from 'vitest';
import { resolveLabelEnergyKcal, shouldPreferLabelEnergy } from './labelEnergy';

const BEER_LABEL = {
  servingSize: '100ml',
  calories: '54 kcal',
  addedSugar: '0g',
  protein: '0.0g',
  salt: '<0.01g',
  saturatedFat: '0.0g',
  sodium: '0g',
  sugar: '1.7g',
  totalCarbohydrate: '5.0g',
  totalFat: '0.0g',
};

describe('resolveLabelEnergyKcal', () => {
  it('live failure: 440 ml at 54 kcal/100ml is ~238 kcal, not the 88 kcal macros give', () => {
    const r = resolveLabelEnergyKcal({ rawNutritionLabel: BEER_LABEL, itemWeightGrams: 440 });
    expect(r.perServingKcal).toBe(54);
    expect(r.basisGrams).toBe(100);
    expect(r.kcal).toBe(238);
    expect(r.source).toBe('rawNutritionLabel');
  });

  it('scales by declared grams too', () => {
    const r = resolveLabelEnergyKcal({
      rawNutritionLabel: { servingSize: '30 g', calories: '150 kcal' },
      itemWeightGrams: 60,
    });
    expect(r.kcal).toBe(300);
  });

  it('reads kJ and normalizes to kcal', () => {
    const r = resolveLabelEnergyKcal({
      rawNutritionLabel: { servingSize: '100 g', calories: '783 kJ' },
      itemWeightGrams: 100,
    });
    expect(r.kcal).toBe(187);
  });

  it('falls back to the normalized per-serving panel', () => {
    const r = resolveLabelEnergyKcal({
      labelNutrientsPerServing: { calories: 54, servingSizeGrams: 100 },
      itemWeightGrams: 440,
    });
    expect(r.kcal).toBe(238);
    expect(r.source).toBe('labelNutrientsPerServing');
  });

  it('never charges an unscaled per-serving figure to the whole item', () => {
    const r = resolveLabelEnergyKcal({ rawNutritionLabel: { calories: '54 kcal' }, itemWeightGrams: 440 });
    expect(r.perServingKcal).toBe(54);
    expect(r.kcal).toBeNull();
  });

  it('returns null when the label prints no energy', () => {
    expect(resolveLabelEnergyKcal({ rawNutritionLabel: { protein: '10g' }, itemWeightGrams: 100 }).kcal).toBeNull();
    expect(resolveLabelEnergyKcal({ itemWeightGrams: 100 }).kcal).toBeNull();
  });

  it('returns null for a zero or missing consumed weight', () => {
    expect(resolveLabelEnergyKcal({ rawNutritionLabel: BEER_LABEL, itemWeightGrams: 0 }).kcal).toBeNull();
    expect(resolveLabelEnergyKcal({ rawNutritionLabel: BEER_LABEL }).kcal).toBeNull();
  });
});

describe('shouldPreferLabelEnergy', () => {
  it('the live 88 vs 238 case prefers the label', () => {
    expect(shouldPreferLabelEnergy({ derivedKcal: 88, labelKcal: 238 })).toBe(true);
  });

  it('ledger-aligned: an 8 kcal label gap is actionable (the ±5 kcal trial balance would flag it), 2 kcal dust is not', () => {
    // Bug-3 (card #3): the old 15%-only rule blessed 230-vs-238 as "no churn"
    // while the ledger flags any scout-vs-saved gap above 5 kcal — the two
    // checks could never agree. Gaps the ledger flags must be actionable here.
    expect(shouldPreferLabelEnergy({ derivedKcal: 230, labelKcal: 238 })).toBe(true);
    expect(shouldPreferLabelEnergy({ derivedKcal: 236, labelKcal: 238 })).toBe(false);
    expect(shouldPreferLabelEnergy({ derivedKcal: 240, labelKcal: 238 })).toBe(false);
  });

  it('never invents energy over a zero placeholder', () => {
    expect(shouldPreferLabelEnergy({ derivedKcal: 0, labelKcal: 238 })).toBe(false);
    expect(shouldPreferLabelEnergy({ derivedKcal: null, labelKcal: 238 })).toBe(false);
  });

  it('never fires without a usable label value', () => {
    expect(shouldPreferLabelEnergy({ derivedKcal: 88, labelKcal: null })).toBe(false);
    expect(shouldPreferLabelEnergy({ derivedKcal: 88, labelKcal: 0 })).toBe(false);
  });
});
