import { describe, it, expect } from 'vitest';
import { getTraceNutrientsForFoodType, getCookingMethodModifier, lookupCanonicalBaseFood } from './server_food_db';
import { classifyUniversalPhysicalFormV3 } from './server_matching_engine';

describe('getTraceNutrientsForFoodType', () => {
  it('returns base values at 100g', () => {
    const result = getTraceNutrientsForFoodType('red_meat', 100);
    expect(result.iron).toBeCloseTo(2.5, 2);
    expect(result.magnesium).toBeCloseTo(22, 2);
  });

  it('scales down linearly below 100g', () => {
    const result = getTraceNutrientsForFoodType('red_meat', 50);
    expect(result.iron).toBeCloseTo(1.25, 2);
  });

  it('scales up linearly above 100g', () => {
    const result = getTraceNutrientsForFoodType('leafy_veg', 200);
    expect(result.vitaminC).toBeCloseTo(100, 2);
  });

  it('falls back to the "unknown" profile for an unrecognized foodType', () => {
    const result = getTraceNutrientsForFoodType('not_a_real_type', 100);
    const unknown = getTraceNutrientsForFoodType('unknown', 100);
    expect(result).toEqual(unknown);
  });

  it('returns all zeros for beverage_zero at any weight', () => {
    const result = getTraceNutrientsForFoodType('beverage_zero', 390);
    expect(result.calcium).toBe(0);
    expect(result.phosphorus).toBe(0);
    expect(result.magnesium).toBe(0);
    expect(result.vitaminA).toBe(0);
    expect(result.vitaminC).toBe(0);
    expect(result.iron).toBe(0);
  });

  it('returns low realistic values for standard beverage', () => {
    const result = getTraceNutrientsForFoodType('beverage', 250);
    expect(result.calcium).toBeCloseTo(12.5, 1);
    expect(result.phosphorus).toBeCloseTo(25, 1);
    expect(result.vitaminA).toBe(0);
  });

  it('returns all zeros at weightGrams = 0', () => {
    const result = getTraceNutrientsForFoodType('fish_fatty', 0);
    expect(result.omega3).toBe(0);
    expect(result.vitaminD).toBe(0);
  });
});

describe('getCookingMethodModifier', () => {
  it('returns exact modifiers for direct keys', () => {
    const deepFried = getCookingMethodModifier('deep_fried');
    expect(deepFried.addedFatPer100g).toBe(10.0);
    expect(deepFried.addedCaloriesPer100g).toBe(90.0);

    const steamed = getCookingMethodModifier('steamed');
    expect(steamed.addedFatPer100g).toBe(0);
  });

  it('fuzzy matches lowercase/uppercase/substrings', () => {
    const deep = getCookingMethodModifier('DEEP fried');
    expect(deep.addedFatPer100g).toBe(10.0);

    const pan = getCookingMethodModifier('panfried chicken');
    expect(pan.addedFatPer100g).toBe(5.0);

    const boil = getCookingMethodModifier('boiled beef');
    expect(boil.addedFatPer100g).toBe(0.0);
  });

  it('defaults to unknown for empty/null/unrecognized methods', () => {
    const empty = getCookingMethodModifier(null);
    expect(empty.addedFatPer100g).toBe(0.0);

    const unrecognized = getCookingMethodModifier('magical_spell');
    expect(unrecognized.addedFatPer100g).toBe(0.0);
  });
});

describe('lookupCanonicalBaseFood (F-1 & F-2 Catalog-First Resolution)', () => {
  it('resolves canonical base foods instantly without network calls', () => {
    const salmon = lookupCanonicalBaseFood('Grilled Salmon');
    expect(salmon).toBeDefined();
    expect(salmon.id).toBe('grilled_salmon');
    expect(salmon.foodType).toBe('fish_fatty');
    expect(salmon.fdcId).toBeUndefined();

    const oats = lookupCanonicalBaseFood('Rolled Oats');
    expect(oats).toBeDefined();
    expect(oats.foodType).toBe('grain');

    const avocado = lookupCanonicalBaseFood('Fresh Avocado');
    expect(avocado).toBeDefined();
    expect(avocado.id).toBe('avocado');

    const painAuRaisin = lookupCanonicalBaseFood('Pain au Raisin');
    expect(painAuRaisin).toBeDefined();
    expect(painAuRaisin.id).toBe('pain_au_raisin');
    expect(painAuRaisin.foodType).toBe('grain');
    expect(painAuRaisin.calories).toBe(355);

    const cinnamonSwirl = lookupCanonicalBaseFood('Cinnamon Swirl');
    expect(cinnamonSwirl).toBeDefined();
    expect(cinnamonSwirl.id).toBe('cinnamon_swirl');
    expect(cinnamonSwirl.foodType).toBe('grain');

    const plainRaisins = lookupCanonicalBaseFood('Raisins');
    expect(plainRaisins).toBeDefined();
    expect(plainRaisins.id).toBe('raisins');
    expect(plainRaisins.foodType).toBe('fruit');
  });

  it('does not keep an in-memory USDA HTTP cache', async () => {
    const mod = await import('./server_food_db');
    expect((mod as any).getCachedUSDAFood).toBeUndefined();
    expect((mod as any).setCachedUSDAFood).toBeUndefined();
    expect((mod as any).LOCAL_USDA_CACHE).toBeUndefined();
  });

  it('classifies bakery/pastries with fruit in name as bakery_dessert rather than fruit_vegetable', () => {
    const pastryForm = classifyUniversalPhysicalFormV3({ name: 'Pain au Raisin' });
    expect(pastryForm.primaryCategory).toBe('bakery_dessert');
    expect(pastryForm.physicalForm).toBe('SOLID_GRAIN_BAKERY');

    const swirlForm = classifyUniversalPhysicalFormV3({ name: 'Cinnamon Swirl' });
    expect(swirlForm.primaryCategory).toBe('bakery_dessert');

    const rawFruitForm = classifyUniversalPhysicalFormV3({ name: 'Raisins' });
    expect(rawFruitForm.primaryCategory).toBe('fruit_vegetable');
  });
});


