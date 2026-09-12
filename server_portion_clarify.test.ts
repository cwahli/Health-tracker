import { describe, it, expect } from 'vitest';
import { applyPortionChoices, detectPortionAmbiguity, buildPortionClarifyPayload, parseServingGramsFromLabel, resolveItemQuantities, statedMatchesEstimate } from './server_portion_clarify';

describe('detectPortionAmbiguity & buildPortionClarifyPayload', () => {
  it('parses Indonesian serving counts ("23 sajian per Kemasan") as servings, not countable units', () => {
    const item = {
      scoutIndex: 4,
      originalName: 'Oatmeal',
      keyword: 'instant oatmeal',
      estimatedWeightGrams: 35,
      packGrams: 805,
      packageLabelText: 'Takaran Saji 35 g, 23 sajian per Kemasan',
      rawNutritionLabel: { servingSize: '35 g', calories: '150 kkal' },
    };
    const res = detectPortionAmbiguity(item, 4);
    expect(res).not.toBeNull();
    // Servings language must not leak unit framing into the question.
    expect(res?.reason).toMatch(/23 servings/);
    expect(res?.reason).not.toMatch(/23 units/);
    expect(res?.options.some((o) => o.weightGrams === 35)).toBe(true);
    expect(res?.options.some((o) => o.weightGrams === 70)).toBe(true);
    // "Whole pack of 23 (805g)" is not something anyone eats — dropped,
    // while the question itself (35 vs 130 matters hugely) survives.
    expect(res?.options.some((o) => o.weightGrams === 805)).toBe(false);
    expect(res?.options.some((o) => /[Ww]hole pack/.test(o.label))).toBe(false);
  });

  it('keeps whole-pack choice for small packs (brownies 2 servings of 15g)', () => {
    const item = {
      scoutIndex: 3,
      originalName: 'Lemonilo Brownies Crispy',
      keyword: 'brownies crispy',
      estimatedWeightGrams: 15,
      packGrams: 30,
      packageLabelText: 'Takaran Saji: 15 g, 2 Sajian per Kemasan',
      rawNutritionLabel: { servingSize: '15 g', calories: '70 kkal' },
    };
    const res = detectPortionAmbiguity(item, 3);
    expect(res).not.toBeNull();
    expect(res?.reason).toMatch(/2 servings/);
    expect(res?.options.some((o) => o.weightGrams === 15)).toBe(true);
    expect(res?.options.some((o) => o.weightGrams === 30)).toBe(true);
  });

  it('drops absurd whole/half/quarter pack options for bulk packs on the general path', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Bulk Oats Bag',
      keyword: 'oats',
      estimatedWeightGrams: 35,
      packGrams: 805,
      // No servings/unit/count words anywhere: skips the unit branch,
      // derives pack from servings count on the general branch.
      rawNutritionLabel: { servingsPerContainer: '23', servingSize: '35 g', calories: '150 kkal' },
    };
    const res = detectPortionAmbiguity(item, 0);
    expect(res).not.toBeNull();
    const grams = (res?.options || []).map((o) => o.weightGrams);
    expect(grams).toContain(35);
    expect(grams).toContain(70);
    expect(grams).not.toContain(805);
    expect(grams).not.toContain(402);
    expect(grams).not.toContain(201);
  });

  it('triggers portion clarify for bulk 800g oats bag when servingsPerContainer is missing', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Quaker Whole Rolled Oats Package',
      keyword: 'rolled oats package',
      estimatedWeightGrams: 40,
      packGrams: 800,
      packageLabelText: 'QUAKER WHOLE ROLLED OATS EMPING OAT UTUH BERAT BERSIH 800g',
      rawNutritionLabel: {
        servingSize: '40g',
        calories: '160',
        totalFat: '4g',
      },
    };
    const res = detectPortionAmbiguity(item, 0);
    expect(res).not.toBeNull();
    const grams = (res?.options || []).map((o) => o.weightGrams);
    expect(grams).toContain(40);
    expect(grams).toContain(80);
    expect(grams).toContain(200);
    expect(grams).not.toContain(800);
    expect(grams).not.toContain(400);
  });

  it('detects multipack cereal bar box as portion ambiguous', () => {
    const item = {
      scoutIndex: 2,
      originalName: 'Skinny Crunch Light Raspberry & White Choc',
      keyword: 'raspberry white chocolate cereal bar',
      estimatedWeightGrams: 19,
      rawNutritionLabel: {
        servingSize: '100g',
        calories: '329 kcal',
        protein: '4.8g',
        totalFat: '4.8g',
        totalCarbohydrate: '54g',
      },
    };
    const res = detectPortionAmbiguity(item, 2);
    expect(res).not.toBeNull();
    expect(res?.name).toBe('Skinny Crunch Light Raspberry & White Choc');
    expect(res?.options.length).toBeGreaterThanOrEqual(3);
    expect(res?.options.some((o) => o.weightGrams === 19)).toBe(true);
    expect(res?.options.some((o) => o.weightGrams === 38)).toBe(true);
  });

  it('correctly labels Whole pack as actual pack weight (85g) when label is per 100g and portion is 50g', () => {
    const item = {
      scoutIndex: 1,
      originalName: 'Southern Style Chicken Bites 85g',
      keyword: 'southern fried chicken bites',
      estimatedWeightGrams: 50,
      rawNutritionLabel: {
        servingSize: '100g',
        calories: '210 kcal',
        protein: '19.0g',
        totalFat: '9.5g',
        totalCarbohydrate: '12g',
      },
    };
    const res = detectPortionAmbiguity(item, 1);
    expect(res).not.toBeNull();
    expect(res?.name).toBe('Southern Style Chicken Bites 85g');
    // Whole pack option should be 85g, NOT 100g
    const wholePackOpt = res?.options.find((o) => o.label.startsWith('Whole pack'));
    expect(wholePackOpt).toBeDefined();
    expect(wholePackOpt?.weightGrams).toBe(85);
    expect(wholePackOpt?.label).toBe('Whole pack (85g)');

    // 100g option should be labeled as nutrition panel basis
    const panelOpt = res?.options.find((o) => o.weightGrams === 100);
    expect(panelOpt).toBeDefined();
    expect(panelOpt?.label).toContain('100g');
    expect(panelOpt?.label).not.toContain('Whole pack');
  });

  it('does NOT trigger portionClarify when packGrams equals estimatedWeightGrams', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Beef Blade Tray',
      keyword: 'beef blade',
      estimatedWeightGrams: 110,
      packGrams: 110,
      rawNutritionLabel: {
        servingSize: '100g',
        calories: '150 kcal',
        protein: '22g',
        totalFat: '6g',
      },
    };
    expect(detectPortionAmbiguity(item, 0)).toBeNull();
  });

  it('triggers portionClarify when packGrams (440g) differs from estimated portion (150g)', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Tenderstem Broccoli Pack',
      keyword: 'broccoli',
      estimatedWeightGrams: 150,
      packGrams: 440,
    };
    const res = detectPortionAmbiguity(item, 0);
    expect(res).not.toBeNull();
    expect(res?.options.some((o) => o.weightGrams === 150)).toBe(true);
    expect(res?.options.some((o) => o.weightGrams === 440)).toBe(true);
  });

  it('builds generic multi-item clarification payload when multiple foods have ambiguous portions', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Turkey Cold Cuts Deli Tub',
        keyword: 'turkey slices',
        estimatedWeightGrams: 50,
        rawNutritionLabel: {
          servingSize: '100g',
          calories: '120 kcal',
          protein: '22g',
          totalFat: '2g',
          totalCarbohydrate: '1g',
        },
      },
      {
        scoutIndex: 1,
        originalName: 'Skinny Crunch Light Raspberry & White Choc',
        keyword: 'raspberry white chocolate cereal bar',
        estimatedWeightGrams: 19,
        rawNutritionLabel: {
          servingSize: '100g',
          calories: '329 kcal',
          protein: '4.8g',
          totalFat: '4.8g',
          totalCarbohydrate: '54g',
        },
      },
    ];
    const payload = buildPortionClarifyPayload(items);
    expect(payload).not.toBeNull();
    expect(payload?.items).toHaveLength(2);
    expect(payload?.promptMessage).toContain('Confirm portions for:');
  });

  it('triggers portion clarify for composite subcomponents with packGrams discrepancy', () => {
    const compositeMeal = [
      {
        scoutIndex: 0,
        originalName: 'Stir-fry Dish',
        keyword: 'stir-fry dish',
        estimatedWeightGrams: 300,
        components: [
          {
            name: 'Broccoli',
            keyword: 'broccoli',
            estimatedWeightGrams: 100,
            packGrams: 100, // no discrepancy
          },
          {
            name: 'Baby Corn Pack',
            keyword: 'baby corn',
            estimatedWeightGrams: 50,
            packGrams: 200, // 200g pack vs 50g portion
            rawNutritionLabel: {
              servingSize: '100g',
              calories: '30 kcal',
            },
          },
        ],
      },
    ];
    const payload = buildPortionClarifyPayload(compositeMeal);
    expect(payload).not.toBeNull();
    expect(payload?.items.some((it) => it.name.toLowerCase().includes('baby corn'))).toBe(true);
  });
});

