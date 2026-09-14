import { describe, it, expect } from "vitest";
import { parseAndHealVisionScout, checkScoutSanity, userSafeScoutFailureMessage, mergeScoutItems, canMergeScoutLabelIntoFood, resolvePackageAndContextItems, reconcileIngredientsToComponents, clusterSpatialCompositeDishes } from "./server_vision_scout";

describe("server_vision_scout", () => {
  it("heals unterminated string JSON from a truncated scout reply", () => {
    const raw = '{"items":[{"keyword":"mie suit","originalName":"Mie Suit';
    const result = parseAndHealVisionScout(raw, () => {});
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("heals extra long internalReasoning instead of throwing Vision Scout Corrupted", () => {
    const huge = "retry dump " + "x".repeat(4000);
    const raw = {
      _internalReasoning: huge,
      internalReasoning: huge,
      dishes: [
        {
          dishName: "Sup Daging Sapi",
          estimatedWeightGrams: 690,
          cookingMethod: "boiled",
          foods: [
            { foodName: "Beef", weightGrams: 110, nutrients: { protein: 24, carbohydrates: 0 } }
          ]
        }
      ]
    };
    expect(() => parseAndHealVisionScout(raw, () => {})).not.toThrow();
    const result = parseAndHealVisionScout(raw, () => {});
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].originalName).toBe("Sup Daging Sapi");
    expect(JSON.stringify(result)).not.toMatch(/Vision Scout Corrupted/);
  });

  it("checkScoutSanity strips item internalReasoning rather than failing", () => {
    const items = [
      {
        originalName: "Broccoli",
        keyword: "broccoli",
        estimatedWeightGrams: 80,
        internalReasoning: "x".repeat(5000),
        _internalReasoning: "y".repeat(5000),
      }
    ];
    const sanity = checkScoutSanity({ items }, () => {});
    expect(sanity.valid).toBe(true);
    expect(items[0].internalReasoning).toBeUndefined();
    expect(items[0]._internalReasoning).toBeUndefined();
  });

  it("userSafeScoutFailureMessage does not leak Vision Scout Corrupted to the caller", () => {
    const direct = userSafeScoutFailureMessage("[Vision Scout Corrupted] Sanity check failed: Item field packageLabelText length (4000) exceeds 150");
    expect(direct).not.toMatch(/Vision Scout Corrupted/);
    expect(direct).toBe("Analysis failed");
    const wrapped = userSafeScoutFailureMessage(
      "Vision Scout Failed: Couldn't reliably read this image, please try again or re-upload. (Details: [Vision Scout Corrupted] Sanity check failed: foo)"
    );
    expect(wrapped).not.toMatch(/Vision Scout Corrupted/);
    const fromError = userSafeScoutFailureMessage(new Error("[Vision Scout Corrupted] Sanity check failed"));
    expect(fromError).not.toMatch(/Vision Scout Corrupted/);
  });

  it("parseAndHeal never throws and never returns Vision Scout Corrupted for unrecoverable JSON", () => {
    expect(() => parseAndHealVisionScout("not json {{{", () => {})).not.toThrow();
    const result = parseAndHealVisionScout("not json {{{", () => {});
    expect(Array.isArray(result.items)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Vision Scout Corrupted/);
  });

  it("heals overlong packageLabelText from barcode OCR instead of throwing Corrupted", () => {
    const raw = {
      dishes: [
        {
          dishName: "Beef Blade",
          estimatedWeightGrams: 110,
          cookingMethod: "raw",
          packageLabelText: "BEEF BLADE OCR " + "x".repeat(400),
          foods: [{ foodName: "Beef Blade", weightGrams: 110, packageLabelText: "LABEL " + "y".repeat(400), nutrients: { protein: 24, carbohydrates: 0 } }]
        }
      ]
    };
    expect(() => parseAndHealVisionScout(raw, () => {})).not.toThrow();
    const result = parseAndHealVisionScout(raw, () => {});
    expect(result.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/Vision Scout Corrupted/);
  });
  describe("DISH_DROP via genericEnglishName", () => {
    it("DISH_DROP: should map a local food component to a generic english searchQuery", () => {
      const llmOutput = {
        dishes: [
          {
            dishName: "Seafood Pot",
            foods: [
              {
                foodName: "Ikan Cendro",
                genericEnglishName: "needlefish"
              }
            ]
          }
        ]
      };
      const result = parseAndHealVisionScout(llmOutput, () => {});
      expect(result.items.length).toBe(1);
      const dish = result.items[0];
      expect(dish.components.length).toBe(1);
      expect(dish.components[0].searchQuery).toBe("needlefish");
    });
  });

  describe("mergeScoutItems", () => {
    it("should return visionItems if llmItems are empty", () => {
      const visionItems = [{ name: "item1", scoutIndex: 0 }];
      const result = mergeScoutItems(visionItems, []);
      expect(result).toEqual(visionItems);
    });

    it("should return llmItems if visionItems are empty", () => {
      const llmItems = [{ name: "item1" }];
      const result = mergeScoutItems([], llmItems);
      expect(result).toEqual(llmItems);
    });

    it("should correctly merge properties preserving rich vision metadata", () => {
      const visionItems = [
        {
          scoutIndex: 12,
          keyword: "bread",
          rawNutritionLabel: { servingSize: "50g" },
          nutritionFacts: { calories: 150 },
          ingredientsList: "wheat flour",
          boundingBox2D: [1, 2, 3, 4],
          sourceImageIndex: 0,
          source: "label"
        }
      ];

      const llmItems = [
        {
          scoutIndex: 12,
          keyword: "wheat bread", // updated keyword
          customProperty: "foo"
        }
      ];

      const merged = mergeScoutItems(visionItems, llmItems);
      expect(merged).toHaveLength(1);
      expect(merged[0].scoutIndex).toBe(12);
      expect(merged[0].keyword).toBe("wheat bread");
      expect(merged[0].customProperty).toBe("foo");
      expect(merged[0].rawNutritionLabel).toEqual({ servingSize: "50g" });
      expect(merged[0].boundingBox2D).toEqual([1, 2, 3, 4]);
    });

    it("preserves vision estimatedCalories, weight, components, and rawNutritionLabel over LLM overwrite", () => {
      const visionItems = [
        {
          scoutIndex: 0,
          keyword: "poke bowl",
          estimatedCalories: 550,
          estimatedWeightGrams: 400,
          components: [{ searchQuery: "rice", volumePercentage: 50 }],
          rawNutritionLabel: { calories: "450 kcal" },
        },
      ];
      const llmItems = [
        {
          scoutIndex: 0,
          keyword: "poke",
          estimatedCalories: 900,
          estimatedWeightGrams: 100,
          components: [],
          rawNutritionLabel: { calories: "999" },
        },
      ];
      const merged = mergeScoutItems(visionItems, llmItems);
      expect(merged).toHaveLength(1);
      expect(merged[0].estimatedCalories).toBe(550);
      expect(merged[0].estimatedWeightGrams).toBe(400);
      expect(merged[0].rawNutritionLabel).toEqual({ calories: "450 kcal" });
      expect(merged[0].components).toEqual([{ searchQuery: "rice", volumePercentage: 50 }]);
      expect(merged[0].keyword).toBe("poke");
    });

    it("falls back to LLM estimatedCalories when vision soft cal is null/undefined", () => {
      const visionItems = [{ scoutIndex: 1, estimatedCalories: undefined, estimatedWeightGrams: undefined }];
      const llmItems = [{ scoutIndex: 1, estimatedCalories: 420, estimatedWeightGrams: 300 }];
      const merged = mergeScoutItems(visionItems, llmItems);
      expect(merged[0].estimatedCalories).toBe(420);
      expect(merged[0].estimatedWeightGrams).toBe(300);
    });
  });

  describe("parseAndHealVisionScout", () => {
    it("parses standard scout output correctly", () => {
      const mockOutput = {
        recommendedMode: "new_log",
        contentType: "visual",
        cookingMethod: "deep-fried",
        items: [
          {
            keyword: "french fries",
            originalName: "Kentang Goreng",
            itemConfidence: "High",
            estimatedWeightGrams: 150,
            source: "visual",
            boundingBox2D: [100, 100, 500, 500],
            sourceImageIndex: 0
          }
        ]
      };

      const logs: string[] = [];
      const result = parseAndHealVisionScout(mockOutput, (msg) => logs.push(msg));

      expect(result.items).toHaveLength(1);
      expect(result.items[0].keyword).toBe("french fries");
      expect(result.items[0].originalName).toBe("Kentang Goreng");
      expect(result.scoutConfidenceRating).toBe("High (>90%)");
      expect(result.scoutCookingMethod).toBe("deep-fried");
      expect(result.visionScoutContentType).toBe("visual");
      expect(result.scoutRecommendedMode).toBe("new_log");
      expect(result.queriesToSearch).toHaveLength(0); // Generic items like 'french fries' without chainName shouldn't be pre-searched
      expect(result.visionScoutRanAndReturnedItems).toBe(true);
    });

    it("splits fry-fat onto components without writing Atwater kcal (finalize owns persisted calories)", () => {
      const mockOutput = {
        dishes: [
          {
            dishName: "Crispy Tofu Plate",
            estimatedWeightGrams: 250,
            cookingMethod: "deep_fried",
            dishNutrients: { protein: 20, carbohydrates: 30, totalFat: 28, saturatedFat: 5 },
            foods: [
              { foodName: "Crispy Tofu", weightGrams: 150, nutrients: { protein: 18, carbohydrates: 8, totalFat: 8 } },
              { foodName: "Seasoned Fries", weightGrams: 100, nutrients: { protein: 2, carbohydrates: 22, totalFat: 2.5 } },
            ],
          },
        ],
      };
      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      const sumFat = result.items.reduce((acc: number, it: any) => acc + Number(it.nutrients?.totalFat || 0), 0);
      expect(sumFat).toBeCloseTo(28, 0);
      expect(result.items.every((it: any) => it.nutrients.calories == null || it.nutrients.calories === undefined)).toBe(true);
    });

    it("applies the fat overflow correction to raw nutrition label", () => {
      const mockOutput = {
        items: [
          {
            keyword: "butter",
            originalName: "Butter",
            rawNutritionLabel: {
              totalFat: "10g",
              saturatedFat: "12g", // Saturated fat exceeds total fat!
              calories: 120
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items[0].rawNutritionLabel.totalFat).toBe(12); // corrected to match saturated fat
      expect(result.items[0].anomalyFlags).toContain("fat overflow corrected: totalFat increased from 10 to 12");
    });

    it("applies the algebraic healer to compute missing carbohydrates when discrepancy is within 20%", () => {
      const mockOutput = {
        items: [
          {
            keyword: "yogurt",
            originalName: "Yogurt",
            rawNutritionLabel: {
              calories: 60,
              protein: "5g",
              totalFat: "4g"
              // totalCarbohydrate omitted (missing) -> (60 - 36 - 20) / 4 = 1g
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      // Discrepancy is Math.abs(56 - 60)/56 = 7.1% (<= 20%).
      // Carbs should heal to: (60 - 36 - 20) / 4 = 1g.
      expect(result.items[0].rawNutritionLabel.totalCarbohydrate).toBe(1);
    });

    it("preserves explicitly declared 0g totalFat on label without injecting non-zero fat", () => {
      const mockOutput = {
        items: [
          {
            keyword: "yakult",
            originalName: "Yakult Probiotic Drink",
            rawNutritionLabel: {
              calories: 50,
              protein: "1g",
              totalFat: "0g",
              totalCarbohydrate: "11g"
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      // All 3 macros present (fat: 0g, protein: 1g, carbs: 11g). Total fat must remain 0.
      expect(result.items[0].rawNutritionLabel.totalFat).toBe("0g");
    });

    it("explodes list formatted items with commas into multiple items if not bearing printed macros", () => {
      const mockOutput = {
        items: [
          {
            keyword: "fruit platter",
            originalName: "Apple, Orange, Banana", // commas splitting
            estimatedWeightGrams: 300,
            rawNutritionLabel: {} // No printed macros
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(3);
      expect(result.items[0].originalName).toBe("Apple");
      expect(result.items[1].originalName).toBe("Orange");
      expect(result.items[2].originalName).toBe("Banana");
    });

    it("successfully parses compact spreadsheet formats into standalone items", () => {
      const mockOutput = {
        compactSpreadsheet: [
          "Snacks|Potato Chips|Lay's Classic|120g|10,10,90,90",
          "Beverages|Soda|Coca Cola|250ml|100,100,400,400",
          "Snacks|Tiny Treat|Mini Pack|30g|20,20,80,80"
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(3);
      expect(result.items[0].keyword).toBe("Potato Chips");
      expect(result.items[0].originalName).toBe("[Snacks] Lay's Classic");
      expect(result.items[0].estimatedWeightGrams).toBe(120);
      expect(result.items[0].boundingBox2D).toEqual([10, 10, 90, 90]);

      expect(result.items[1].keyword).toBe("Soda");
      expect(result.items[1].originalName).toBe("[Beverages] Coca Cola");
      expect(result.items[1].estimatedWeightGrams).toBe(250);
      expect(result.items[1].boundingBox2D).toEqual([100, 100, 400, 400]);

      // 30g is <= 50, so it should fall back/scale to 300g per the backend rule
      expect(result.items[2].keyword).toBe("Tiny Treat");
      expect(result.items[2].estimatedWeightGrams).toBe(300);
    });

    it("does not throw Vision Scout Corrupted for overlong strings; returns a partial scout", () => {
      const corruptedOutput = {
        recommendedMode: "new_log",
        contentType: "visual",
        items: [
          {
            keyword: "A".repeat(160), // Exceeds 150 limit
            originalName: "Overlong Name",
            estimatedWeightGrams: 100,
            boundingBox2D: [0, 0, 100, 100]
          }
        ]
      };

      expect(() => parseAndHealVisionScout(corruptedOutput, () => {})).not.toThrow();
      const result = parseAndHealVisionScout(corruptedOutput, () => {});
      expect(Array.isArray(result.items)).toBe(true);
    });

    it("does not throw Vision Scout Corrupted for visualIngredients JSON heuristics", () => {
      const corruptedOutput = {
        recommendedMode: "new_log",
        contentType: "visual",
        items: [
          {
            keyword: "food",
            originalName: "Food Item",
            estimatedWeightGrams: 100,
            boundingBox2D: [0, 0, 100, 100],
            visualIngredients: ["ingredientsList", "components: ["] // contains key name heuristics
          }
        ]
      };

      expect(() => parseAndHealVisionScout(corruptedOutput, () => {})).not.toThrow();
      const result = parseAndHealVisionScout(corruptedOutput, () => {});
      expect(Array.isArray(result.items)).toBe(true);
    });

    it("merges separate standalone label item into primary packaged food item and clears visualIngredients", () => {
      const mockOutput = {
        items: [
          {
            keyword: "traditional crackers",
            originalName: "Kerupuk Crackers",
            estimatedWeightGrams: 200,
            sourceImageIndex: 0,
            rawNutritionLabel: {}
          },
          {
            keyword: "nutrition facts",
            originalName: "Informasi Nilai Gizi",
            estimatedWeightGrams: 100,
            sourceImageIndex: 1,
            rawNutritionLabel: { calories: 150, protein: "3g", totalFat: "6g", totalCarbohydrate: "21g" },
            ingredientsList: "Tapioca starch, salt, palm oil"
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].originalName).toBe("Kerupuk Crackers");
      expect(result.items[0].rawNutritionLabel.calories).toBe('150 kcal');
      expect(result.items[0].ingredientsList).toBe("Tapioca starch, salt, palm oil");
      expect(result.items[0].visualIngredients).toEqual([]);
    });
  });

  describe("explicit user weights on two drinks", () => {
    it("does not apply 1L to the lassi after 500ml was already claimed", () => {
      const items = [
        { originalName: "Mango Lassi Yogurt Drink", keyword: "mango lassi", estimatedWeightGrams: 500, components: [] },
        { originalName: "Low Fat Yogurt Drink", keyword: "yogurt drink", estimatedWeightGrams: 500, components: [] },
      ];
      const out = resolvePackageAndContextItems(items, () => {}, "Lassi is 500ml the other is 1L", true);
      const lassi = out.find((i) => /lassi/i.test(i.originalName));
      const other = out.find((i) => /low fat/i.test(i.originalName));
      expect(lassi?.estimatedWeightGrams).toBe(500);
      expect(other?.estimatedWeightGrams).toBe(1000);
    });
  });

  describe("canMergeScoutLabelIntoFood", () => {
    it("does not glue a reformed-ham label onto Serrano", () => {
      const d = canMergeScoutLabelIntoFood(
        { originalName: "Reformed Ham Nutrition Facts Label" },
        { originalName: "Gran Reserva Serrano Ham 50% Duroc Breed", keyword: "serrano ham" }
      );
      expect(d.ok).toBe(false);
      expect(d.reason).toMatch(/conflict|generic|weak/i);
    });

    it("still merges a milk label onto the matching milk carton", () => {
      const d = canMergeScoutLabelIntoFood(
        { originalName: "Organic Semi-Skimmed Milk Nutrition Facts Label" },
        { originalName: "Organic Semi-Skimmed Milk" }
      );
      expect(d.ok).toBe(true);
    });

    it("merges a same-named ham label onto that ham", () => {
      const d = canMergeScoutLabelIntoFood(
        { originalName: "Co-op Formed Ham Nutrition Facts Label" },
        { originalName: "Co-op Formed Ham" }
      );
      expect(d.ok).toBe(true);
    });
  });

  describe("cross-photo deduplication guards", () => {
    it("collapses a labeled oats package and the cooked porridge from another photo into one dish", () => {
      const result = parseAndHealVisionScout({
        dishes: [
          {
            dishName: "Quaker Whole Rolled Oats",
            genericEnglishName: "rolled oats",
            chainName: "Quaker",
            estimatedWeightGrams: 40,
            packGrams: 800,
            cookingMethod: "raw",
            sourceImageIndex: 0,
            foods: [
              {
                foodName: "Quaker Whole Rolled Oats",
                weightGrams: 40,
                packGrams: 800,
                sourceImageIndex: 0,
                rawNutritionLabel: { servingSize: "40g", calories: "160 kcal", protein: "5g", carbohydrates: "28g", totalFat: "4g" },
                nutrients: { protein: 5, carbohydrates: 28, saturatedFat: 0.5 },
              },
            ],
            dishNutrients: { protein: 5, carbohydrates: 28, totalFat: 4, saturatedFat: 0.5 },
          },
          {
            dishName: "Boiled Rolled Oats Porridge",
            genericEnglishName: "oatmeal porridge",
            estimatedWeightGrams: 200,
            cookingMethod: "boiled",
            sourceImageIndex: 2,
            foods: [
              { foodName: "Rolled Oats", weightGrams: 40, nutrients: { protein: 5, carbohydrates: 28 } },
              { foodName: "Water", weightGrams: 160, nutrients: { protein: 0, carbohydrates: 0 } },
            ],
            dishNutrients: { protein: 5, carbohydrates: 28, totalFat: 4 },
          },
        ],
      }, () => {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].rawNutritionLabel).toBeTruthy();
      expect(result.items[0].rawNutritionLabel.calories).toBeTruthy();
      expect(Number(result.items[0].estimatedWeightGrams)).toBe(40);
      expect(String(result.items[0].originalName || result.items[0].keyword)).toMatch(/oat/i);
    });

    it("does not merge two distinct items sharing flavor words when printed calories or labels differ", () => {
      const mockOutput = {
        items: [
          {
            keyword: "sweet chilli chicken wrap",
            originalName: "Sweet Chilli Chicken Wrap",
            estimatedWeightGrams: 220,
            sourceImageIndex: 0,
            rawNutritionLabel: { calories: "453 kcal" }
          },
          {
            keyword: "mycoprotein sweet chilli mini fillets",
            originalName: "Sweet Chilli Mini Fillets",
            estimatedWeightGrams: 138,
            sourceImageIndex: 1,
            rawNutritionLabel: { calories: "98 kcal" }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(2);
      expect(result.items[0].originalName).toBe("Sweet Chilli Chicken Wrap");
      expect(result.items[1].originalName).toBe("Sweet Chilli Mini Fillets");
    });
  });

  describe("reconcileIngredientsToComponents", () => {
    it("allocates non-zero volume percentage for detected ranch dressing in ingredients list", () => {
      const item = {
        keyword: "chicken avocado salad",
        originalName: "Chicken Cobb Salad",
        ingredientsList: "Feta cheese, avocado, bacon, chicken, red onion, cherry tomato, eggs, mix leaves, ranch dressing",
        components: [
          { searchQuery: "mixed salad leaves", volumePercentage: 35 },
          { searchQuery: "grilled chicken breast", volumePercentage: 20 },
          { searchQuery: "avocado", volumePercentage: 15 },
          { searchQuery: "hard boiled egg", volumePercentage: 10 },
          { searchQuery: "feta cheese", volumePercentage: 10 },
          { searchQuery: "cherry tomato", volumePercentage: 5 },
          { searchQuery: "bacon bits", volumePercentage: 3 },
          { searchQuery: "red onion", volumePercentage: 2 },
        ]
      };

      reconcileIngredientsToComponents(item);

      const ranchComp = item.components.find((c: any) => c.searchQuery.includes("ranch"));
      expect(ranchComp).toBeDefined();
      expect(ranchComp?.volumePercentage).toBeGreaterThanOrEqual(5);

      const totalPct = item.components.reduce((sum: number, c: any) => sum + (c.volumePercentage || 0), 0);
      expect(totalPct).toBeGreaterThanOrEqual(95);
      expect(totalPct).toBeLessThanOrEqual(105);
    });

    it("does not duplicate condiment if already present in components", () => {
      const item = {
        keyword: "salad with ranch",
        components: [
          { searchQuery: "mixed greens", volumePercentage: 80 },
          { searchQuery: "ranch dressing", volumePercentage: 20 }
        ],
        ingredientsList: "mixed greens, ranch dressing"
      };

      const initialCount = item.components.length;
      reconcileIngredientsToComponents(item);
      expect(item.components.length).toBe(initialCount);
    });
  });

  describe("canMergeScoutLabelIntoFood & spatial clustering", () => {
    it("does not merge sweet chilli mini fillets label", () => {
      const label = { originalName: "Quorn Sweet Chilli Mini Fillets Nutrition Facts Label" };
      const food = { originalName: "Quorn Sweet Chilli Mini Fillets" };
      const d = canMergeScoutLabelIntoFood(label, food);
      expect(d.ok).toBe(true);
    });
    it("uses Scout Dedupe for True Friends", () => {
      const label = { originalName: "Tesco Vegan Chicken Nuggets Nutrition Facts Label" };
      const food = { originalName: "Tesco Vegan Chicken Nuggets" };
      const d = canMergeScoutLabelIntoFood(label, food);
      expect(d.ok).toBe(true);
    });

    it("preserves parenthetical comma lists without exploding and keeps direct nutrients intact", () => {
      const mockOutput = {
        items: [
          {
            keyword: "mixed vegetables",
            originalName: "Mixed Vegetables (Corn, Peas, Carrots)",
            estimatedWeightGrams: 120,
            nutrients: {
              protein: 4,
              carbohydrates: 18,
              totalFat: 4,
              sodium: 120
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].originalName).toBe("Mixed Vegetables (Corn, Peas, Carrots)");
      expect(result.items[0].estimatedWeightGrams).toBe(120);
      expect(result.items[0].nutrientBasisWeight).toBe(120);
      expect(result.items[0].nutrients.protein).toBe(4);
    });

    it("re-anchors nutrientBasisWeight and merges nutrients in clusterSpatialCompositeDishes", () => {
      const items = [
        {
          originalName: "Grilled Chicken",
          keyword: "grilled chicken",
          estimatedWeightGrams: 150,
          nutrientBasisWeight: 150,
          boundingBox2D: [100, 100, 400, 400],
          sourceImageIndex: 0,
          nutrients: { protein: 30, carbohydrates: 0, totalFat: 5 }
        },
        {
          originalName: "Steamed Rice",
          keyword: "steamed rice",
          estimatedWeightGrams: 200,
          nutrientBasisWeight: 200,
          boundingBox2D: [120, 110, 410, 410],
          sourceImageIndex: 0,
          nutrients: { protein: 5, carbohydrates: 50, totalFat: 1 }
        }
      ];

      const clustered = clusterSpatialCompositeDishes(items, () => {});
      expect(clustered).toHaveLength(1);
      expect(clustered[0].estimatedWeightGrams).toBe(350);
      expect(clustered[0].nutrientBasisWeight).toBe(350);
      expect(clustered[0].nutrients.protein).toBe(35);
      expect(clustered[0].nutrients.carbohydrates).toBe(50);
      expect(clustered[0].nutrients.totalFat).toBe(6);
    });

    it("combines weights and nutrients for duplicate visual items across separate photos", () => {
      const mockOutput = {
        items: [
          {
            keyword: "potato wedges",
            originalName: "Potato Wedges",
            estimatedWeightGrams: 100,
            sourceImageIndex: 0,
            boundingBox2D: [500, 100, 900, 400],
            nutrients: { protein: 2.5, carbohydrates: 26, totalFat: 7, sodium: 200 }
          },
          {
            keyword: "potato wedges",
            originalName: "Potato Wedges",
            estimatedWeightGrams: 90,
            sourceImageIndex: 1,
            boundingBox2D: [400, 50, 800, 500],
            nutrients: { protein: 2.2, carbohydrates: 23, totalFat: 6, sodium: 180 }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockOutput, () => {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].estimatedWeightGrams).toBe(190);
      expect(result.items[0].nutrientBasisWeight).toBe(190);
      expect(result.items[0].nutrients.protein).toBe(4.7);
      expect(result.items[0].nutrients.carbohydrates).toBe(49);
      expect(result.items[0].nutrients.totalFat).toBe(13);
      expect(result.items[0].nutrients.sodium).toBe(380);
    });

    it("does not merge separate plates or distinct dishes with their own components", () => {
      const items = [
        {
          originalName: "Uncooked Plate Ingredients",
          keyword: "uncooked plate ingredients",
          estimatedWeightGrams: 300,
          boundingBox2D: [390, 0, 990, 439],
          sourceImageIndex: 0,
          components: [
            { name: "Broccoli", weightGrams: 250 },
            { name: "Baby Corn", weightGrams: 50 }
          ]
        },
        {
          originalName: "Raw Egg",
          keyword: "raw egg",
          estimatedWeightGrams: 65,
          boundingBox2D: [790, 350, 990, 489],
          sourceImageIndex: 0,
          components: [
            { name: "Chicken Egg", weightGrams: 65 }
          ]
        }
      ];

      const clustered = clusterSpatialCompositeDishes(items, () => {});
      // Raw egg and plate ingredients on separate coordinates should remain distinct dishes
      expect(clustered).toHaveLength(2);
      expect(clustered[0].originalName).toBe("Uncooked Plate Ingredients");
      expect(clustered[1].originalName).toBe("Raw Egg");
    });

    it("consolidates duplicate scout items with identical names from the same image even with default boxes", () => {
      const items = [
        {
          originalName: "Almond Glazed Donut",
          keyword: "donut",
          estimatedWeightGrams: 80,
          boundingBox2D: [100, 100, 400, 400],
          sourceImageIndex: 0,
        },
        {
          originalName: "Yakult Rasa Stroberi",
          keyword: "probiotic drink",
          estimatedWeightGrams: 65,
          boundingBox2D: [0, 0, 1000, 1000],
          sourceImageIndex: 0,
        },
        {
          originalName: "Yakult Rasa Stroberi",
          keyword: "probiotic drink",
          estimatedWeightGrams: 65,
          boundingBox2D: [0, 0, 1000, 1000],
          sourceImageIndex: 0,
        },
      ];

      const clustered = clusterSpatialCompositeDishes(items, () => {});
      expect(clustered).toHaveLength(2);
      expect(clustered[0].originalName).toBe("Almond Glazed Donut");
      expect(clustered[1].originalName).toBe("Yakult Rasa Stroberi");
      expect(clustered[1].estimatedWeightGrams).toBe(130);
    });
  });

  describe("bracketed content handling", () => {
    it("should parse bracketed food items with name and weight", async () => {
      const { parseBracketedFoodItems } = await import("./agents/scoutInstructions");
      const items = parseBracketedFoodItems("[Mr Oat Rolled Oats 70g] + identify all barcode");
      expect(items).toHaveLength(1);
      expect(items[0].originalName).toBe("Mr Oat Rolled Oats");
      expect(items[0].estimatedWeightGrams).toBe(70);
      expect(items[0].source).toBe("bracket_pre_extracted");
    });

    it("should filter out scout dishes matching bracketed items in parseAndHealVisionScout", async () => {
      const { parseAndHealVisionScout } = await import("./server_vision_scout");
      const mockScoutOutput = {
        dishes: [
          {
            dishName: "Seafood Soup Pot",
            estimatedWeightGrams: 800,
            cookingMethod: "boiled",
            foods: [
              { foodName: "Squid", weightGrams: 200, nutrients: { protein: 30, saturatedFat: 0.5, addedSugar: 0, totalFibre: 0, sodium: 80, carbohydrates: 0 } }
            ]
          },
          {
            dishName: "Mr Oat Rolled Oats",
            estimatedWeightGrams: 70,
            cookingMethod: "raw",
            foods: [
              { foodName: "Mr Oat Rolled Oats", weightGrams: 70, nutrients: { protein: 3, saturatedFat: 0.5, addedSugar: 0, totalFibre: 0, sodium: 0, carbohydrates: 21 } }
            ]
          }
        ]
      };
      const result = parseAndHealVisionScout(mockScoutOutput, () => {}, false, "I had [Mr Oat Rolled Oats 70g] with all food in the picture");
      expect(result.items.some((it: any) => it.originalName === "Mr Oat Rolled Oats")).toBe(false);
      expect(result.items.some((it: any) => it.originalName === "Seafood Soup Pot")).toBe(true);
    });

    it("should filter out hallucinated/placeholder dishes like 'Empty Context' or 'None'", async () => {
      const { parseAndHealVisionScout } = await import("./server_vision_scout");
      const mockScoutEmptyContext = {
        dishes: [
          {
            dishName: "Empty Context",
            estimatedWeightGrams: 250,
            cookingMethod: "raw",
            foods: [
              { foodName: "None", weightGrams: 1, nutrients: { calories: 0, protein: 0, saturatedFat: 0, addedSugar: 0, totalFibre: 0, sodium: 0, carbohydrates: 0 } }
            ]
          }
        ]
      };
      const result = parseAndHealVisionScout(mockScoutEmptyContext, () => {});
      expect(result.items.length).toBe(0);
      expect(result.visionScoutRanAndReturnedItems).toBe(false);
    });

    it("applies unsweetened modifier correctly to Indonesian iced tea (Es Manis / Es Tawar)", async () => {
      const { applyNutrientModifiers } = await import("./server_derivation");
      const { applyMealModifiers } = await import("./src/server/food/server_food_precalc");

      const nutrients = {
        calories: 92,
        protein: 0,
        totalFat: 0,
        saturatedFat: 0,
        carbohydrates: 23,
        sugar: 22,
        addedSugar: 22,
        sodium: 10
      };

      const res = applyNutrientModifiers(nutrients, {
        message: "The tea is unsweetened",
        name: "Es Manis",
      });

      expect(res.updatedNutrients.calories).toBe(0);
      expect(res.updatedNutrients.carbohydrates).toBe(0);
      expect(res.updatedNutrients.sugar).toBe(0);
      expect(res.updatedNutrients.addedSugar).toBe(0);

      const precalcItems = [
        {
          originalName: "Es Manis",
          keyword: "Es Manis",
          foodType: "beverage",
          nutrients: { ...nutrients },
          components: [
            {
              name: "Teh Manis Dingin",
              calories: 92,
              carbohydrates: 23,
              sugar: 22,
              addedSugar: 22,
              nutrients: { ...nutrients }
            }
          ]
        }
      ];

      applyMealModifiers({
        preCalculatedItems: precalcItems,
        message: "The tea is unsweetened",
        onLog: () => {}
      });

      expect(precalcItems[0].nutrients.calories).toBe(0);
      expect(precalcItems[0].nutrients.carbohydrates).toBe(0);
      expect(precalcItems[0].nutrients.sugar).toBe(0);
      expect(precalcItems[0].components[0].calories).toBe(0);
    });

    it("reconcileIngredientsToComponents gives injected ingredients valid non-zero nutrients and prevents duplicates", () => {
      const itemWithExisting = {
        keyword: "Burger",
        originalName: "Cheeseburger",
        components: [
          { name: "Beef Patty", volumePercentage: 60 },
          { name: "Lettuce and Sauce", volumePercentage: 40 }
        ],
        ingredientsList: "beef, lettuce and sauce, special sauce"
      };

      reconcileIngredientsToComponents(itemWithExisting);
      // "sauce" / "lettuce and sauce" should not be re-injected as a duplicate
      expect(itemWithExisting.components.length).toBe(2);

      const itemWithMissing = {
        keyword: "Salad",
        originalName: "Garden Salad",
        components: [
          { name: "Mixed Greens", volumePercentage: 100 }
        ],
        ingredientsList: "mixed greens, ranch dressing"
      };

      reconcileIngredientsToComponents(itemWithMissing);
      expect(itemWithMissing.components.length).toBe(2);
      const injected = itemWithMissing.components[1] as any;
      expect(injected.name).toBe("ranch dressing");
      expect(injected.calories).toBeGreaterThan(0);
      expect(injected.totalFat).toBeGreaterThan(0);
      expect(injected.nutrients.calories).toBeGreaterThan(0);
    });

    it("unrolls a single dish containing multiple distinct food components into separate top-level items without subitems", () => {
      const mockScout = {
        dishes: [
          {
            dishName: "Tahu dan Daging Sapi",
            estimatedWeightGrams: 400,
            cookingMethod: "boiled",
            sourceImageIndex: 0,
            boundingBox2D: [0, 0, 1000, 1000],
            foods: [
              {
                foodName: "Tahu",
                genericEnglishName: "tofu",
                weightGrams: 300,
                nutrients: {
                  protein: 24,
                  saturatedFat: 1.5,
                  addedSugar: 0,
                  totalFibre: 2,
                  sodium: 15,
                  carbohydrates: 5,
                }
              },
              {
                foodName: "Daging Sapi",
                genericEnglishName: "beef",
                weightGrams: 100,
                nutrients: {
                  protein: 26,
                  saturatedFat: 3,
                  addedSugar: 0,
                  totalFibre: 0,
                  sodium: 50,
                  carbohydrates: 0,
                }
              }
            ],
            dishNutrients: {
              saturatedFat: 4.5,
              totalFat: 15,
              totalSugar: 0.5,
              vitaminD: 0,
              protein: 50,
              sodium: 65,
              totalFibre: 2,
            }
          }
        ]
      };

      const result = parseAndHealVisionScout(mockScout, () => {});
      expect(result.items.length).toBe(2);
      expect(result.items[0].originalName).toBe("Tahu");
      expect(result.items[0].estimatedWeightGrams).toBe(300);
      expect(result.items[0].hasComponents).toBe(false);
      expect(result.items[0].components).toBeUndefined();
      expect(result.items[0].nutrients.protein).toBe(24);

      expect(result.items[1].originalName).toBe("Daging Sapi");
      expect(result.items[1].estimatedWeightGrams).toBe(100);
      expect(result.items[1].hasComponents).toBe(false);
      expect(result.items[1].components).toBeUndefined();
      expect(result.items[1].nutrients.protein).toBe(26);
    });

    it("unrolls a sole Mie Ayam bowl (job_1789414917685) even when the dish name does not contain the food names", () => {
      const mockScout = {
        dishes: [
          {
            dishName: "Mie Ayam",
            genericEnglishName: "chicken noodles",
            estimatedWeightGrams: 350,
            cookingMethod: "boiled",
            sourceImageIndex: 0,
            boundingBox2D: [190, 0, 960, 1000],
            foods: [
              {
                foodName: "Mie Kuning",
                genericEnglishName: "yellow wheat noodles",
                weightGrams: 150,
                sourceImageIndex: 0,
                nutrients: { protein: 6, saturatedFat: 0.5, addedSugar: 0, totalFibre: 2, sodium: 300, carbohydrates: 45 },
              },
              {
                foodName: "Ayam Kecap",
                genericEnglishName: "sweet soy chicken",
                weightGrams: 100,
                sourceImageIndex: 0,
                nutrients: { protein: 18, saturatedFat: 2.5, addedSugar: 4, totalFibre: 0.5, sodium: 450, carbohydrates: 5 },
              },
              {
                foodName: "Sawi Hijau",
                genericEnglishName: "choy sum",
                weightGrams: 50,
                sourceImageIndex: 0,
                nutrients: { protein: 1, saturatedFat: 0, addedSugar: 0, totalFibre: 1.5, sodium: 20, carbohydrates: 2 },
              },
              {
                foodName: "Minyak Ayam dan Kaldu",
                genericEnglishName: "chicken oil and broth",
                weightGrams: 50,
                sourceImageIndex: 0,
                nutrients: { protein: 1, saturatedFat: 3.5, addedSugar: 0, totalFibre: 0, sodium: 250, carbohydrates: 0.5 },
              },
            ],
            dishNutrients: {
              saturatedFat: 6.5,
              totalFat: 14,
              protein: 26,
              sodium: 1020,
              carbohydrates: 52.5,
              totalFibre: 4,
            },
          },
        ],
      };

      const result = parseAndHealVisionScout(mockScout, () => {});
      expect(result.items.map((it: any) => it.originalName)).toEqual([
        "Mie Kuning",
        "Ayam Kecap",
        "Sawi Hijau",
        "Minyak Ayam dan Kaldu",
      ]);
      for (const it of result.items) {
        expect(it.hasComponents).toBe(false);
        expect(it.components).toBeUndefined();
        expect(it.boundingBox2D).toEqual([190, 0, 960, 1000]);
      }
      expect(result.items[0].estimatedWeightGrams).toBe(150);
      expect(result.items[1].estimatedWeightGrams).toBe(100);
    });
  });
});

