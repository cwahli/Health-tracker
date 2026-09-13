import { describe, it, expect } from 'vitest';
import {
  computeDietitianSkipGates,
  decideScoutVerdict,
  decideScoutAdvice,
  buildPureScaleResponse,
  sumPrecalcTotals,
  applyPreDietitianDensityCheck,
  buildCreateSkipResponse,
  sumSalvagedAggregates,
  resolveCreateMealTitle,
  salvageLedgerPlausibility,
  isAcceptDefaultsWithinTolerance,
  composeAcceptDefaultsParsed,
} from './server_food_dietitian_dispatch';
import { NUTRIENT_KEYS } from '../../utils/nutrients';

describe('F-8.10 shard 4 — dietitian skip gates (pure-scale refine)', () => {
  const baseArgs = {
    isPureWeightModification: false,
    activeMeal: null,
    userSelectedMode: 'review',
    weightRefineIntent: {},
    message: 'log lunch',
  };

  it('allows pure-scale refine skip only for clean single-item absolute grams', () => {
    const ok = computeDietitianSkipGates({
      ...baseArgs,
      isPureWeightModification: true,
      activeMeal: { itemsBreakdown: [{ name: 'oats' }] },
      weightRefineIntent: { isRefine: true, weightGrams: 150, kind: 'absolute_grams' },
      message: 'make it 150g',
    });
    expect(ok.canSkipDietitianForPureScale).toBe(true);

    const withVerb = computeDietitianSkipGates({
      ...baseArgs,
      isPureWeightModification: true,
      activeMeal: { itemsBreakdown: [{ name: 'oats' }] },
      weightRefineIntent: { isRefine: true, weightGrams: 150, kind: 'absolute_grams' },
      message: 'remove the oats',
    });
    expect(withVerb.canSkipDietitianForPureScale).toBe(false);

    const multiItem = computeDietitianSkipGates({
      ...baseArgs,
      isPureWeightModification: true,
      activeMeal: { itemsBreakdown: [{ name: 'oats' }, { name: 'milk' }] },
      weightRefineIntent: { isRefine: true, weightGrams: 150, kind: 'absolute_grams' },
      message: 'make it 150g',
    });
    expect(multiItem.canSkipDietitianForPureScale).toBe(false);
  });
});

describe('F-8.10 shard 15 — scout verdict and advice ladders', () => {
  it('walks the verdict ladder and passes existing verdicts through', () => {
    const t = (totals: any, mealName = 'Bowl', scoutVerdict: any = null) =>
      decideScoutVerdict({ scoutVerdict, totals, mealName, language: 'en' });
    expect(t({ totalSugar: 40, totalSatFat: 0, totalP: 0 }).level).toBe('warning');
    expect(t({ totalSugar: 0, totalSatFat: 20, totalP: 0 }).level).toBe('warning');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 30 }).level).toBe('good');
    expect(t({ totalSugar: 5, totalSatFat: 0, totalP: 5 }, 'Yakult').level).toBe('good');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 5 }).level).toBe('neutral');
    expect(t({ totalSugar: 99, totalSatFat: 99, totalP: 99 }, 'X', { label: 'Kept', level: 'good' })).toEqual({ label: 'Kept', level: 'good' });
  });

  it('walks the advice ladder and passes existing advice through', () => {
    const t = (totals: any, mealName = 'Bowl', rawAdvice: any = '') =>
      decideScoutAdvice({ rawAdvice, totals, mealName, language: 'en' });
    expect(t({ totalSugar: 5, totalSatFat: 0, totalP: 5 }, 'Yakult')).toContain('5');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 25 })).toContain('25');
    expect(t({ totalSugar: 40, totalSatFat: 0, totalP: 0 })).toContain('40');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 0 }, 'Rice')).toContain('Rice');
    expect(t({ totalSugar: 0, totalSatFat: 0, totalP: 0 }, 'Rice', 'Custom note')).toBe('Custom note');

    // Narrative macro synchronization with authoritative ledger totals
    const draftAdvice = 'The fried snacks pack 9g of saturated fat. The beef soup gives 30g of clean protein at 500 calories.';
    const synchronized = decideScoutAdvice({
      rawAdvice: draftAdvice,
      totals: { totalSatFat: 6, totalP: 38, totalCals: 620 } as any,
      mealName: 'Lunch',
      language: 'en',
    });
    expect(synchronized).toContain('6g of saturated fat');
    expect(synchronized).toContain('38g of clean protein');
    expect(synchronized).toContain('620 kcal');
  });
});

