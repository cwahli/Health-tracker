import { describe, it, expect } from 'vitest';
import {
  inheritActiveMealScoutItems,
  mapCompareItemsToScoutItems,
  resolvePriorScoutItems,
  applyBracketPreExtract,
  injectExplicitFoodTags,
  inferPackagedBindChains,
  mapTextQueriesToScoutItems,
  buildScoutFailureError,
  applyScoutResultState,
  mergeScoutIntoActiveMeal,
  logScoutItemSummaries,
  summarizeScoutImageInventory,
  logScoutImageInventory,
  applyWeightModShortcut,
  restoreTurnOneCandidates,
  computeScoutRetryDelay,
  applySkipScoutShortcut,
  checkResumedFromImageTurn,
  applyTextQueryShortcut,
  checkMenuScaleBypass,
  buildScoutCallArgs,
  runScoutRetryLoop,
  countCompareExtracted,
} from './server_food_scout_source';
import { visionScoutResponseSchema } from './server_food_analyze_schema';

describe('F-8.10 shard 9 — scout item sourcing', () => {
  it('inherits finalized items from the active meal for edits', () => {
    const logs: string[] = [];
    const activeMeal = {
      itemsBreakdown: [{ canonicalDbName: 'Rice', weightGrams: 200, nutrients: { calories: 260 }, dbSource: 'estimated' }],
    };
    const out = inheritActiveMealScoutItems({ isModifySession: true, visionScoutItems: [], activeMeal, onLog: (m) => logs.push(m) });
    expect(out.ran).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].keyword).toBe('Rice');
    expect(out.items[0].estimatedWeightGrams).toBe(200);
    expect(out.items[0].scoutIndex).toBe(0);
    expect(logs.some((m) => m.includes('Edit Continuity'))).toBe(true);
  });

  it('passes through when not a modify session or nothing to inherit', () => {
    const logs: string[] = [];
    const existing = [{ keyword: 'x' }];
    expect(inheritActiveMealScoutItems({ isModifySession: false, visionScoutItems: existing, activeMeal: {}, onLog: (m) => logs.push(m) }))
      .toEqual({ items: existing, ran: false });
    expect(inheritActiveMealScoutItems({ isModifySession: true, visionScoutItems: [], activeMeal: { itemsBreakdown: [] }, onLog: (m) => logs.push(m) }).ran).toBe(false);
    expect(logs).toEqual([]);
  });

  it('maps compare names to scout rows', () => {
    expect(mapCompareItemsToScoutItems(['Oats', 'Cake'])).toEqual([
      { scoutIndex: 0, keyword: 'Oats', originalName: 'Oats', estimatedWeightGrams: 100, source: 'compare_request' },
      { scoutIndex: 1, keyword: 'Cake', originalName: 'Cake', estimatedWeightGrams: 100, source: 'compare_request' },
    ]);
  });

  it('resolves prior scout across body, meal, and history fallbacks', () => {
    const items = [{ keyword: 'rice' }];
    expect(resolvePriorScoutItems({ body: { activeScoutItems: items }, history: [], activeMeal: null })).toBe(items);
    expect(resolvePriorScoutItems({ body: { scoutItems: items }, history: [], activeMeal: null })).toBe(items);
    expect(resolvePriorScoutItems({ body: {}, history: [], activeMeal: { scoutItems: items } })).toBe(items);
    const fromHistory = resolvePriorScoutItems({
      body: {}, history: [{ data: { portionClarify: { items } } }], activeMeal: null,
    });
    expect(fromHistory).toBe(items);
    expect(resolvePriorScoutItems({ body: {}, history: [], activeMeal: null })).toEqual([]);
  });
});

describe('F-8.10 shard 9 — scout schema invariants', () => {
  it('requires identity, weight, method, box, foods, and dish nutrients', () => {
    const schema: any = visionScoutResponseSchema;
    expect(schema.required).toEqual(['contentType', 'diningEnvironment', 'dishes']);
    const dish = schema.properties.dishes.items;
    expect(dish.required).toEqual(['dishName', 'estimatedWeightGrams', 'cookingMethod', 'boundingBox2D', 'foods', 'dishNutrients']);
    expect(dish.properties.cookingMethod.enum).toContain('deep_fried');
    const nutrients = dish.properties.foods.items.properties.nutrients;
    expect(nutrients.required).toEqual(['protein', 'saturatedFat', 'addedSugar', 'totalFibre', 'sodium', 'carbohydrates']);
    expect(nutrients.required).not.toContain('calories');
    expect(dish.properties.foods.items.properties.rawNutritionLabel.required).toEqual(['servingSize', 'calories']);
  });
});

