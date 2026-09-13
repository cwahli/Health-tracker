import { describe, it, expect, vi } from 'vitest';
import { normalizeFoodKey, normalizeDishKey, resolveInternalFood, checkAtwaterValidity, getFallbackCategoryProfile, upsertFoodAlias, mergeFoodCatalogItems, computeAliasHitRate, isNearDupCluster } from './server_food_catalog';
import { applyServerAverageNutrients } from './server_pure_helpers';
import { NUTRIENT_KEYS } from './src/utils/nutrients';

const aliasHitUpdates: any[] = [];
vi.mock('./supabaseAdmin', () => {
  const aliasRow = {
    hit_count: 4,
    weight: 1.0,
    food_items: {
      food_id: 'f_alias_oats', food_key: 'alias_oats_probe', display_name: 'Alias Oats',
      nutrients_per_100g: { calories: 350, protein: 10, carbohydrates: 60, totalFat: 8 },
      status: 'active', confidence: 0.9, fdc_id: 'alias_oats_fdc', form_tags: [], state: null,
    },
  };
  const chain = (data: any) => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = async () => ({ data, error: null });
    return b;
  };
  return {
    isSupabaseConfigured: true,
    supabaseAdmin: {
      from: (table: string) => {
        if (table !== 'food_aliases') return chain(null);
        const b: any = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: aliasRow, error: null });
        b.update = (vals: any) => {
          aliasHitUpdates.push(vals);
          return { eq: () => ({ catch: () => {} }) };
        };
        return b;
      },
    },
  };
});