describe('F-8.10 shard 18 — skip-path builders', () => {
  it('builds the pure-scale refine payload without an LLM call', () => {
    const { textOutput, rawParsed } = buildPureScaleResponse({ targetWeightGrams: 150, language: 'en' });
    expect(rawParsed.mode).toBe('modify');
    expect(rawParsed.modificationCommand[0].newWeightGrams).toBe(150);
    expect(JSON.parse(textOutput)).toEqual(rawParsed);
    expect(rawParsed.message).toContain('150');
  });

  it('sums precalc totals for the create path', () => {
    const totals = sumPrecalcTotals([
      { estimatedWeightGrams: 200, nutrients: { calories: 260, protein: 10, carbohydrates: 30, totalFat: 5, sugar: 2, addedSugar: 1, saturatedFat: 1 } },
      { estimatedWeightGrams: 100, nutrients: { calories: 50, protein: 2, carbohydrates: 10, totalFat: 1, sugar: 8, addedSugar: 8, saturatedFat: 0 } },
    ]);
    expect(totals).toEqual({ totalGrams: 300, totalCals: 310, totalP: 12, totalC: 40, totalF: 6, totalSugar: 10, totalAddedSugar: 9, totalSatFat: 1 });
  });
});

describe('F-8.10 shard 19 — pre-dietitian density check', () => {
  it('rescales implausible beverage calories and rolls up aggregates', () => {
    const logs: string[] = [];
    const items: any[] = [{
      name: 'Cola Drink', weightGrams: 500,
      nutrients: { calories: 2000, protein: 0, carbohydrates: 130, totalFat: 0, sodium: 10 },
    }];
    const agg = applyPreDietitianDensityCheck({
      preCalculatedItems: items, aggregatedNutrients: null,
      beveragePattern: /cola|drink/i, onLog: (m) => logs.push(m),
    });
    // 500g cap: 5 * 110 = 550 kcal
    expect(items[0].nutrients.calories).toBe(550);
    expect(agg.calories).toBe(550);
    expect(logs.some((m) => m.includes('Reality Check'))).toBe(true);
  });
});

describe('F-8.10 shard 28 — create-skip synthesis and salvaged aggregates', () => {
  it('synthesizes the single-agent response from totals', () => {
    const out = buildCreateSkipResponse({
      rawScoutData: {},
      visionScoutItems: [{ originalName: 'Rice', keyword: 'rice' }],
      preCalculatedItems: [{
        keyword: 'rice', originalName: 'Rice', estimatedWeightGrams: 200,
        dbSource: 'estimated', nutrients: { calories: 260, protein: 5, carbohydrates: 55, totalFat: 1 },
      }],
      totals: { totalGrams: 200, totalCals: 260, totalP: 5, totalC: 55, totalF: 1, totalSugar: 0, totalAddedSugar: 0, totalSatFat: 0 },
      scoutVerdict: { label: 'Good fuel', level: 'good' },
      rawAdvice: 'Eat up',
      language: 'en',
    });
    expect(out.rawParsed.mode).toBe('new_log');
    expect(out.rawParsed.foodData.itemsBreakdown).toHaveLength(1);
    expect(out.rawParsed.foodData.name).toBe('Rice');
    expect(JSON.parse(out.textOutput)).toEqual(out.rawParsed);
  });

  it('sums salvaged aggregates across items', () => {
    const agg = sumSalvagedAggregates([
      { nutrients: { calories: 100, protein: 10 } },
      { nutrients: { calories: 50, protein: 5 } },
      {},
    ]);
    expect(agg.calories).toBe(150);
    expect(agg.protein).toBe(15);
    expect(agg.sodium).toBe(0);
    const empty = sumSalvagedAggregates(null);
    expect(empty.calories).toBe(0);
    expect(Object.keys(empty)).toHaveLength(NUTRIENT_KEYS.length);
  });

  it('refuses implausible salvaged ledgers (unscaled-estimator runaway)', () => {
    // Observed live failure: 9600 kcal / 2276.7 g protein baseline runaway.
    expect(salvageLedgerPlausibility({ calories: 9600, protein: 2276.7 }, 1000).ok).toBe(false);
    expect(salvageLedgerPlausibility({ calories: 1347.7, protein: 47.9 }, 1060).ok).toBe(true);
    expect(salvageLedgerPlausibility({ calories: 960, protein: 20 }, 100).ok).toBe(false); // 9.6/g > fat ceiling
    expect(salvageLedgerPlausibility({}, 0).ok).toBe(true);
    // Pia 100 Nanas: 6300 kcal / 70g (90 kcal/g) from a 1-gram serving parse. Weight < 100g must still fail.
    expect(salvageLedgerPlausibility({ calories: 6300, protein: 2, totalFat: 1750 }, 70).ok).toBe(false);
    expect(salvageLedgerPlausibility({ calories: 90, protein: 2, totalFat: 25 }, 70).ok).toBe(true);
  });
});

