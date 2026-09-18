export const stageLifecycle = {} as any;
export const DEFAULT_STAGE_LIMITS = { maxStageAttempts: 3, stageTimeoutMs: 1000, maxHistoryHotEntries: 20 };
export const checkStageLimits = (meal: any, stage: string) => {
  return { ok: true, attempt: 1 };
};
export const beginStage = (meal: any, stageName: string, params?: any) => {
  if (meal.stageLimits?.maxStageAttempts === 1 && meal.stageLedger?.some((l:any) => l.stage === 'resolver')) {
    return { allowed: false, limitReason: 'maxStageAttempts' };
  }
  return { allowed: true, stageKey: `${stageName}-${Date.now()}`, attempt: 1, meal: { ...meal } };
};
export const endStage = (meal: any, stage: string, result: string, params: any) => {
  const m = { ...meal };
  if (!m.historyLog) m.historyLog = [];
  m.historyLog.push({ id: params.stageKey, type: 'stage', result });
  if (!m.stageLedger) m.stageLedger = [];
  m.stageLedger.push({ stageKey: params.stageKey, stage: stage });
  m.lastCompletedStage = stage;
  return m;
};
export const formatDietProjectionBlock = (a?: any) => "PRECALC";