// Bug #9 regressions — visual-source single-serve items
describe('Bug #9 — visual-source portion-clarify guard', () => {
  it('does NOT trigger portionClarify for a visual-source single wrap (no explicit unit count)', () => {
    // "Crispy chicken wrap" — user sees 1 wrap; source=visual; no leading number in name.
    // Expect: return null so scout's 200g estimate is used directly.
    const item = {
      scoutIndex: 2,
      originalName: 'Crispy chicken wrap',
      keyword: 'crispy chicken wrap',
      estimatedWeightGrams: 200,
      estimatedCalories: 450,
      source: 'visual',
      ingredientsList: 'chicken, lettuce, crispy onion, gherkins, spicy mayonnaise',
    };
    expect(detectPortionAmbiguity(item, 2)).toBeNull();
  });

  it('does NOT trigger portionClarify for visual single-serve ice cream cone', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Yogurt Ice Cream Cone with Yogurt Soft Serve, Waffle Cone',
      keyword: 'Yogurt Ice Cream Cone with Yogurt Soft Serve, Waffle Cone',
      estimatedWeightGrams: 120,
      contentType: 'visual',
      rawNutritionLabel: null,
    };
    expect(detectPortionAmbiguity(item, 0)).toBeNull();
  });

  it('uses leading digit from name for "2 butter croissants" (never the biscuit-default of 6)', () => {
    // Before fix: unitNoun='piece' → default 6 units. After fix: detectedUnits=2 from name.
    const item = {
      scoutIndex: 1,
      originalName: '2 butter croissants',
      keyword: 'croissants',
      estimatedWeightGrams: 130,
      estimatedCalories: 500,
      source: 'visual',
    };
    const res = detectPortionAmbiguity(item, 1);
    expect(res).not.toBeNull();
    // reason must mention 2 units, never 6
    expect(res?.reason).toContain('2');
    expect(res?.reason).not.toContain('6');
    // Must offer a 1-unit option
    expect(res?.options.some((o) => o.label.startsWith('1 '))).toBe(true);
    // Must offer a 2-unit option
    expect(res?.options.some((o) => o.label.startsWith('2 '))).toBe(true);
  });
});