describe('F-8.10 shard 10 — scout-prep seams', () => {
  it('purges OCR duplicates of bracket items and stamps fallback nutrients', () => {
    const logs: string[] = [];
    const vision: any[] = [{ originalName: 'Oat Bar', keyword: 'oat bar' }];
    const queries: string[] = [];
    applyBracketPreExtract({
      bracketItems: [{ originalName: 'Oat Bar', estimatedWeightGrams: 200 }],
      visionScoutItems: vision, queriesToSearch: queries, onLog: (m) => logs.push(m),
    });
    expect(vision).toHaveLength(1);
    expect(vision[0].source).toBe('bracket_pre_extracted');
    expect(vision[0].nutrients.calories).toBeGreaterThan(0);
    expect(vision[0].components).toHaveLength(1);
    expect(queries).toEqual(['Oat Bar']);
    expect(logs.some((m) => m.includes('Dropping Scout item'))).toBe(true);
  });

  it('injects catalog tags once and infers packaged chains', () => {
    const logs: string[] = [];
    const vision: any[] = [{ dbId: 'a', keyword: 'Oats' }];
    injectExplicitFoodTags({
      visionScoutItems: vision,
      explicitFoodTags: [{ dbId: 'a', name: 'Oats' }, { dbId: 'b', name: 'Cake', weightGrams: 50 }],
      onLog: (m) => logs.push(m),
    });
    expect(vision).toHaveLength(2);
    expect(vision[1].scoutIndex).toBe(1001);
    expect(vision[1].dbSource).toBe('internal_catalog');

    const items: any[] = [{ originalName: 'Drink', packageLabelText: 'Acme Citrus | Vitamin Drink 330ml' }];
    const logs2: string[] = [];
    inferPackagedBindChains({ packagedBindItems: items, onLog: (m) => logs2.push(m) });
    expect(items[0].chainName).toBe('Acme Citrus');
  });

  it('maps text queries with cooking-method sniffing', () => {
    expect(mapTextQueriesToScoutItems(['grilled salmon', 'rice'])).toEqual([
      { scoutIndex: 0, keyword: 'grilled salmon', originalName: 'grilled salmon', estimatedWeightGrams: 100, source: 'text_query', cookingMethod: 'grilled', visualIngredients: [] },
      { scoutIndex: 1, keyword: 'rice', originalName: 'rice', estimatedWeightGrams: 100, source: 'text_query', cookingMethod: 'raw', visualIngredients: [] },
    ]);
  });
});

