import { describe, it, expect } from 'vitest';
import { normalizeChainKey } from './serverBrandMenu';
import { 
  sanitizeMealWeight, 
  jsToYaml, 
  extractBalancedJson, 
  sanitizeString,
  findItemIndexInList,
  extractUSDANutrientsPer100g,
  extractOFFNutrientsPer100g,
  checkIfItemIsAlreadyPrepared,
  checkAtwaterConsistency,
  applyNutrientRealityChecks,
  backfillSolubleFibre,
  applySatFatAndAddedSugarFloor,
  backfillSparseMicronutrients,
  formatMealReceiptTable,
} from './server_pure_helpers';

describe('server_pure_helpers', () => {
  describe('sanitizeMealWeight', () => {
    it('returns fallback for an overlong digit string that causes overflow', () => {
      const overlong = "150" + "0".repeat(30);
      const fallback = 100;
      const result = sanitizeMealWeight(overlong, fallback);
      expect(result).not.toBe(Infinity);
      expect(result).toBe(fallback);
    });

    it('returns rounded number for valid input', () => {
      expect(sanitizeMealWeight("150.4", 100)).toBe(150);
      expect(sanitizeMealWeight(150.6, 100)).toBe(151);
    });
  });

  describe('jsToYaml', () => {
    it('uses literal-block (|) for strings containing newlines', () => {
      const input = "line1\nline2";
      const result = jsToYaml(input);
      expect(result).toBe("|\n  line1\n  line2");
    });
  });

  describe('extractBalancedJson', () => {
    it('recovers the first balanced block from wrapped/garbage input', () => {
      const input = "```json\n{\"a\": 1}\n``` trailing garbage";
      const result = extractBalancedJson(input);
      expect(result).toBe('{"a": 1}');
    });

    it('recovers correctly when nested curly braces are present', () => {
      const input = "Some leading text {\"outer\": {\"inner\": 42}} some trailing text";
      const result = extractBalancedJson(input);
      expect(result).toBe('{"outer": {"inner": 42}}');
    });
  });

  describe('sanitizeString', () => {
    it('uses fallback for null, undefined, or empty/spaces values', () => {
      expect(sanitizeString(null, "fallback")).toBe("fallback");
      expect(sanitizeString(undefined, "fallback")).toBe("fallback");
      expect(sanitizeString("undefined", "fallback")).toBe("fallback");
      expect(sanitizeString("   ", "fallback")).toBe("fallback");
    });

    it('returns valid string unchanged', () => {
      expect(sanitizeString("hello", "fallback")).toBe("hello");
      expect(sanitizeString(123, "fallback")).toBe("123");
    });
  });

  describe('findItemIndexInList', () => {
    const items = [
      { name: "Scrambled Eggs", canonicalDbName: "egg_scrambled", dbId: "123" },
      { name: "Sourdough Toast", canonicalDbName: "bread_sourdough", dbId: "456" },
      { name: "Avocado Slices", canonicalDbName: "avocado_raw", dbId: "789" }
    ];

    it('matches exact dbId first', () => {
      expect(findItemIndexInList(items, "Sourdough Toast", "789")).toBe(2); // Matches dbId 789 (Avocado) despite name mismatch
      expect(findItemIndexInList(items, "Non-existent", "123")).toBe(0); // Matches dbId 123 (Eggs)
    });

    it('matches exact name case-insensitively', () => {
      expect(findItemIndexInList(items, "scrambled eggs", null)).toBe(0);
      expect(findItemIndexInList(items, "Avocado Slices", null)).toBe(2);
    });

    it('matches canonicalDbName case-insensitively', () => {
      expect(findItemIndexInList(items, "egg_scrambled", null)).toBe(0);
      expect(findItemIndexInList(items, "bread_sourdough", null)).toBe(1);
    });

    it('matches prefix or suffix', () => {
      expect(findItemIndexInList(items, "Scrambled", null)).toBe(0); // prefix match
      expect(findItemIndexInList(items, "Toast", null)).toBe(1); // suffix match
    });

    it('matches via classic substring includes fallback', () => {
      expect(findItemIndexInList(items, "Slices", null)).toBe(2);
      expect(findItemIndexInList(items, "ourdo", null)).toBe(1);
    });

    it('matches via word-by-word intersection fallback', () => {
      // "Delicious Sourdough" has word "Sourdough" which is in canonical "bread_sourdough" / "Sourdough Toast"
      expect(findItemIndexInList(items, "Delicious Sourdough", null)).toBe(1);
    });

    it('matches tea against Iced Lemon Tea', () => {
      const mealItems = [
        { name: "Sizzling Steak with Wedges", canonicalDbName: "steak_dish", dbId: "comp_1" },
        { name: "Iced Lemon Tea", canonicalDbName: "iced_lemon_tea", dbId: "bev_2" }
      ];
      expect(findItemIndexInList(mealItems, "tea", null)).toBe(1);
      expect(findItemIndexInList(mealItems, "the tea", null)).toBe(1);
      expect(findItemIndexInList(mealItems, "iced tea", null)).toBe(1);
      expect(findItemIndexInList(mealItems, "lemon tea", null)).toBe(1);
      expect(findItemIndexInList(mealItems, "steak", null)).toBe(0);
    });

    it('returns -1 for completely unrecognized names', () => {
      expect(findItemIndexInList(items, "Peanut Butter", null)).toBe(-1);
    });
  });

  describe('extractUSDANutrientsPer100g', () => {
    it('extracts primary and trace nutrients correctly from foodNutrients array', () => {
      const mockUSDAFood = {
        foodNutrients: [
          { nutrientName: "Protein", value: 12.5 },
          { nutrientName: "Total lipid (fat)", value: 9.8 },
          { nutrientName: "Fatty acids, total saturated", value: 3.2 },
          { nutrientName: "Energy", value: 650, unitName: "kJ" }, // Should be converted to kcal (650 / 4.184 = 155)
          { nutrientName: "Sodium, Na", value: 450 },
          { nutrientName: "Iron, Fe", value: 1.8 }
        ]
      };

      const profile = extractUSDANutrientsPer100g(mockUSDAFood);
      expect(profile.protein).toBe(12.5);
      expect(profile.totalFat).toBe(9.8);
      expect(profile.saturatedFat).toBe(3.2);
      expect(profile.calories).toBe(155); // kJ to kcal conversion
      expect(profile.sodium).toBe(450);
      expect(profile.iron).toBe(1.8);
    });

    it('correctly extracts calories from raw corn structure containing both kJ and kcal, preferring kcal or converting properly', () => {
      // Mock raw corn with kJ (358 kJ) and kcal (86 kcal)
      const mockCornFood = {
        foodNutrients: [
          { nutrientId: 1062, nutrientName: "Energy", value: 358, unitName: "kJ" },
          { nutrientId: 1008, nutrientName: "Energy", value: 86, unitName: "kcal" }
        ]
      };
      const profile = extractUSDANutrientsPer100g(mockCornFood);
      expect(profile.calories).toBe(86);

      // And if only kJ is present (358 kJ)
      const mockCornFoodKjOnly = {
        foodNutrients: [
          { nutrientId: 1062, nutrientName: "Energy", value: 358, unitName: "kJ" }
        ]
      };
      const profileKjOnly = extractUSDANutrientsPer100g(mockCornFoodKjOnly);
      expect(profileKjOnly.calories).toBe(86); // 358 / 4.184 = 85.56 => 86
    });

    it('handles empty/missing nutrients gracefully', () => {
      const profile = extractUSDANutrientsPer100g({});
      expect(profile).toEqual({});
    });
  });

  describe('extractOFFNutrientsPer100g', () => {
    it('extracts primary and trace nutrients correctly from nutriments', () => {
      const mockOFFProduct = {
        nutriments: {
          "energy-kcal_100g": 250,
          "proteins_100g": 8.5,
          "fat_100g": 12.0,
          "saturated-fat_100g": 4.5,
          "sodium_100g": 0.35 // OFF sodium is typically in grams, will be scaled to mg (0.35 * 1000 = 350)
        }
      };

      const profile = extractOFFNutrientsPer100g(mockOFFProduct);
      expect(profile.calories).toBe(250);
      expect(profile.protein).toBe(8.5);
      expect(profile.totalFat).toBe(12.0);
      expect(profile.saturatedFat).toBe(4.5);
      expect(profile.sodium).toBe(350);
    });

    it('handles OFF energy in Joules properly', () => {
      const mockOFFProduct = {
        nutriments: {
          "energy_100g": 837 // 837 / 4.184 = 200 kcal
        }
      };
      const profile = extractOFFNutrientsPer100g(mockOFFProduct);
      expect(profile.calories).toBe(200);
    });
  });

  describe('Newline and YAML splitting edge cases', () => {
    it('parses literal \\n strings and real newlines identically', () => {
      const regex = /\r?\n|\\n/;
      const textWithRealNL = "line1\nline2\r\nline3";
      const textWithLiteralNL = "line1\\nline2\\nline3";

      const splitReal = textWithRealNL.split(regex).map(s => s.trim());
      const splitLiteral = textWithLiteralNL.split(regex).map(s => s.trim());

      expect(splitReal).toEqual(["line1", "line2", "line3"]);
      expect(splitLiteral).toEqual(["line1", "line2", "line3"]);
    });
  });

  describe('checkIfItemIsAlreadyPrepared', () => {
    it('detects prepared/pre-seasoned foods correctly', () => {
      expect(checkIfItemIsAlreadyPrepared("McCain Potato Wedges", "potato wedges", "off")).toBe(true);
      expect(checkIfItemIsAlreadyPrepared("Raw Potato", "raw potato", "usda", 5)).toBe(false);
      expect(checkIfItemIsAlreadyPrepared("French Fries", "potato", "usda")).toBe(true);
      expect(checkIfItemIsAlreadyPrepared("Steak with Pepper Sauce", "steak", "usda", 600)).toBe(true);
    });
  });

  describe('checkAtwaterConsistency', () => {
    it('flags and corrects a label-sourced item whose macros do not reconcile with stated calories (the McDonald\'s burger bug)', () => {
      // Milk's label (125 kcal, 9g protein, 4.5g fat) wrongly attached to a 120g fried fish burger.
      const nutrients = { calories: 60, protein: 4.3, totalFat: 2.2, carbohydrates: 12 };
      applyNutrientRealityChecks("Fish Goujon Happy Meal Burger", 120, nutrients, 0, undefined, "label");
      // Derived from macros: 4.3*4 + 12*4 + 2.2*9 = 84.6 kcal vs stated 60 kcal -> 41% deviation, should NOT be silently trusted
      expect(nutrients.totalFat).not.toBe(2.2);
    });

    it('flags fabricated fat on a partially-backfilled label item (the fries bug)', () => {
      // Only calories (237) came from the real label; fat (26.3g) was backfilled from an
      // unrelated DB match and must still be checked because dbSource is "label_partial".
      const nutrients = { calories: 237, protein: 2.6, totalFat: 26.3, carbohydrates: 30 };
      applyNutrientRealityChecks("Small Fries", 75, nutrients, 0, undefined, "label_partial");
      // 2.6*4 + 30*4 + 26.3*9 = 367.1 kcal derived vs 237 stated -> should be rescaled down
      expect(nutrients.totalFat).toBeLessThan(26.3);
    });

    it('does not alter macros that already reconcile with stated calories', () => {
      const nutrients = { calories: 200, protein: 10, totalFat: 8, carbohydrates: 20 };
      // 10*4 + 20*4 + 8*9 = 192 kcal derived vs 200 stated -> 4% deviation, within tolerance
      applyNutrientRealityChecks("Vegetable Rice Bowl", 200, nutrients, 0, undefined, "usda");
      expect(nutrients.totalFat).toBe(8);
      expect(nutrients.protein).toBe(10);
    });

    it('backfills calories from macros when calories are zero but macros are present', () => {
      const nutrients = { calories: 0, protein: 10, totalFat: 5, carbohydrates: 20 };
      applyNutrientRealityChecks("Test Item", 100, nutrients, 0, undefined, undefined);
      expect(nutrients.calories).toBe(Math.round(10 * 4 + 20 * 4 + 5 * 9));
    });

    it('leaves items with zero calories and zero macros alone', () => {
      const nutrients = { calories: 0, protein: 0, totalFat: 0, carbohydrates: 0 };
      expect(() => applyNutrientRealityChecks("Water", 250, nutrients, 0, undefined, "usda")).not.toThrow();
      expect(nutrients.calories).toBe(0);
    });

    it('handles null or undefined itemNutrients gracefully without throwing TypeError', () => {
      expect(() => checkAtwaterConsistency("Null Item", null as any)).not.toThrow();
      expect(() => checkAtwaterConsistency("Undefined Item", undefined as any)).not.toThrow();
      expect(() => applyNutrientRealityChecks("Null Item", 100, null as any, 0)).not.toThrow();
      expect(() => applyNutrientRealityChecks("Undefined Item", 100, undefined as any, 0)).not.toThrow();
    });
  });

  describe('applyNutrientRealityChecks', () => {
    it('corrects unrealistically high sodium for non-cured items', () => {
      const nutrients = { sodium: 800, protein: 10 };
      applyNutrientRealityChecks("Potato Wedges", 100, nutrients, 200);
      expect(nutrients.sodium).toBe(450); // Adjusted (250 + 200) * (100 / 100)
    });

    it('retains high sodium for cured or salted items', () => {
      const nutrients = { sodium: 1200, protein: 15 };
      applyNutrientRealityChecks("Cured Bacon", 100, nutrients, 150);
      expect(nutrients.sodium).toBe(1200); // Unchanged
    });

    it('caps unrealistically high protein for standard items', () => {
      const nutrients = { sodium: 100, protein: 60 };
      applyNutrientRealityChecks("Beef Steak", 100, nutrients, 50);
      expect(nutrients.protein).toBe(45); // Capped at 45g per 100g
    });

    it('never overrides sodium when dbSource is "label", even for unusual items', () => {
      const nutrients = { sodium: 1110, protein: 3 };
      applyNutrientRealityChecks("HANA Mat Kimchi (Diced Radish Kimchi)", 150, nutrients, 0, undefined, "label");
      expect(nutrients.sodium).toBe(1110); // Unchanged — label data is ground truth
    });

    it('never overrides protein when dbSource is "label"', () => {
      const nutrients = { sodium: 100, protein: 60 };
      applyNutrientRealityChecks("Some Label Item", 100, nutrients, 0, undefined, "label");
      expect(nutrients.protein).toBe(60); // Unchanged — label data is ground truth
    });

    it('rescales wildly undercounted calories for a dessert/candy item (generic, not name-specific)', () => {
      const nutrients = { calories: 4, protein: 0.1 };
      applyNutrientRealityChecks("Dark Chocolate Coating", 9, nutrients, 0);
      expect(nutrients.calories).toBe(35); // ~390 kcal/100g midpoint * 9g
    });

    it('rescales wildly overcounted calories for a grain/snack item', () => {
      const nutrients = { calories: 5000, protein: 5 };
      applyNutrientRealityChecks("Bread Roll", 50, nutrients, 0);
      expect(nutrients.calories).toBe(165); // ~330 kcal/100g midpoint * 50g
    });

    it('leaves a plausible calorie value untouched', () => {
      const nutrients = { calories: 480, protein: 5 };
      applyNutrientRealityChecks("Chocolate Cookie", 100, nutrients, 0);
      expect(nutrients.calories).toBe(480); // Within bakery_dessert bounds
    });

    it('injects a calories field when calories is absent but macros are present', () => {
      const nutrients: Record<string, number> = { sodium: 100, protein: 10 };
      expect(() => applyNutrientRealityChecks("Potato Wedges", 100, nutrients, 200)).not.toThrow();
      expect(nutrients.calories).toBe(40);
    });
  });

  describe('backfillSolubleFibre', () => {
    it('backfills soluble fibre for oats (35% ratio)', () => {
      const nutrients = { totalFibre: 10, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Sainsbury Rolled Oats");
      expect(nutrients.solubleFibre).toBe(3.5);
    });

    it('backfills soluble fibre for fruits (30% ratio)', () => {
      const nutrients = { totalFibre: 4.3, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Gala Apple");
      expect(nutrients.solubleFibre).toBe(1.29);
    });

    it('backfills soluble fibre for peach/plum/grapes', () => {
      const nutrients = { totalFibre: 2, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Donut peach");
      expect(nutrients.solubleFibre).toBe(0.6);
    });

    it('does not overwrite existing non-zero soluble fibre', () => {
      const nutrients = { totalFibre: 10, solubleFibre: 2.5 };
      backfillSolubleFibre(nutrients, "Sainsbury Rolled Oats");
      expect(nutrients.solubleFibre).toBe(2.5);
    });

    it('does nothing if totalFibre is 0 or missing', () => {
      const nutrients = { totalFibre: 0, solubleFibre: 0 };
      backfillSolubleFibre(nutrients, "Water");
      expect(nutrients.solubleFibre).toBe(0);
    });
  });

  describe('normalizeChainKey', () => {
    it('normalizes sainsbury and sainsbury_s to sainsbury', () => {
      expect(normalizeChainKey("Sainsbury")).toBe('sainsbury');
      expect(normalizeChainKey("Sainsbury's")).toBe('sainsbury');
      expect(normalizeChainKey("sainsbury_s")).toBe('sainsbury');
      expect(normalizeChainKey("sainsburys")).toBe('sainsbury');
    });

    it('normalizes mcdonalds variations to mcdonalds', () => {
      expect(normalizeChainKey("McDonald's")).toBe('mcdonalds');
      expect(normalizeChainKey("mcdonald_s")).toBe('mcdonalds');
      expect(normalizeChainKey("mcdonald")).toBe('mcdonalds');
    });

    it('normalizes generic possessive chain names correctly', () => {
      expect(normalizeChainKey("Jack Daniel's")).toBe('jack_daniels');
      expect(normalizeChainKey("jack_daniel_s")).toBe('jack_daniels');
      expect(normalizeChainKey("YOLK")).toBe('yolk');
      expect(normalizeChainKey("Pret A Manger")).toBe('pret_a_manger');
    });
  });

  describe('applySatFatAndAddedSugarFloor', () => {
    it('applies sat fat floor to fast food / processed fried items when sat fat is missing or too low', () => {
      const nutrients: Record<string, number> = { calories: 450, totalFat: 20, saturatedFat: 0, unsaturatedFat: 20 };
      applySatFatAndAddedSugarFloor("Cheeseburger", nutrients, undefined, undefined, { chainName: "McDonald's" });
      expect(nutrients.saturatedFat).toBeGreaterThanOrEqual(5); // 25% of 20g
      expect(nutrients.unsaturatedFat).toBe(20 - nutrients.saturatedFat);
    });

    it('applies higher sat fat floor (35%) to bakery pastries/desserts', () => {
      const nutrients: Record<string, number> = { calories: 350, totalFat: 18, saturatedFat: 0, unsaturatedFat: 18 };
      applySatFatAndAddedSugarFloor("Butter Croissant", nutrients, undefined);
      expect(nutrients.saturatedFat).toBeGreaterThanOrEqual(6.3); // 35% of 18g
    });

    it('applies added sugar floor to sweet desserts and baked goods', () => {
      const nutrients: Record<string, number> = { calories: 400, carbohydrates: 50, sugar: 30, addedSugar: 0 };
      applySatFatAndAddedSugarFloor("Chocolate Cake", nutrients, undefined);
      expect(nutrients.addedSugar).toBe(24); // 80% of 30g sugar
      expect(nutrients.sugar).toBe(30);
    });

    it('does NOT alter verified printed label or brand official source items', () => {
      const nutrients: Record<string, number> = { calories: 400, totalFat: 20, saturatedFat: 1, addedSugar: 0, sugar: 20 };
      applySatFatAndAddedSugarFloor("Commercial Donut", nutrients, "label");
      expect(nutrients.saturatedFat).toBe(1);
      expect(nutrients.addedSugar).toBe(0);
    });

    it('does NOT force added sugar on clean whole foods like fruit or plain oats', () => {
      const nutrients: Record<string, number> = { calories: 150, carbohydrates: 27, sugar: 14, addedSugar: 0, totalFat: 0.5, saturatedFat: 0.1 };
      applySatFatAndAddedSugarFloor("Fresh Blueberries", nutrients, undefined);
      expect(nutrients.addedSugar).toBe(0);
    });
  });

  describe('backfillSparseMicronutrients', () => {
    it('backfills missing micronutrients when majority (>60%) are 0', () => {
      const nutrients: Record<string, number> = {
        calories: 120,
        protein: 2.0,
        totalFat: 0.2,
        carbohydrates: 25.0,
        potassium: 0,
        calcium: 0,
        iron: 0,
        magnesium: 0,
        zinc: 0,
        selenium: 0,
        iodine: 0,
        phosphorus: 0,
        vitaminA: 0,
        vitaminC: 0,
        vitaminD: 0,
        vitaminE: 0,
        vitaminK: 0,
        vitaminB12: 0,
        vitaminB6: 0,
        folate: 0,
        thiamine: 0,
        riboflavin: 0,
        niacin: 0
      };
      backfillSparseMicronutrients("Mixed Green Salad", 150, nutrients, undefined, "leafy_greens");
      expect(nutrients.potassium).toBeGreaterThan(0);
      expect(nutrients.vitaminK).toBeGreaterThan(0);
      expect(nutrients.calcium).toBeGreaterThan(0);
    });

    it('does not touch verified printed label source', () => {
      const nutrients: Record<string, number> = {
        calories: 120,
        potassium: 0,
        calcium: 0
      };
      backfillSparseMicronutrients("Greek Salad", 150, nutrients, "label", "leafy_greens");
      expect(nutrients.potassium).toBe(0);
    });

    it('does not touch items that already have populated micronutrients', () => {
      const nutrients: Record<string, number> = {
        calories: 200,
        potassium: 350,
        calcium: 40,
        iron: 1.5,
        magnesium: 30,
        zinc: 1.2,
        selenium: 15,
        iodine: 10,
        phosphorus: 120,
        vitaminA: 50,
        vitaminC: 20,
        vitaminD: 0,
        vitaminE: 1.0,
        vitaminK: 15,
        vitaminB12: 0.5,
        vitaminB6: 0.2,
        folate: 40,
        thiamine: 0.1,
        riboflavin: 0.1,
        niacin: 2.0
      };
      backfillSparseMicronutrients("Chicken Breast", 100, nutrients, undefined, "poultry");
      // Potassium should remain unchanged (350, not overwritten)
      expect(nutrients.potassium).toBe(350);
    });
  });

  describe('pipeline safeguards & mass/state compatibility', () => {
    it('blocks raw commodity matches for prepared sweet spreads', async () => {
      const { checkCategoryAndStateCompatibility } = await import('./server_pure_helpers');
      const res = checkCategoryAndStateCompatibility('Strawberry Jam', 'Strawberries, raw');
      expect(res.compatible).toBe(false);
    });

    it('blocks raw kelp matches for dressed seaweed salad', async () => {
      const { checkCategoryAndStateCompatibility } = await import('./server_pure_helpers');
      const res = checkCategoryAndStateCompatibility('Seaweed Salad', 'Seaweed, kelp, raw');
      expect(res.compatible).toBe(false);
    });

    it('enforces moisture and mass conservation ceiling for gelatin/mousse desserts', () => {
      const nutrients: Record<string, number> = {
        calories: 500,
        protein: 10,
        carbohydrates: 100,
        totalFat: 20,
        sugar: 90
      };
      // For 120g fruit jelly, 130g total macros is physically impossible
      applyNutrientRealityChecks('Fruit Jelly Dessert', 120, nutrients, 50, undefined, undefined);
      const totalMacros = (nutrients.protein || 0) + (nutrients.carbohydrates || 0) + (nutrients.totalFat || 0);
      expect(totalMacros).toBeLessThanOrEqual(120 * 0.45 + 0.1); // Max 45% dry matter
      expect(nutrients.sugar).toBeLessThanOrEqual(nutrients.carbohydrates || 0);
    });
  });

  describe('synchronizeNarrativeText', () => {
    it('does not cross-pollinate protein numbers into carbohydrates across conjunctions', async () => {
      const { synchronizeNarrativeText } = await import('./server_pure_helpers');
      const input = "You got 6g of plant protein and quality complex carbohydrates from the rolled oats to fuel your morning.";
      const result = synchronizeNarrativeText(input, 240, 6, 7, 1, 0, 42);
      expect(result).toBe("You got 6g of plant protein and quality complex carbohydrates from the rolled oats to fuel your morning.");
    });

    it('correctly updates standalone carbohydrate and protein numbers', async () => {
      const { synchronizeNarrativeText } = await import('./server_pure_helpers');
      const input = "This meal provides 5g of protein and 40g of carbohydrates.";
      const result = synchronizeNarrativeText(input, 240, 6, 7, 1, 0, 42);
      expect(result).toBe("This meal provides 6g of protein and 42g of carbohydrates.");
    });

    it('correctly synchronizes protein, fiber, and sodium in complex multi-item hotpot narratives', async () => {
      const { synchronizeNarrativeText } = await import('./server_pure_helpers');
      const input = "You secured an impressive 70.6g of high-quality protein and nearly 17g of fiber from the lean beef, egg, and fresh vegetables. This nourishing home-cooked hotpot combination keeps sodium exceptionally low at 357mg while providing steady energy. Enjoying warm, fiber-rich broths supports smooth gastric emptying and gentle hydration. Take a comfortable 15-minute stroll to aid digestion and maintain your metabolic rhythm.";
      const result = synchronizeNarrativeText(input, 650, 45.2, 18.0, 4.5, 850, 30.0, 8.5);
      expect(result).toContain("45.2g of high-quality protein");
      expect(result).toContain("nearly 8.5g of fiber");
      expect(result).toContain("keeps sodium exceptionally low at 850mg");
      expect(result).toContain("15-minute stroll");
    });
  });
});

import { isLabelPanelItem, sanitizeVerdictLabel, preserveSpecVerdictLabel, applyServerAverageNutrients } from "./server_pure_helpers.js";

describe("isLabelPanelItem", () => {
  it("rejects items containing fillet as a label", () => {
    expect(isLabelPanelItem({ name: "Quorn Sweet Chilli Mini Fillets Nutrition Facts Label" })).toBe(false);
  });

  describe("formatMealReceiptTable", () => {
    it("renders constituent rows for composite items alongside sub-totals and grand total", () => {
      const items = [
        {
          name: "Es Teh Tawar",
          weightGrams: 300,
          nutrients: { calories: 0, protein: 0, saturatedFat: 0, sodium: 5 },
        },
        {
          name: "Ikan Bakar Set with Rice and Sambal",
          weightGrams: 400,
          nutrients: { calories: 478, protein: 40.2, saturatedFat: 2.9, sodium: 760 },
          componentsDetailList: [
            { name: "Grilled Fish", weightGrams: 180, calories: 221, protein: 35, saturatedFat: 2.5, sodium: 450 },
            { name: "White Rice", weightGrams: 150, calories: 210, protein: 3.8, saturatedFat: 0.1, sodium: 5 },
            { name: "Sambal", weightGrams: 40, calories: 34, protein: 1, saturatedFat: 0.3, sodium: 300 },
            { name: "Raw Cabbage", weightGrams: 30, calories: 13, protein: 0.4, saturatedFat: 0, sodium: 5 },
          ],
        },
      ];
      const grandTotals = { calories: 478, protein: 40.2, saturatedFat: 2.9, sodium: 765 };
      const table = formatMealReceiptTable(items, grandTotals, 700);

      expect(table).toContain("### 🧾 Nutrition calculation");
      expect(table).toContain("1. Es Teh Tawar - 300g");
      expect(table).toContain("Item Sub-Total - 300g");
      expect(table).toContain("2. Ikan Bakar Set with Rice and Sambal - 400g");
      expect(table).toContain("Grilled Fish - 180g");
      expect(table).toContain("White Rice - 150g");
      expect(table).toContain("Sambal - 40g");
      expect(table).toContain("Raw Cabbage - 30g");
      expect(table).toContain("Item Sub-Total - 400g");
      expect(table).toContain("🏆 GRAND MEAL TOTAL - 700g");
    });
  });

  describe("sanitizeVerdictLabel & checkAtwaterConsistency", () => {
    it("assigns appropriate mindful sugar verdicts on high added sugar meals", () => {
      const verdict = sanitizeVerdictLabel("High Sugar Snack", "neutral", { addedSugar: 25, carbohydrates: 60 });
      expect(verdict).toBe("Requires mindful sugar balance");
    });

    it("assigns high simple carbohydrate load verdict when sugar is high", () => {
      const verdict = sanitizeVerdictLabel("Sweet Treat", "neutral", { sugar: 45, carbohydrates: 50 });
      expect(verdict).toBe("High simple carbohydrate load");
    });

    it("elevates calories when stated calories is lower than carbohydrate energy alone", () => {
      const nutrients: Record<string, number> = {
        calories: 50,
        protein: 4.5,
        carbohydrates: 50,
        totalFat: 0,
      };
      checkAtwaterConsistency("Yakult Rasa Stroberi", nutrients);
      // 4.5 * 4 + 50 * 4 = 18 + 200 = 218 kcal
      expect(nutrients.calories).toBe(218);
      expect(nutrients.carbohydrates).toBe(50);
      expect(nutrients.protein).toBe(4.5);
    });
  });
});

describe("compare-mode verdict & per-serving guards (Meal_03 audit)", () => {
  it("preserveSpecVerdictLabel keeps schema-compliant 3-6 word model labels verbatim", () => {
    expect(preserveSpecVerdictLabel({ label: "Excessive Sugar & Saturated Fat", level: "alert" }, null)).toEqual({
      label: "Excessive Sugar & Saturated Fat",
      level: "alert",
    });
    expect(preserveSpecVerdictLabel({ label: "Moderate Refined Carbs & Dairy Fat", level: "warning" }, { saturatedFat: 1 })).toEqual({
      label: "Moderate Refined Carbs & Dairy Fat",
      level: "warning",
    });
  });

  it("preserveSpecVerdictLabel still scrubs non-conforming labels via the meal-mode path", () => {
    const out = preserveSpecVerdictLabel({ label: "Good", level: "good" }, {});
    expect(out).toEqual({ label: "Supports sustained metabolic energy", level: "good" });
    const long = preserveSpecVerdictLabel({ label: "This is a far too long verdict label indeed", level: "neutral" }, {});
    expect(long.label.split(/\s+/).length).toBeLessThanOrEqual(6);
  });

  it("applyServerAverageNutrients derives per-serving from per100g x weight when the model omits averages", () => {
    const groups = [{
      groupName: "Tier 3 - Warning: Cheese-Topped Bakery Buns",
      averageNutrients: null,
      averageNutrientsPer100g: { calories: 340, protein: 9.5, totalFat: 14, saturatedFat: 6.5, carbohydrates: 44, sugar: 12, totalFibre: 1.5, sodium: 420, addedSugar: 10, transFat: 0.2 },
      servingWeightGrams: 80,
      scoutItemIndices: [0, 1],
      comparisonSentence: "s",
      orderingTip: "t",
      boundingBox2D: [650, 680, 950, 990],
    }];
    const flatLedger = {
      0: { calories: 157, protein: 8, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sugar: 12.5, sodium: 200 },
      1: { calories: 157, protein: 8, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sugar: 12.5, sodium: 200 },
    };
    const [out] = applyServerAverageNutrients(groups, flatLedger);
    // 340 * 80 / 100 — deterministic math, NOT the flat 157 ledger fallback.
    expect(out.averageNutrients.calories).toBe(272);
    expect(out.averageNutrients.protein).toBe(7.6);
    expect(out.averageNutrients.saturatedFat).toBe(5.2);
    expect(out.averageNutrients.sodium).toBe(336);
    expect(out.servingWeightGrams).toBe(80);
  });

  it("applyServerAverageNutrients keeps the ledger path when no per100g basis exists", () => {
    const groups = [{
      groupName: "g",
      averageNutrients: null,
      averageNutrientsPer100g: null,
      servingWeightGrams: null,
      scoutItemIndices: [0],
      comparisonSentence: "s",
      orderingTip: null,
      boundingBox2D: null,
    }];
    const ledger = { 0: { calories: 157, protein: 8 } };
    const [out] = applyServerAverageNutrients(groups, ledger);
    expect(out.averageNutrients.calories).toBe(157);
  });
});