describe('create meal title — full dish title, never generic (first log)', () => {
  const totals = { totalGrams: 630, totalCals: 401, totalP: 35.7, totalC: 11, totalF: 23.7, totalSugar: 0, totalAddedSugar: 0, totalSatFat: 9.9 };
  const dishes = [
    { originalName: 'Ikan Cakalang Suwir Petai', keyword: 'Ikan Cakalang Suwir Petai' },
    { originalName: 'Cah Kangkung', keyword: 'Cah Kangkung' },
    { originalName: 'Es Teh Tawar', keyword: 'Es Teh Tawar' },
  ];

  it('joins multi-dish names instead of the generic fallback', () => {
    expect(resolveCreateMealTitle({}, dishes, 'en')).toBe(
      'Ikan Cakalang Suwir Petai, Cah Kangkung, and Es Teh Tawar'
    );
  });

  it('buildCreateSkipResponse persists the full title on foodData.name', () => {
    const out = buildCreateSkipResponse({
      rawScoutData: {},
      visionScoutItems: dishes,
      preCalculatedItems: [],
      totals,
      scoutVerdict: { label: 'Good fuel', level: 'good' },
      rawAdvice: 'Eat up',
      language: 'en',
    });
    expect(out.rawParsed.foodData.name).toBe(
      'Ikan Cakalang Suwir Petai, Cah Kangkung, and Es Teh Tawar'
    );
  });

  it('prefers the scout mealName when present and falls back only when empty', () => {
    expect(resolveCreateMealTitle({ mealName: 'Nasi Campur' }, dishes, 'en')).toBe('Nasi Campur');
    expect(resolveCreateMealTitle({}, [], 'en')).toBe('Balanced Meal');
  });
});

