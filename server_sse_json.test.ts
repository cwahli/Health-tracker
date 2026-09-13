import { describe, it, expect } from 'vitest';
import { attachSseJsonResponder, parseSseFinalResult } from './server_sse_json';
import { markDietDegraded, buildSavableMealFromParsed } from './server_meal_orchestrator';
import { toPendingFoodLog } from './src/mealBuild/adapters';
import { previewStatusLabel } from './src/jobs/jobPreview';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('SSE res.json wrap (DEGRADE_NOT_TERMINAL)', () => {
  it('emits final+result so serverJobs can persistSucceeded', () => {
    const writes: string[] = [];
    const res: any = {
      headersSent: true,
      write: (c: string) => writes.push(c),
      end: () => writes.push('END'),
    };
    attachSseJsonResponder(res);
    const payload = {
      pendingFoodLog: { name: 'Soto Daging Santan', nutrients: { calories: 648 } },
      degradedStages: ['dietitian'],
      message: 'Nutrients logged based on core databases, but AI clinical advice is currently unavailable.',
    };
    res.json(payload);
    expect(writes[0]).toMatch(/^data: /);
    const result = parseSseFinalResult(writes[0]);
    expect(result.degradedStages).toEqual(['dietitian']);
    expect(result.pendingFoodLog.nutrients.calories).toBe(648);
    expect(writes).toContain('END');
  });

  it('food-analyze stream path attaches the SSE json responder', () => {
    const src = fs.readFileSync(path.join(__dirname, 'server_food_analyze_run_setup.ts'), 'utf8');
    expect(src).toMatch(/attachSseJsonResponder\(res\)/);
  });
});

describe('diet salvage is a succeeded job, not stuck running', () => {
  it('markDietDegraded keeps macros and sets diet degrade', () => {
    const items = [
      { originalName: 'Soto Daging Santan', estimatedWeightGrams: 400, nutrients: { calories: 380, protein: 24.7 } },
      { originalName: 'Donut Malaysia Matcha', estimatedWeightGrams: 75, nutrients: { calories: 268, protein: 4 } },
    ];
    const meal = buildSavableMealFromParsed(items, null, { calories: 648, protein: 28.7 }, null);
    const degraded = markDietDegraded(meal, '503 UNAVAILABLE');
    expect(degraded.degradedStages).toEqual(['diet']);
    expect(degraded.savable).toBe(true);
    const log = toPendingFoodLog(degraded);
    expect(log.nutrients?.calories ?? log.calories).toBe(648);
  });

  it('preview says AI advice pending only when succeeded + diet degrade', () => {
    const job: any = {
      status: 'succeeded',
      result: {
        pendingFoodLog: { name: 'Soto', nutrients: { calories: 648 } },
        degradedStages: ['diet'],
      },
    };
    expect(previewStatusLabel(job)).toMatch(/AI advice pending/i);
    expect(previewStatusLabel({ ...job, status: 'running' })).not.toMatch(/AI advice pending/i);
  });
});
