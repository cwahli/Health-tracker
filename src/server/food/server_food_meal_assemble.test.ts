import { describe, it, expect } from 'vitest';
import {
  buildFallbackItemsBreakdown,
  assembleParsedMealHeader,
  backfillEditCommandEstimates,
  formatMultiItemMealTitle,
  resolveEditedMealTitle,
  resolveModifyIncomingTitle,
  isDummyBoundingBox,
  appendEditHistoryEntry,
  syncEditScoutItems,
  buildGateInput,
  deriveMealComposition,
  resolveMealImageUrls,
  mergeFinalScoutItems,
  buildNewLogGateInput,
  mapFinalizeToMeal,
  mergeModifyPathScoutItems,
  runEvaluationFinalize,
  assembleEvaluationComparison,
} from './server_food_meal_assemble';
import { applyMealEdits } from '../../../server_meal_edit.js';

describe('F-8.10 shard 6 — fallback breakdown', () => {
  it('builds estimated rows from scout items and logs once', () => {
    const logs: string[] = [];
    const out = buildFallbackItemsBreakdown({
      visionScoutItems: [{ keyword: 'rice', estimatedWeightGrams: 200 }],
      databaseMatchesArray: [],
      quarantinedIdsSet: new Set(),
      onLog: (m) => logs.push(m),
    });
    expect(out).toHaveLength(1);
    expect(out![0].canonicalDbName).toBe('rice');
    expect(out![0].dbSource).toBe('estimated');
    expect(out![0].weightGrams).toBe('200');
    expect(logs.some((m) => m.includes('LLM truncated'))).toBe(true);
  });

  it('returns null without scout items and never invents a label source', () => {
    const logs: string[] = [];
    expect(buildFallbackItemsBreakdown({
      visionScoutItems: [], databaseMatchesArray: [], quarantinedIdsSet: new Set(), onLog: (m) => logs.push(m),
    })).toBeNull();
    expect(logs).toEqual([]);
    const out = buildFallbackItemsBreakdown({
      visionScoutItems: [{
        keyword: 'oats', estimatedWeightGrams: 60,
        source: 'visual',
        nutritionFacts: { caloriesPer100g: 350, proteinPer100g: 10 },
      }],
      databaseMatchesArray: [],
      quarantinedIdsSet: new Set(),
      onLog: () => {},
    });
    // nutritionFacts alone must not promote the row to a printed label
    expect(out![0].dbSource).toBe('estimated');
    expect(out![0].labelNutrientsPerServing).toBeNull();
  });
});

describe('F-8.10 shard 6 — parsed meal header', () => {
  const base = {
    rawFoodData: {
      name: 'Lunch',
      date: '2026-09-04',
      itemsBreakdown: [{ canonicalDbName: 'Rice', weightGrams: 200 }],
      composition: 'Rice bowl',
      weightGrams: 200,
      quantity: '1 serving',
      message: 'Tasty',
      verdict: { label: 'Good fuel', level: 'good' },
      cookingMethod: 'boiled',
    },
    rawParsed: {},
    imageDates: [],
    message: 'log lunch',
    originalModeIsModify: false,
    activeMeal: null as any,
    language: 'en' as unknown,
  };

  it('assembles names, dates, verdict, and dining env', () => {
    const { parsedData, diningEnvironment } = assembleParsedMealHeader({
      ...base, scoutCookingMethod: 'raw', diningEnvironment: 'home_cooked',
    });
    expect(parsedData.name).toBe('Lunch');
    expect(parsedData.date).toBe('2026-09-04');
    expect(parsedData.weightGrams).toBe(200);
    expect(parsedData.basis_type).toBe('total');
    expect(parsedData.verdict.level).toBe('good');
    expect(parsedData.diningEnvironment).toBe('home_cooked');
    expect(diningEnvironment).toBe('home_cooked');
  });

  it('falls back to the active meal date and dining env on edits', () => {
    const { parsedData, diningEnvironment } = assembleParsedMealHeader({
      ...base,
      rawFoodData: { ...base.rawFoodData, date: undefined },
      originalModeIsModify: true,
      activeMeal: { date: '2026-09-01', diningEnvironment: 'casual_restaurant' },
      diningEnvironment: 'unknown',
    });
    expect(parsedData.date).toBe('2026-09-01');
    expect(diningEnvironment).toBe('casual_restaurant');
  });

  it('sanitizes undefined-ish strings and keeps Q&A message empty-safe', () => {
    const { parsedData } = assembleParsedMealHeader({
      ...base,
      rawFoodData: { name: 'undefined', itemsBreakdown: [] },
      rawParsed: { message: undefined },
    });
    expect(parsedData.name).toBe('Meal Log');
    expect(parsedData.message).toBe('');
  });
});

