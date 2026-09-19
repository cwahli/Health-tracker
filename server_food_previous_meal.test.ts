import { describe, it, expect } from 'vitest';
import { mapPreviousMealRow, previousMealImageUrls, collectRefPhotoIds, substituteRefPhotos } from './server_food_previous_meal';
import { calculateCompositeMeal } from './src/utils/compositeFoodCalculation';

/** The row a composite save writes: nutrition + OCR evidence live on item 0. */
const oatRow = (overrides: any = {}) => ({
  id: 'food_oat_1',
  name: 'Mr. Oat Quick Cook Oatmeal',
  date: '2026-09-19',
  weight_grams: 130,
  calories: 0,
  nutrients: {},
  image_urls: ['/photos/food_oat_1.jpg', '/photos/food_oat_1_1.jpg'],
  items_breakdown: [
    {
      id: 'food_oat_1_i0',
      name: 'Mr. Oat Quick Cook Oatmeal',
      weightGrams: 130,
      calories: 498,
      protein: 16.4,
      carbohydrates: 97.5,
      totalFat: 7.8,
      saturatedFat: 1.4,
      totalFibre: 13.4,
      sodium: 3,
      imageUrl: '/photos/food_oat_1_i0.jpg',
      dbSource: 'label',
      rawNutritionLabel: { servingSize: '130g', calories: '498' },
      labelNutrientsPerServing: { calories: 498, protein: 16.4 },
    },
  ],
  ...overrides,
});

describe('mapPreviousMealRow', () => {
  it('keeps identity, type and photos', () => {
    const row = mapPreviousMealRow(oatRow());
    expect(row.type).toBe('previous_meal');
    expect(row.id).toBe('food_oat_1');
    expect(row.name).toBe('Mr. Oat Quick Cook Oatmeal');
    expect(row.food_id).toBe('food_oat_1');
    expect(row.imageUrl).toBe('/photos/food_oat_1.jpg');
    expect(row.imageUrls).toEqual(['/photos/food_oat_1.jpg', '/photos/food_oat_1_1.jpg']);
    expect(row.portionGrams).toBe(130);
    expect(row.weightGrams).toBe(130);
  });

  it('lifts a single item’s OCR provenance to the top level (badge can render)', () => {
    const row = mapPreviousMealRow(oatRow());
    expect(row.dbSource).toBe('label');
    expect(row.rawNutritionLabel).toEqual({ servingSize: '130g', calories: '498' });
    expect(row.labelNutrientsPerServing).toEqual({ calories: 498, protein: 16.4 });
  });

  it('surfaces nutrition values even when the meal row stored none', () => {
    const row = mapPreviousMealRow(oatRow());
    expect(row.calories).toBe(498);
    expect(row.protein).toBe(16.4);
    expect(row.carbohydrates).toBe(97.5);
    expect(row.totalFat).toBe(7.8);
    expect(row.totalFibre).toBe(13.4);
    expect(row.nutrients.calories).toBe(498);
    expect(row.nutrients.carbohydrates).toBe(97.5);
  });

  it('exposes the item list under both spellings so tiles can read it', () => {
    const row = mapPreviousMealRow(oatRow());
    expect(row.items_breakdown).toHaveLength(1);
    expect(row.itemsBreakdown).toBe(row.items_breakdown);
    expect(row.itemsBreakdown[0].imageUrl).toBe('/photos/food_oat_1_i0.jpg');
  });

  it('does not lift item evidence from a multi-item meal (it would misattribute)', () => {
    const row = mapPreviousMealRow(
      oatRow({
        items_breakdown: [
          { name: 'Oats', calories: 300, dbSource: 'label', rawNutritionLabel: { calories: '300' } },
          { name: 'Milk', calories: 90, dbSource: 'usda' },
        ],
      }),
    );
    expect(row.dbSource).toBeUndefined();
    expect(row.rawNutritionLabel).toBeUndefined();
    expect(row.itemsBreakdown).toHaveLength(2);
  });

  it('prefers real top-level values over the item fallback', () => {
    const row = mapPreviousMealRow(
      oatRow({
        calories: 480,
        protein: 15,
        nutrients: { calories: 480, protein: 15, sodium: 120 },
        dbSource: 'brand_official',
      }),
    );
    expect(row.calories).toBe(480);
    expect(row.protein).toBe(15);
    expect(row.dbSource).toBe('brand_official');
    // Item-only keys still fill in the ones the meal row lacks.
    expect(row.carbohydrates).toBe(97.5);
    expect(row.nutrients.sodium).toBe(120);
  });

  it('accepts client camelCase rows unchanged in shape', () => {
    const row = mapPreviousMealRow({
      id: 'local_1',
      name: 'Oat Bowl',
      weightGrams: 210,
      imageUrls: ['/photos/local_1.jpg'],
      items_breakdown: [{ name: 'Oat Bowl', calories: 320, dbSource: 'label', rawNutritionLabel: { calories: '320' } }],
    });
    expect(row.weightGrams).toBe(210);
    expect(row.calories).toBe(320);
    expect(row.dbSource).toBe('label');
  });

  it('leaves a legacy row without items usable (no invented evidence)', () => {
    const row = mapPreviousMealRow({ id: 'legacy_1', name: 'Old Meal', weight_grams: 250, image_urls: [] });
    expect(row.calories).toBeUndefined();
    expect(row.dbSource).toBeUndefined();
    expect(row.itemsBreakdown).toBeUndefined();
    // Falls back to the deterministic photo proxy like the old projection did.
    expect(row.imageUrls).toEqual(['/photos/legacy_1.jpg']);
  });

  it('is defensive about null / non-object rows', () => {
    expect(mapPreviousMealRow(null).type).toBe('previous_meal');
    expect(mapPreviousMealRow(undefined).name).toBeUndefined();
  });
});