describe('F-8.10 shard 11 — scout result handling', () => {
  it('classifies dead scout runs into quota/503/corrupt/generic errors', () => {
    expect(() => buildScoutFailureError({ message: '429 RESOURCE_EXHAUSTED' }, 'en')).toThrow(/quota \(429\)/);
    expect(() => buildScoutFailureError({ message: '503 UNAVAILABLE' }, 'en')).toThrow(/503/);
    expect(() => buildScoutFailureError({ message: 'fetch failed' }, 'en')).toThrow(/503/);
    expect(() => buildScoutFailureError({ message: 'Stream stalled: Vision Scout' }, 'en')).toThrow(/503/);
    expect(() => buildScoutFailureError({ message: 'Vision Scout Corrupted output' }, 'en')).toThrow();
    expect(() => buildScoutFailureError({ message: 'weird' }, 'en')).toThrow(/re-upload/);
  });

  it('applies scout state with source defaulting and mode overrides', () => {
    const logs: string[] = [];
    const events: any[] = [];
    const streams: any[] = [];
    const state = applyScoutResultState({
      scoutResult: {
        internalReasoning: 'r',
        items: [
          { keyword: 'rice', originalName: 'Rice', estimatedWeightGrams: 200 },
          { keyword: 'cola', originalName: 'Cola', estimatedWeightGrams: 330, rawNutritionLabel: { calories: '100' } },
        ],
        scoutConfidenceRating: 'High',
        visionScoutContentType: 'visual',
        diningEnvironment: 'unknown',
        queriesToSearch: ['rice', 'cola'],
        visionScoutRanAndReturnedItems: true,
      },
      requestedMode: 'review',
      hasActiveMealDocument: false,
      activeMealDining: 'casual_restaurant',
      currentRecommendedMode: null,
      onLog: (m) => logs.push(m),
      onEvent: (t, s, m, d) => events.push([t, s, m]),
      onStream: (e) => streams.push(e),
    });
    expect(state.visionScoutItems[0].source).toBe('visual');
    expect(state.visionScoutItems[1].source).toBe('label');
    expect(state.diningEnvironment).toBe('casual_restaurant');
    expect(state.scoutRecommendedMode).toBe('new_log');
    expect(state.queriesToSearch).toEqual(['rice', 'cola']);
    expect(events[0][0]).toBe('scout_answer');
    expect(streams[0].stage).toBe('scout');
  });

  it('merges fresh dishes behind existing meal items with index offset', () => {
    const logs: string[] = [];
    const merged = mergeScoutIntoActiveMeal({
      activeMealItemsBreakdown: [{ canonicalDbName: 'Rice', weightGrams: 200, scoutIndex: 0 }],
      visionScoutItems: [{ keyword: 'tea', scoutIndex: 0 }],
      onLog: (m) => logs.push(m),
    });
    expect(merged).toHaveLength(2);
    expect(merged[0].keyword).toBe('Rice');
    expect(merged[1].scoutIndex).toBe(1);
    expect(logs.some((m) => m.includes('same meal'))).toBe(true);
  });

  it('logs per-item summaries with label and flag chrome', () => {
    const logs: string[] = [];
    logScoutItemSummaries([
      { scoutIndex: 0, keyword: 'cola', rawNutritionLabel: { calories: '100', servingSize: '330ml' }, anomalyFlags: ['big'] },
    ], (m) => logs.push(m));
    expect(logs[0]).toContain('Nutrition Label:');
    expect(logs[0]).toContain('Flags: [big]');
  });

  it('summarizes model perImage rows and flags zero-coverage images', () => {
    const out = summarizeScoutImageInventory({
      perImage: [
        { imageIndex: 0, itemsFound: ['Oat Cereal'] },
        { imageIndex: 1, itemsFound: [] },
      ],
      imageCount: 2,
      items: [{ sourceImageIndex: 0, dishName: 'Oat Cereal' }],
    });
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0].itemsFound).toEqual(['Oat Cereal']);
    expect(out.uncovered).toEqual([1]);
  });

  it('derives coverage from dishes when the model omits perImage', () => {
    const logs: string[] = [];
    const out = logScoutImageInventory({
      perImage: undefined,
      imageCount: 3,
      items: [
        { sourceImageIndex: 1, dishName: 'Soup' },
        { sourceImageIndex: 2, dishName: 'Drink' },
      ],
      onLog: (m) => logs.push(m),
    });
    expect(out.uncovered).toEqual([0]);
    expect(logs.some((m) => m.includes('[ScoutInventory] 3 image(s) attached'))).toBe(true);
    expect(logs.some((m) => m.includes('WARN image 0 grounded 0 dishes'))).toBe(true);
  });

  it('logs no WARN when every image is grounded', () => {
    const logs: string[] = [];
    const out = logScoutImageInventory({
      perImage: [{ imageIndex: 0, itemsFound: ['Oats'] }],
      imageCount: 1,
      items: [{ sourceImageIndex: 0, keyword: 'Oats' }],
      onLog: (m) => logs.push(m),
    });
    expect(out.uncovered).toEqual([]);
    expect(out.unmatched).toEqual([]);
    expect(logs.some((m) => m.includes('WARN'))).toBe(false);
  });

  it('flags perImage names that match no emitted dish (looked-and-declined)', () => {
    const logs: string[] = [];
    const out = logScoutImageInventory({
      perImage: [
        { imageIndex: 0, itemsFound: ['Informasi Nilai Gizi'] },
        { imageIndex: 1, itemsFound: ['Beef soup'] },
      ],
      imageCount: 2,
      items: [
        { sourceImageIndex: 1, dishName: 'Sup Daging Sapi dan Sayur' },
        { sourceImageIndex: 1, dishName: 'Beef soup with vegetables' },
      ],
      onLog: (m) => logs.push(m),
    });
    expect(out.unmatched).toEqual(['Informasi Nilai Gizi']);
    expect(logs.some((m) => m.includes('looked-and-declined'))).toBe(true);
  });

  it('matches variant names to dishes without noise', () => {
    const out = summarizeScoutImageInventory({
      perImage: [{ imageIndex: 0, itemsFound: ['Beef soup'] }],
      imageCount: 1,
      items: [{ sourceImageIndex: 0, dishName: 'Beef soup with vegetables' }],
    });
    expect(out.unmatched).toEqual([]);
  });

  it('stays silent when the index anchors the row despite wobbling names', () => {
    const out = summarizeScoutImageInventory({
      perImage: [{ imageIndex: 0, itemsFound: ['Oat Cereal pack'] }],
      imageCount: 1,
      items: [{ sourceImageIndex: 0, dishName: 'Sup Oatmeal Sehat' }],
    });
    expect(out.unmatched).toEqual([]);
  });
});