describe('F-8.10 shard 7 — modify-path seams', () => {
  it('backfills identity-change estimates and throws on invalid commands', () => {
    const withFix = backfillEditCommandEstimates({
      modificationCommand: [{ action: 'replace_identity', itemName: 'soda', newItemName: 'Tea', scoutIndex: 3 }],
      foodData: { itemsBreakdown: [{ canonicalDbName: 'Tea', scoutIndex: 3, correctedNutrients: { calories: 2, protein: 0 }, foodType: 'beverage', cookingMethod: 'raw' }] },
    });
    expect(withFix[0].estimate.calories).toBe(2);
    expect(withFix[0].estimate.foodType).toBe('beverage');
    expect(() => backfillEditCommandEstimates({
      modificationCommand: [{ action: 'add_item', itemName: 'cake' }],
      foodData: { itemsBreakdown: [] },
    })).toThrow(/invalid response/);
    expect(backfillEditCommandEstimates({ modificationCommand: [] })).toEqual([]);
  });

  it('formats multi-item titles and syncs renames from commands', () => {
    expect(formatMultiItemMealTitle([])).toBe('Meal');
    expect(formatMultiItemMealTitle([{ name: 'Rice' }])).toBe('Rice');
    expect(formatMultiItemMealTitle([{ name: 'Rice' }, { name: 'Tea' }])).toBe('Rice and Tea');
    expect(formatMultiItemMealTitle([{ name: 'Rice' }, { name: 'Tea' }, { name: 'Soup' }])).toBe('Rice, Tea, and Soup');
    expect(formatMultiItemMealTitle([
      { name: 'Burger' }, { name: 'Fries' }, { name: 'Cola' }, { name: 'Salad' }, { name: 'Pie' }
    ])).toBe('Burger, Fries, and 3 other dishes');
    const renamed = resolveEditedMealTitle({
      incomingTitle: 'Rice and Soda',
      items: [{ name: 'Rice' }, { name: 'Unsweetened Tea' }],
      editCommands: [{ action: 'replace_identity', itemName: 'Soda', newItemName: 'Unsweetened Tea' }],
    });
    expect(renamed).toBe('Rice and Unsweetened Tea');
    expect(resolveEditedMealTitle({ incomingTitle: 'Lunch', items: [{ name: 'Rice' }], editCommands: [] })).toBe('Lunch');
    expect(resolveEditedMealTitle({ incomingTitle: null, items: [], editCommands: [] })).toBeNull();
  });

  it('keeps the stable active-meal title over a corrupted edit-turn re-observation', () => {
    // Live case: zero-image "drink is unsweetened" edit merged the tea into the
    // fish dish at scout level ("Ikan Cendro Suwir Pete with Teh Tawar").
    const incomingTitle = resolveModifyIncomingTitle(
      'Ikan Cendro Suwir Pete, Cah Kangkung, and Es Teh Manis',
      'Ikan Cendro Suwir Pete with Teh Tawar and Cah Kangkung',
    );
    expect(incomingTitle).toBe('Ikan Cendro Suwir Pete, Cah Kangkung, and Es Teh Manis');
    const resolved = resolveEditedMealTitle({
      incomingTitle,
      items: [{ name: 'Ikan Cendro Suwir Pete' }, { name: 'Cah Kangkung' }, { name: 'Es Teh Tawar' }],
      editCommands: [{ action: 'set_modifier', itemName: 'Es Teh Manis', newItemName: 'Es Teh Tawar' }],
    });
    expect(resolved).toBe('Ikan Cendro Suwir Pete, Cah Kangkung, and Es Teh Tawar');
    expect(resolveModifyIncomingTitle(null, 'Projector Name')).toBe('Projector Name');
  });

  it('rebuilds a stale multi-item title from result items when segments no longer match', () => {
    // Live case 1: scout-level rename with no edit commands — title kept Manis
    // while every other surface (ledger, chips, receipt) said Tawar.
    expect(resolveEditedMealTitle({
      incomingTitle: 'Ikan Cakalang Suwir, Cah Kangkung, and Es Teh Manis',
      items: [{ name: 'Ikan Cakalang Suwir' }, { name: 'Cah Kangkung' }, { name: 'Es Teh Tawar' }],
      editCommands: [],
    })).toBe('Ikan Cakalang Suwir, Cah Kangkung, and Es Teh Tawar');
    // Live case 2: merge fragment leaked into the title on a zero-image edit.
    expect(resolveEditedMealTitle({
      incomingTitle: 'Ikan Cendro Suwir Pete with Teh Tawar and Cah Kangkung',
      items: [{ name: 'Ikan Cendro Suwir Pete' }, { name: 'Cah Kangkung' }, { name: 'Es Teh Tawar' }],
      editCommands: [],
    })).toBe('Ikan Cendro Suwir Pete, Cah Kangkung, and Es Teh Tawar');
    // Weight-only edit: segments still match, title untouched.
    expect(resolveEditedMealTitle({
      incomingTitle: 'Rice, Kangkung, and Tea',
      items: [{ name: 'Rice' }, { name: 'Kangkung' }, { name: 'Tea' }],
      editCommands: [],
    })).toBe('Rice, Kangkung, and Tea');
  });

  it('syncs scout chips with ledger renames and fabricates missing rows', () => {
    const out = syncEditScoutItems({
      baseScoutItems: [{ scoutIndex: 0, originalName: 'Es Teh Manis', keyword: 'Es Teh Manis' }],
      resultItems: [{ scoutIndex: 0, canonicalDbName: 'Unsweetened Iced Tea', weightGrams: 300 }],
    });
    expect(out[0].originalName).toBe('Unsweetened Iced Tea');
    expect(out[0].keyword).toBe('Unsweetened Iced Tea');
    const fabricated = syncEditScoutItems({
      baseScoutItems: [],
      resultItems: [{ scoutIndex: 9, name: 'Mystery' }],
    });
    expect(fabricated[0].originalName).toBe('Mystery');
    expect(fabricated[0].cookingMethod).toBe('raw');
  });

  it('carries real turn-1 boxes over dummy zero-image edit emissions', () => {
    expect(isDummyBoundingBox([0, 0, 100, 100])).toBe(true);
    expect(isDummyBoundingBox([0, 0, 1000, 1000])).toBe(true);
    expect(isDummyBoundingBox([342, 0, 907, 582])).toBe(false);
    expect(isDummyBoundingBox(null)).toBe(false);
    // Live case: t2 re-emitted [0,0,100,100] for all 3 dishes; chips must keep t1 boxes.
    const out = syncEditScoutItems({
      baseScoutItems: [{ scoutIndex: 0, originalName: 'Es Teh Manis', keyword: 'Es Teh Manis', boundingBox2D: [0, 303, 391, 655] }],
      resultItems: [{ scoutIndex: 0, canonicalDbName: 'Es Teh Tawar', weightGrams: 300, boundingBox2D: [0, 0, 100, 100] }],
    });
    expect(out[0].boundingBox2D).toEqual([0, 303, 391, 655]);
    expect(out[0].originalName).toBe('Es Teh Tawar');
    // Real re-observation still wins when present.
    const grounded = syncEditScoutItems({
      baseScoutItems: [{ scoutIndex: 0, originalName: 'Tea', keyword: 'Tea', boundingBox2D: [0, 303, 391, 655] }],
      resultItems: [{ scoutIndex: 0, canonicalDbName: 'Tea', weightGrams: 300, boundingBox2D: [10, 310, 400, 660] }],
    });
    expect(grounded[0].boundingBox2D).toEqual([10, 310, 400, 660]);
  });

  it('appends edit history and shapes gate input', () => {
    const meal: any = {};
    const logs: string[] = [];
    appendEditHistoryEntry({
      activeMeal: meal, message: 'less rice',
      result: { notes: [' halved rice '], beforeItems: [{ name: 'Rice', weightGrams: 200 }], items: [{ name: 'Rice', weightGrams: 100 }] },
      onLog: (m) => logs.push(m),
    });
    expect(meal.historyLog.length).toBe(1);
    expect(meal.historyLog[0].stage).toBe('meal_edit');
    const gate = buildGateInput({
      finalMeal: { id: 'm1', name: 'Lunch', weightGrams: 300, nutrients: { calories: 400, protein: 20, carbohydrates: 50, totalFat: 10 }, itemsBreakdown: [{ originalName: 'Rice', weightGrams: 300 }] },
      jobId: 'j1', imagePayloads: [{}], finalMessage: 'done', previousMeal: null, editCommands: [],
    });
    expect(gate.mealId).toBe('m1');
    expect(gate.calories).toBe(400);
    expect(gate.imageCount).toBe(1);
    expect(gate.items[0].name).toBe('Rice');
  });
});

