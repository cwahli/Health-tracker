import { describe, it, expect } from 'vitest';
import { aggregateItemsNutrients } from './server_nutrient_aggregation';
import { autoSpotFood } from './src/utils/bugAutoSpot';
import { lookupCanonicalBaseFood } from './server_food_db';

// Bug-2 repro (card #2, tag_muwyto2i_lv3uyw):
// Saved item 'Sainsbury oat with milk' carries 16 micro keys at exactly 0.
// Root hypothesis: CANONICAL_BASE_FOODS.sainsbury_rolled_oats is micro-poor
// (macros + sodium/potassium/fibre only), so STEP 2.2 imputation in
// aggregateItemsNutrients fills almost nothing and the zero-initialized
// NUTRIENT_KEYS publish a wall of explicit 0s, tripping MICROS_ZERO (>=8).
const MICRO_KEYS = [
  'potassium', 'magnesium', 'calcium', 'iron', 'zinc', 'selenium', 'iodine',
  'phosphorus', 'vitaminD', 'vitaminB12', 'folate', 'vitaminC', 'vitaminE',
  'vitaminK', 'vitaminA', 'vitaminB6', 'thiamine', 'riboflavin', 'niacin',
];

function zeroMicroCount(nutrients: Record<string, any>): number {
  let zeros = 0;
  for (const k of MICRO_KEYS) {
    const v = nutrients?.[k];
    if (v == null || v === '') continue;
    if (Number(v) === 0) zeros += 1;
  }
  return zeros;
}

// Brand catalog row brand_menu_items_local.json :: sainsbury_oat_with_milk
// (110 kcal/100g, macros + salt/sodium only — no micros).
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

describe('bug2 repro: sainsbury oat with milk micro wall', () => {
  it('canonical lookup for the composite query carries grain minerals', () => {
    const c: any = lookupCanonicalBaseFood('Sainsbury oat with milk');
    expect(c).toBeTruthy();
    for (const k of ['calcium', 'magnesium', 'iron', 'zinc']) {
      expect(Number(c[k]) > 0, `canonical micro ${k} should be > 0, got ${c[k]}`).toBe(true);
    }
  });

  it('brand-locked oat-with-milk item imputes micros (fewer than 8 zero micro keys)', () => {
    const rawItems = [
      {
        name: 'Sainsbury oat with milk',
        canonicalDbName: 'Sainsbury oat with milk',
        originalName: 'Sainsbury oat with milk',
        keyword: 'Sainsbury oat with milk',
        weightGrams: 260,
        dbSource: 'brand_official',
        chainName: "Sainsbury's",
        labelNutrientsPerServing: { ...BRAND_ROW_PER_100G },
        foodType: 'grain',
      },
    ];
    const result = aggregateItemsNutrients(rawItems, 260, new Map(), [], () => {});
    expect(result.itemsBreakdown).toHaveLength(1);
    const itemNutrients = (result.itemsBreakdown[0] as any).nutrients;
    const zeros = zeroMicroCount(itemNutrients);
    expect(zeros < 8, `expected < 8 zero micro keys, got ${zeros}`).toBe(true);

    const hits = autoSpotFood({
      foodLog: {
        itemsBreakdown: [
          { originalName: 'Sainsbury oat with milk', dbSource: 'brand_official', nutrients: itemNutrients },
        ],
      },
    });
    expect(hits.remaining.filter((h) => h.code === 'MICROS_ZERO')).toEqual([]);
  });
});