/**
 * The search row feeds the client's composite restage directly, so the two ends
 * of the contract are asserted together: a reused saved meal must arrive with
 * nutrition values and OCR provenance, not an empty 0.00 breakdown.
 */
describe('projection → calculateCompositeMeal contract', () => {
  it('renders values and the OCR badge for a reused saved meal with no donor row', () => {
    const projected = mapPreviousMealRow(oatRow());
    const meal = calculateCompositeMeal([
      {
        source: 'previous_meal',
        dbId: projected.id,
        name: projected.name,
        weightGrams: 130,
        originalLog: projected,
        imageUrl: projected.imageUrl,
      } as any,
    ]);
    expect(meal.roundedCal).toBe(498);
    expect(meal.roundedProt).toBe(16.4);
    expect(meal.roundedCarb).toBe(97.5);
    const item = meal.itemsBreakdown[0];
    expect(item.calories).toBe(498);
    expect(item.dbSource).toBe('label');
    expect(item.rawNutritionLabel).toEqual({ servingSize: '130g', calories: '498' });
    // The meal hero photo leads; the item's own photo is still carried for the tiles.
    expect(item.imageUrl).toBe('/photos/food_oat_1.jpg');
    expect(meal.allImages).toContain('/photos/food_oat_1.jpg');
    expect(meal.allImages).toContain('/photos/food_oat_1_i0.jpg');
  });

  it('scales the label evidence with the portion factor', () => {
    const projected = mapPreviousMealRow(oatRow());
    const meal = calculateCompositeMeal([
      {
        source: 'previous_meal',
        dbId: projected.id,
        name: projected.name,
        weightGrams: 260,
        originalLog: projected,
      } as any,
    ]);
    expect(meal.roundedCal).toBe(996);
    expect(meal.itemsBreakdown[0].labelNutrientsPerServing).toEqual({ calories: 996, protein: 32.8 });
  });
});

describe('previousMealImageUrls', () => {
  it('drops snapshot placeholders and unusable tokens', () => {
    expect(
      previousMealImageUrls({ id: 'x', image_urls: ['[image_removed_for_snapshot]', 'Image reference preserved', 'loading', '/photos/x.jpg'] }),
    ).toEqual(['/photos/x.jpg']);
  });

  it('synthesizes the proxy url for a real id but never for brand rows', () => {
    expect(previousMealImageUrls({ id: 'food_1' })).toEqual(['/photos/food_1.jpg']);
    expect(previousMealImageUrls({ id: 'brand_menu_oat' })).toEqual([]);
  });

  it('never ships a ref: pointer as a photo', () => {
    expect(previousMealImageUrls({ id: 'food_dup', image_urls: ['ref:food_orig'] })).toEqual(['/photos/food_dup.jpg']);
  });
});

describe('ref: photo pointer substitution', () => {
  const dupRow = () => ({
    id: 'food_dup_1',
    name: 'Mr. Oat Quick Cook Oatmeal',
    date: '2026-09-16',
    weight_grams: 175,
    calories: 280,
    nutrients: {},
    image_urls: ['ref:food_orig_1'],
  });

  it('collects pointer ids from top-level photo fields', () => {
    expect(collectRefPhotoIds([dupRow(), { id: 'x', imageUrl: 'ref:food_orig_2' }, { id: 'y' }])).toEqual([
      'food_orig_1',
      'food_orig_2',
    ]);
  });

  it('substitutes the primary real photos ahead of projection', () => {
    const rows = substituteRefPhotos([dupRow()], new Map([['food_orig_1', ['/photos/job_oat.jpg']]]));
    expect(rows[0].image_urls).toEqual(['/photos/job_oat.jpg']);
    const projected = mapPreviousMealRow(rows[0]);
    expect(projected.imageUrl).toBe('/photos/job_oat.jpg');
    expect(projected.imageUrls).toEqual(['/photos/job_oat.jpg']);
  });

  it('drops dangling pointers instead of shipping them', () => {
    const rows = substituteRefPhotos([dupRow()], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].image_urls).toEqual(['ref:food_orig_1']);
    // Without a resolved primary the pointer never reaches the client as a photo.
    expect(previousMealImageUrls(rows[0])).toEqual(['/photos/food_dup_1.jpg']);
    const rows2 = substituteRefPhotos([dupRow()], new Map([['other', ['/photos/x.jpg']]]));
    expect(mapPreviousMealRow(rows2[0]).imageUrls).toEqual(['/photos/food_dup_1.jpg']);
  });
});