describe('F-8.10 shard 8 — new_log tail seams', () => {
  it('derives composition with sauce and redundancy filters, clears label visuals', () => {
    const items: any[] = [
      { canonicalDbName: 'Chicken Rice', visualIngredients: ['chicken', 'rice', 'soy sauce', 'cucumber'] },
      { canonicalDbName: 'Cola', dbSource: 'label', dbId: 'printed_packaging_label_1', visualIngredients: ['caramel'] },
    ];
    expect(deriveMealComposition(items)).toBe('Chicken Rice (cucumber), Cola');
    expect(items[1].visualIngredients).toEqual([]);
    expect(deriveMealComposition(null)).toBe('');
  });

  it('resolves image urls through the payload priority chain', () => {
    const parsed: any = {};
    resolveMealImageUrls({ body: { photoUrl: 'http://p' }, images: [], image: null, parsedData: parsed });
    expect(parsed.imageUrl).toBe('http://p');
    expect(parsed.imageUrls).toEqual(['http://p']);
    const parsed2: any = {};
    resolveMealImageUrls({ body: {}, images: [], image: null, parsedData: parsed2 });
    expect(parsed2.imageUrl).toBeUndefined();
  });

  it('merges final scout items with precalc overlay and ledger renames', () => {
    const out = mergeFinalScoutItems({
      visionScoutItems: [{ scoutIndex: 0, keyword: 'rice', originalName: 'Rice', estimatedWeightGrams: 100 }],
      dietScoutItems: [],
      preCalculatedItems: [{ scoutIndex: 0, nutrients: { calories: 130 } }],
      itemsBreakdown: [{ scoutIndex: 0, canonicalDbName: 'Steamed Rice', weightGrams: 200 }],
    });
    expect(out[0].nutrients.calories).toBe(130);
    expect(out[0].preCalcNutrients.calories).toBe(130);
    expect(out[0].originalName).toBe('Steamed Rice');
    expect(out[0].estimatedWeightGrams).toBe(200);
  });

  it('shapes identical gate input for new_log and modify fallback', () => {
    const meal: any = {
      id: 'm1', name: 'Lunch', weightGrams: 300,
      nutrients: { calories: 400, protein: 20, carbohydrates: 50, totalFat: 10 },
      itemsBreakdown: [{ originalName: 'Rice', weightGrams: 300, nutrients: { calories: 400 } }],
    };
    const args = { finalMeal: meal, jobId: 'j1', photoUrl: 'http://p', imagePayloads: [{}], narrative: 'msg' };
    const gate = buildNewLogGateInput(args);
    expect(gate.mealId).toBe('m1');
    expect(gate.items).toHaveLength(1);
    expect(gate.imageCount).toBe(1);
    expect(gate.narrative).toBe('msg');
    expect(gate).not.toHaveProperty('commands');
    expect(gate).not.toHaveProperty('previousMeal');
  });
});

