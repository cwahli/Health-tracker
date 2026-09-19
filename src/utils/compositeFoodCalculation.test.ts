import { describe, it, expect } from 'vitest';
import { calculateCompositeMeal, parseTrayGramInput, normalizeTrayGrams, hydratePreviousMealTag, buildCompositeHealthImpact } from './compositeFoodCalculation';

describe('calculateCompositeMeal', () => {
  it('calculates single previous meal correctly without scaling (same portion)', () => {
    const previousMealTag: any = {
      name: 'Chicken Rice',
      dbId: 'food_123',
      source: 'previous_meal',
      weightGrams: 300,
      originalLog: {
        id: 'food_123',
        name: 'Chicken Rice',
        imageUrl: 'https://pub-xxx.r2.dev/photos/food_123.jpg',
        weight_grams: 300,
        calories: 600,
        nutrients: {
          calories: 600,
          protein: 35,
          carbohydrates: 70,
          totalFat: 18,
          saturated_fat: 4,
          fiber: 3,
          sodium: 850
        }
      }
    };

    const result = calculateCompositeMeal([previousMealTag]);
    expect(result.dishName).toBe('Chicken Rice');
    expect(result.primaryImageUrl).toBe('/photos/food_123.jpg');
    expect(result.totalWeight).toBe(300);
    expect(result.roundedCal).toBe(600);
    expect(result.roundedProt).toBe(35);
    expect(result.roundedCarb).toBe(70);
    expect(result.roundedFat).toBe(18);
    expect(result.roundedSat).toBe(4);
    expect(result.roundedFib).toBe(3);
    expect(result.roundedSod).toBe(850);
  });

  it('mirrors flat values onto item.nutrients for nutrient-table consumers', () => {
    const tag: any = {
      name: 'Mr. Oat Quick Cook Oatmeal',
      dbId: 'food_oat',
      source: 'previous_meal',
      weightGrams: 130,
      originalLog: {
        id: 'food_oat',
        name: 'Mr. Oat Quick Cook Oatmeal',
        weightGrams: 175,
        calories: 280,
        protein: 17.5,
        nutrients: { calories: 280, protein: 17.5, carbohydrates: 40, totalFat: 5, sodium: 10 },
      },
    };
    const item = calculateCompositeMeal([tag]).itemsBreakdown[0];
    // 130/175 factor on 280 kcal → 208.
    expect(item.calories).toBe(208);
    expect(item.nutrients.calories).toBe(208);
    expect(item.nutrients.protein).toBe(item.protein);
    expect(item.nutrients.carbohydrates).toBe(item.carbohydrates);
    expect(item.nutrients.totalFat).toBe(item.totalFat);
    expect(item.nutrients.sodium).toBe(item.sodium);
  });
});

describe('buildCompositeHealthImpact', () => {
  it('derives the message from remaining allowance and targets', () => {
    const msg = buildCompositeHealthImpact(
      { calories: 208, protein: 13 },
      { caloriesTarget: 1800, calories: 1400, proteinTarget: 50, proteinLogged: 20 },
    );
    expect(msg).toContain('208 kcal');
    expect(msg).toContain('1192 kcal remaining of 1800 target');
    expect(msg).toContain('33 of 50g');
  });

  it('clamps remaining at zero when over target', () => {
    const msg = buildCompositeHealthImpact(
      { calories: 900, protein: 10 },
      { caloriesTarget: 1800, calories: 100, proteinTarget: 50, proteinLogged: 45 },
    );
    expect(msg).toContain('0 kcal remaining');
  });

  it('falls back to the generic line without allowance', () => {
    expect(buildCompositeHealthImpact({ calories: 208, protein: 13 }, null)).toBe(
      'Balanced intake from selected items.',
    );
  });

  it('scales nutrients proportionally when weightGrams differs from original', () => {
    const previousMealTag: any = {
      name: 'Oatmeal',
      dbId: 'food_456',
      source: 'previous_meal',
      weightGrams: 100, // half portion of original 200g
      originalLog: {
        id: 'food_456',
        name: 'Oatmeal',
        weight_grams: 200,
        calories: 300,
        nutrients: {
          calories: 300,
          protein: 10,
          carbohydrates: 50,
          fat: 6,
          saturated_fat: 1,
          fiber: 8,
          sodium: 200
        }
      }
    };

    const result = calculateCompositeMeal([previousMealTag]);
    expect(result.totalWeight).toBe(100);
    expect(result.roundedCal).toBe(150);
    expect(result.roundedProt).toBe(5);
    expect(result.roundedCarb).toBe(25);
    expect(result.roundedFat).toBe(3);
    expect(result.roundedFib).toBe(4);
    expect(result.roundedSod).toBe(100);
  });

  it('combines previous meal and catalog tag correctly', () => {
    const previousMealTag: any = {
      name: 'Black Coffee',
      dbId: 'food_789',
      source: 'previous_meal',
      weightGrams: 250,
      originalLog: {
        id: 'food_789',
        name: 'Black Coffee',
        weight_grams: 250,
        calories: 5,
        nutrients: {
          calories: 5,
          protein: 0.3,
          carbohydrates: 0,
          fat: 0,
          sodium: 5
        }
      }
    };

    const catalogTag: any = {
      name: 'Banana',
      dbId: 'cat_1',
      source: 'catalog_tag',
      weightGrams: 100,
      item: {
        dish_name: 'Banana',
        serving_grams: 100,
        calories: 89,
        protein: 1.1,
        carbohydrates: 23,
        total_fat: 0.3,
        saturated_fat: 0.1,
        total_fibre: 2.6,
        sodium: 1
      }
    };

    const result = calculateCompositeMeal([previousMealTag, catalogTag]);
    expect(result.dishName).toBe('Black Coffee + Banana');
    expect(result.totalWeight).toBe(350);
    expect(result.roundedCal).toBe(94);
    expect(result.itemsBreakdown.length).toBe(2);
  });
});

