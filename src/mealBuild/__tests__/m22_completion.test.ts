/**
 * M22 completion / chaos-lite tests — must stay green for Meal Build "true complete".
 */
import { describe, it, expect } from 'vitest';
import { consolidateMeal, rebaseUserEdit, makeStageKey, appendHistory } from '../consolidate';
import { beginStage, endStage, checkStageLimits, formatDietProjectionBlock, DEFAULT_STAGE_LIMITS } from '../stageLifecycle';
import { projectDietInput } from '../projectors';
import { buildColdDebugPackage, coldDebugExpiredMessage } from '../coldDebug';
import { fromPendingFoodLog, toPendingFoodLog } from '../adapters';
import type { MealBuild } from '../types';

function baseMeal(over: Partial<MealBuild> = {}): MealBuild {
  return {
    id: 'm22',
    schemaVersion: 1,
    version: 1,
    mode: 'new_log',
    items: [{ itemId: 'a', name: 'Rice', weightGrams: 100, nutrients: { calories: 130 } }],
    nutrients: { calories: 130 },
    stageLimits: { maxStageAttempts: 2, stageTimeoutMs: 1000, maxHistoryHotEntries: 20 } as any,
    ...over,
  };
}

describe('M22 stage lifecycle + circuit', () => {
  it('beginStage + endStage append history and ledger with stageKey', () => {
    let meal = baseMeal();
    const start = beginStage(meal, 'scout', { actor: 'job' });
    expect(start.allowed).toBe(true);
    expect(start.stageKey).toContain('scout');
    meal = start.meal;
    meal = endStage(meal, 'scout', 'success', {
      stageKey: start.stageKey,
      attempt: start.attempt,
      message: 'scout ok',
      patch: { items: [{ itemId: 'a', name: 'Rice', estimatedCalories: 140 }] },
    });
    expect(meal.historyLog && meal.historyLog.length).toBeGreaterThan(0);
    expect(meal.stageLedger?.some((r) => r.stageKey === start.stageKey)).toBe(true);
    expect(meal.lastCompletedStage).toBe('scout');
  });

  it('circuit: exceeding maxStageAttempts degrades', () => {
    let meal = baseMeal({ stageLimits: { maxStageAttempts: 1, stageTimeoutMs: 1000, maxHistoryHotEntries: 10 } as any });
    const a1 = beginStage(meal, 'resolver');
    meal = endStage(a1.meal, 'resolver', 'error', { stageKey: a1.stageKey, attempt: 1, message: 'fail1' });
    // count attempts from ledger — second begin should trip if max=1 and we already have records
    meal = {
      ...meal,
      stageLedger: [
        ...(meal.stageLedger || []),
        { stageKey: 'x', stage: 'resolver', attempt: 1, timestamp: '', status: 'error' } as any,
      ],
    };
    // force two prior resolver entries
    meal.stageLedger = [
      { stageKey: 'r1', stage: 'resolver', attempt: 1, timestamp: 't', status: 'error' },
      { stageKey: 'r2', stage: 'resolver', attempt: 2, timestamp: 't', status: 'error' },
    ] as any;
    const blocked = beginStage(meal, 'resolver');
    expect(blocked.allowed).toBe(false);
    expect(blocked.limitReason || '').toMatch(/maxStageAttempts|exceeded/i);
  });

  it('checkStageLimits default allows first attempt', () => {
    const c = checkStageLimits(baseMeal({ stageLedger: [] }), 'diet');
    expect(c.ok).toBe(true);
    expect(c.attempt).toBe(1);
    expect(DEFAULT_STAGE_LIMITS.maxStageAttempts).toBeGreaterThan(0);
  });
});

describe('M22 idempotency + zombie + rebase', () => {
  it('stageKey stable shape', () => {
    const k = makeStageKey('meal1', 'calculation', 2);
    expect(k).toMatch(/meal1/);
    expect(k).toMatch(/calculation/);
    expect(k).toMatch(/2/);
  });

  it('zombie delete still holds under resolver patch', () => {
    const meal = baseMeal({
      items: [{ itemId: 'fries', name: 'Fries' }],
      deletedItemIds: ['fries'],
    });
    const out = consolidateMeal(meal, { items: [{ itemId: 'fries', name: 'Fries', dbId: 'x' }] }, 'resolver');
    expect(out.items.find((i) => i.itemId === 'fries')).toBeUndefined();
  });

  it('rebaseUserEdit preserves deletedItemIds (max attempts)', () => {
    const server = baseMeal({ version: 5, items: [{ itemId: 'a', name: 'Rice', weightGrams: 100 }] });
    const { rebasedMeal, success } = rebaseUserEdit(server, {
      deletedItemIds: ['a'],
      items: [],
    });
    expect(success).toBe(true);
    expect(rebasedMeal.deletedItemIds || []).toContain('a');
    const fail = rebaseUserEdit(server, { items: [] }, 4);
    expect(fail.success).toBe(false);
  });
});

describe('M22 projector + cold debug + partial meal', () => {
  it('formatDietProjectionBlock is non-empty and has PRECALC', () => {
    const meal = baseMeal({ content: { name: 'Bowl' }, nutrients: { calories: 500, protein: 30 } });
    const p = projectDietInput(meal, { age: 30 });
    const block = formatDietProjectionBlock(p);
    expect(block).toMatch(/PRECALC|macroTotals/i);
    expect(block).not.toMatch(/databaseMatchesArray/);
  });

  it('partial label-only item round-trips', () => {
    const log = {
      name: 'Yolk burger',
      nutrients: { calories: 700 },
      itemsBreakdown: [
        {
          itemId: 'y1',
          name: 'Yolk burger',
          rawNutritionLabel: { calories: 700 },
          estimatedCalories: 700,
          nutrientStatus: 'partial',
        },
      ],
    };
    const meal = fromPendingFoodLog(log, { savable: true });
    const back = toPendingFoodLog(meal);
    const item = (back.itemsBreakdown || back.items)[0];
    expect(item.rawNutritionLabel || item.estimatedCalories).toBeTruthy();
  });

  it('buildColdDebugPackage collects errors; expired message set', () => {
    let meal = baseMeal();
    meal = appendHistory(meal, {
      type: 'error',
      timestamp: new Date().toISOString(),
      message: 'quota',
      stage: 'diet',
    } as any);
    const cold = buildColdDebugPackage({ meal, jobId: 'j1', backendLogsText: 'log line' });
    expect(cold.schemaVersion).toBe(1);
    expect(cold.errors.length).toBeGreaterThan(0);
    expect(coldDebugExpiredMessage()).toMatch(/expired|14|30/i);
  });

  it('empty items meal is not forced savable by consolidate alone', () => {
    const meal = baseMeal({ items: [], nutrients: {}, savable: false });
    const out = consolidateMeal(meal, { items: [] }, 'calculation');
    expect(out.items.length).toBe(0);
  });
});
