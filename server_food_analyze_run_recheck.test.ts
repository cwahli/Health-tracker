/**
 * Integration sensor for the RECHECK class — live failure job_1791044439374_4x4srekyi.
 *
 * The unit sensors cover classifyEditIntent and the applyMealEdits guards in
 * isolation. This drives the two real seams between them:
 *   1. createAnalyzeRunContext must flag the live wording as a re-analysis request.
 *   2. executeScoutPhase must then withhold the replace|add|delete edit
 *      instruction and rebuild the dish list instead of merging into it.
 *
 * The model is stubbed with the scout emission the live run actually produced —
 * the one that answered "This is incorrect check again" with action: "delete".
 * No network, no Gemini.
 */
import { describe, it, expect } from 'vitest';
import { createAnalyzeRunContext } from './server_food_analyze_run';
import { executeScoutPhase } from './server_food_analyze_run_scout';

const BEER_LABEL = {
  servingSize: '100ml',
  calories: '54 kcal',
  addedSugar: '0g',
  potassium: '0',
  protein: '0.0g',
  salt: '<0.01g',
  saturatedFat: '0.0g',
  sodium: '0g',
  sugar: '1.7g',
  totalCarbohydrate: '5.0g',
  totalFat: '0.0g',
  totalFibre: '0g',
  transFat: '0g',
};

/** The live job's saved meal: one dish, one photo, label OCR intact. */
function liveActiveMeal() {
  return {
    id: 'meal_1791044454688',
    name: 'Desperados Beer',
    date: '2026-10-03',
    quantity: '1 serving',
    weightGrams: 440,
    itemsBreakdown: [
      {
        scoutIndex: 0,
        name: 'Desperados Original Beer',
        canonicalDbName: 'Desperados Original Beer',
        originalName: 'Desperados Original Beer',
        keyword: 'desperados original beer',
        weightGrams: 440,
        estimatedWeightGrams: 440,
        calories: 88,
        nutrients: { calories: 88, protein: 0, carbohydrates: 22, totalFat: 0, saturatedFat: 0, sodium: 0 },
        rawNutritionLabel: BEER_LABEL,
        packageLabelText: 'Cont. 440 ml, 5.9% vol., Energy: 54 kcal per 100ml',
        packGrams: 440,
        sourceImageIndex: 0,
        boundingBox2D: [50, 150, 950, 850],
      },
    ],
    userLockedSlots: [],
    verdict: { label: 'High Alcohol and Sugar Load', level: 'alert' },
  };
}

/** The scout emission the live run produced for turn 2: a delete of the only dish. */
function liveTurn2ScoutEmission() {
  return JSON.stringify({
    dishes: [
      {
        dishName: 'Desperados Original Beer',
        genericEnglishName: 'flavoured beer',
        estimatedWeightGrams: 440,
        packGrams: 440,
        cookingMethod: 'raw',
        sourceImageIndex: 0,
        boundingBox2D: [0, 0, 1000, 1000],
        foods: [
          {
            foodName: 'Desperados Original Beer',
            genericEnglishName: 'flavoured beer',
            weightGrams: 440,
            nutrients: { protein: 0, saturatedFat: 0, addedSugar: 0, totalFibre: 0, sodium: 0, carbohydrates: 15 },
            boundingBox2D: [0, 0, 1000, 1000],
          },
        ],
        dishNutrients: { saturatedFat: 0, totalFat: 0, totalSugar: 15, carbohydrates: 15, protein: 0, sodium: 0, totalFibre: 0 },
        action: 'delete',
        replacesDish: 'Desperados Original Beer',
      },
    ],
    contentType: 'visual',
    diningEnvironment: 'unknown',
    verdict: { label: 'Supports sustained metabolic energy', level: 'good' },
    clinicalAdvice: 'Removing the alcohol is a positive step for your cardiovascular and liver health.',
    perImage: [{ imageIndex: 0, itemsFound: [] }],
    _internalReasoning: 'Deleting incorrectly logged beer per user correction instruction.',
  });
}

const EDIT_INSTRUCTION_MARKER = 'The user is modifying/refining an existing logged meal.';

