/**
 * M22 — Stage lifecycle + limits for progressive MealBuild.
 * Pure helpers (no I/O). Server/orchestrator call these around each stage.
 */
import type { MealBuild, StageAuditRecord, HistoryLogEntry } from './types';
import { appendHistory, appendStageLedger, consolidateMeal, makeStageKey } from './consolidate';

export type StageName =
  | 'media'
  | 'scout'
  | 'portion'
  | 'resolver'
  | 'calculation'
  | 'diet'
  | 'user_edit';

export interface StageLimits {
  maxStageAttempts: number;
  stageTimeoutMs: number;
  maxHistoryHotEntries: number;
  totalTokenBudget?: number;
}

export const DEFAULT_STAGE_LIMITS: StageLimits = {
  maxStageAttempts: 3,
  stageTimeoutMs: 90_000,
  maxHistoryHotEntries: 80,
};

export function getStageLimits(meal?: MealBuild | null): StageLimits {
  const raw = meal?.stageLimits as any;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STAGE_LIMITS };
  return {
    maxStageAttempts: Number(raw.maxStageAttempts) || DEFAULT_STAGE_LIMITS.maxStageAttempts,
    stageTimeoutMs: Number(raw.stageTimeoutMs) || DEFAULT_STAGE_LIMITS.stageTimeoutMs,
    maxHistoryHotEntries: Number(raw.maxHistoryHotEntries) || DEFAULT_STAGE_LIMITS.maxHistoryHotEntries,
    totalTokenBudget: raw.totalTokenBudget,
  };
}

/** Count attempts already recorded for a stage (any status). */
export function countStageAttempts(meal: MealBuild | null | undefined, stage: string): number {
  const ledger = meal?.stageLedger || [];
  return ledger.filter((r) => r.stage === stage).length;
}

export function checkStageLimits(
  meal: MealBuild | null | undefined,
  stage: string
): { ok: boolean; attempt: number; reason?: string; code?: string } {
  const limits = getStageLimits(meal);
  const prior = countStageAttempts(meal, stage);
  const attempt = prior + 1;
  if (attempt > limits.maxStageAttempts) {
    return {
      ok: false,
      attempt,
      code: 'CircuitBreakerTripped',
      reason: `Stage ${stage} exceeded maxStageAttempts=${limits.maxStageAttempts}`,
    };
  }
  return { ok: true, attempt };
}

export function beginStage(
  meal: MealBuild,
  stage: StageName | string,
  opts?: { actor?: string; message?: string }
): { meal: MealBuild; stageKey: string; attempt: number; allowed: boolean; limitReason?: string } {
  const check = checkStageLimits(meal, stage);
  const stageKey = makeStageKey(meal.id || 'meal', stage, check.attempt);
  let m = meal;

  if (!check.ok) {
    const record: StageAuditRecord = {
      stageKey,
      stage,
      attempt: check.attempt,
      timestamp: new Date().toISOString(),
      status: 'degraded',
      recovery: 'awaiting_user',
      message: check.reason,
      actor: opts?.actor,
    } as any;
    m = appendStageLedger(m, record);
    m = appendHistory(m, {
      type: 'error',
      timestamp: new Date().toISOString(),
      stage,
      message: check.reason || 'stage limits exceeded',
    } as any);
    m = {
      ...m,
      degradedStages: Array.from(new Set([...(m.degradedStages || []), stage, 'circuit'])),
    };
    return { meal: m, stageKey, attempt: check.attempt, allowed: false, limitReason: check.reason };
  }

  const record: StageAuditRecord = {
    stageKey,
    stage,
    attempt: check.attempt,
    timestamp: new Date().toISOString(),
    status: 'success',
    actor: opts?.actor,
    message: opts?.message || `${stage} started`,
  } as any;
  // Use a distinct in-progress message; endStage overwrites same stageKey
  m = appendStageLedger(m, { ...record, status: 'success', message: `start:${stage}` } as any);
  m = appendHistory(m, {
    type: 'stage_start',
    timestamp: new Date().toISOString(),
    stage,
    message: opts?.message || `Stage ${stage} started (attempt ${check.attempt})`,
  } as any);

  return { meal: m, stageKey, attempt: check.attempt, allowed: true };
}

export function endStage(
  meal: MealBuild,
  stage: StageName | string,
  status: 'success' | 'error' | 'degraded',
  opts?: {
    stageKey?: string;
    attempt?: number;
    message?: string;
    actor?: string;
    recovery?: string;
    patch?: Partial<MealBuild>;
  }
): MealBuild {
  const attempt = opts?.attempt || countStageAttempts(meal, stage) || 1;
  const stageKey = opts?.stageKey || makeStageKey(meal.id || 'meal', stage, attempt);
  let m = meal;

  if (opts?.patch && Object.keys(opts.patch).length > 0) {
    m = consolidateMeal(m, opts.patch, stage, {
      stageKey,
      attempt,
      actor: opts.actor,
      expectedVersion: m.version,
    });
  }

  const record: StageAuditRecord = {
    stageKey,
    stage,
    attempt,
    timestamp: new Date().toISOString(),
    status,
    actor: opts?.actor,
    recovery: opts?.recovery,
    message: opts?.message,
  } as any;
  m = appendStageLedger(m, record);

  const histType = status === 'success' ? 'stage_complete' : 'error';
  m = appendHistory(m, {
    type: histType,
    timestamp: new Date().toISOString(),
    stage,
    message: opts?.message || `Stage ${stage} ${status}`,
  } as any);

  if (status === 'degraded' || status === 'error') {
    m = {
      ...m,
      degradedStages: Array.from(new Set([...(m.degradedStages || []), stage])),
    };
  }
  if (status === 'success') {
    m = { ...m, lastCompletedStage: stage };
  }
  return m;
}

export function formatDietProjectionBlock(projection: any): string {
  if (!projection) return '';
  const macros = projection.macroTotals || {};
  const items = projection.itemsSummary || [];
  return [
    '[SERVER BASELINE ESTIMATE — audit each nutrient against culinary reality; accept or provide clinical corrections in correctedNutrients]',
    `mealId=${projection.mealId || ''}`,
    `mealName=${projection.mealName || ''}`,
    `macroTotals=${JSON.stringify(macros)}`,
    `itemsSummary=${JSON.stringify(items)}`,
  ].join('\n');
}