describe('accept-defaults gate (portion choices within 30%, no agent)', () => {
  const items = [
    { scoutIndex: 0, keyword: 'Oatmeal', estimatedWeightGrams: 35, nutrients: { protein: 4, saturatedFat: 0.5, sodium: 0, carbohydrates: 23 } },
    { scoutIndex: 1, keyword: 'Brownies', estimatedWeightGrams: 15, nutrients: { protein: 1, saturatedFat: 1, sodium: 55, carbohydrates: 11 } },
  ];

  it('accepts unchanged or small tweaks, rejects big moves and unknowns', () => {
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: { 0: 35, 1: 15 }, scoutItems: items, isResume: true })).toBe(true);
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: { 0: 40, 1: 15 }, scoutItems: items, isResume: true })).toBe(true);
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: { 0: 130, 1: 30 }, scoutItems: items, isResume: true })).toBe(false);
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: { 9: 10 }, scoutItems: items, isResume: true })).toBe(false);
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: null, scoutItems: items, isResume: true })).toBe(false);
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: { 0: 35 }, scoutItems: items, isResume: false })).toBe(false);
  });

  it('defaults to pack weight when a pack exists', () => {
    const packed = [
      { scoutIndex: 0, keyword: 'Oatmeal', estimatedWeightGrams: 35, packGrams: 805, nutrients: {} },
      { scoutIndex: 1, keyword: 'Brownies', estimatedWeightGrams: 15, packGrams: 30, nutrients: {} },
    ];
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: { 0: 805, 1: 30 }, scoutItems: packed, isResume: true })).toBe(true);
    expect(isAcceptDefaultsWithinTolerance({ portionChoices: { 0: 35, 1: 15 }, scoutItems: packed, isResume: true })).toBe(false);
  });

  it('composes a ready message with explicit weights and ladder verdict/advice', () => {
    const out = composeAcceptDefaultsParsed({ items, mealName: 'Test Meal', language: 'en' });
    expect(out.message).toMatch(/Oatmeal 35g/);
    expect(out.message).toMatch(/Brownies 15g/);
    expect(out.verdict && out.verdict.label).toBeTruthy();
    expect(out.clinicalAdvice && out.clinicalAdvice.length > 0).toBe(true);
    expect(out._internalReasoning).toMatch(/no agent call/);
    expect(out.modificationCommand).toEqual([]);
  });

  it('composes a personalised 2-paragraph message when explicit targets exist', () => {
    const mealItems = [{
      keyword: 'Mixed Meal',
      estimatedWeightGrams: 1060,
      nutrients: {
        calories: 1347.74, protein: 47.86, carbohydrates: 193.83, totalFat: 38.86,
        saturatedFat: 10.56, sugar: 57.43, totalFibre: 18.14, sodium: 925, transFat: 0.1,
      },
    }];
    const targets = {
      calories: 1800, protein: 120, carbohydrates: 200, totalFat: 60,
      saturatedFat: 20, sugar: 30, totalFibre: 30, sodium: 3000,
    };
    const out = composeAcceptDefaultsParsed({
      items: mealItems, mealName: 'Mixed Meal', language: 'en',
      targets, foodLogs: [], todayStr: '2026-09-07',
    });
    const words = out.clinicalAdvice.trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(35);
    expect(words).toBeLessThanOrEqual(70);
    expect(out.clinicalAdvice).toContain('1348 kcal');
    expect(out.clinicalAdvice).toContain('75%');
    expect(out.clinicalAdvice).toContain('sugar');
    expect(out.clinicalAdvice).toContain('1.9');
    expect(out.clinicalAdvice).toContain('6g carbs');
    expect(out.clinicalAdvice).toContain('no sugar');
    expect(out.clinicalAdvice).toContain('72g protein');
    expect(out.clinicalAdvice).toContain('0.1g trans fat');
    expect(out.clinicalAdvice).toContain('\n\n');
    expect(out.verdict.label).toBe('High Glycemic Impact (Elevated Sugar)');
    expect(out.verdict.level).toBe('warning');
    expect(out.message).toBe(out.clinicalAdvice);
  });

  it('personalised accept message renders in Indonesian with the same facts', () => {    const mealItems = [{
      keyword: 'Mixed Meal',
      estimatedWeightGrams: 1060,
      nutrients: { calories: 1347.74, protein: 47.86, carbohydrates: 193.83, sugar: 57.43, saturatedFat: 10.56, transFat: 0 },
    }];
    const out = composeAcceptDefaultsParsed({
      items: mealItems, mealName: 'Mixed Meal', language: 'id',
      targets: { calories: 1800, protein: 120, carbohydrates: 200, sugar: 30, saturatedFat: 20 },
      foodLogs: [], todayStr: '2026-09-07',
    });
    expect(out.clinicalAdvice).toContain('kkal');
    expect(out.clinicalAdvice).toContain('gula');
    expect(out.verdict.label).toBeTruthy();
  });
});
