import { describe, it, expect, vi } from "vitest";
import { aggregateItemsNutrients } from "./server_nutrient_aggregation";

describe("server_nutrient_aggregation", () => {
  it("aggregates standard estimated items correctly from LLM estimate data", () => {
    const rawItems = [
      {
        name: "Avocado Toast",
        canonicalDbName: "Toast with Avocado",
        weightGrams: 100,
        dbSource: "estimated",
        dbId: null,
        labelNutrientsPerServing: {
          servingSizeGrams: 100,
          calories: 200,
          protein: 5,
          totalFat: 10,
          saturatedFat: 2,
          transFat: 0,
          carbohydrates: 25,
          addedSugar: 1,
          sodium: 200,
          potassium: 300,
          totalFibre: 6,
          solubleFibre: 2
        },
        foodType: "processed"
      }
    ];

    const dbMatchMap = new Map();
    const databaseMatchesArray: any[] = [];
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const result = aggregateItemsNutrients(
      rawItems,
      100,
      dbMatchMap,
      databaseMatchesArray,
      logger
    );

    // Validate calories, macros, and sodium
    expect(result.nutrients.calories).toBe(200);
    expect(result.nutrients.protein).toBe(5);
    expect(result.nutrients.totalFat).toBe(10);
    expect(result.nutrients.saturatedFat).toBe(2);
    expect(result.nutrients.carbohydrates).toBe(25);
    expect(result.nutrients.sodium).toBe(200);

    // Validate itemsBreakdown mapping
    expect(result.itemsBreakdown).toHaveLength(1);
    expect(result.itemsBreakdown[0].name).toBe("Avocado Toast");
    expect(result.itemsBreakdown[0].canonicalDbName).toBe("Toast with Avocado");
    expect(result.itemsBreakdown[0].weightGrams).toBe(100);
    expect(result.itemsBreakdown[0].calories).toBe(200);
  });

  it("applies scale factor when item weight differs from servingSizeGrams", () => {
    const rawItems = [
      {
        name: "Scrambled Eggs",
        weightGrams: 150, // 150g weight, serving size is 100g (scale factor = 1.5)
        dbSource: "estimated",
        labelNutrientsPerServing: {
          servingSizeGrams: 100,
          calories: 140,
          protein: 12,
          totalFat: 9,
          saturatedFat: 3,
          transFat: 0,
          carbohydrates: 1
        },
        foodType: "egg"
      }
    ];

    const result = aggregateItemsNutrients(rawItems, 150, new Map(), [], () => {});

    expect(result.nutrients.calories).toBe(210); // 140 * 1.5
    expect(result.nutrients.protein).toBe(18); // 12 * 1.5
    expect(result.nutrients.totalFat).toBe(13.5); // 9 * 1.5
    expect(result.nutrients.saturatedFat).toBe(4.5); // 3 * 1.5
  });

  it("reinforces nutrients using dbMatchMap for USDA or OFF source items", () => {
    const rawItems = [
      {
        name: "Peanut Butter",
        weightGrams: 50,
        dbSource: "usda",
        dbId: "FDC_123456",
        labelNutrientsPerServing: {
          servingSizeGrams: 100,
          calories: 100 // Core-11 here should be overridden by database values
        }
      }
    ];

    // Simulated USDA matched nutrients per 100g
    const mockDbNutrients = {
      calories: 588,
      protein: 25,
      totalFat: 50,
      saturatedFat: 10,
      transFat: 0,
      carbohydrates: 20
    };

    const dbMatchMap = new Map([["FDC_123456", mockDbNutrients]]);
    const result = aggregateItemsNutrients(rawItems, 50, dbMatchMap, [], () => {});

    // Overridden nutrients should scale to 50g (factor of 0.5)
    expect(result.nutrients.calories).toBe(294); // (588 * 0.5)
    expect(result.nutrients.protein).toBe(12.5); // 25 * 0.5
    expect(result.nutrients.totalFat).toBe(25); // (50 * 0.5)
    expect(result.nutrients.saturatedFat).toBe(5); // (10 * 0.5)
  });

  it("ensures physical fat consistency (totalFat must equal or exceed saturated + trans fat)", () => {
    const rawItems = [
      {
        name: "Faulty Item",
        weightGrams: 100,
        dbSource: "estimated",
        labelNutrientsPerServing: {
          servingSizeGrams: 100,
          calories: 45, // Set to 45 so totalFat of 5 doesn't trigger Atwater rescale
          totalFat: 5,
          saturatedFat: 6, // Saturated fat exceeds total fat!
          transFat: 2      // Trans fat is also present
        }
      }
    ];

    const result = aggregateItemsNutrients(rawItems, 100, new Map(), [], () => {});

    // Saturated (6) + Trans (2) = 8. Since totalFat was 5, it must be adjusted to 8.
    expect(result.nutrients.saturatedFat).toBe(6);
    expect(result.nutrients.transFat).toBe(2);
    expect(result.nutrients.totalFat).toBe(8);
    expect(result.nutrients.unsaturatedFat).toBe(0); // 8 - 6 - 2 = 0
  });

  it("aggregates multi-component items deterministically by summing components", () => {
    const rawItems = [
      {
        name: "Beef Steak with Black Pepper Sauce",
        weightGrams: 220,
        dbSource: "backend_calculated",
        dbId: "MOCK_BEEF",
        primaryBase100g: {
          calories: 143,
          protein: 21.1,
          totalFat: 6,
          saturatedFat: 2.4,
          sodium: 45,
          carbohydrates: 0
        },
        primaryBaseWeightG: 165,
        saucesDetailList: [
          {
            name: "Black pepper sauce",
            weightGrams: 55,
            calories: 240,
            protein: 0.6,
            totalFat: 15,
            saturatedFat: 2.0,
            sodium: 378,
            carbohydrates: 12
          }
        ],
        cookingAdded: {
          addedCalories: 79,
          addedFat: 10,
          addedSaturatedFat: 1.8,
          addedSodium: 550
        },
        foodType: "beef"
      }
    ];

    const result = aggregateItemsNutrients(rawItems, 220, new Map(), [], () => {});

    // portionBase values for 165g of base (1.65 factor):
    // portionBaseCal = Math.round(143 * 1.65) = 236
    // portionBaseP = Math.round(21.1 * 1.65 * 10) / 10 = 34.8
    // portionBaseFat = Math.round(6 * 1.65 * 10) / 10 = 9.9
    // portionBaseSatFat = Math.round(2.4 * 1.65 * 10) / 10 = 4.0
    // portionBaseNa = Math.round(45 * 1.65) = 74
    // portionBaseCarbs = Math.round(0 * 1.65 * 10) / 10 = 0

    // sauces values for 55g (scaleRatio is 1, so unchanged):
    // sCal = 240, sP = 0.6, sFat = 15, sSatFat = 2.0, sNa = 378, sCarbs = 12

    // cookingAdded values:
    // cookingCal = 79, cookingFat = 10, cookingSatFat = 1.8, cookingNa = 550

    // Sum of rows above:
    // Calories: 236 + 240 + 79 = 555
    // Protein: 34.8 + 0.6 = 35.4
    // Fat: 9.9 + 15 + 10 = 34.9
    // Saturated Fat: 4.0 + 2.0 + 1.8 = 7.8
    // Sodium: 74 + 378 + 550 = 1002
    // Carbohydrates: 0 + 12 = 12

    expect(result.nutrients.calories).toBe(555);
    expect(result.nutrients.protein).toBe(35.4);
    expect(result.nutrients.totalFat).toBe(34.9);
    expect(result.nutrients.saturatedFat).toBe(7.8);
    expect(result.nutrients.sodium).toBe(1002);
    expect(result.nutrients.carbohydrates).toBe(12);

    expect(result.itemsBreakdown[0].calories).toBe(555);
    expect(result.itemsBreakdown[0].protein).toBe(35.4);
  });

  it("preserves locked truth nutrients exactly during aggregation", () => {
    const rawItems = [
      {
        name: "Locked Burger",
        weightGrams: 150,
        dbSource: "estimated",
        labelNutrientsPerServing: {
          servingSizeGrams: 100,
          calories: 500,
          protein: 20,
          totalFat: 25,
        },
        truthNutrients: {
          calories: 450,
          protein: 18,
          sodium: 120
        },
        lockedNutrientKeys: ["calories", "protein", "sodium"]
      }
    ];

    const result = aggregateItemsNutrients(rawItems, 150, new Map(), [], () => {});

    // Even though standard aggregation/scaling would say:
    // Calories: 500 * (150/100) = 750
    // Protein: 20 * (150/100) = 30
    // Sodium: 0
    // The locked values are: calories=450, protein=18, sodium=120
    expect(result.nutrients.calories).toBe(450);
    expect(result.nutrients.protein).toBe(18);
    expect(result.nutrients.sodium).toBe(120);

    // Unlocked totalFat should scale normally: 25 * 1.5 = 37.5
    expect(result.nutrients.totalFat).toBe(37.5);

    // Ensure locked metadata is persisted on the breakdown items
    expect(result.itemsBreakdown[0].truthNutrients).toEqual({
      calories: 450,
      protein: 18,
      sodium: 120
    });
    expect(result.itemsBreakdown[0].lockedNutrientKeys).toContain("calories");
    expect(result.itemsBreakdown[0].lockedNutrientKeys).toContain("protein");
    expect(result.itemsBreakdown[0].lockedNutrientKeys).toContain("sodium");
  });

  it("preserves rawNutritionLabel and components on itemsBreakdown", () => {
    const components = [{ searchQuery: "beef", volumePercentage: 60 }];
    const rawNutritionLabel = { calories: "37 kcal", protein: "7.3g" };
    const rawItems = [
      {
        name: "Co-op topside",
        weightGrams: 25,
        dbSource: "estimated",
        components,
        rawNutritionLabel,
        labelNutrientsPerServing: {
          servingSizeGrams: 25,
          calories: 37,
          protein: 7.3,
          totalFat: 0.6,
        },
        truthNutrients: { calories: 37, protein: 7.3 },
        lockedNutrientKeys: ["calories", "protein"],
      },
    ];
    const result = aggregateItemsNutrients(rawItems, 25, new Map(), [], () => {});
    expect(result.itemsBreakdown[0].rawNutritionLabel).toEqual(rawNutritionLabel);
    expect(result.itemsBreakdown[0].components).toEqual(components);
    expect(result.nutrients.calories).toBe(37);
    expect(result.nutrients.protein).toBe(7.3);
  });

  it("populates micronutrients for items via category fallback and trace profile", () => {
    const rawItems = [
      {
        name: "Prawn Skewer",
        originalName: "Prawn Skewer",
        keyword: "prawn",
        weightGrams: 100,
        dbSource: "estimated",
        foodType: "shellfish",
        labelNutrientsPerServing: {
          servingSizeGrams: 100,
          calories: 120,
          protein: 24,
          totalFat: 1.5,
          saturatedFat: 0.3,
          carbohydrates: 0,
          sodium: 150
        }
      }
    ];
    const result = aggregateItemsNutrients(rawItems, 100, new Map(), [], () => {});
    expect(result.nutrients.calories).toBe(120);
    expect(result.nutrients.protein).toBe(24);
    // Micronutrients should be non-zero from trace/category profile
    expect(result.nutrients.calcium).toBeGreaterThan(0);
    expect(result.nutrients.iron).toBeGreaterThan(0);
    expect(result.nutrients.zinc).toBeGreaterThan(0);
    expect(result.nutrients.magnesium).toBeGreaterThan(0);
  });

  it("preserves canonical base food micronutrient keys for croissant items during fallback aggregation", () => {
    const rawItems = [
      {
        name: "Butter Croissant",
        originalName: "Butter Croissant",
        keyword: "croissant",
        weightGrams: 80,
        dbSource: "estimated",
        foodType: "processed"
      }
    ];
    const result = aggregateItemsNutrients(rawItems, 80, new Map(), [], () => {});
    expect(result.nutrients.calories).toBeGreaterThan(0);
    expect(result.nutrients.calcium).toBeGreaterThan(0);
    expect(result.nutrients.iron).toBeGreaterThan(0);
    expect(result.nutrients.folate).toBeGreaterThan(0);
  });

  it("populates canonical base food micronutrients for macaroni and cheese dish in fallback aggregation", () => {
    const rawItems = [
      {
        name: "Macaroni and Cheese",
        originalName: "macaroni and cheese",
        canonicalDbName: "macaroni and cheese",
        weightGrams: 200,
        dbSource: "estimated",
        foodType: "processed"
      }
    ];
    const result = aggregateItemsNutrients(rawItems, 200, new Map(), [], () => {});
    expect(result.nutrients.calories).toBeGreaterThan(0);
    expect(result.nutrients.calcium).toBeGreaterThan(0);
    expect(result.nutrients.iron).toBeGreaterThan(0);
    expect(result.nutrients.magnesium).toBeGreaterThan(0);
    expect(result.nutrients.zinc).toBeGreaterThan(0);
  });

  it("populates trace micronutrients for brand/label grain item without leaving 16 zeros", () => {
    const rawItems = [
      {
        name: "Sainsbury's Rolled Oats with Whole Milk",
        originalName: "Sainsbury's Rolled Oats with Whole Milk",
        canonicalDbName: "sainsbury_rolled_oats",
        weightGrams: 250,
        dbSource: "brand_official",
        chainName: "Sainsbury's",
        labelNutrientsPerServing: {
          servingSizeGrams: 100,
          calories: 180,
          protein: 7,
          totalFat: 5,
          saturatedFat: 2,
          carbohydrates: 26,
          sugar: 6,
          sodium: 50,
          potassium: 200
        }
      }
    ];
    const result = aggregateItemsNutrients(rawItems, 250, new Map(), [], () => {});
    expect(result.nutrients.calories).toBeGreaterThan(0);
    expect(result.nutrients.magnesium).toBeGreaterThan(0);
    expect(result.nutrients.calcium).toBeGreaterThan(0);
    expect(result.nutrients.iron).toBeGreaterThan(0);
    expect(result.nutrients.zinc).toBeGreaterThan(0);
    expect(result.nutrients.phosphorus).toBeGreaterThan(0);
  });
});