describe('FALSE_FRIEND class examples', () => {
  it('pomegranate seeds does not steal sesame seed', () => {
    const p = lookupCanonicalBaseFood('pomegranate seeds');
    expect(p?.id).not.toBe('sesame_seed');
  });

  it('individual berry species resolve to distinct base food references rather than falling back to generic mixed berries', () => {
    const s = lookupCanonicalBaseFood('strawberry');
    const b = lookupCanonicalBaseFood('blueberry');
    const r = lookupCanonicalBaseFood('raspberry');
    expect(s?.id).toBe('strawberry');
    expect(b?.id).toBe('blueberry');
    expect(r?.id).toBe('raspberry');
    expect(s?.id).not.toBe(b?.id);
    expect(r?.id).not.toBe(b?.id);
  });

  it('mixed fruit cup query returns canonical fruit cup instead of actimel or yogurt drink', () => {
    const res = lookupCanonicalBaseFood('mixed fruit cup');
    expect(res?.id).toBe('mixed_fruit_cup');
  });

  it('american cheese has comprehensive micronutrient profile populated', () => {
    const cheese = lookupCanonicalBaseFood('american cheese');
    expect(cheese).toBeDefined();
    expect(cheese!.vitaminC).toBeDefined();
    expect(cheese!.vitaminE).toBeDefined();
    expect(cheese!.vitaminK).toBeDefined();
    expect(cheese!.vitaminA).toBeDefined();
    expect(cheese!.iron).toBeDefined();
    expect(cheese!.calcium).toBeDefined();
    expect(cheese!.phosphorus).toBeDefined();
  });

  it('macaroni and cheese has comprehensive micronutrient profile populated', () => {
    const mac = lookupCanonicalBaseFood('macaroni and cheese');
    expect(mac).toBeDefined();
    expect(mac?.calcium).toBeGreaterThan(0);
    expect(mac?.iron).toBeGreaterThan(0);
    expect(mac?.magnesium).toBeGreaterThan(0);
    expect(mac?.zinc).toBeGreaterThan(0);
    expect(mac?.phosphorus).toBeGreaterThan(0);
  });

  it('crispy onion query returns canonical crispy onion instead of category fallback', () => {
    const res = lookupCanonicalBaseFood('crispy onion');
    expect(res?.id).toBe('crispy_onion');
  });

  it('ranch dressing query returns canonical ranch dressing instead of category fallback', () => {
    const res = lookupCanonicalBaseFood('ranch dressing');
    expect(res?.id).toBe('ranch_dressing');
  });

  it('gherkin query returns canonical gherkin instead of category fallback', () => {
    const res = lookupCanonicalBaseFood('gherkin');
    expect(res?.id).toBe('gherkin');
  });

  it('cobb salad query returns canonical cobb salad instead of salad dressing', () => {
    const res = lookupCanonicalBaseFood('cobb salad');
    expect(res?.id).toBe('cobb_salad');
  });

  it('resolves cooked bacon query to canonical bacon entry', () => {
    const res = lookupCanonicalBaseFood('cooked bacon');
    expect(res?.id).toBe('cooked_bacon');
  });

  it('F-3 FALSE_FRIEND PLANT_MILK_AS_DAIRY: plant milks never resolve to dairy milk', () => {
    for (const q of ['oat milk', 'soy milk', 'almond milk', 'coconut milk', 'Oat Milk Latte']) {
      const res = lookupCanonicalBaseFood(q);
      expect(res?.id).not.toBe('whole_cow_milk');
      expect(res?.foodType).not.toBe('dairy');
    }
    expect(lookupCanonicalBaseFood('whole milk')?.id).toBe('whole_cow_milk');
    expect(lookupCanonicalBaseFood('glass of milk')?.id).toBe('whole_cow_milk');
  });
});
