import { describe, it, expect } from 'vitest';
import {
  buildUserContext,
  buildTimeContext,
  buildImageContext,
  buildHistoryContext,
  buildVisionScoutContext,
  buildDatabaseMatchesContext,
  buildBiomarkersContext,
  stitchFoodPrompt,
  selectSystemInstruction,
  assemblePrecalcPromptBlock,
} from './server_food_prompt_context';
import { foodAnalyzeSchema } from './server_food_analyze_schema';

describe('F-8.10 shard 3 — prompt context builders', () => {
  it('buildUserContext renders demographics or empty', () => {
    const ctx = buildUserContext({ age: 30, gender: 'female', weight: 60, height: 165, ethnicity: 'sg' });
    expect(ctx).toContain('Age: 30');
    expect(ctx).toContain('Gender: female');
    expect(buildUserContext(null)).toBe('');
  });

  it('buildTimeContext pins the active-meal date unless the user names a date', () => {
    const pinned = buildTimeContext({ activeMealDate: '2026-09-01', message: 'add rice' });
    expect(pinned).toContain('2026-09-01');
    const overridden = buildTimeContext({ activeMealDate: '2026-09-01', message: 'log this for yesterday' });
    expect(overridden).not.toContain('2026-09-01');
    expect(overridden).toContain('CURRENT TIME CONTEXT');
  });

  it('buildImageContext distinguishes label close-ups and date overrides', () => {
    expect(buildImageContext([], [])).toBe('');
    expect(buildImageContext([{}, {}], [])).toContain('images are attached above');
    expect(buildImageContext([{}], ['2026-09-02'])).toContain('CRITICAL DATE OVERRIDE');
  });

  it('buildHistoryContext dedupes consecutive repeats and uppercases roles', () => {
    const ctx = buildHistoryContext([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(ctx).toContain('USER: hi');
    expect(ctx).toContain('ASSISTANT: hello');
    expect(ctx.match(/USER: hi/g)?.length).toBe(1);
    expect(buildHistoryContext([])).toBe('');
  });

  it('buildVisionScoutContext uses real scoutIndex and skips pure-text edits', () => {
    const items = [{ scoutIndex: 7, keyword: 'rice', originalName: 'Nasi', estimatedWeightGrams: 200 }];
    const ctx = buildVisionScoutContext({
      visionScoutItems: items, visionScoutContentType: 'visual',
      scoutConfidenceRating: 'High', scoutCookingMethod: 'boiled',
      userSelectedMode: 'review', diningEnvironment: 'home_cooked',
    });
    expect(ctx).toContain('Index: 7');
    expect(ctx).toContain('diningEnvironment: home_cooked');
    expect(buildVisionScoutContext({ visionScoutItems: items, hasActiveMeal: true, hasImages: false })).toBe('');
  });

  it('buildDatabaseMatchesContext concatenates precalc and verified matches', () => {
    expect(buildDatabaseMatchesContext('PRECALC', 'DB')).toContain('PRECALC');
    expect(buildDatabaseMatchesContext('PRECALC', 'DB')).toContain('VERIFIED DATABASE MATCHES');
    expect(buildDatabaseMatchesContext(null, null)).toBe('');
  });

  it('buildBiomarkersContext renders string and object warnings', () => {
    const ctx = buildBiomarkersContext([
      'high sodium',
      { name: 'LDL', status: 'high', value: 160, unit: 'mg/dL', normalRange: '<100' },
    ]);
    expect(ctx).toContain('CRITICAL PATIENT BIOMARKER WARNINGS');
    expect(ctx).toContain('LDL is HIGH (160 mg/dL, normal range: <100)');
    expect(buildBiomarkersContext([])).toBe('');
  });

  it('stitchFoodPrompt assembles default, custom, and compare paths', () => {
    const base = {
      systemInstruction: 'SYS', userSelectedMode: 'review' as string,
      biomarkersCtx: 'BIO', visionScoutCtx: 'SCOUT', databaseMatchesCtx: 'DB',
      historyContext: 'HIST', pastMealsCtx: 'PAST', userCtx: 'USER',
      timeCtx: 'TIME', imageCtx: 'IMG', message: 'log lunch',
    };
    const def = stitchFoodPrompt(base);
    expect(def.promptText).toContain('Analyze this current food request');
    expect(def.promptText).toContain('Current User Input: "log lunch"');
    expect(def.fullPromptSent).toContain('System Instruction:\nSYS');
    expect(def.finalSystemInstruction).toBe('SYS');

    const custom = stitchFoodPrompt({ ...base, customSystemInstruction: 'C-SYS', customVariableData: 'C-VAR' });
    expect(custom.promptText).toContain('C-VAR');
    expect(custom.finalSystemInstruction).toBe('C-SYS');

    const modeD = stitchFoodPrompt({ ...base, userSelectedMode: 'compare' });
    expect(modeD.promptText).toContain('scoutItemIndices');
  });
});

describe('F-8.10 shard 3 — diet schema grammar invariants (food-calc §1b)', () => {
  it('top level requires reasoning, verdict, and message', () => {
    const schema: any = foodAnalyzeSchema;
    expect(schema.required).toEqual(['_internalReasoning', 'verdict', 'message']);
    expect(schema.propertyOrdering).toContain('foodData');
  });

  it('estimate required lists P/C/F macros + sodium, never calories', () => {
    const schema: any = foodAnalyzeSchema;
    const modEstimate = schema.properties.modificationCommand.items.properties.estimate;
    expect(modEstimate.required).toEqual(['protein', 'carbohydrates', 'totalFat', 'saturatedFat', 'sodium']);
    expect(modEstimate.required).not.toContain('calories');
    const splitEstimate =
      schema.properties.modificationCommand.items.properties.into.items.properties.estimate;
    expect(splitEstimate.required).toEqual(['protein', 'carbohydrates', 'totalFat', 'saturatedFat', 'sodium']);
    expect(splitEstimate.required).not.toContain('calories');
  });
});

describe('F-8.10 shard 15 — system instruction router', () => {
  const base = {
    isExplicitModify: false,
    effectiveActiveMeal: null,
    activeComparisonState: null,
    biomarkersNeedingImprovement: [],
    remainingAllowance: null,
    foodLogs: [],
    userProfile: { language: 'en' },
    visionScoutItems: [],
  };

  it('routes review/edit/compare to their instruction packs', () => {
    expect(selectSystemInstruction({ ...base, userSelectedMode: 'review' })).toContain('NARRATE');
    expect(selectSystemInstruction({ ...base, userSelectedMode: 'edit', isExplicitModify: true })).toContain('EDIT OR Q&A');
    expect(selectSystemInstruction({ ...base, userSelectedMode: 'compare' })).toContain('PRODUCT EVALUATION');
    expect(selectSystemInstruction({ ...base, userSelectedMode: 'compare', activeComparisonState: { id: 'c' } })).toContain('REFINEMENT');
  });
});

describe('F-8.10 shard 23 — precalc prompt block', () => {
  it('appends the projection block to prompt and full text', () => {
    const logs: string[] = [];
    const out = assemblePrecalcPromptBlock({
      preCalculatedItems: [],
      activeMeal: null,
      aggregatedNutrients: {},
      userProfile: { language: 'en' },
      promptText: 'PROMPT',
      fullPromptSent: 'FULL',
      onLog: (m: string) => logs.push(m),
    });
    expect(out.promptText.startsWith('PROMPT')).toBe(true);
    expect(out.promptText.length).toBeGreaterThan('PROMPT'.length);
    expect(out.fullPromptSent.startsWith('FULL')).toBe(true);
    expect(logs.some((m) => m.includes('projector diet applied'))).toBe(true);
  });
});