/**
 * Live regression: job_1791044439374_4x4srekyi. A 440 ml bottle labelled
 * "Energy: 54 kcal per 100ml" (~238 kcal) was logged at 88 kcal — exactly
 * 22 g carbohydrate x 4. Atwater cannot express alcohol energy, and the existing
 * Atwater gate only guards a lower bound from fat, so with 0 g fat it never fired.
 */
describe("printed-label energy is truth (alcohol / fibre energy)", () => {
  const BEER_LABEL = {
    servingSize: "100ml",
    calories: "54 kcal",
    addedSugar: "0g",
    protein: "0.0g",
    salt: "<0.01g",
    saturatedFat: "0.0g",
    sodium: "0g",
    sugar: "1.7g",
    totalCarbohydrate: "5.0g",
    totalFat: "0.0g",
    totalFibre: "0g"
  };

  const beer = (overrides: Record<string, any> = {}) => [
    {
      name: "Desperados Original Beer",
      weightGrams: 440,
      dbSource: "estimated",
      rawNutritionLabel: BEER_LABEL,
      // The scout emitted macros but no energy, which is what let Atwater win.
      labelNutrientsPerServing: {
        servingSizeGrams: 100,
        protein: 0,
        carbohydrates: 5,
        totalFat: 0,
        saturatedFat: 0,
        sodium: 0
      },
      ...overrides
    }
  ];

  it("charges the printed energy for the consumed weight, not the macro sum", () => {
    const result = aggregateItemsNutrients(beer(), 440, new Map(), [], () => {});
    expect(result.nutrients.calories).toBe(238);
    expect(result.nutrients.calories).not.toBe(88);
  });

  it("an explicit calories lock still wins over the printed energy", () => {
    const result = aggregateItemsNutrients(
      beer({ lockedNutrientKeys: ["calories"], truthNutrients: { calories: 120 } }),
      440,
      new Map(),
      [],
      () => {}
    );
    expect(result.nutrients.calories).toBe(120);
  });

  it("a verified catalog match is not overruled by the panel", () => {
    const dbMatchMap = new Map([["FDC_1", { calories: 43, protein: 0.5, totalFat: 0, saturatedFat: 0, carbohydrates: 3.6 }]]);
    const result = aggregateItemsNutrients(beer({ dbId: "FDC_1", dbSource: "usda" }), 440, dbMatchMap, [], () => {});
    expect(result.nutrients.calories).toBeCloseTo(189.2, 1);
  });

  it("says so in the debug log", () => {
    const logs: string[] = [];
    aggregateItemsNutrients(beer(), 440, new Map(), [], (m: string) => logs.push(m));
    expect(logs.some((l) => l.includes("[Label Energy Gate]") && l.includes("Desperados"))).toBe(true);
  });
});