describe('applyPortionChoices', () => {
  it('updates estimatedWeightGrams and sets nutrientBasisWeight while preserving rawNutritionLabel', () => {
    const items = [
      {
        scoutIndex: 0,
        estimatedWeightGrams: 200,
        estimatedCalories: 400,
        rawNutritionLabel: { calories: '200 kcal / 100g' },
        keyword: 'granola',
      },
    ];
    const out = applyPortionChoices(items, { '0': 100 });
    expect(out[0].estimatedWeightGrams).toBe(100);
    expect(out[0].nutrientBasisWeight).toBe(200);
    expect(out[0].rawNutritionLabel).toEqual({ calories: '200 kcal / 100g' });
    expect(out[0].portionChoiceApplied).toBe(100);
  });

  it('scales legacy estimatedCalories when FOOD_DISH_ESTIMATE is 0', () => {
    const prevEnv = process.env.FOOD_DISH_ESTIMATE;
    try {
      process.env.FOOD_DISH_ESTIMATE = '0';
      const items = [
        {
          scoutIndex: 0,
          estimatedWeightGrams: 200,
          estimatedCalories: 400,
          rawNutritionLabel: { calories: '200 kcal / 100g' },
          keyword: 'granola',
        },
      ];
      const out = applyPortionChoices(items, { '0': 100 });
      expect(out[0].estimatedWeightGrams).toBe(100);
      expect(out[0].estimatedCalories).toBe(200);
    } finally {
      process.env.FOOD_DISH_ESTIMATE = prevEnv;
    }
  });

  it('no-ops when choices empty', () => {
    const items = [{ scoutIndex: 0, estimatedWeightGrams: 150, estimatedCalories: 300 }];
    expect(applyPortionChoices(items, null)).toEqual(items);
    expect(applyPortionChoices(items, {})).toEqual(items);
  });

  it('does not keep a 1g WRONG_BASIS when the user picks a real serving', () => {
    const items = [
      {
        scoutIndex: 0,
        estimatedWeightGrams: 70,
        nutrientBasisWeight: 1,
        estimatedCalories: 90,
        rawNutritionLabel: { servingSize: '1 serving (70g)', calories: '90' },
        keyword: 'pia',
      },
    ];
    const out = applyPortionChoices(items, { '0': 70 });
    expect(out[0].estimatedWeightGrams).toBe(70);
    expect(out[0].nutrientBasisWeight).toBe(70);
  });
});

