import { describe, it, expect } from 'vitest';
import { isFruitJuiceItem, computeCaloriesFromMacros } from '../../../../server_derivation';
import { repairNutrientBag, repairFoodLogRow } from '../../../../scripts/repair-satfat-invariant.mjs';

describe('F-14 Portion Selection Follow-up Invariants & Repair', () => {
  describe('F-14.4 & F-14.2: isFruitJuiceItem detection', () => {
    it('recognizes generic fruit juices and blends', () => {
      expect(isFruitJuiceItem('Lidl Fruit Juice Blend')).toBe(true);
      expect(isFruitJuiceItem('Apple juice')).toBe(true);
      expect(isFruitJuiceItem('Orange juice')).toBe(true);
      expect(isFruitJuiceItem('Grape juice')).toBe(true);
      expect(isFruitJuiceItem('Pineapple juice')).toBe(true);
      expect(isFruitJuiceItem('Cranberry juice')).toBe(true);
    });

    it('recognizes curated juice brands', () => {
      expect(isFruitJuiceItem('Tropicana Pure Premium')).toBe(true);
      expect(isFruitJuiceItem('Naked Juice Green Machine')).toBe(true);
      expect(isFruitJuiceItem('Ocean Spray Cranberry Classic')).toBe(true);
      expect(isFruitJuiceItem('Ribena Blackcurrant Drink')).toBe(true);
      expect(isFruitJuiceItem('Innocent Apple & Mango')).toBe(true);
      expect(isFruitJuiceItem('Capri-Sun Orange')).toBe(true);
      expect(isFruitJuiceItem('Minute Maid 100% Orange Juice')).toBe(true);
      expect(isFruitJuiceItem('Copella Apple Juice')).toBe(true);
      expect(isFruitJuiceItem("Welch's Concord Grape Juice")).toBe(true);
    });

    it('recognizes items with foodCategory tag', () => {
      expect(isFruitJuiceItem({ name: 'Sunrise Drink', foodCategory: 'fruit_juice' })).toBe(true);
      expect(isFruitJuiceItem({ name: 'Berry Splash', category: 'juice' })).toBe(true);
    });

    it('excludes coconut milk, avocado juice, and meat gravies', () => {
      expect(isFruitJuiceItem('Coconut juice')).toBe(false);
      expect(isFruitJuiceItem('Coconut milk')).toBe(false);
      expect(isFruitJuiceItem('Avocado juice')).toBe(false);
      expect(isFruitJuiceItem('Roast Beef with Au Jus')).toBe(false);
    });
  });

  describe('F-14.5: Calorie computation fallback when cal === 0', () => {
    it('computes calories from macros when calories is 0 but macros are present', () => {
      const prot = 20;
      const carbs = 30;
      const totalFat = 10;
      const cal = computeCaloriesFromMacros(prot, carbs, totalFat);
      // 4*20 + 4*30 + 9*10 = 80 + 120 + 90 = 290
      expect(cal).toBe(290);
    });
  });

  describe('F-14.6: Supabase Repair Functions', () => {
    it('repairNutrientBag clamps totalFat >= saturatedFat and re-derives unsaturatedFat', () => {
      const broken = {
        calories: 100,
        protein: 10,
        carbohydrates: 0,
        totalFat: 1.0,
        saturatedFat: 2.5,
        transFat: 0,
      };

      const { changed, nutrients: fixed } = repairNutrientBag(broken);
      expect(changed).toBe(true);
      expect(fixed.totalFat).toBe(2.5);
      expect(fixed.saturatedFat).toBe(2.5);
      expect(fixed.unsaturatedFat).toBe(0);
    });

    it('repairNutrientBag leaves valid nutrient bags untouched', () => {
      const valid = {
        calories: 200,
        protein: 15,
        carbohydrates: 10,
        totalFat: 8,
        saturatedFat: 2.5,
        transFat: 0,
      };

      const { changed, nutrients: fixed } = repairNutrientBag(valid);
      expect(changed).toBe(false);
      expect(fixed.totalFat).toBe(8);
      expect(fixed.saturatedFat).toBe(2.5);
    });

    it('repairFoodLogRow repairs top-level nutrients and itemsBreakdown', () => {
      const row = {
        id: 'row-123',
        name: 'Fruit and Meat Breakfast',
        nutrients: {
          calories: 500,
          totalFat: 2.0,
          saturatedFat: 3.5, // Violation
        },
        items_breakdown: [
          {
            name: 'Beef Slice',
            totalFat: 1.0,
            saturatedFat: 1.8, // Violation
            nutrients: {
              totalFat: 1.0,
              saturatedFat: 1.8,
            },
          },
          {
            name: 'Apple',
            totalFat: 0.2,
            saturatedFat: 0.05,
            nutrients: {
              totalFat: 0.2,
              saturatedFat: 0.05,
            },
          },
        ],
      };

      const { changed, row: repaired } = repairFoodLogRow(row);
      expect(changed).toBe(true);
      expect(repaired.nutrients.totalFat).toBe(3.5);
      expect(repaired.nutrients.saturatedFat).toBe(3.5);

      const beef = repaired.items_breakdown[0];
      expect(beef.totalFat).toBe(1.8);
      expect(beef.fat).toBe(1.8);
      expect(beef.nutrients.totalFat).toBe(1.8);

      const apple = repaired.items_breakdown[1];
      expect(apple.totalFat).toBe(0.2);
      expect(apple.saturatedFat).toBe(0.05);
    });
  });
});