describe('parseTrayGramInput / normalizeTrayGrams (T-3 clear-to-edit)', () => {
  it('returns undefined for empty input so the field can be cleared mid-edit', () => {
    expect(parseTrayGramInput('')).toBeUndefined();
    expect(parseTrayGramInput('   ')).toBeUndefined();
  });

  it('allows 0 mid-edit instead of snapping to 1', () => {
    expect(parseTrayGramInput('0')).toBe(0);
  });

  it('rounds numeric input', () => {
    expect(parseTrayGramInput('130')).toBe(130);
    expect(parseTrayGramInput('12.6')).toBe(13);
  });

  it('clamps to >= 1g on blur/submit', () => {
    expect(normalizeTrayGrams(undefined)).toBe(1);
    expect(normalizeTrayGrams(0)).toBe(1);
    expect(normalizeTrayGrams(-5)).toBe(1);
    expect(normalizeTrayGrams(130)).toBe(130);
  });
});

describe('OCR passthrough (T-7, no agent call)', () => {
  const ocrTag: any = {
    name: 'Oat Label Porridge',
    dbId: 'pm_ocr',
    source: 'previous_meal',
    weightGrams: 200,
    originalLog: {
      id: 'pm_ocr',
      name: 'Oat Label Porridge',
      weightGrams: 100,
      calories: 150,
      nutrients: { calories: 150, protein: 5 },
      dbSource: 'label',
      rawNutritionLabel: { servingSize: '100g', calories: '150' },
      labelNutrientsPerServing: { calories: 150, protein: 5 },
    },
  };

  it('carries dbSource/raw label onto the composite item and scales label nutrients', () => {
    const result = calculateCompositeMeal([ocrTag]);
    const item = result.itemsBreakdown[0];
    expect(item.dbSource).toBe('label');
    expect(item.rawNutritionLabel).toEqual({ servingSize: '100g', calories: '150' });
    expect(item.labelNutrientsPerServing).toEqual({ calories: 300, protein: 10 });
  });

  it('leaves non-OCR items untouched', () => {
    const plain: any = {
      name: 'Plain Oats',
      source: 'previous_meal',
      weightGrams: 100,
      originalLog: { id: 'pm_plain', name: 'Plain Oats', weightGrams: 100, calories: 100, nutrients: { calories: 100 } },
    };
    const item = calculateCompositeMeal([plain]).itemsBreakdown[0];
    expect(item.dbSource).toBeUndefined();
    expect(item.rawNutritionLabel).toBeUndefined();
    expect(item.labelNutrientsPerServing).toBeUndefined();
  });
});