describe('F-8.10 shard 19 — finalize-to-meal mapping', () => {
  it('maps ledgers onto parsedData and backfills empty meals honestly', () => {
    const logs: string[] = [];
    const sent: any[] = [];
    const parsed: any = { name: 'Draft', date: '2026-09-04' };
    mapFinalizeToMeal({
      preCalculatedItems: [],
      rawFoodData: { itemsBreakdown: [] },
      diningEnvironment: 'home_cooked',
      parsedData: parsed,
      rawParsed: { message: 'hi' },
      onLog: (m: string) => logs.push(m),
      sendLog: (t: string, s: string, m: string) => sent.push([t, s, m]),
    });
    expect(parsed.itemsBreakdown).toEqual([]);
    expect(parsed.nutrients).toEqual({});
    expect(logs.some((m) => m.includes('not inventing a second calorie book'))).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe('F-8.10 shard 20 — modify-path scout merge', () => {
  it('merges diet items, prunes to ledger indices, and renames', () => {
    const out = mergeModifyPathScoutItems({
      visionScoutItems: [
        { scoutIndex: 0, keyword: 'rice', originalName: 'Rice', estimatedWeightGrams: 100 },
        { scoutIndex: 1, keyword: 'soda', originalName: 'Soda', estimatedWeightGrams: 200 },
      ],
      activeMealScoutItems: [],
      dietScoutItems: [],
      itemsBreakdown: [{ scoutIndex: 0, canonicalDbName: 'Steamed Rice', weightGrams: 200 }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].originalName).toBe('Steamed Rice');
    expect(out[0].estimatedWeightGrams).toBe(200);
  });

  it('falls back to active-meal scouts when vision is empty', () => {
    const out = mergeModifyPathScoutItems({
      visionScoutItems: [],
      activeMealScoutItems: [{ scoutIndex: 5, keyword: 'tea' }],
      dietScoutItems: [],
      itemsBreakdown: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].scoutIndex).toBe(5);
  });

  it('keeps locked coordinates when a patch re-emit carries a dummy box', () => {
    const out = mergeModifyPathScoutItems({
      visionScoutItems: [
        { scoutIndex: 4, keyword: 'Cereal', originalName: 'Granola / Cereal Packet', estimatedWeightGrams: 130, boundingBox2D: [0, 0, 100, 100], sourceImageIndex: 0 },
      ],
      activeMealScoutItems: [
        { scoutIndex: 4, keyword: 'Cereal', originalName: 'Granola / Cereal Packet', estimatedWeightGrams: 35, boundingBox2D: [10, 20, 900, 950], sourceImageIndex: 0 },
      ],
      dietScoutItems: [],
      itemsBreakdown: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].boundingBox2D).toEqual([10, 20, 900, 950]);
    expect(out[0].sourceImageIndex).toBe(0);
  });

  it('leaves boxes alone when nothing is dummy', () => {
    const out = mergeModifyPathScoutItems({
      visionScoutItems: [
        { scoutIndex: 1, keyword: 'Soup', originalName: 'Sop', estimatedWeightGrams: 400, boundingBox2D: [100, 50, 920, 960], sourceImageIndex: 1 },
      ],
      activeMealScoutItems: [
        { scoutIndex: 1, keyword: 'Soup', originalName: 'Sop', estimatedWeightGrams: 400, boundingBox2D: [5, 5, 50, 50], sourceImageIndex: 1 },
      ],
      dietScoutItems: [],
      itemsBreakdown: [],
    });
    expect(out[0].boundingBox2D).toEqual([100, 50, 920, 960]);
  });
});

describe('F-8.10 shard 24 — evaluation finalize loop', () => {
  it('finalizes scout items and indexes nutrients by position', async () => {
    const logs: string[] = [];
    const out = await runEvaluationFinalize({
      visionScoutItems: [
        {
          scoutIndex: 0, keyword: 'steamed rice', originalName: 'Steamed Rice',
          estimatedWeightGrams: 200,
          nutrients: { calories: 260, protein: 5, carbohydrates: 55, totalFat: 1, sodium: 5 },
        },
      ],
      diningEnvironment: 'home_cooked',
      onLog: (m: string) => logs.push(m),
    });
    // Atwater bottom-up: 4*5 + 4*55 + 9*1 = 249 (fixture kcal is not trusted)
    expect(out[0].calories).toBe(249);
    expect(logs.some((m) => m.includes('mode=D idx=0'))).toBe(true);
    expect(await runEvaluationFinalize({ visionScoutItems: [], onLog: () => {} })).toEqual({});
  });
});

describe('F-8.10 shard 27 — evaluation comparison assembly', () => {
  it('resolves groups and builds the comparison set', () => {
    const logs: string[] = [];
    const { comparisonData, comparisonSet } = assembleEvaluationComparison({
      comparisonData: { groups: [{ groupName: 'A', scoutItemIndices: [0] }] },
      visionScoutItems: [{ keyword: 'rice' }],
      preCalcByScoutIndex: {},
      isMenuScale: false,
      language: 'en',
      jobId: 'job1',
      onLog: (m: string) => logs.push(m),
    });
    expect(comparisonData.isMenuScale).toBe(false);
    expect(comparisonSet).toBeTruthy();
    expect(logs.some((m) => m.includes('Comparison Resolve'))).toBe(true);
  });
});

describe('F-8.10 modify-path rename persistence', () => {
  it('propagates an identity rename into the next-turn itemsBreakdown components', async () => {
    const result = await applyMealEdits({
      items: [
        {
          scoutIndex: 0,
          name: 'Suwir Petai',
          canonicalDbName: 'Cakalang Suwir Petai',
          originalName: 'Cakalang Suwir Petai',
          keyword: 'Cakalang Suwir Petai',
          weightGrams: 200,
          nutrients: {
            calories: 200,
            protein: 20,
            carbohydrates: 10,
            totalFat: 8,
          },
          componentsDetailList: [
            {
              scoutIndex: 0,
              name: 'Cakalang Suwir Petai',
              canonicalDbName: 'Cakalang Suwir Petai',
              originalName: 'Cakalang Suwir Petai',
              keyword: 'Cakalang Suwir Petai',
              weightGrams: 200,
              nutrients: {
                calories: 200,
                protein: 20,
                carbohydrates: 10,
                totalFat: 8,
              },
            },
          ],
          hasComponents: true,
        },
      ],
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang Suwir Petai',
          newItemName: 'Ikan Nila Suwir Petai',
          estimate: {
            protein: 22,
            carbohydrates: 0,
            totalFat: 6,
            foodType: 'fish',
            cookingMethod: 'cooked',
          },
        },
      ],
      userMessage: 'change cakalang to ikan nila',
    });

    expect(result.items[0]?.name).toBe('Ikan Nila Suwir Petai');
    expect(result.items[0]?.canonicalDbName).toBe('Ikan Nila Suwir Petai');
    expect(result.items[0]?.componentsDetailList?.[0]?.canonicalDbName).toBe('Ikan Nila Suwir Petai');
    expect(result.items[0]?.componentsDetailList?.[0]?.name).toBe('Ikan Nila Suwir Petai');
    expect(result.items[0]?.components?.[0]?.canonicalDbName).toBe('Ikan Nila Suwir Petai');
    expect(JSON.stringify(result.items)).not.toContain('Cakalang');
  });
});
