/**
 * M22 — Cold forensic debug package builder (R2 / download).
 * Keep hot meal lean; put bulk here.
 */
import type { MealBuild } from './types';
import { stripHeavyImages } from '../utils/debugPayload';

export interface ColdDebugPackage {
  schemaVersion: 1;
  mealId?: string;
  jobId?: string;
  userId?: string;
  exportedAt: string;
  meal?: any;
  stageLedger?: any[];
  historyLog?: any[];
  lastUserAction?: any;
  version?: number;
  errors: Array<{ at: string; message: string; class?: string; code?: string; stage?: string; stageKey?: string }>;
  backendLogsText?: string;
  network?: { entries: Array<{ at?: string; method?: string; urlHostAndPath?: string; status?: number; durationMs?: number; error?: string }> };
  console?: { entries: Array<{ at?: string; level?: string; message: string }> };
  environment?: { appVersion?: string; userAgent?: string; path?: string };
  note?: string;
}

export function buildColdDebugPackage(input: {
  meal?: MealBuild | null;
  jobId?: string;
  userId?: string;
  backendLogsText?: string;
  network?: ColdDebugPackage['network'];
  console?: ColdDebugPackage['console'];
  extraErrors?: ColdDebugPackage['errors'];
  environment?: ColdDebugPackage['environment'];
}): ColdDebugPackage {
  const meal = input.meal ? (stripHeavyImages(input.meal) as MealBuild) : undefined;
  const errors: ColdDebugPackage['errors'] = [...(input.extraErrors || [])];

  for (const h of meal?.historyLog || []) {
    const e = h as any;
    if (e.type === 'error' || e.kind === 'error') {
      errors.push({
        at: e.at || e.timestamp || new Date().toISOString(),
        message: String(e.message || 'error'),
        stage: e.stage,
      });
    }
  }
  for (const r of meal?.stageLedger || []) {
    const rec = r as any;
    if (rec.status === 'error' || rec.status === 'degraded') {
      if (rec.message) {
        errors.push({
          at: rec.timestamp || new Date().toISOString(),
          message: String(rec.message),
          stage: rec.stage,
          stageKey: rec.stageKey,
          code: rec.recovery,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    mealId: meal?.id,
    jobId: input.jobId,
    userId: input.userId,
    exportedAt: new Date().toISOString(),
    meal,
    stageLedger: meal?.stageLedger,
    historyLog: meal?.historyLog,
    lastUserAction: meal?.lastUserAction,
    version: meal?.version,
    errors,
    backendLogsText: input.backendLogsText
      ? String(input.backendLogsText).slice(0, 200_000)
      : undefined,
    network: input.network,
    console: input.console,
    environment: input.environment,
    note: 'Cold forensic package. Hot meal ledger/history remain source of long-term audit. R2 debug objects may expire after 14–30 days.',
  };
}

export function coldDebugExpiredMessage(): string {
  return 'Forensic debug package expired or unavailable (kept 14–30 days). Meal stage ledger and history log on the job remain available.';
}
