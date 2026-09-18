import { describe, it, expect } from 'vitest';
import { calculateCompositeMeal } from './compositeFoodCalculation';

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
    expect(result.totalWeight).toBe(300);
    expect(result.roundedCal).toBe(600);
    expect(result.roundedProt).toBe(35);
    expect(result.roundedCarb).toBe(70);
    expect(result.roundedFat).toBe(18);
    expect(result.roundedSat).toBe(4);
    expect(result.roundedFib).toBe(3);
    expect(result.roundedSod).toBe(850);
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
