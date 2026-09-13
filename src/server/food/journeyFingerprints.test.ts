import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scoutSystemInstruction } from '../../../agents/scoutInstructions.js';
import { scoutOnlyCompareSystemInstruction } from '../../../prototype/meallog/compare/scout_only_compare_instructions.js';
import { visionScoutResponseSchema, scoutOnlyCompareResponseSchema } from './server_food_analyze_schema.js';
import { selectSystemInstruction } from './server_food_prompt_context.js';
import { buildScoutCallArgs } from './server_food_scout_source.js';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Standing fingerprints. "Learn from meal log" must copy a mechanism, never
 * replace compare's pack. Nutrition targets must ride the live LLM call.
 * If these fail, a journey was overwritten — restore from git, do not "fix"
 * the test.
 */
describe('journey fingerprints (log vs compare; nutrition targets)', () => {
  it('standing.json Guard script exits 0', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/assert-standing.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('compare instruction is not the meal-log instruction', () => {
    expect(scoutOnlyCompareSystemInstruction).not.toEqual(scoutSystemInstruction);
    expect(scoutOnlyCompareSystemInstruction).toContain('EVALUATION ONLY');
    expect(scoutOnlyCompareSystemInstruction).toContain('allExtractedDishes');
    expect(scoutOnlyCompareSystemInstruction).toMatch(/Mode D|competing food options/);
    expect(scoutSystemInstruction).not.toContain('allExtractedDishes');
  });

  it('compare schema is not the meal-log schema', () => {
    expect(scoutOnlyCompareResponseSchema.required).toContain('allExtractedDishes');
    expect(scoutOnlyCompareResponseSchema.required).toContain('groups');
    expect(scoutOnlyCompareResponseSchema.required).not.toContain('dishes');
    expect(visionScoutResponseSchema.required).toContain('dishes');
    expect((visionScoutResponseSchema.properties as any).allExtractedDishes).toBeUndefined();
  });

  it('diet router keeps compare on PRODUCT EVALUATION', () => {
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
    const review = selectSystemInstruction({ ...base, userSelectedMode: 'review' });
    const compare = selectSystemInstruction({ ...base, userSelectedMode: 'compare' });
    expect(compare).not.toEqual(review);
    expect(compare).toContain('PRODUCT EVALUATION');
    expect(review).toContain('NARRATE');
  });

  it('live scout call for compare does not silently use the log pack', () => {
    const compare = buildScoutCallArgs({
      engine: 'x', language: 'en', scoutPromptText: 'P', imagePayloads: [], isCompare: true,
    });
    const log = buildScoutCallArgs({
      engine: 'x', language: 'en', scoutPromptText: 'P', imagePayloads: [], isCompare: false,
    });
    expect(compare.systemInstruction).toContain('EVALUATION ONLY');
    expect(compare.responseSchema).toBe(scoutOnlyCompareResponseSchema);
    expect(log.responseSchema).toBe(visionScoutResponseSchema);
  });

  it('production run files pass assembled instruction (targets) into runScoutRetryLoop', () => {
    const run = read('server_food_analyze_run.ts');
    expect(run).toContain('systemInstruction: resolvedScoutSystemInstruction');
    expect(run).toContain('scoutOnlyCompareSystemInstruction');
    expect(run).toContain('buildNutritionTargetStatus');
    expect(run).toMatch(/userSelectedMode === 'compare'[\s\S]*scoutOnlyCompareSystemInstruction/);
    const shard = read('server_food_analyze_run_scout.ts');
    expect(shard).toContain('systemInstruction: resolvedScoutSystemInstruction');
    expect(shard).toContain('scoutOnlyCompareSystemInstruction');
    expect(shard).toContain('buildNutritionTargetStatus');
  });
});
