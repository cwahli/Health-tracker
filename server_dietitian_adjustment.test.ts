import { describe, it, expect } from "vitest";
import { rebalanceNutrientProfile, applyNutrientModifiers } from "./server_derivation";
import { sanitizeVerdictLabel, synchronizeNarrativeText, synthesizeEditCommandsFromBreakdown } from "./server_pure_helpers";

describe("Meal Agent Clinical Adjustment & Weight Calibration", () => {
  const NUTRIENT_KEYS = [
    'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat', 'unsaturatedFat',
    'carbohydrates', 'sugar', 'addedSugar', 'totalFibre', 'sodium', 'potassium', 'salt'
  ];

  function simulateDietitianInjection(preMatch: any, dietitianItem: any) {
    const weight = dietitianItem.weightGrams;
    const originalBasisWeight = Number(preMatch.estimatedWeightGrams || preMatch.weightGrams || preMatch.nutrientBasisWeight || weight);
    const weightScaleFactor = (originalBasisWeight > 0 && Math.abs(weight - originalBasisWeight) > 0.01)
      ? (weight / originalBasisWeight)
      : 1.0;

    const n = { ...preMatch.nutrients };
    if (weightScaleFactor !== 1.0) {
      NUTRIENT_KEYS.forEach(k => {
        if (n[k] !== undefined && n[k] !== null && Number.isFinite(Number(n[k]))) {
          n[k] = Number(((Number(n[k])) * weightScaleFactor).toFixed(2));
        }
      });
    }

    if (dietitianItem.correctedNutrients && typeof dietitianItem.correctedNutrients === 'object') {
      Object.entries(dietitianItem.correctedNutrients).forEach(([k, v]) => {
        if (v !== null && v !== undefined && Number.isFinite(Number(v))) {
          n[k] = Number(v);
        }
      });
      // Pure TS rebalancing: recalculates Calories (4P+4C+9F), Unsat Fat, Salt, and density bounds
      const rebalanced = rebalanceNutrientProfile(n, weight);
      Object.assign(n, rebalanced);
    }

    const scale = 100 / weight;
    const injectedLabel: Record<string, number> = { servingSizeGrams: 100 };
    NUTRIENT_KEYS.forEach(k => {
      injectedLabel[k] = parseFloat(((n[k] || 0) * scale).toFixed(2));
    });

    return {
      ...dietitianItem,
      weightGrams: weight,
      syntheticBase100g: injectedLabel,
      truthNutrients: n,
      nutrients: n,
      clinicalCorrectionNote: dietitianItem.clinicalCorrectionNote || null
    };
  }

  it("calibrates portion weight and proportionally scales baseline macros", () => {
    const preMatch = {
      scoutIndex: 1,
      originalName: "SIOMAY",
      keyword: "steamed chicken dumplings",
      estimatedWeightGrams: 150,
      nutrients: {
        calories: 280,
        protein: 16,
        totalFat: 10,
        saturatedFat: 3,
        carbohydrates: 30,
        sugar: 1,
        addedSugar: 0,
        totalFibre: 1,
        sodium: 520,
        potassium: 150
      }
    };

    const dietitianItem = {
      scoutIndex: 1,
      canonicalDbName: "steamed chicken dumplings",
      weightGrams: 100,
      dbSource: "estimated"
    };

    const finalized = simulateDietitianInjection(preMatch, dietitianItem);

    expect(finalized.weightGrams).toBe(100);
    expect(finalized.nutrients.calories).toBe(186.67);
    expect(finalized.nutrients.protein).toBe(10.67);
    expect(finalized.nutrients.totalFat).toBe(6.67);
    expect(finalized.nutrients.sodium).toBe(346.67);
  });

  it("applies clinical corrections and rebalances dependent metrics (Calories = 4P+4C+9F, Unsat Fat, Salt)", () => {
    const preMatch = {
      scoutIndex: 1,
      originalName: "Fried Fish Fillet",
      keyword: "fried fish",
      estimatedWeightGrams: 200,
      nutrients: {
        protein: 24,
        carbohydrates: 20,
        totalFat: 12,
        saturatedFat: 2.5,
        transFat: 0,
        sodium: 400,
      }
    };

    // Dietitian observes deep-fried oil absorption undercounted -> adjusts totalFat to 22g and satFat to 5g
    const dietitianItem = {
      scoutIndex: 1,
      canonicalDbName: "Fried Fish Fillet",
      weightGrams: 200,
      dbSource: "estimated",
      correctedNutrients: {
        totalFat: 22,
        saturatedFat: 5,
        sodium: 600,
      },
      clinicalCorrectionNote: "Increased total fat by 10g for batter oil absorption and updated sodium."
    };

    const finalized = simulateDietitianInjection(preMatch, dietitianItem);

    expect(finalized.weightGrams).toBe(200);
    expect(finalized.nutrients.totalFat).toBe(22);
    expect(finalized.nutrients.saturatedFat).toBe(5);
    expect(finalized.nutrients.unsaturatedFat).toBe(17); // 22 - 5 = 17
    expect(finalized.nutrients.sodium).toBe(600);
    expect(finalized.nutrients.salt).toBe(1.52); // (600 * 2.54) / 1000 = 1.52
    // Bottom-Up Calories automatically recalculated: 4(24) + 4(20) + 9(22) = 96 + 80 + 198 = 374 kcal!
    expect(finalized.nutrients.calories).toBe(374);
    expect(finalized.clinicalCorrectionNote).toContain("batter oil absorption");
  });

  it("handles unsweetened beverage edits via universal applyNutrientModifiers", () => {
    const teaNutrients = {
      protein: 0,
      carbohydrates: 18,
      totalFat: 0,
      saturatedFat: 0,
      transFat: 0,
      sugar: 18,
      addedSugar: 18,
      sodium: 5,
      calories: 72
    };

    const res = applyNutrientModifiers(teaNutrients, {
      message: "My tea was unsweatened",
      foodType: "beverage",
      name: "Iced Tea"
    });

    expect(res.updatedNutrients.sugar).toBe(0);
    expect(res.updatedNutrients.addedSugar).toBe(0);
    expect(res.updatedNutrients.carbohydrates).toBe(0);
    expect(res.updatedNutrients.calories).toBe(0);
    expect(res.lockedKeys).toContain("sugar");
    expect(res.lockedKeys).toContain("calories");
  });

  it("handles zero-sodium and oil-free modifiers universally without food-specific hardcoding", () => {
    const dishNutrients = {
      protein: 25,
      carbohydrates: 10,
      totalFat: 20,
      saturatedFat: 6,
      transFat: 0,
      sodium: 850,
      calories: 320
    };

    // User says "no salt and steamed without oil"
    const res = applyNutrientModifiers(dishNutrients, {
      message: "Cooked with no salt and steamed without oil",
      foodType: "protein",
      name: "Chicken Breast"
    });

    expect(res.updatedNutrients.sodium).toBe(0);
    expect(res.updatedNutrients.salt).toBe(0);
    expect(res.updatedNutrients.totalFat).toBe(6); // 20 * 0.3 = 6
    // Recalculated Calories bottom up: 4(25) + 4(10) + 9(6) = 100 + 40 + 54 = 194 kcal!
    expect(res.updatedNutrients.calories).toBe(194);
    expect(res.lockedKeys).toContain("sodium");
    expect(res.lockedKeys).toContain("totalFat");
  });

  it("sanitizes generic meal descriptions to health outcome verdict labels", () => {
    // Banned generic meal descriptors
    const label1 = sanitizeVerdictLabel("Exceptional High Protein Meal", "good", { protein: 94.5, totalFibre: 14.4 });
    expect(label1).toBe("Boosts lean muscle tissue");

    const label2 = sanitizeVerdictLabel("High Protein Dish", "good", { protein: 45 });
    expect(label2).toBe("Boosts lean muscle tissue");

    const label2b = sanitizeVerdictLabel("Exceptional lean protein asset", "good", { protein: 40 });
    expect(label2b).toBe("Boosts lean muscle tissue");

    const label2c = sanitizeVerdictLabel("Nutrient Dense Meal", "good", { totalFibre: 10 });
    expect(label2c).toBe("Supports digestive health");

    const label2d = sanitizeVerdictLabel("Low Calorie Dinner", "good", { sodium: 300, calories: 450 });
    expect(label2d).toBe("Good for your heart");

    const label2e = sanitizeVerdictLabel("High Protein Snack", "good", { protein: 35 });
    expect(label2e).toBe("Boosts lean muscle tissue");

    const label2f = sanitizeVerdictLabel("Balanced Choice", "neutral", { calories: 400 });
    expect(label2f).toBe("Supports sustained metabolic energy");

    const label2g = sanitizeVerdictLabel("High Fat Dinner", "alert", { saturatedFat: 15 });
    expect(label2g).toBe("Elevated saturated fat impact");

    // Legitimate health outcome labels are preserved
    const label3 = sanitizeVerdictLabel("Good for your heart", "good");
    expect(label3).toBe("Good for your heart");

    const label4 = sanitizeVerdictLabel("140% over sat fat limit", "alert");
    expect(label4).toBe("140% over sat fat limit");

    const label5 = sanitizeVerdictLabel("Supports digestive balance", "good");
    const idKept = sanitizeVerdictLabel("Menunjang energi metabolik berkelanjutan", "neutral", {}, "id");
    expect(idKept).toBe("Menunjang energi metabolik berkelanjutan");

    expect(label5).toBe("Supports digestive balance");
  });

  it("synchronizes narrative text with final nutrient ledger values including fiber and sodium", () => {
    const rawReasoning = "The user logged a seafood soup pot with vegetables, mushrooms, and rolled oats (totaling 1102g). The meal is exceptionally high in lean protein (94.5g) and dietary fiber (8.1g) while remaining low in sodium (316mg) and saturated fat (3.2g). I will formulate a Mode B 4-beat response praising the protein and fiber asset, noting the modest caloric and sodium metrics, explaining digestive balance, and suggesting a gentle post-meal walk.";

    // Final ledger totals
    const synced = synchronizeNarrativeText(rawReasoning, 630, 94.5, 9.2, 3.7, 446, 52.4, 14.4);

    expect(synced).toContain("lean protein (94.5g)");
    expect(synced).toContain("dietary fiber (14.4g)");
    expect(synced).toContain("sodium (446mg)");
    expect(synced).toContain("saturated fat (3.7g)");
  });

  it("synthesizes edit commands correctly when only a subset of scoutIndex items are edited", () => {
    const activeMeal = {
      itemsBreakdown: [
        { name: "Crispy Fried Chicken", scoutIndex: 0, weightGrams: 200, dbId: "item_0" },
        { name: "Sempol Ayam", scoutIndex: 1, weightGrams: 150, dbId: "item_1" },
        { name: "Hemaviton C1000", scoutIndex: 2, weightGrams: 250, dbId: "item_2" },
        { name: "Sizzling Steak and Potato Wedges", scoutIndex: 3, weightGrams: 400, dbId: "item_3" },
        { name: "Crispy Giant Squid", scoutIndex: 4, weightGrams: 300, dbId: "item_4" },
        { name: "Soft Serve Ice Cream Cone", scoutIndex: 5, weightGrams: 120, dbId: "item_5" }
      ]
    };

    // Dietitian edited ONLY item at scoutIndex 3 (Sizzling Steak) into 2 sub-items
    const dietitianItems = [
      { canonicalDbName: "Beef Steak", scoutIndex: 3, weightGrams: 250 },
      { canonicalDbName: "Potato Wedges", scoutIndex: 3, weightGrams: 150 }
    ];

    const commands = synthesizeEditCommandsFromBreakdown(activeMeal, dietitianItems, "I replaced the steak combo with beef steak and potato wedges");

    // Only item 3 should be removed
    const removals = commands.filter(c => c.action === "remove_item");
    expect(removals.length).toBe(1);
    expect(removals[0].targetDbId).toBe("item_3");

    // Items 0, 1, 2, 4, 5 must NOT be removed
    const removedNames = removals.map(r => r.itemName);
    expect(removedNames).not.toContain("Crispy Fried Chicken");
    expect(removedNames).not.toContain("Sempol Ayam");
    expect(removedNames).not.toContain("Hemaviton C1000");

    // Additions for Beef Steak and Potato Wedges
    const additions = commands.filter(c => c.action === "add_item");
    expect(additions.length).toBe(2);
    expect(additions.map(a => a.itemName)).toEqual(["Beef Steak", "Potato Wedges"]);
  });

  it("synthesizes remove_item and add_item when replacing/splitting a composite dish in a full breakdown", () => {
    const activeMeal = {
      itemsBreakdown: [
        { name: "Soft Serve Ice Cream Cone", scoutIndex: 0, weightGrams: 120, dbId: "item_0" },
        { name: "Crispy Fried Chicken", scoutIndex: 1, weightGrams: 150, dbId: "item_1" },
        { name: "Sizzling Steak and Potato Wedges", scoutIndex: 4, weightGrams: 200, dbId: "item_4" },
        { name: "Sweet Iced Tea", scoutIndex: 5, weightGrams: 120, dbId: "item_5" }
      ]
    };

    const dietitianItems = [
      { canonicalDbName: "Soft Serve Ice Cream Cone", scoutIndex: 0, weightGrams: 120 },
      { canonicalDbName: "Crispy Fried Chicken", scoutIndex: 1, weightGrams: 150 },
      { canonicalDbName: "Sweet Iced Tea", scoutIndex: 5, weightGrams: 120 },
      { canonicalDbName: "Beef Steak", weightGrams: 100 },
      { canonicalDbName: "Chicken Steak", weightGrams: 100 }
    ];

    const commands = synthesizeEditCommandsFromBreakdown(
      activeMeal,
      dietitianItems,
      "the beef and chicken is 100g of beef steak and 100g of chicken steak"
    );

    const removals = commands.filter(c => c.action === "remove_item");
    expect(removals.length).toBe(1);
    expect(removals[0].targetDbId).toBe("item_4");

    const additions = commands.filter(c => c.action === "add_item");
    expect(additions.length).toBe(2);
    expect(additions.map(a => a.itemName)).toEqual(["Beef Steak", "Chicken Steak"]);
  });

  it("synthesizes update_modifier when user specifies unsweatened/unsweetened tea", () => {
    const activeMeal = {
      itemsBreakdown: [
        { name: "Soft Serve Ice Cream Cone", scoutIndex: 0, weightGrams: 120, dbId: "item_0" },
        { name: "Sweet Iced Tea", scoutIndex: 5, weightGrams: 120, dbId: "item_5" }
      ]
    };

    const dietitianItems = [
      { canonicalDbName: "Soft Serve Ice Cream Cone", scoutIndex: 0, weightGrams: 120 },
      { canonicalDbName: "Sweet Iced Tea", scoutIndex: 5, weightGrams: 120 }
    ];

    const commands = synthesizeEditCommandsFromBreakdown(
      activeMeal,
      dietitianItems,
      "the tea is unsweatened"
    );

    const modifiers = commands.filter(c => c.action === "update_modifier");
    expect(modifiers.length).toBe(1);
    expect(modifiers[0].itemName).toBe("Sweet Iced Tea");
    expect(modifiers[0].modifier).toBe("unsweetened");
  });
});