describe('hydratePreviousMealTag (T-8 thin API rows)', () => {
  const donor: any = {
    id: 'pm_donor',
    name: 'Oat Donor Porridge',
    weight_grams: 130,
    calories: 150,
    nutrients: { calories: 150, protein: 5, carbohydrates: 27, totalFat: 3 },
    dbSource: 'label',
    rawNutritionLabel: { servingSize: '100g', calories: '150' },
    labelNutrientsPerServing: { calories: 150, protein: 5 },
    imageUrl: '/photos/pm_donor_a.jpg',
    imageUrls: ['/photos/pm_donor_a.jpg', '/photos/pm_donor_b.jpg'],
  };

  it('fills thin API fields from the donor log', () => {
    const thin: any = { type: 'previous_meal', id: 'pm_donor', name: 'Oat Donor Porridge', portionGrams: 130, weightGrams: 130 };
    const out = hydratePreviousMealTag(thin, [donor]);
    expect(out.nutrients).toEqual(donor.nutrients);
    expect(out.calories).toBe(150);
    expect(out.dbSource).toBe('label');
    expect(out.rawNutritionLabel).toEqual(donor.rawNutritionLabel);
    expect(out.imageUrls).toEqual(['/photos/pm_donor_a.jpg', '/photos/pm_donor_b.jpg']);
  });

  it('keeps API scalars where present and unions donor images', () => {
    const thin: any = {
      type: 'previous_meal', id: 'pm_donor', name: 'Oat Donor Porridge',
      portionGrams: 200, weightGrams: 200,
      imageUrl: '/photos/pm_donor_preview.jpg',
    };
    const out = hydratePreviousMealTag(thin, [donor]);
    expect(out.portionGrams).toBe(200);
    expect(out.weightGrams).toBe(200);
    expect(out.imageUrls).toEqual(['/photos/pm_donor_preview.jpg', '/photos/pm_donor_a.jpg', '/photos/pm_donor_b.jpg']);
    expect(out.nutrients).toEqual(donor.nutrients);
  });

  it('returns the item untouched with no matching donor', () => {
    const thin: any = { type: 'previous_meal', id: 'pm_missing', name: 'Ghost Porridge' };
    expect(hydratePreviousMealTag(thin, [donor])).toBe(thin);
    expect(hydratePreviousMealTag(thin, null)).toBe(thin);
  });

  it('does not merge a same-day row with a different name', () => {
    const thin: any = { type: 'previous_meal', id: 'other-id', name: 'Quinoa Bowl', date: '2026-09-16' };
    const oatDonor: any = { ...donor, id: 'local-oat-16', date: '2026-09-16' };
    expect(hydratePreviousMealTag(thin, [oatDonor])).toBe(thin);
  });

  it('does not merge same name on a different day', () => {
    const thin: any = { type: 'previous_meal', id: 'cloud-copy', name: 'Oat Donor Porridge', date: '2026-09-10' };
    const oatDonor: any = { ...donor, id: 'local-oat-16', date: '2026-09-16' };
    expect(hydratePreviousMealTag(thin, [oatDonor])).toBe(thin);
  });

  it('rescues nutrients/OCR/photos from a same-day same-name donor under a different id', () => {
    const localDonor: any = { ...donor, id: 'local-oat-16', date: '2026-09-16', updated_at: 5 };
    const thin: any = { type: 'previous_meal', id: 'cloud-copy-9', name: 'Oat Donor Porridge', date: '2026-09-16', portionGrams: 130 };
    const out = hydratePreviousMealTag(thin, [localDonor]);
    expect(out).not.toBe(thin);
    expect(out.nutrients).toEqual(localDonor.nutrients);
    expect(out.dbSource).toBe('label');
    expect(out.rawNutritionLabel).toEqual(localDonor.rawNutritionLabel);
    expect(out.imageUrls).toEqual(['/photos/pm_donor_a.jpg', '/photos/pm_donor_b.jpg']);
    // Thin-row identity wins: the API row id is kept, not the donor's.
    expect(out.id).toBe('cloud-copy-9');
  });

  it('prefers the photo-holding copy when several same-name donors exist', () => {
    const bare: any = {
      id: 'local-oat-bare', name: 'Oat Donor Porridge', date: '2026-09-16', updated_at: 9,
      nutrients: { calories: 150 }, imageUrls: [],
    };
    const rich: any = { ...donor, id: 'local-oat-rich', date: '2026-09-16', updated_at: 1 };
    const thin: any = { type: 'previous_meal', id: 'cloud-copy-9', name: 'Oat Donor Porridge', date: '2026-09-16' };
    const out = hydratePreviousMealTag(thin, [bare, rich]);
    expect(out.imageUrls).toEqual(['/photos/pm_donor_a.jpg', '/photos/pm_donor_b.jpg']);
    expect(out.rawNutritionLabel).toEqual(rich.rawNutritionLabel);
  });

  it('treats zero/blank API scalars as unknown and hydrates from donor', () => {
    const thin: any = {
      type: 'previous_meal', id: 'pm_donor', name: 'Oat Donor Porridge',
      portionGrams: 130, weightGrams: 130,
      calories: 0, protein: '', nutrients: {},
    };
    const out = hydratePreviousMealTag(thin, [donor]);
    expect(out.calories).toBe(150);
    // No top-level donor protein to fill from — stays blank, nutrients still hydrate.
    expect(out.protein).toBe('');
    expect(out.nutrients).toEqual(donor.nutrients);
  });

  it('hydrates alias spellings and syncs both item-list spellings', () => {
    const donorWithBreakdown: any = {
      ...donor,
      sugar: 12,
      items_breakdown: [{ name: 'Oat Donor Porridge', calories: 150, dbSource: 'label' }],
    };
    const thin: any = { type: 'previous_meal', id: 'pm_donor', name: 'Oat Donor Porridge', portionGrams: 130 };
    const out = hydratePreviousMealTag(thin, [donorWithBreakdown]);
    expect(out.sugar).toBe(12);
    expect(out.items_breakdown).toHaveLength(1);
    expect(out.itemsBreakdown).toBe(out.items_breakdown);
  });
});