async function runScout(message: string, scoutEmission: string) {
  const req: any = {
    body: {
      message,
      userSelectedMode: 'edit',
      activeMeal: liveActiveMeal(),
      images: ['data:image/jpeg;base64,PHOTO_A', 'data:image/jpeg;base64,PHOTO_B'],
      imageUrls: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
      userProfile: { language: 'en' },
    },
  };
  const res: any = { json: () => {}, write: () => {}, status: () => ({ json: () => {} }) };
  const setup: any = {
    isStream: false,
    hasSentHeaders: false,
    sessionId: 'test-session',
    initialLogCount: 0,
    sendStreamEvent: () => {},
  };
  const ctx = createAnalyzeRunContext(req, res, setup as any);
  const prompts: string[] = [];
  // Stub the model at the only seam executeScoutPhase reads it from. The scout
  // call carries its instruction on `promptText` (buildScoutCallArgs) — capture
  // that field, or the "withheld" assertions pass vacuously on an empty string.
  (ctx as any).callUnifiedLLM = async (args: any) => {
    prompts.push(String(args?.promptText || ''));
    return scoutEmission;
  };
  await executeScoutPhase(ctx);
  return { ctx, prompts };
}

describe('recheck routing — createAnalyzeRunContext', () => {
  const ctxFor = (message: string) =>
    createAnalyzeRunContext(
      { body: { message, userSelectedMode: 'edit', activeMeal: liveActiveMeal(), images: ['data:image/jpeg;base64,A'] } } as any,
      { json: () => {} } as any,
      { isStream: false, hasSentHeaders: false, sessionId: 's', initialLogCount: 0, sendStreamEvent: () => {} } as any
    );

  it('live wording is flagged as a re-analysis request', () => {
    const ctx = ctxFor('This is incorrect check again');
    expect(ctx.editIntent.kind).toBe('recheck');
    expect(ctx.isRecheckRequest).toBe(true);
  });

  it('an explicit removal is not a recheck', () => {
    const ctx = ctxFor('this is incorrect, remove the beer');
    expect(ctx.editIntent.kind).toBe('targeted');
    expect(ctx.isRecheckRequest).toBe(false);
  });

  it('a portion correction is not a recheck', () => {
    expect(ctxFor('that was 330ml not 440').isRecheckRequest).toBe(false);
  });

  it('a message on a meal-less session is never a recheck', () => {
    const ctx = createAnalyzeRunContext(
      { body: { message: 'This is incorrect check again', userSelectedMode: 'new_log', images: ['data:image/jpeg;base64,A'] } } as any,
      { json: () => {} } as any,
      { isStream: false, hasSentHeaders: false, sessionId: 's', initialLogCount: 0, sendStreamEvent: () => {} } as any
    );
    expect(ctx.isRecheckRequest).toBe(false);
  });
});

describe('recheck routing — executeScoutPhase', () => {
  it('live failure: the edit instruction is withheld on a recheck turn', async () => {
    const { ctx, prompts } = await runScout('This is incorrect check again', liveTurn2ScoutEmission());
    expect(ctx.isRecheckRequest).toBe(true);
    expect(prompts.length).toBeGreaterThan(0);
    // Guard against a vacuous pass: the model really was called, with a prompt.
    expect(prompts.join('\n').length).toBeGreaterThan(100);
    expect(prompts.join('\n')).not.toContain(EDIT_INSTRUCTION_MARKER);
  });

  it('live failure: a targeted edit still gets the edit instruction', async () => {
    const { ctx, prompts } = await runScout('remove the beer', liveTurn2ScoutEmission());
    expect(ctx.isRecheckRequest).toBe(false);
    expect(prompts.join('\n')).toContain(EDIT_INSTRUCTION_MARKER);
  });

  it('the recheck re-reads the photo instead of merging into the prior meal', async () => {
    const { ctx } = await runScout('This is incorrect check again', liveTurn2ScoutEmission());
    // The model emitted the beer with action "delete". A recheck must not let a
    // delete take the dish out of the rebuilt list.
    expect(ctx.visionScoutItems.length).toBe(1);
    expect(ctx.visionScoutItems[0].originalName || ctx.visionScoutItems[0].dishName).toMatch(/Desperados/i);
  });

  it('printed label truth survives the re-read even though the model dropped it', async () => {
    const { ctx } = await runScout('This is incorrect check again', liveTurn2ScoutEmission());
    const dish = ctx.visionScoutItems[0];
    expect(dish.rawNutritionLabel).toBeDefined();
    expect(dish.rawNutritionLabel.calories).toBe('54 kcal');
    expect(dish.packGrams).toBe(440);
  });

  it('a re-read that grounds nothing on an attached photo marks the run degraded', async () => {
    const { ctx } = await runScout('This is incorrect check again', liveTurn2ScoutEmission());
    // The live turn-2 emission covered image 0 only, with zero items, while two
    // photos were attached. That is a partial read, not a clean one.
    expect(ctx.scoutDegradedReasons).toContain('scout_partial_read');
  });
});