describe('F-8.10 shard 16 — shortcut chain seams', () => {
  it('reuses prior scout with portion choices or refine grams', () => {
    const logs: string[] = [];
    const out = applyWeightModShortcut({
      activeScoutItems: [{ keyword: 'rice' }],
      portionChoices: [{ scoutIndex: 0, weightGrams: 150 }],
      weightRefineIntent: {},
      scoutContentType: undefined,
      refineDecision: { reason: 'test' },
      priorScoutForRefine: [],
      imagePayloads: [],
      onLog: (m) => logs.push(m),
    });
    expect(out.visionScoutContentType).toBe('visual');
    expect(out.ran).toBe(true);
    expect(logs.some((m) => m.includes('Weight modification'))).toBe(true);
  });

  it('restores turn-1 candidates into the match stores', () => {
    const logs: string[] = [];
    const arr: any[] = [];
    const map = new Map<string, any>();
    const n = restoreTurnOneCandidates({
      resolvedDbCandidates: [{ id: 'x', nutrients: { calories: 10 } }, { fdcId: 'y' }],
      databaseMatchesArray: arr, dbMatchMap: map, onLog: (m) => logs.push(m),
    });
    expect(n).toBe(2);
    expect(arr).toHaveLength(2);
    expect(map.get('x').calories).toBe(10);
    expect(map.get('y').fdcId).toBe('y');
    expect(restoreTurnOneCandidates({ resolvedDbCandidates: [], databaseMatchesArray: [], dbMatchMap: new Map(), onLog: () => {} })).toBe(0);
  });

  it('backs off longer on 503/UNAVAILABLE than other failures', () => {
    expect(computeScoutRetryDelay({ message: '503 UNAVAILABLE' })).toBe(2000);
    expect(computeScoutRetryDelay({ message: 'boom' })).toBe(1000);
    expect(computeScoutRetryDelay(null)).toBe(1000);
  });
});

describe('F-8.10 shard 17 — skipScout shortcut', () => {
  it('inherits prior scout with portion choices and dining env', () => {
    const logs: string[] = [];
    const out = applySkipScoutShortcut({
      body: { portionChoices: [{ scoutIndex: 0 }], scoutContentType: 'label', diningEnvironment: 'id' },
      history: [], activeMeal: null, onLog: (m) => logs.push(m),
    });
    expect(out.ran).toBe(false);
    expect(logs.some((m) => m.includes('priorScout is empty'))).toBe(true);
  });

  it('falls back to prior-scout dining when the body has none', () => {
    const out = applySkipScoutShortcut({
      body: { portionChoices: [{ scoutIndex: 0 }] },
      history: [{ data: { scoutItems: [{ keyword: 'rice', diningEnvironment: 'home_cooked' }] } }],
      activeMeal: null, onLog: () => {},
    });
    expect(out.ran).toBe(true);
    expect(out.visionScoutContentType).toBe('visual');
    expect(out.diningEnvironment).toBe('home_cooked');
  });
});