describe('Food Catalog Normalization & Resolution (PASS 2 - R7)', () => {
  it('normalizes mac & cheese synonyms correctly', () => {
    expect(normalizeDishKey('Mac & Cheese')).toBe('macaroni_and_cheese');
    expect(normalizeDishKey('mac and cheese')).toBe('macaroni_and_cheese');
    expect(normalizeDishKey('Mac_N_Cheese')).toBe('macaroni_and_cheese');
    expect(normalizeDishKey('macaroni cheese')).toBe('macaroni_and_cheese');
  });

  it('resolves internal canonical food items', async () => {
    const match = await resolveInternalFood('Chicken Breast');
    expect(match).not.toBeNull();
    expect(match?.food_key).toBe('chicken_breast');
    expect(match?.source).toBe('canonical_local');
    expect(match?.nutrients_per_100g.protein).toBeGreaterThan(20);

    const cobbMatch = await resolveInternalFood('Cobb Salad');
    expect(cobbMatch).not.toBeNull();
    expect(cobbMatch?.source).toBe('canonical_local');
    expect(cobbMatch?.food_id).toBe('cobb_salad');
    expect(cobbMatch?.fdc_id).toBeNull();

    const caesarMatch = await resolveInternalFood('Caesar Dressing');
    expect(caesarMatch).not.toBeNull();
    expect(caesarMatch?.source).toBe('canonical_local');
    expect(caesarMatch?.nutrients_per_100g.totalFat).toBeGreaterThan(40);

    const balsamicMatch = await resolveInternalFood('Balsamic Vinaigrette');
    expect(balsamicMatch).not.toBeNull();
    expect(balsamicMatch?.source).toBe('canonical_local');
    expect(balsamicMatch?.nutrients_per_100g.calories).toBeGreaterThan(200);
  });

  it('normalizes arbitrary food names consistently', () => {
    expect(normalizeFoodKey('  Granola Fruit Cup! ')).toBe('granola_fruit_cup');
    expect(normalizeFoodKey('Whole-Wheat Bread')).toBe('whole_wheat_bread');
  });

  it('validates Atwater macronutrient-to-calorie consistency', () => {
    // Valid item: 10g P (40cal) + 20g C (80cal) + 5g F (45cal) = 165 cal stated vs 165 cal calculated
    const valid = checkAtwaterValidity({ calories: 165, protein: 10, carbohydrates: 20, totalFat: 5 });
    expect(valid.valid).toBe(true);

    // Invalid item: stated 500 cal vs calculated (10*4 + 20*4 + 5*9 = 165) -> ~67% diff
    const invalid = checkAtwaterValidity({ calories: 500, protein: 10, carbohydrates: 20, totalFat: 5 });
    expect(invalid.valid).toBe(false);
  });

  it('returns appropriate fallback category profiles with complete NUTRIENT_KEYS set', () => {
    const poultryProfile = getFallbackCategoryProfile('grilled chicken breast');
    expect(poultryProfile.protein).toBe(31);

    // Verify all NUTRIENT_KEYS are present in fallback profile
    NUTRIENT_KEYS.forEach(key => {
      expect(poultryProfile).toHaveProperty(key);
      expect(typeof poultryProfile[key]).toBe('number');
    });

    const beverageProfile = getFallbackCategoryProfile('black tea drink');
    expect(beverageProfile.calories).toBe(0);

    const produceProfile = getFallbackCategoryProfile('fresh apple slice');
    expect(produceProfile.carbohydrates).toBe(9);

    const pickleProfile = getFallbackCategoryProfile('dill pickle spear');
    expect(pickleProfile.calories).toBeLessThanOrEqual(45);
    expect(pickleProfile.sodium).toBeGreaterThan(500);

    const crispyShallotProfile = getFallbackCategoryProfile('crispy shallots garnish');
    expect(crispyShallotProfile.calories).toBeGreaterThan(450);
    expect(crispyShallotProfile.totalFat).toBeGreaterThan(30);
  });

  it('supports alias creation via upsertFoodAlias', async () => {
    const result = await upsertFoodAlias({
      alias_key: 'test_custom_alias',
      food_key: 'chicken_breast',
      source: 'manual_test'
    });
    expect(result.success).toBe(true);
  });

  it('calculates average nutrients for comparison groups correctly via applyServerAverageNutrients', () => {
    const groups = [
      { groupName: 'Group A', scoutItemIndices: [0, 1] }
    ];
    const preCalcByScoutIndex = {
      0: { calories: 100, protein: 10, totalFat: 2, carbohydrates: 15 },
      1: { calories: 200, protein: 20, totalFat: 4, carbohydrates: 25 }
    };
    const res = applyServerAverageNutrients(groups, preCalcByScoutIndex);
    expect(res[0].averageNutrients).toEqual({
      calories: 150,
      protein: 15,
      totalFat: 3,
      carbohydrates: 20
    });
  });

  it('rejects merge of incompatible food form tags in mergeFoodCatalogItems', async () => {
    const mergeRes = await mergeFoodCatalogItems({
      target_id: 'item_bar_1',
      source_id: 'item_loose_1',
      form_tags_target: ['bar'],
      form_tags_source: ['loose/cup']
    });
    expect(mergeRes.success).toBe(false);
    expect(mergeRes.error).toContain('Incompatible physical form tags');
  });

  it('F-4 increments alias hit_count on alias hits (hit rate becomes measurable)', async () => {
    aliasHitUpdates.length = 0;
    const match = await resolveInternalFood('Zxq Jkl Mno');
    expect(match).not.toBeNull();
    expect(match?.source).toBe('alias_active');
    expect(aliasHitUpdates).toHaveLength(1);
    expect(aliasHitUpdates[0].hit_count).toBe(5);
  });

  it('F-4 measures alias hit rate from hit_count rows (no silent merge metric)', () => {
    const r = computeAliasHitRate([
      { hit_count: 5 },
      { hit_count: 0 },
      { hit_count: 2 },
      {},
    ]);
    expect(r.total).toBe(4);
    expect(r.hitAliases).toBe(2);
    expect(r.totalHits).toBe(7);
    expect(r.hitRate).toBeCloseTo(0.5);
    expect(computeAliasHitRate([]).hitRate).toBe(0);
  });

  it('F-4 gates merges to near-duplicate clusters (same fdc_id or name+kcal)', () => {
    expect(isNearDupCluster(
      { display_name: 'Rolled Oats', fdc_id: '123', nutrients_per_100g: { calories: 350 } },
      { display_name: 'Rolled Oats Bulk', fdc_id: '123', nutrients_per_100g: { calories: 900 } },
    ).cluster).toBe(true);
    expect(isNearDupCluster(
      { display_name: 'Rolled Oats', nutrients_per_100g: { calories: 350, protein: 10, carbohydrates: 60, totalFat: 8 } },
      { display_name: 'Rolled Oats Bulk', nutrients_per_100g: { calories: 360, protein: 10, carbohydrates: 62, totalFat: 8 } },
    ).cluster).toBe(true);
    const far = isNearDupCluster(
      { display_name: 'Rolled Oats', fdc_id: '111', nutrients_per_100g: { calories: 350 } },
      { display_name: 'Chocolate Bar', fdc_id: '999', nutrients_per_100g: { calories: 500 } },
    );
    expect(far.cluster).toBe(false);
  });
});
