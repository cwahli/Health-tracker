import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pipeline = ["server_food_analyze_run.ts", "server_food_analyze_run_scout.ts", "server_food_analyze_run_precalc.ts", "server_food_analyze_run_scout_compose.ts", "server_food_analyze_run_finalize.ts"].map(f => readFileSync(resolve(__dirname, "./" + f), "utf8")).join("\n");
const route = readFileSync(resolve(__dirname, './server_routes_food_analyze.ts'), 'utf8');

describe('F-8.9 calorie host deleted from analyze pipeline', () => {
  it('does not contain First-Principles Injection or post-finalize aggregate', () => {
    expect(pipeline).not.toMatch(/First-Principles Injection/);
    expect(pipeline).not.toMatch(/aggregateItemsNutrients\s*\(/);
    expect(pipeline).not.toMatch(/Construct 5-Column Clean First-Principles/);
    expect(pipeline).not.toMatch(/Backend-Side Mathematical Macro Aggregation/);
    expect(route).not.toMatch(/First-Principles Injection/);
    expect(route).not.toMatch(/aggregateItemsNutrients\s*\(/);
  });

  it('create maps from finalize; edit uses applyMealEdits', () => {
    expect(pipeline).toMatch(/attachHappyPathMealBuild/);
    expect(pipeline).toMatch(/applyMealEdits/);
    expect(pipeline).toMatch(/evaluateMealGate/);
  });

  it('packaged items bind via PackagedBind rather than silent CuratorSkipped-only', () => {
    expect(pipeline).toMatch(/PackagedBind/);
    expect(pipeline).toMatch(/isPackagedBindItem/);
  });

  it('does not copy scout estimatedCalories onto compare seed rows', () => {
    expect(pipeline).not.toMatch(/calories:\s*s\.estimatedCalories/);
  });

  it('HTTP adapter is thin and delegates to runFoodAnalyze', () => {
    expect(route).toMatch(/runFoodAnalyze/);
    expect(route.split('\n').filter(Boolean).length).toBeLessThanOrEqual(700);
    expect(route).not.toMatch(/finalizeDishLedger/);
  });
});

describe('Single Meal Agent owns compose: no dietitian/narrator phase', () => {
  const compose = readFileSync(resolve(__dirname, './server_food_analyze_run_scout_compose.ts'), 'utf8');
  it('dietitian owner file is gone; orchestrator runs the scout compose phase', () => {
    expect(pipeline).toMatch(/executeScoutComposePhase/);
    expect(pipeline).not.toMatch(/executeDietitianPhase/);
    expect(pipeline).not.toMatch(/executeMealProjectorPhase\s*\(/);
    expect(pipeline).not.toMatch(/server_food_analyze_run_dietitian/);
  });

  it('compose leg is pure TS: no live LLM call in the compose owner', () => {
    expect(compose).not.toMatch(/callUnifiedLLM\s*\(/);
  });

  it('no narrator dispatch or emission in analyze pipeline', () => {
    expect(pipeline).not.toMatch(/buildNarratorDispatch/);
    expect(pipeline).not.toMatch(/PROJECTOR_NARRATOR_INSTRUCTION/);
    expect(pipeline).not.toMatch(/agent:\s*['"]narrator['"]/);
    expect(pipeline).not.toMatch(/['"]narrator_answer['"]/);
  });
});

describe('F-12.1 no live USDA on Analyze', () => {
  it('pipeline never calls searchUSDA / fetchUSDAFoodById / two-round helpers', () => {
    expect(pipeline).not.toMatch(/searchUSDA\s*\(/);
    expect(pipeline).not.toMatch(/fetchUSDAFoodById\s*\(/);
    expect(pipeline).not.toMatch(/searchUSDAFood\s*\(/);
    expect(pipeline).not.toMatch(/searchUSDAWithTwoRounds\s*\(/);
  });

  it('F-12.2: no FDC hint machinery on the pipeline', () => {
    expect(pipeline).not.toMatch(/collectFdcHintTasks/);
    expect(pipeline).not.toMatch(/isFdcHintRelevant/);
    expect(pipeline).not.toMatch(/verifiedFdcHintMap/);
    expect(pipeline).not.toMatch(/suggestedFdcId/);
  });
});

describe('F-12.3 no new usda meal writes; curator takes no USDA fn', () => {
  const dbSearch = readFileSync(resolve(__dirname, './src/server/food/server_food_db_search.ts'), 'utf8');
  const curator = readFileSync(resolve(__dirname, './server_food_resolver_curator.ts'), 'utf8');
  const helpers = readFileSync(resolve(__dirname, './src/server/food/server_food_analyze_helpers.ts'), 'utf8');
  it('curator has no USDA search hook; db search never labels matches usda', () => {
    expect(curator).not.toMatch(/searchUSDAFn/);
    expect(dbSearch).not.toMatch(/searchUSDAFn/);
    expect(dbSearch).not.toMatch(/source:\s*["']usda["']/);
    expect(dbSearch).not.toMatch(/["']usda["']\s*:\s*["']/);
  });
  it('component fallback defaults to estimated, never usda', () => {
    expect(helpers).not.toMatch(/:\s*['"]usda['"]\s*\)/);
    expect(helpers).toMatch(/brand_official.*estimated/);
  });
});
describe('F-8 compiler uses finalize not aggregateItemsNutrients', () => {
  const src = readFileSync(resolve(__dirname, './server_meal_compiler.ts'), 'utf8');
  it('compileMealState calls finalizeDishLedger and not aggregateItemsNutrients(', () => {
    expect(src).toMatch(/finalizeDishLedger/);
    expect(src).not.toMatch(/aggregateItemsNutrients\s*\(/);
  });
});