describe('F-8.10 shard 20 — resumed-turn predicate', () => {
  it('detects continued image turns across payload shapes', () => {
    const no = { body: {}, visionScoutItems: [], history: [] };
    expect(checkResumedFromImageTurn(no)).toBe(false);
    expect(checkResumedFromImageTurn({ body: { skipScout: true }, visionScoutItems: [], history: [] })).toBe(true);
    expect(checkResumedFromImageTurn({ body: {}, visionScoutItems: [{ keyword: 'x' }], history: [] })).toBe(true);
    expect(checkResumedFromImageTurn({ body: {}, visionScoutItems: [], history: [{ data: { photoUrl: 'u' } }] })).toBe(true);
    expect(checkResumedFromImageTurn({ body: { activeScoutItems: [{}] }, visionScoutItems: [], history: [] })).toBe(true);
  });
});

describe('F-8.10 shard 22 — text-query branch and menu-scale rule', () => {
  it('seeds scout items for food text, stays quiet in edit flows', () => {
    const logs: string[] = [];
    const out = applyTextQueryShortcut({ message: 'nasi goreng', isExplicitModify: false, isPureWeightModification: false, onLog: (m) => logs.push(m) });
    expect(out.queriesToSearch).toEqual(['nasi goreng']);
    expect(out.visionScoutItems).toHaveLength(1);
    expect(out.scoutRecommendedMode).toBe('new_log');
    const edit = applyTextQueryShortcut({ message: 'nasi goreng', isExplicitModify: true, isPureWeightModification: false, onLog: () => {} });
    expect(edit.visionScoutItems).toEqual([]);
    expect(edit.scoutRecommendedMode).toBeNull();
    const quiet = applyTextQueryShortcut({ message: 'hello there', isExplicitModify: false, isPureWeightModification: false, onLog: () => {} });
    expect(quiet.queriesToSearch).toEqual([]);
  });

  it('skips search only for true browse mode, never for new_log dishes', () => {
    expect(checkMenuScaleBypass({ visionScoutContentType: 'menu_or_poster', scoutRecommendedMode: 'evaluation' })).toBe(true);
    expect(checkMenuScaleBypass({ visionScoutContentType: 'menu_or_poster', scoutRecommendedMode: 'new_log' })).toBe(false);
    expect(checkMenuScaleBypass({ visionScoutContentType: 'visual', scoutRecommendedMode: null })).toBe(false);
  });
});

describe('F-8.10 shard 25 — scout call args', () => {
  it('pins flash-lite defaults with the scout language block and schema', () => {
    const args = buildScoutCallArgs({ engine: undefined, language: 'id', scoutPromptText: 'P', imagePayloads: [] });
    expect(args.modelId).toBe('gemini-3.5-flash-lite');
    expect(args.systemInstruction).toContain('Bahasa Indonesia');
    expect(args.responseSchema.required).toEqual(['contentType', 'diningEnvironment', 'dishes']);
    expect(args.maxOutputTokens).toBe(8192);
    expect(args.imagePayloads).toEqual([]);
  });

  it('compare uses the compare pack and schema, not the meal-log pack', () => {
    const log = buildScoutCallArgs({ engine: undefined, language: 'en', scoutPromptText: 'P', imagePayloads: [], isCompare: false });
    const compare = buildScoutCallArgs({ engine: undefined, language: 'en', scoutPromptText: 'P', imagePayloads: [], isCompare: true });
    expect(compare.systemInstruction).not.toEqual(log.systemInstruction);
    expect(compare.systemInstruction).toContain('EVALUATION ONLY');
    expect(compare.systemInstruction).not.toMatch(/hierarchical schema with weightGrams/);
    expect(compare.responseSchema.required).toContain('allExtractedDishes');
    expect(compare.responseSchema.required).not.toContain('dishes');
    expect(log.responseSchema.required).toContain('dishes');
    expect(log.responseSchema.properties.allExtractedDishes).toBeUndefined();
  });

  it('passes assembled nutrition targets into the live LLM call, not only debug', () => {
    const suffix = '=== NUTRITIONAL TARGET STATUS ===\n1 days avg: Calorie (1800kcal)';
    const args = buildScoutCallArgs({
      engine: undefined, language: 'en', scoutPromptText: 'P', imagePayloads: [], isCompare: true,
      systemInstruction: `COMPARE-PACK\n${suffix}`,
    });
    expect(args.systemInstruction).toContain('NUTRITIONAL TARGET STATUS');
    expect(args.systemInstruction).toContain('1800kcal');
    expect(args.responseSchema.required).toContain('allExtractedDishes');
  });
});

