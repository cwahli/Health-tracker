import { describe, it, expect } from 'vitest';
import { aggregateItemsNutrients } from './server_nutrient_aggregation';
import { detectLedgerImbalances } from './src/utils/goldenLedger';
import { shouldPreferLabelEnergy } from './src/utils/labelEnergy';

// Bug-3 repro (card #3, tag_muwyto87_lb78bc):
// Trial balance drifted: Scout Opening (300 kcal) != Saved Table (287 kcal).
// Root hypothesis: the printed-label energy gate (Label Energy Gate in
// server_nutrient_aggregation, rule in src/utils/labelEnergy) only overrules
// the macro-derived figure on gaps above a 15% relative tolerance. A
// label-backed 13 kcal gap (300 printed vs ~286 derived, 4.3%) sails through,
// so the saved table disagrees with printed-label truth AND trips the ledger's
// ±5 kcal trial-balance check — a gap the ledger flags can never be
// reconciled by the gate. The item below mirrors the card's meal: 260 g
// Sainsbury oat with milk (brand panel 110 kcal/100g → 286 derived) carrying
// a printed OCR panel stating 300 kcal for the 260 g serving, scout opening
// estimate 300.
const BRAND_ROW_PER_100G = {
  servingSizeGrams: 100,
  calories: 110,
  protein: 4.5,
  totalFat: 2.8,
  saturatedFat: 0.9,
  carbohydrates: 16.5,
  sugar: 3.2,
  totalFibre: 3.5,
  sodium: 20,
};

const OAT_LABEL_ITEM = {
  name: 'Sainsbury oat with milk',
  canonicalDbName: 'Sainsbury oat with milk',
  originalName: 'Sainsbury oat with milk',
  keyword: 'Sainsbury oat with milk',
  weightGrams: 260,
  dbSource: 'brand_official',
  chainName: "Sainsbury's",
  labelNutrientsPerServing: { ...BRAND_ROW_PER_100G },
  foodType: 'grain',
  estimatedCalories: 300,
  rawNutritionLabel: {
    calories: '300 kcal',
    servingSize: '260g',
    protein: '11.7g',
    totalFat: '7.3g',
    totalCarbohydrate: '42.9g',
  },
};

function aggregateOnce() {
  const result = aggregateItemsNutrients([OAT_LABEL_ITEM], 260, new Map(), [], () => {});
  expect(result.itemsBreakdown).toHaveLength(1);
  return result;
}

describe('bug3 repro: label-backed 300 kcal portion must save at label truth', () => {
  it('printed 300 kcal panel wins over the ~286 kcal derived figure', () => {
    const result = aggregateOnce();
    expect(
      result.itemsBreakdown[0].calories,
      `label truth 300 kcal should win, saved ${result.itemsBreakdown[0].calories}`
    ).toBe(300);
  });

  it('scout 300 vs saved table balances once label truth is honored', () => {
    const result = aggregateOnce();
    const imbalances = detectLedgerImbalances({
      scout: [{ estimatedCalories: 300 }],
      foodLog: { nutrients: { calories: result.nutrients.calories } },
    });
    expect(
      imbalances.filter((i) => i.id === 'ledger_scout_est_vs_saved_table'),
      `trial balance should agree, got ${JSON.stringify(imbalances.map((i) => i.label))}`
    ).toEqual([]);
  });

  it('gate primitives: a 13 kcal label gap is actionable, rounding dust is not', () => {
    expect(shouldPreferLabelEnergy({ derivedKcal: 287, labelKcal: 300 })).toBe(true);
    expect(shouldPreferLabelEnergy({ derivedKcal: 236, labelKcal: 238 })).toBe(false);
  });
});