describe('parseServingGramsFromLabel', () => {
  it('requires a g/ml unit so "1 serving (70g)" is 70, not 1', () => {
    expect(parseServingGramsFromLabel('1 serving (70g)')).toBe(70);
    expect(parseServingGramsFromLabel('1 pcs')).toBeNull();
    expect(parseServingGramsFromLabel('1 porsi')).toBeNull();
    expect(parseServingGramsFromLabel('1 serving')).toBeNull();
    expect(parseServingGramsFromLabel('100g')).toBe(100);
  });
});

describe('detectPortionAmbiguity brand names', () => {
  it('does not treat a brand name number as pack unit count (Pia 100 Nanas)', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Pia 100 Nanas',
      keyword: 'pineapple pie',
      estimatedWeightGrams: 70,
      packGrams: 70,
      rawNutritionLabel: {
        servingSize: '1 serving (70g)',
        calories: '90 kkal',
        protein: '2g',
        totalFat: '25g',
        carbohydrates: '8g',
      },
    };
    const res = detectPortionAmbiguity(item, 0);
    expect(res).toBeNull();
  });
});

describe('S-10 PORTION_FUNNEL quantity resolution', () => {
  const kacang = (est: number, extra: any = {}) => ({
    scoutIndex: 2,
    originalName: 'Indomaret Kacang Kulit',
    keyword: 'kacang kulit',
    estimatedWeightGrams: est,
    packGrams: 180,
    packageLabelText: 'Indomaret Kacang Kulit Berat Bersih 180 g',
    rawNutritionLabel: { servingSize: 'per 100g', calories: '607' },
    ...extra,
  });
  const drumstick = (est: number) => ({
    scoutIndex: 0,
    originalName: 'Fried Chicken Drumstick',
    keyword: 'fried chicken',
    estimatedWeightGrams: est,
  });
  const cooltopia = (est: number) => ({
    scoutIndex: 1,
    originalName: 'Cooltopia Melon Orange Drink',
    keyword: 'cooltopia',
    estimatedWeightGrams: est,
    packGrams: 320,
  });

  it('statedMatchesEstimate uses one named kitchen-rounding tolerance', () => {
    expect(statedMatchesEstimate(100, 100)).toBe(true);
    expect(statedMatchesEstimate(95, 100)).toBe(true);
    expect(statedMatchesEstimate(90, 100)).toBe(false);
    expect(statedMatchesEstimate(0, 100)).toBe(false);
    expect(statedMatchesEstimate(100, 0)).toBe(false);
  });

  it('case-2 shape: stated 100g matching est suppresses the picker', () => {
    const items = [drumstick(100), cooltopia(320), kacang(100)];
    const funnel = resolveItemQuantities(items, { userText: 'I had 100g of kacang', locale: 'en' });
    expect(funnel.clarifyItems).toHaveLength(0);
    expect(buildPortionClarifyPayload(items, { userText: 'I had 100g of kacang', locale: 'en' })).toBeNull();
    const kacangRes = funnel.resolutions.find((r) => r.scoutIndex === 2)!;
    expect(kacangRes.decision).toBe('accept-stated');
    expect(funnel.items[2].estimatedWeightGrams).toBe(100);
    expect(funnel.items[2].statedGramsAdopted).toBe(true);
  });

  it('case-1 shape: 28g est on 180g pack with no statement still asks (half/quarter are real options)', () => {
    const items = [kacang(28, { packGrams: 180 })];
    const payload = buildPortionClarifyPayload(items);
    expect(payload).not.toBeNull();
    const weights = payload!.items[0].options.map((o) => o.weightGrams);
    expect(weights).toContain(28);
    expect(weights).toContain(90);
    expect(weights).toContain(45);
  });

  it('parses Indonesian pack prints into packGrams (boundary data, not logic)', () => {
    const item = kacang(28, { packGrams: undefined });
    delete (item as any).packGrams;
    const res = detectPortionAmbiguity(item, 2);
    expect(res).not.toBeNull();
    expect(res?.packGrams).toBe(180);
  });

  it('bare grams across dishes injects "You said" options instead of dying silently', () => {
    const items = [drumstick(100), kacang(80)];
    // Bare unitless "90" is not a quantity (could be anything) — ignored.
    expect(buildPortionClarifyPayload(items, { userText: '90', locale: 'en' })!.items.some((i) => i.options.some((o) => o.id.startsWith('stated_')))).toBe(false);
    const payload = buildPortionClarifyPayload(items, { userText: '90g', locale: 'en' });
    expect(payload).not.toBeNull();
    expect(payload!.items.some((i) => i.options.some((o) => o.id === 'stated_90'))).toBe(true);
  });

  it('fraction without pack basis forces the question when options exist', () => {
    const item = {
      scoutIndex: 0,
      originalName: 'Rolled Oats',
      keyword: 'oats',
      estimatedWeightGrams: 60,
      rawNutritionLabel: { servingSize: 'per 100g', calories: '150' },
    };
    const funnel = resolveItemQuantities([item], { userText: 'half the oats', locale: 'en' });
    expect(funnel.clarifyItems).toHaveLength(1);
    expect(funnel.resolutions[0].decision).toBe('ask');
  });

  it('fraction with known pack adopts without asking', () => {
    const funnel = resolveItemQuantities([kacang(100)], { userText: 'half the kacang', locale: 'en' });
    expect(funnel.clarifyItems).toHaveLength(0);
    expect(funnel.items[0].estimatedWeightGrams).toBe(90);
    expect(funnel.resolutions[0].decision).toBe('adopt-stated');
  });

  it('diverged statement is adopted with overflow noted, never silently clamped', () => {
    const funnel = resolveItemQuantities([kacang(100)], { userText: 'I ate 500g of kacang', locale: 'en' });
    expect(funnel.clarifyItems).toHaveLength(0);
    expect(funnel.items[0].estimatedWeightGrams).toBe(500);
    expect(funnel.resolutions[0].why).toMatch(/exceeds 180g pack/);
  });

  it('questions and past references yield zero candidates (behavior unchanged)', () => {
    const items = [drumstick(100)];
    // No pack divergence on a single unpackaged item: nothing to ask, with or without text.
    expect(buildPortionClarifyPayload(items, { userText: 'is 100g a lot?', locale: 'en' })).toBeNull();
    expect(buildPortionClarifyPayload(items, { userText: 'kacang yesterday 100g', locale: 'en' })).toBeNull();
    expect(buildPortionClarifyPayload(items, { userText: 'This is delicious', locale: 'en' })).toBeNull();
    expect(buildPortionClarifyPayload(items)).toBeNull();
  });

  it('ambiguous match across two items synthesizes disambiguation (no silent adopt)', () => {
    const items = [
      { scoutIndex: 0, originalName: 'Chicken Rice', keyword: 'chicken rice', estimatedWeightGrams: 200 },
      { scoutIndex: 1, originalName: 'Chicken Soup', keyword: 'chicken soup', estimatedWeightGrams: 300 },
    ];
    const funnel = resolveItemQuantities(items, { userText: '100g chicken', locale: 'en' });
    expect(funnel.clarifyItems.length).toBeGreaterThan(0);
    expect(funnel.items[0].statedGramsAdopted).toBeUndefined();
    expect(funnel.items[1].statedGramsAdopted).toBeUndefined();
  });
});