describe('F-8.10 shard 29 — scout retry loop (stubbed LLM)', () => {
  const base = {
    engine: 'test-model',
    language: 'en' as unknown,
    scoutPromptText: 'P',
    imagePayloads: [],
    isCompare: false,
    message: 'lunch',
    onLog: () => {},
  };

  it('succeeds first try without sleeping', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const out = await runScoutRetryLoop({
      ...base,
      callUnifiedLLM: async () => { calls++; return '{}'; },
      sleep: async (ms: number) => { sleeps.push(ms); },
    });
    expect(out.scoutResult).toBeTruthy();
    expect(out.attempts).toBe(1);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    expect(out.lastScoutErr).toBeNull();
  });

  it('retries once on failure, then succeeds', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const out = await runScoutRetryLoop({
      ...base,
      callUnifiedLLM: async () => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return '{}';
      },
      sleep: async (ms: number) => { sleeps.push(ms); },
    });
    expect(out.scoutResult).toBeTruthy();
    expect(out.attempts).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it('backs off longer on 503 and aborts early on quota errors', async () => {
    const sleeps503: number[] = [];
    await runScoutRetryLoop({
      ...base,
      callUnifiedLLM: async () => { throw new Error('503 UNAVAILABLE'); },
      sleep: async (ms: number) => { sleeps503.push(ms); },
    }).catch(() => {});
    // 503 is not a quota break: 3 attempts, 2 backoffs of 2000
    expect(sleeps503).toEqual([2000, 2000]);

    let quotaCalls = 0;
    const quota = await runScoutRetryLoop({
      ...base,
      callUnifiedLLM: async () => { quotaCalls++; throw new Error('429 RESOURCE_EXHAUSTED'); },
      sleep: async () => {},
    });
    expect(quota.scoutResult).toBeNull();
    expect(quotaCalls).toBe(1);
    expect(quota.lastScoutErr).toBeTruthy();
  });

  it('passes the stream hook through to the LLM call', async () => {
    let seenOnStream: any = 'missing';
    await runScoutRetryLoop({
      ...base,
      callUnifiedLLM: async (a: any) => { seenOnStream = a.onStream; return '{}'; },
      sleep: async () => {},
      onStreamChunk: () => {},
    });
    expect(typeof seenOnStream).toBe('function');
  });
});

