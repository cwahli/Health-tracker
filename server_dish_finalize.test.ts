import { describe, it, expect } from "vitest";
import { finalizeDishLedger, parseOcrLabel } from "./server_dish_finalize";
import { matchBrandMenu } from "./server_brand_match";

describe("server_dish_finalize", () => {
  it("scales scout baseline nutrients proportionally by R (consumedWeight / nutrientBasisWeight)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Grilled Chicken Salad",
      keyword: "chicken salad",
      estimatedWeightGrams: 300,
      nutrientBasisWeight: 300,
      nutrients: {
        calories: 400,
        protein: 30,
        totalFat: 20,
        saturatedFat: 4,
        transFat: 0,
        carbohydrates: 25,
        sodium: 600,
      },
    };

    // User eats 150g (half portion)
    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 300,
      consumedWeight: 150,
    });

    expect(ledger.weightGrams).toBe(150);
    expect(ledger.nutrients.calories).toBe(200);
    expect(ledger.nutrients.protein).toBe(15);
    expect(ledger.nutrients.totalFat).toBe(10);
    expect(ledger.nutrients.saturatedFat).toBe(2);
    expect(ledger.nutrients.carbohydrates).toBe(12.5);
    expect(ledger.nutrients.sodium).toBe(300);
    expect(ledger.nutrients.unsaturatedFat).toBe(8); // 10 - (2 + 0)
    expect(ledger.nutrients.salt).toBe(0.76); // 300 * 2.54 / 1000
    expect(ledger.dbSource).toBe("estimated");
    // No cookingMethod / env → TS prep must not change numbers (method_unknown, composite, or zero add).
    expect(ledger.prepAddition?.addedFat ?? 0).toBe(0);
    expect(ledger.prepAddition?.addedSodium ?? 0).toBe(0);
  });

  it("handles standalone condiment cap: scales nutrients once based on post-cap weight", async () => {
    // 80g mayo with nutrients estimated for the 80g portion, capped to 30g
    const item = {
      scoutIndex: 0,
      originalName: "Heinz Mayonnaise",
      keyword: "mayo",
      estimatedWeightGrams: 30,
      nutrientBasisWeight: 80,
      nutrients: {
        calories: 540,
        protein: 1,
        totalFat: 58,
        saturatedFat: 4.5,
        transFat: 0,
        carbohydrates: 2,
        sodium: 400,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 80,
      consumedWeight: 30,
    });

    expect(ledger.weightGrams).toBe(30);
    // Bottom-Up: 4(0.4) + 4(0.8) + 9(21.8) = 1.6 + 3.2 + 196.2 = 201 kcal
    expect(ledger.nutrients.calories).toBe(201);
    expect(ledger.nutrients.totalFat).toBe(21.8); // 58 * 30/80 = 21.75 -> 21.8
  });

  it("locks OCR label nutrition when rawNutritionLabel is present", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Protein Muffin",
      keyword: "muffin",
      estimatedWeightGrams: 85,
      rawNutritionLabel: {
        calories: "154",
        protein: "16.2g",
        totalFat: "8.5g",
        saturatedFat: "2.1g",
        carbohydrates: "3.2g",
        sodium: "250mg",
        basisType: "per_dish",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 85,
      consumedWeight: 85,
    });

    expect(ledger.dbSource).toBe("label");
    expect(ledger.lockedNutrientKeys).toContain("calories");
    expect(ledger.nutrients.calories).toBe(154);
    expect(ledger.nutrients.protein).toBe(16.2);
    expect(ledger.nutrients.totalFat).toBe(8.5);
    expect(ledger.nutrients.carbohydrates).toBe(3.2);
    expect(ledger.nutrients.unsaturatedFat).toBe(6.4); // 8.5 - 2.1 = 6.4
    expect(ledger.nutrients.salt).toBe(0.64); // 250 * 2.54 / 1000 = 0.635 -> 0.64
    expect(ledger.prepAddition?.addedFat ?? 0).toBe(0);
    expect(ledger.prepAddition?.addedSodium ?? 0).toBe(0);
    expect(ledger.prepAddition?.reason).toBe("locked_truth");
  });

  it("recognizes Gemini totalCarbohydrate alias in OCR label and scales correctly for user portion edit", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Snack Bar",
      keyword: "bar",
      estimatedWeightGrams: 50,
      rawNutritionLabel: {
        calories: "200",
        protein: "10g",
        totalFat: "8g",
        saturatedFat: "2g",
        totalCarbohydrate: "22g", // Gemini output format
        sodium: "100mg",
        basisType: "per_dish",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 50,
      consumedWeight: 100, // User edited to 100g (2x portion)
    });

    expect(ledger.dbSource).toBe("label");
    expect(ledger.weightGrams).toBe(100);
    expect(ledger.nutrients.calories).toBe(400);
    expect(ledger.nutrients.protein).toBe(20);
    expect(ledger.nutrients.totalFat).toBe(16);
    expect(ledger.nutrients.carbohydrates).toBe(44);
    expect(ledger.nutrients.salt).toBe(0.51);
  });

  it("scales stored brand lock correctly on portion edit (D8) without re-fetching whole dish", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Big Mac",
      keyword: "burger",
      chainName: "McDonald's",
      estimatedWeightGrams: 215,
      nutrients: {
        calories: 550,
        protein: 25,
        totalFat: 30,
        carbohydrates: 45,
        sodium: 1000,
        potassium: 350,
      },
    };

    const storedBrandLock = {
      id: "brand-mcd-big-mac",
      basisType: "per_dish",
      servingGrams: 215,
      keys: ["calories", "protein", "totalFat", "saturatedFat", "carbohydrates", "sodium"],
      valuesAtBasis: {
        calories: 550,
        protein: 25,
        totalFat: 30,
        saturatedFat: 10,
        carbohydrates: 45,
        sodium: 1000,
      },
      per100g: null,
    };

    const ledger = await finalizeDishLedger({
      item,
      storedBrandLock,
      nutrientBasisWeight: 215,
      consumedWeight: 107.5, // 0.5x portion
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.weightGrams).toBe(108); // Rounded
    expect(ledger.nutrients.calories).toBe(276); // 550 * 108 / 215 = 276.28 -> 276
    expect(ledger.nutrients.protein).toBe(12.6); // 25 * 108 / 215 = 12.56 -> 12.6
    expect(ledger.nutrients.totalFat).toBe(15.1); // 30 * 108 / 215 = 15.07 -> 15.1
    expect(ledger.nutrients.carbohydrates).toBe(22.6); // 45 * 108 / 215 = 22.6
    expect(ledger.nutrients.sodium).toBe(502.3); // 1000 * 108 / 215 = 502.32 -> 502.3
    // Unlocked micronutrient potassium scales by effective R (108 / 215)
    expect(ledger.nutrients.potassium).toBe(176);
  });

  it("computes bottom-up calories on estimated dishes and flags Atwater on OCR labels with discrepancy > 35%", async () => {
    // 1. Estimated dish: computes bottom-up calories
    const estimatedItem = {
      scoutIndex: 0,
      originalName: "Mystery Dish",
      estimatedWeightGrams: 200,
      nutrients: {
        protein: 10,
        totalFat: 10,
        carbohydrates: 10,
        sodium: 200,
      },
    };

    const estimatedLedger = await finalizeDishLedger({
      item: estimatedItem,
      nutrientBasisWeight: 200,
      consumedWeight: 200,
    });

    // 4(10) + 4(10) + 9(10) = 170 kcal
    expect(estimatedLedger.nutrients.calories).toBe(170);

    // 2. OCR label with high discrepancy: locks label calories and flags Atwater
    const ocrItem = {
      scoutIndex: 1,
      originalName: "Mislabeled Bar",
      estimatedWeightGrams: 100,
      rawNutritionLabel: {
        calories: "1000",
        protein: "10g",
        totalFat: "10g",
        carbohydrates: "10g",
        basisType: "per_dish",
      },
    };

    const ocrLedger = await finalizeDishLedger({
      item: ocrItem,
      nutrientBasisWeight: 100,
      consumedWeight: 100,
    });

    expect(ocrLedger.atwaterFlag).not.toBeNull();
    expect(ocrLedger.atwaterFlag?.flagged).toBe(true);
    expect(ocrLedger.nutrients.calories).toBe(1000);
  });

  it("derives carbohydrates from energy without flagging Atwater if C is missing", async () => {
    // 500 kcal, 25g P, 20g F -> carbs missing
    const item = {
      scoutIndex: 0,
      originalName: "Chicken Rice Bowl",
      estimatedWeightGrams: 300,
      nutrients: {
        calories: 500,
        protein: 25,
        totalFat: 20,
        sodium: 500,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 300,
      consumedWeight: 300,
    });

    expect(ledger.nutrients.carbohydrates).toBe(55); // (500 - 100 - 180) / 4 = 55
    expect(ledger.atwaterFlag).toBeNull();
  });

  it("proportionally scales unprovided micronutrients by brand calorie adjustment ratio", async () => {
    // Stored brand lock provides Calories (780 kcal) and Protein (45g), but no micronutrients
    const storedBrandLock = {
      id: "brand_menu_yolk_sandwich",
      basisType: "per_dish" as const,
      servingGrams: 300,
      keys: ["calories", "protein", "totalFat"],
      valuesAtBasis: {
        calories: 780,
        protein: 45,
        totalFat: 30,
      },
    };

    // Scout estimated 650 kcal with micronutrients for a 300g portion
    const item = {
      scoutIndex: 0,
      originalName: "Yolk Chicken Sandwich",
      keyword: "chicken sandwich",
      chainName: "Yolk",
      estimatedWeightGrams: 300,
      nutrientBasisWeight: 300,
      nutrients: {
        calories: 650,
        protein: 35,
        totalFat: 25,
        sodium: 1000,
        potassium: 300,
        calcium: 150,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 300,
      consumedWeight: 300,
      storedBrandLock,
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.nutrients.calories).toBe(780);
    expect(ledger.nutrients.protein).toBe(45);
    expect(ledger.nutrients.totalFat).toBe(30);
    // Ratio = 780 / 650 = 1.2
    // Sodium: 1000 * 1.2 = 1200
    expect(ledger.nutrients.sodium).toBe(1200);
    // Potassium: 300 * 1.2 = 360
    expect(ledger.nutrients.potassium).toBe(360);
    // Calcium: 150 * 1.2 = 180
    expect(ledger.nutrients.calcium).toBe(180);
    // Derived Atwater Carbs: (780 - 4(45) - 9(30)) / 4 = (780 - 180 - 270) / 4 = 330 / 4 = 82.5
    expect(ledger.nutrients.carbohydrates).toBe(82.5);
  });

  it("canned drink with chainName and no OCR still attempts brand (honest BIND_MISS, no invented vitamin C)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Acme Citrus Vitamin Drink",
      keyword: "vitamin drink",
      chainName: "Acme",
      estimatedWeightGrams: 330,
      nutrients: {
        protein: 0,
        carbohydrates: 25,
        totalFat: 0,
      },
    };
    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 330,
      consumedWeight: 330,
    });
    expect(ledger.bindStatus).toBe("MISS");
    expect(ledger.dbSource).toBe("estimated");
    expect(ledger.nutrients.calories).toBe(100);
    expect(ledger.nutrients.vitaminC == null || ledger.nutrients.vitaminC === 0).toBe(true);
  });

  it("scales OCR label correctly when serving size is given in ml (e.g. 65 ml per serving, 325g consumed)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Yakult Rasa Stroberi",
      keyword: "probiotic drink",
      estimatedWeightGrams: 325,
      rawNutritionLabel: {
        servingSize: "65 ml",
        calories: "50",
        protein: "0.9g",
        totalFat: "0g",
        carbohydrates: "10g",
        sodium: "6mg",
        basisType: "per_serving",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 325,
      consumedWeight: 325,
    });

    expect(ledger.dbSource).toBe("label");
    // Scale = 325 / 65 = 5.0
    expect(ledger.nutrients.calories).toBe(250);
    expect(ledger.nutrients.protein).toBe(4.5);
    expect(ledger.nutrients.carbohydrates).toBe(50);
    expect(ledger.nutrients.sodium).toBe(30);
  });

  it("preserves Scout nutrient estimates (e.g. addedSugar, potassium) when omitted on printed OCR label", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Yakult Rasa Stroberi Pack",
      keyword: "probiotic drink",
      estimatedWeightGrams: 325,
      nutrients: {
        protein: 5.0,
        saturatedFat: 0.0,
        addedSugar: 50.0,
        totalFibre: 0.0,
        sodium: 50,
        carbohydrates: 55.0,
        potassium: 100,
        calcium: 50,
      },
      rawNutritionLabel: {
        servingSize: "65 ml",
        calories: "50",
        protein: "1g",
        totalFat: "0g",
        totalCarbohydrate: "11g",
        sodium: "10mg",
        basisType: "per_serving",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 325,
      consumedWeight: 325,
    });

    expect(ledger.dbSource).toBe("label");
    // Locked from OCR (scaled 5x):
    expect(ledger.nutrients.calories).toBe(250);
    expect(ledger.nutrients.protein).toBe(5);
    expect(ledger.nutrients.carbohydrates).toBe(55);
    expect(ledger.nutrients.sodium).toBe(50);
    // Unlocked from Scout (preserved and never dropped):
    expect(ledger.nutrients.addedSugar).toBe(50);
    expect(ledger.nutrients.potassium).toBe(100);
    expect(ledger.nutrients.calcium).toBe(50);
  });

  it("parses Indonesian % AKG labels and preserves exact 0g total and saturated fat", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Yakult Minuman Probiotik",
      keyword: "yakult",
      estimatedWeightGrams: 65,
      nutrientBasisWeight: 65,
      nutrients: {
        calories: 50,
        protein: 1.0,
        totalFat: 0.0,
        saturatedFat: 0.0,
        carbohydrates: 11.0,
        sodium: 10,
        sugar: 10.0,
      },
      rawNutritionLabel: {
        servingSize: "65 ml",
        energiTotal: "50 kkal",
        protein: "1 g",
        lemakTotal: "0 g",
        lemakJenuh: "0 g",
        karbohidratTotal: "11 g",
        gula: "10 g",
        natrium: "10 mg",
        vitaminD: "8% AKG",
        kalsium: "2% AKG",
        basisType: "per_serving",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 65,
      consumedWeight: 65,
    });

    expect(ledger.dbSource).toBe("label");
    expect(ledger.nutrients.calories).toBe(50);
    expect(ledger.nutrients.totalFat).toBe(0);
    expect(ledger.nutrients.saturatedFat).toBe(0);
    expect(ledger.nutrients.protein).toBe(1);
    expect(ledger.nutrients.carbohydrates).toBe(11);
    expect(ledger.nutrients.sugar).toBe(10);
    expect(ledger.nutrients.sodium).toBe(10);
    // % AKG conversions:
    // Vitamin D: 8% of 15 mcg = 1.2 mcg
    expect(ledger.nutrients.vitaminD).toBe(1.2);
    // Kalsium: 2% of 1100 mg = 22 mg
    expect(ledger.nutrients.calcium).toBe(22);
  });

  it("F-8.12 locks printed vitamin C from the can label (absolute mg, not the 1000 mg name)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Hemaviton C1000 Orange Drink",
      keyword: "vitamin drink",
      chainName: "Hemaviton",
      estimatedWeightGrams: 330,
      nutrientBasisWeight: 330,
      nutrients: {
        calories: 100,
        protein: 0,
        totalFat: 0,
        carbohydrates: 25,
        sodium: 45,
      },
      rawNutritionLabel: {
        servingSize: "330 ml",
        calories: "100",
        carbohydrates: "25 g",
        sodium: "45 mg",
        vitaminC: "125 mg",
        basisType: "per_serving",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 330,
      consumedWeight: 330,
    });

    expect(ledger.dbSource).toBe("label");
    expect(ledger.nutrients.calories).toBe(100);
    expect(ledger.nutrients.vitaminC).toBe(125);
    expect(ledger.lockedNutrientKeys).toContain("vitaminC");
  });

  it("F-8.12 locks printed vitamin C from % AKG without inventing the can-name dose", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Hemaviton C1000 Orange Drink",
      keyword: "vitamin drink",
      chainName: "Hemaviton",
      estimatedWeightGrams: 330,
      nutrientBasisWeight: 330,
      nutrients: {
        calories: 100,
        protein: 0,
        totalFat: 0,
        carbohydrates: 25,
        sodium: 45,
      },
      rawNutritionLabel: {
        servingSize: "330 ml",
        calories: "100",
        vitaminC: "139% AKG",
        basisType: "per_serving",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 330,
      consumedWeight: 330,
    });

    expect(ledger.dbSource).toBe("label");
    // 139% of the 90 mg vitamin C daily value = 125.1 mg — printed fact, not the 1000 mg name
    expect(ledger.nutrients.vitaminC).toBeCloseTo(125.1, 1);
    expect(ledger.nutrients.vitaminC).not.toBe(1000);
  });

  it("F-8.12 carries brand-lock vitamin C micros into the ledger (scaled, not invented)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Hemaviton C1000 Orange Drink",
      keyword: "vitamin drink",
      chainName: "Hemaviton",
      estimatedWeightGrams: 330,
      nutrientBasisWeight: 330,
      nutrients: {
        calories: 100,
        protein: 0,
        totalFat: 0,
        carbohydrates: 25,
        sodium: 45,
      },
    };
    const storedBrandLock = {
      id: "brand_hema_c1000",
      basisType: "per_100g",
      servingGrams: 100,
      keys: ["calories", "protein", "totalFat", "carbohydrates", "sodium", "vitaminC"],
      valuesAtBasis: {
        calories: 30,
        protein: 0,
        totalFat: 0,
        carbohydrates: 7.5,
        sodium: 14,
        vitaminC: 38,
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 330,
      consumedWeight: 330,
      storedBrandLock,
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.bindStatus).toBe("HIT");
    // per_100g scale: 38 mg * 3.3 = 125.4 mg from the brand row — not the 1000 mg name
    expect(ledger.nutrients.vitaminC).toBeCloseTo(125.4, 1);
    expect(ledger.nutrients.vitaminC).not.toBe(1000);
    expect(ledger.lockedNutrientKeys).toContain("vitaminC");
  });

  it("F-13.2 live T2 replay: per-100g brand lock at 40 g lands on one basis (not 400 kcal @ 40 g)", async () => {
    // Hard evidence: live review-mode T2 `job_1789655364725_qoestq254`
    // (text `[Mr Oat Rolled Oats] [40g] add oats, drop the coconut`) recorded
    // the lock row as 400 kcal @ 40 g with inconsistently scaled macros.
    // The real catalog row is per-100g {400, 11.7, 70, 11.7}; 40 g must be
    // {160, 4.7, 28, 4.7}. Tag-shaped item: no nutrientBasisWeight, no
    // scout nutrients — exactly what injectExplicitFoodTags submits.
    const brandMatch = await matchBrandMenu(null, "Mr Oat Rolled Oats");
    expect(brandMatch.matched).toBe(true);
    expect(brandMatch.valuesAtBasis?.calories).toBe(400);

    const ledger = await finalizeDishLedger({
      item: {
        scoutIndex: 1000,
        originalName: "Mr Oat Rolled Oats",
        keyword: "Mr Oat Rolled Oats",
        estimatedWeightGrams: 40,
        source: "catalog_tag",
        dbId: "brand_menu_local_mr_oat_mr_oat_rolled_oats",
        dbSource: "internal_catalog",
      },
      nutrientBasisWeight: 40,
      consumedWeight: 40,
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.nutrients.calories).toBe(160);
    expect(ledger.nutrients.protein).toBeCloseTo(4.7, 1);
    expect(ledger.nutrients.carbohydrates).toBeCloseTo(28, 0);
    expect(ledger.nutrients.totalFat).toBeCloseTo(4.7, 1);
    // One basis: locked kcal agrees with Atwater on the locked macros.
    expect(ledger.atwaterFlag?.flagged).toBe(false);
  });

  it("F-13.2 guard: per-serving Big Mac lock still records 508 kcal @ 215 g", async () => {
    // The D1 Big Mac row carries per-serving values {508, 26, 43, 25} at
    // servingGrams 215. A naive always-weight-over-100 rescale would print
    // 1092 kcal; the serving basis must win. Shape mirrors the live lock
    // from `job_1789667612860_k5ot7l3bb` (per_dish-stamped, servingGrams 215).
    const ledger = await finalizeDishLedger({
      item: {
        scoutIndex: 0,
        originalName: "Big Mac",
        keyword: "Big Mac",
        chainName: "mcdonalds",
        estimatedWeightGrams: 215,
      },
      nutrientBasisWeight: 215,
      consumedWeight: 215,
      storedBrandLock: {
        id: "bmi_1789651515861_3hjkx",
        basisType: "per_dish",
        servingGrams: 215,
        keys: ["calories", "protein", "totalFat", "carbohydrates", "sodium"],
        valuesAtBasis: { calories: 508, protein: 26, totalFat: 25, carbohydrates: 43, sodium: 920 },
      },
    });

    expect(ledger.dbSource).toBe("brand_official");
    expect(ledger.nutrients.calories).toBe(508);
    expect(ledger.nutrients.protein).toBeCloseTo(26, 0);
    expect(ledger.nutrients.carbohydrates).toBeCloseTo(43, 0);
    expect(ledger.nutrients.totalFat).toBeCloseTo(25, 0);
  });

  it("adds more fat/Na for fast_food_chain deep_fried than home_cooked and re-derives Atwater (F-10.6)", async () => {
    // Restaurant fat/Na is directional TS (diningEnvironment × cookingMethod). Residual is named
    // via prepAddition.reason — do not claim prototype Case 4/9 restaurant meals are 90% correct.
    const baseItem = {
      scoutIndex: 0,
      originalName: "Chicken Breast",
      keyword: "chicken",
      cookingMethod: "deep_fried",
      estimatedWeightGrams: 200,
      nutrients: {
        protein: 40,
        carbohydrates: 0,
        totalFat: 10,
        saturatedFat: 2,
        transFat: 0,
        sodium: 200,
      },
    };

    const home = await finalizeDishLedger({
      item: { ...baseItem, diningEnvironment: "home_cooked" },
      nutrientBasisWeight: 200,
      consumedWeight: 200,
      diningEnvironment: "home_cooked",
    });
    const ff = await finalizeDishLedger({
      item: { ...baseItem, diningEnvironment: "fast_food_chain" },
      nutrientBasisWeight: 200,
      consumedWeight: 200,
      diningEnvironment: "fast_food_chain",
    });

    expect(home.dbSource).toBe("estimated");
    expect(ff.dbSource).toBe("estimated");
    expect(ff.prepAddition?.reason).toBe("calculated_prep");
    expect(home.prepAddition?.reason).toBe("calculated_prep");
    expect(ff.nutrients.totalFat as number).toBeGreaterThan(home.nutrients.totalFat as number);
    expect(ff.nutrients.sodium as number).toBeGreaterThan(home.nutrients.sodium as number);
    expect(ff.nutrients.calories).toBe(
      Math.round(4 * Number(ff.nutrients.protein) + 4 * Number(ff.nutrients.carbohydrates) + 9 * Number(ff.nutrients.totalFat))
    );
    expect(home.nutrients.calories).toBe(
      Math.round(4 * Number(home.nutrients.protein) + 4 * Number(home.nutrients.carbohydrates) + 9 * Number(home.nutrients.totalFat))
    );
  });

  it("skips TS prep when OCR/brand locks labelled kcal/fat (F-10.6 locked_truth)", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Chicken Breast",
      keyword: "chicken",
      cookingMethod: "deep_fried",
      diningEnvironment: "fast_food_chain",
      estimatedWeightGrams: 200,
      nutrients: {
        protein: 40,
        carbohydrates: 0,
        totalFat: 10,
        saturatedFat: 2,
        sodium: 200,
      },
      rawNutritionLabel: {
        calories: "250",
        protein: "40g",
        totalFat: "10g",
        saturatedFat: "2g",
        carbohydrates: "0g",
        sodium: "200mg",
        basisType: "per_dish",
      },
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 200,
      consumedWeight: 200,
      diningEnvironment: "fast_food_chain",
    });

    expect(ledger.dbSource).toBe("label");
    expect(ledger.lockedNutrientKeys).toContain("calories");
    expect(ledger.nutrients.calories).toBe(250);
    expect(ledger.nutrients.totalFat).toBe(10);
    expect(ledger.nutrients.sodium).toBe(200);
    expect(ledger.prepAddition?.addedFat ?? 0).toBe(0);
    expect(ledger.prepAddition?.addedSodium ?? 0).toBe(0);
    expect(ledger.prepAddition?.reason).toBe("locked_truth");
  });

  it("F-10.8 inner: 11 prototype cases keep restaurant fat/Na residual named (no Gemini, not 90% painted)", async () => {
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");
    const here = dirname(fileURLToPath(import.meta.url));
    const rows = JSON.parse(
      readFileSync(join(here, "prototype/meallog/meal/comparison_1_vs_2_results.json"), "utf8")
    ) as Array<{ caseId: number; a1?: { acc?: { fAcc?: number; naAcc?: number } } }>;
    expect(rows).toHaveLength(11);
    const restaurantFatResidual = rows.filter((r) => (r.a1?.acc?.fAcc ?? 100) < 90).map((r) => r.caseId);
    // Cases 1 / 4 / 9 (and others) stay residual — F-10.6 is directional, not a 90% claim.
    expect(restaurantFatResidual).toEqual(expect.arrayContaining([1, 4, 9]));
  });

  it("never zeroes out parent dish nutrients when subcomponents are missing macros", async () => {
    const item = {
      scoutIndex: 0,
      originalName: "Grilled Chicken Steak",
      keyword: "chicken steak",
      estimatedWeightGrams: 300,
      nutrientBasisWeight: 300,
      nutrients: {
        calories: 450,
        protein: 42,
        totalFat: 18,
        saturatedFat: 4.5,
        carbohydrates: 25,
        sodium: 680,
      },
      componentsDetailList: [
        {
          name: "Chicken Breast",
          weightGrams: 200,
          // Missing/0 macros on this component
          calories: 0,
          protein: 0,
          totalFat: 0,
          saturatedFat: 0,
          carbohydrates: 0,
          sodium: 0,
        },
        {
          name: "Mushroom Sauce",
          weightGrams: 100,
          calories: 0,
          protein: 0,
          totalFat: 0,
          saturatedFat: 0,
          carbohydrates: 0,
          sodium: 0,
        }
      ]
    };

    const ledger = await finalizeDishLedger({
      item,
      nutrientBasisWeight: 300,
      consumedWeight: 300,
    });

    // Parent dish nutrients must NOT be overwritten to 0
    expect(ledger.nutrients.calories).toBeGreaterThan(0);
    expect(ledger.nutrients.protein).toBeGreaterThan(0);
    expect(ledger.nutrients.totalFat).toBeGreaterThan(0);
    expect(ledger.componentsDetailList[0].calories).toBeGreaterThan(0);
    expect(ledger.componentsDetailList[1].calories).toBeGreaterThan(0);
  });

  it('does not treat unit-count "1 serving (70g)" as 1 gram (Pia 100 Nanas)', () => {
    const { ocrNutrients } = parseOcrLabel({
      servingSize: '1 serving (70g)',
      calories: '90',
      protein: '2g',
      totalFat: '25g',
      carbohydrates: '8g',
    }, 70, 70);
    expect(ocrNutrients.calories).toBe(90);
    expect(ocrNutrients.totalFat).toBe(25);
    expect(ocrNutrients.protein).toBe(2);
    expect(ocrNutrients.carbohydrates).toBe(8);
  });

  it('does not treat "1 pcs" or "1 porsi" as 1 gram', () => {
    for (const servingSize of ['1 pcs', '1 porsi', '1 serving', '1']) {
      const { ocrNutrients } = parseOcrLabel({
        servingSize,
        calories: '90',
        protein: '2g',
        totalFat: '25g',
        carbohydrates: '8g',
      }, 70, 70);
      expect(ocrNutrients.calories).toBe(90);
    }
  });

  it('finalizes a 70g labeled serving at 90 kcal, not 6300', async () => {
    const ledger = await finalizeDishLedger({
      item: {
        scoutIndex: 0,
        originalName: 'Pia 100 Nanas',
        keyword: 'pineapple pie',
        estimatedWeightGrams: 70,
        rawNutritionLabel: {
          servingSize: '1 serving (70g)',
          calories: '90',
          protein: '2g',
          totalFat: '25g',
          carbohydrates: '8g',
        },
      },
      nutrientBasisWeight: 70,
      consumedWeight: 70,
    });
    expect(ledger.dbSource).toBe('label');
    expect(ledger.nutrients.calories).toBe(90);
    expect(ledger.nutrients.totalFat).toBe(25);
  });

  it('finalizes a 65g almond pack at ~433 kcal (not 5199 kcal) when serving size is 27g and 2.5 servings per pack', async () => {
    // 1) Labeled serving size 27g with 65g net weight consumed (2.4x)
    const ledger = await finalizeDishLedger({
      item: {
        scoutIndex: 0,
        originalName: 'Indomaret Kacang Almond',
        keyword: 'almonds',
        estimatedWeightGrams: 65,
        rawNutritionLabel: {
          servingSize: '27g',
          servingsPerContainer: 2.4,
          calories: 180,
          protein: '8g',
          totalFat: '15g',
          carbohydrates: '4g',
          seratPangan: '3g',
        },
      },
      nutrientBasisWeight: 65,
      consumedWeight: 65,
    });

    expect(ledger.dbSource).toBe('label');
    expect(ledger.nutrients.calories).toBeGreaterThanOrEqual(400);
    expect(ledger.nutrients.calories).toBeLessThanOrEqual(450);
    expect(ledger.nutrients.protein).toBeGreaterThanOrEqual(18);
    expect(ledger.nutrients.protein).toBeLessThanOrEqual(21);
    expect(ledger.nutrients.totalFibre).toBeGreaterThanOrEqual(6);
    expect(ledger.nutrients.totalFibre).toBeLessThanOrEqual(8);
  });

  it('does not explode to 5199 kcal when serving count 2.25 or "2.5 sajian" is passed as servingSize / servingGrams', async () => {
    // 2) Case where servingSize is "2.5 sajian"
    const ledgerSajian = await finalizeDishLedger({
      item: {
        scoutIndex: 0,
        originalName: 'Indomaret Kacang Almond',
        keyword: 'almonds',
        estimatedWeightGrams: 65,
        rawNutritionLabel: {
          servingSize: '2.5 sajian',
          calories: '180',
          protein: '8g',
          totalFat: '15g',
          carbohydrates: '4g',
          seratPangan: '3g',
        },
      },
      nutrientBasisWeight: 65,
      consumedWeight: 65,
    });

    expect(ledgerSajian.nutrients.calories).toBeGreaterThanOrEqual(400);
    expect(ledgerSajian.nutrients.calories).toBeLessThanOrEqual(460);
    expect(ledgerSajian.nutrients.protein).toBeLessThanOrEqual(22);
    expect(ledgerSajian.nutrients.totalFibre).toBeLessThanOrEqual(10);

    // 3) Case where raw servingGrams is 2.25 (the exact math that previously produced 5199 kcal)
    const ledgerCountGrams = await finalizeDishLedger({
      item: {
        scoutIndex: 0,
        originalName: 'Indomaret Kacang Almond',
        keyword: 'almonds',
        estimatedWeightGrams: 65,
        rawNutritionLabel: {
          servingGrams: 2.25,
          calories: 180,
          protein: 8,
          totalFat: 15,
          carbohydrates: 4,
          totalFibre: 3,
        },
      },
      nutrientBasisWeight: 65,
      consumedWeight: 65,
    });

    expect(ledgerCountGrams.nutrients.calories).toBeGreaterThanOrEqual(400);
    expect(ledgerCountGrams.nutrients.calories).toBeLessThanOrEqual(450);
    expect(ledgerCountGrams.nutrients.protein).toBeLessThanOrEqual(21);
    expect(ledgerCountGrams.nutrients.totalFibre).toBeLessThanOrEqual(8);
  });

  it('carries label evidence on the ledger for provenance/badging (never math)', () => {
    return finalizeDishLedger({
      item: {
        scoutIndex: 0,
        originalName: 'Mr. Oat Quick Cook Oatmeal',
        keyword: 'oatmeal',
        estimatedWeightGrams: 130,
        rawNutritionLabel: { servingSize: '130g', calories: '498', protein: '16.4 g' },
        labelNutrientsPerServing: { calories: 498, protein: 16.4 },
      },
      nutrientBasisWeight: 130,
      consumedWeight: 130,
    }).then((ledger) => {
      expect(ledger.dbSource).toBe('label');
      expect(ledger.rawNutritionLabel).toEqual({ servingSize: '130g', calories: '498', protein: '16.4 g' });
      expect(ledger.labelNutrientsPerServing).toEqual({ calories: 498, protein: 16.4 });
    });
  });

  it('carries no label evidence for estimated items', () => {
    return finalizeDishLedger({
      item: {
        scoutIndex: 0,
        originalName: 'Chicken Rice',
        keyword: 'chicken rice',
        estimatedWeightGrams: 300,
        nutrients: { calories: 600, protein: 35 },
      },
      nutrientBasisWeight: 300,
      consumedWeight: 300,
    }).then((ledger) => {
      expect(ledger.dbSource).toBe('estimated');
      expect(ledger.rawNutritionLabel).toBeNull();
      expect(ledger.labelNutrientsPerServing).toBeNull();
    });
  });
});
