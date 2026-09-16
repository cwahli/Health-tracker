import { describe, it, expect } from 'vitest';
import { inferBasisFromServingText, scaleNutrientsToWeight, toPer100g, parseNutrientNumber, normalizeToPer100g, isPlausibleNutrients } from './server_nutrient_basis.js';

describe('server_nutrient_basis', () => {
  it('parses nutrient numbers from string or number', () => {
    expect(parseNutrientNumber(120)).toBe(120);
    expect(parseNutrientNumber('120 kcal')).toBe(120);
    expect(parseNutrientNumber('1,200.5 mg')).toBe(1200.5);
    expect(parseNutrientNumber(null)).toBeNull();
  });

  it('infers basis from serving text correctly', () => {
    expect(inferBasisFromServingText('Per 100g')).toEqual({ basisType: 'per_100g', servingGrams: 100 });
    expect(inferBasisFromServingText('30g serving')).toEqual({ basisType: 'per_serving', servingGrams: 30 });
    expect(inferBasisFromServingText('1/4 pot (40g)')).toEqual({ basisType: 'per_serving', servingGrams: 40 });
    expect(inferBasisFromServingText('1 bowl', 450)).toEqual({ basisType: 'per_dish', servingGrams: 450 });
    expect(inferBasisFromServingText('1 serving (70g)', 70)).toEqual({ basisType: 'per_serving', servingGrams: 70 });
    expect(inferBasisFromServingText('1 pcs', 70)).toEqual({ basisType: 'per_dish', servingGrams: 70 });
    expect(inferBasisFromServingText('1 porsi', 70)).toEqual({ basisType: 'per_dish', servingGrams: 70 });
    expect(inferBasisFromServingText('1 serving', 70)).toEqual({ basisType: 'per_dish', servingGrams: 70 });
    expect(inferBasisFromServingText('1', 70)).toEqual({ basisType: 'per_dish', servingGrams: 70 });
    expect(inferBasisFromServingText('2.5 sajian', 65)).toEqual({ basisType: 'per_serving', servingGrams: 26 });
    expect(inferBasisFromServingText('2.5 porsi per kemasan', 65)).toEqual({ basisType: 'per_serving', servingGrams: 26 });
    expect(inferBasisFromServingText('2.5', 65)).toEqual({ basisType: 'per_serving', servingGrams: 26 });
  });

  it('scales per_100g nutrients to consumed weight (120 kcal / 100g to 180g = 216 kcal)', () => {
    const scaled = scaleNutrientsToWeight({
      basisType: 'per_100g',
      servingGrams: 100,
      nutrients: { calories: 120, protein: 10, totalFat: 2.5 },
    }, 180);
    expect(scaled.calories).toBe(216);
    expect(scaled.protein).toBe(18);
    expect(scaled.totalFat).toBe(4.5);
  });

  it('handles per_dish 450g to 450g consumed weight (scale factor 1)', () => {
    const scaled = scaleNutrientsToWeight({
      basisType: 'per_dish',
      servingGrams: 450,
      nutrients: { calories: 846, protein: 50 },
    }, 450);
    expect(scaled.calories).toBe(846);
    expect(scaled.protein).toBe(50);
  });

  it('handles per_serving 40g to 20g consumed weight (half portion)', () => {
    const scaled = scaleNutrientsToWeight({
      basisType: 'per_serving',
      servingGrams: 40,
      nutrients: { calories: 200, totalFat: 10 },
    }, 20);
    expect(scaled.calories).toBe(100);
    expect(scaled.totalFat).toBe(5);
  });

  it('converts nutrients to per 100g baseline', () => {
    const per100 = toPer100g({
      basisType: 'per_serving',
      servingGrams: 50,
      nutrients: { calories: 200, protein: 10 },
    });
    expect(per100.calories).toBe(400);
    expect(per100.protein).toBe(20);
  });

  it('normalizeToPer100g correctly normalizes based on pack or serving', () => {
    const perPack = normalizeToPer100g({
      basisType: 'per_pack',
      servingGrams: null,
      packGrams: 200,
      nutrients: { calories: 400, protein: 20 },
    });
    expect(perPack.calories).toBe(200);
    expect(perPack.protein).toBe(10);
    
    const perPack2 = normalizeToPer100g({
      basisType: 'per_pack',
      servingGrams: 50,
      portionsPerPack: 4,
      nutrients: { calories: 400, protein: 20 },
    });
    expect(perPack2.calories).toBe(200);
    expect(perPack2.protein).toBe(10);
  });

  it('isPlausibleNutrients checks for limits', () => {
    expect(isPlausibleNutrients({ calories: 960 }).valid).toBe(false);
    expect(isPlausibleNutrients({ calories: 500, protein: 110 }).valid).toBe(false);
    expect(isPlausibleNutrients({ calories: 500, protein: 50, fat: 20 }).valid).toBe(true);
  });
});