describe('Turn 2 Portion Selection — multi-dish preservation', () => {
  it('preserves non-selected items when user chooses portion for one dish', () => {
    const turn1ScoutItems = [
      { scoutIndex: 0, originalName: 'Fried Chicken Meal', keyword: 'fried chicken', estimatedWeightGrams: 550 },
      { scoutIndex: 1, originalName: 'Instant Oatmeal', keyword: 'instant oatmeal', estimatedWeightGrams: 100 },
      { scoutIndex: 2, originalName: 'Öbalab Cake', keyword: 'cake', estimatedWeightGrams: 80 },
    ];

    const logs: string[] = [];
    const out = applySkipScoutShortcut({
      body: {
        activeScoutItems: turn1ScoutItems,
        portionChoices: { '1': 130 },
        skipScout: true,
      },
      history: [],
      activeMeal: null,
      onLog: (m) => logs.push(m),
    });

    expect(out.ran).toBe(true);
    expect(out.visionScoutItems).toHaveLength(3);
    // Fried chicken is preserved at 550g
    expect(out.visionScoutItems[0].originalName).toBe('Fried Chicken Meal');
    expect(out.visionScoutItems[0].estimatedWeightGrams).toBe(550);
    // Instant oatmeal is updated to 130g
    expect(out.visionScoutItems[1].originalName).toBe('Instant Oatmeal');
    expect(out.visionScoutItems[1].estimatedWeightGrams).toBe(130);
    expect(out.visionScoutItems[1].portionChoiceApplied).toBe(130);
    // Cake is preserved at 80g
    expect(out.visionScoutItems[2].originalName).toBe('Öbalab Cake');
    expect(out.visionScoutItems[2].estimatedWeightGrams).toBe(80);
  });

  it('restores Turn 1 candidates into databaseMatchesArray and dbMatchMap', () => {
    const turn1Candidates = [
      { id: 'usda_1', name: 'Fried Chicken', query: 'fried chicken' },
      { id: 'usda_2', name: 'Instant Oatmeal', query: 'instant oatmeal' },
      { id: 'usda_3', name: 'Cake', query: 'cake' },
    ];
    const databaseMatchesArray: any[] = [];
    const dbMatchMap = new Map<string, any>();
    const logs: string[] = [];

    restoreTurnOneCandidates({
      resolvedDbCandidates: turn1Candidates,
      databaseMatchesArray,
      dbMatchMap,
      onLog: (m) => logs.push(m),
    });

    expect(databaseMatchesArray).toHaveLength(3);
    expect(dbMatchMap.get('usda_2')?.name).toBe('Instant Oatmeal');
    expect(dbMatchMap.get('usda_1')?.name).toBe('Fried Chicken');
  });

  it('countCompareExtracted totals zero only when every compare evidence list is empty', () => {
    // Live failure shape: all four lists empty -> guard must fire.
    expect(countCompareExtracted({ items: [], groups: [], allExtractedDishes: [] }, [])).toBe(0);
    expect(countCompareExtracted(null, [])).toBe(0);
    expect(countCompareExtracted(undefined, undefined as any)).toBe(0);
    // Any single evidence form silences the guard.
    expect(countCompareExtracted({ items: [], groups: [], allExtractedDishes: ['A'] }, [])).toBe(1);
    expect(countCompareExtracted({ items: [], groups: [{ groupName: 'g' }] }, [])).toBe(1);
    expect(countCompareExtracted({ items: [{ name: 'A' }] }, [])).toBe(1);
    expect(countCompareExtracted({}, [{ keyword: 'A' }])).toBe(1);
  });

  it('applyScoutResultState promotes allExtractedDishes when compare items is empty (Mode D heal)', () => {
    // Live failure shape (debug-job_1789202906586): model transcribed the
    // shelf but left items[] empty -> shipped a zero-item "successful"
    // comparison with an ungrounded recommendation.
    const logs: string[] = [];
    const out = applyScoutResultState({
      scoutResult: {
        items: [],
        rawScoutJson: {
          comparisonTitle: 'Refrigerator Beverage Shelf Selection',
          allExtractedDishes: [
            'Larutan Cap Kaki Tiga Lemon Lime',
            { name: 'Cooltopia Melon Orange', brand: 'Cap Kaki Tiga' },
          ],
          items: [],
          groups: [],
        },
      },
      requestedMode: 'compare',
      hasActiveMealDocument: false,
      onLog: (m) => logs.push(m),
      onEvent: () => {},
      onStream: () => {},
    });
    expect(out.visionScoutItems.length).toBe(2);
    expect(out.visionScoutItems[0].keyword).toMatch(/Kaki Tiga/);
    expect(out.visionScoutItems[1].keyword).toBe('Cooltopia Melon Orange');
    expect(out.rawScoutData.items.length).toBe(2);
    expect(logs.some((m) => m.includes('Compare Heal'))).toBe(true);
  });

  it('applyScoutResultState leaves populated compare items untouched (heal is empty-only)', () => {
    const out = applyScoutResultState({
      scoutResult: {
        items: [{ name: 'A' }],
        rawScoutJson: { allExtractedDishes: ['A', 'B'], items: [{ name: 'A' }] },
      },
      requestedMode: 'compare',
      hasActiveMealDocument: false,
      onLog: () => {},
      onEvent: () => {},
      onStream: () => {},
    });
    expect(out.visionScoutItems.length).toBe(1);
  });
});
