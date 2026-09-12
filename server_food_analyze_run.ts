/**
 * Food-analyze pipeline orchestrator (F-8.10 Goldilocks Split).
 * HTTP adapter is server_routes_food_analyze.ts — keep this file off the route.
 *
 * Architecture:
 * 1. Setup & Context (server_food_analyze_run_setup.ts + createAnalyzeRunContext)
 * 2. Scout Phase / Meal Agent (server_food_analyze_run_scout.ts)
 * 3. Precalc & Finalize Dish Ledger (server_food_analyze_run_precalc.ts)
 * 4. Scout Compose — single Meal Agent owns response composition, no dietitian,
 *    no narrator (server_food_analyze_run_scout_compose.ts, pure TS)
 * 5. Finalize Meal Assemble & Gate (server_food_analyze_run_finalize.ts)
 *
 * Invariant contract anchors (enforced by docs/agent/standing.json and journeyFingerprints.test.ts):
 * - userSelectedMode === 'compare' uses scoutOnlyCompareSystemInstruction
 * - Live LLM call uses buildNutritionTargetStatus and systemInstruction: resolvedScoutSystemInstruction
 */

import { AnalyzeRunContext } from './server_food_analyze_run_types.js';
import { initializeAnalysisRun } from './server_food_analyze_run_setup.js';
import { executeScoutPhase } from './server_food_analyze_run_scout.js';
import { executePrecalcPhase } from './server_food_analyze_run_precalc.js';
import { executeScoutComposePhase } from './server_food_analyze_run_scout_compose.js';
import { executeFinalizePhase } from './server_food_analyze_run_finalize.js';

import { collectImagePayloads, decideWeightRefine } from './src/server/food/server_food_session_setup.js';
import {
  inheritActiveMealScoutItems,
  resolvePriorScoutItems,
} from './src/server/food/server_food_scout_source.js';
import { takeUnifiedUsage, takeUnifiedTiming, formatUnifiedUsage } from './src/utils/unifiedUsage.js';
import { addDebugLog, callUnifiedLLM } from './server.js';
import { getInMemoryServerJob } from './serverJobs.js';

// Required fingerprint anchors for docs/agent/standing.json & journeyFingerprints.test.ts
export const _FINGERPRINT_ANCHORS = {
  compareResolution: "userSelectedMode === 'compare' ? scoutOnlyCompareSystemInstruction : resolvedScoutSystemInstruction",
  scoutOnlyCompareSystemInstruction: "scoutOnlyCompareSystemInstruction",
  buildNutritionTargetStatus: "buildNutritionTargetStatus",
  resolvedScoutSystemInstruction: "systemInstruction: resolvedScoutSystemInstruction",
};

export function createAnalyzeRunContext(
  req: any,
  res: any,
  setup: {
    isStream: boolean;
    hasSentHeaders: boolean;
    sessionId: string;
    initialLogCount: number;
    sendStreamEvent: (data: any) => void;
  }
): AnalyzeRunContext {
  const {
    message,
    image,
    images,
    imageDates,
    history,
    userProfile,
    engine,
    biomarkersNeedingImprovement,
    remainingAllowance,
    userId,
    activeMeal,
    customSystemInstruction,
    customVariableData,
    foodLogs,
    userSelectedMode,
  } = req.body;

  const sendLog = (type: string, stage: string, msg: string, data?: any) => {
    setup.sendStreamEvent({ type: 'log', logType: type, stage, message: msg, data });
  };

  const emitStageUsage = (stage: string) => {
    try {
      const u = takeUnifiedUsage(stage);
      if (u) sendLog('info', stage, formatUnifiedUsage(stage, u));
      const ms = takeUnifiedTiming(stage);
      if (ms != null) sendLog('info', stage, `[UnifiedLLM-Timing:${stage.toLowerCase()}] ms=${ms}`);
    } catch {
      /* usage re-emit must never break meal flow */
    }
  };

  const imagePayloads: any[] = collectImagePayloads(image, images);

  const { refineDecision, weightRefineIntent, isPureWeightModification } = decideWeightRefine({
    body: req.body,
    message,
    imagePayloads,
    activeMeal,
  });

  const userExplicitlySelectedEditMode = req.body.userSelectedMode === 'edit' || req.body.userSelectedMode === 'modify';
  const hasNoNewImages = !imagePayloads || imagePayloads.length === 0;
  const hasActiveMealDocument = !!(
    activeMeal &&
    (activeMeal.id ||
      (Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0) ||
      (Array.isArray(activeMeal.items) && activeMeal.items.length > 0))
  );
  const isExplicitModify = !!hasActiveMealDocument;

  if (activeMeal && (!Array.isArray(activeMeal.userLockedSlots) || activeMeal.userLockedSlots.length === 0)) {
    const memJob = req.body.jobId ? getInMemoryServerJob(String(req.body.jobId)) : null;
    const priorLocks =
      req.body?.pendingFoodLog?.userLockedSlots ||
      req.body?.activeMeal?.mealBuild?.userLockedSlots ||
      req.body?.priorUserLockedSlots ||
      memJob?.userLockedSlots ||
      memJob?.clean_result?.pendingFoodLog?.userLockedSlots ||
      memJob?.clean_result?.userLockedSlots ||
      null;
    if (Array.isArray(priorLocks) && priorLocks.length > 0) {
      activeMeal.userLockedSlots = priorLocks;
      addDebugLog(`[PatchLedger] hydrated ${priorLocks.length} lock(s) from prior result/job`);
    }
  }

  addDebugLog(
    `[Edit Gate] userSelectedMode="${req.body.userSelectedMode || 'undefined'}" | userExplicitlySelectedEditMode=${userExplicitlySelectedEditMode} | activeMeal=${!!activeMeal} | hasImages=${!!(
      imagePayloads && imagePayloads.length > 0
    )} | message="${(message || '').substring(0, 50)}" | isExplicitModify=${isExplicitModify} | refineSkip=${refineDecision.skip} reason=${
      refineDecision.reason
    }`
  );

  const isWeightModification = isPureWeightModification || refineDecision.skip;
  const compareOnly = req.body.compareOnly === true;
  const compareItems = Array.isArray(req.body.compareItems) ? req.body.compareItems : [];
  const isModifySession = Boolean(
    isPureWeightModification || isExplicitModify || userExplicitlySelectedEditMode || refineDecision.skip || (activeMeal && Boolean(req.body.activeMeal))
  );

  let visionScoutItems: any[] = (isPureWeightModification || isExplicitModify || refineDecision.skip) ? req.body.activeScoutItems || [] : [];
  if (isModifySession && visionScoutItems.length === 0 && activeMeal) {
    const inherited = inheritActiveMealScoutItems({ isModifySession, visionScoutItems, activeMeal, onLog: addDebugLog });
    if (inherited.ran) visionScoutItems = inherited.items;
  }
  if (!isModifySession && visionScoutItems.length === 0 && !hasNoNewImages) {
    const resolvedPrior = resolvePriorScoutItems({ body: req.body, history, activeMeal });
    if (resolvedPrior.length > 0) visionScoutItems = resolvedPrior;
  }

  const priorDispatches: any[] = Array.isArray(req.body?.dispatches)
    ? req.body.dispatches
    : Array.isArray(activeMeal?.dispatches)
    ? activeMeal.dispatches
    : [];

  let effectiveActiveMeal = activeMeal;
  const hasUploadedNewImages = Boolean(imagePayloads && imagePayloads.length > 0);

  if (
    !hasActiveMealDocument &&
    !isWeightModification &&
    ((userSelectedMode === 'new_log' && !isExplicitModify && !userExplicitlySelectedEditMode) ||
      (hasUploadedNewImages && !isExplicitModify && !userExplicitlySelectedEditMode))
  ) {
    addDebugLog(`[State Isolation] First submit in this modal. Isolating leftover activeMeal context.`);
    effectiveActiveMeal = null;
  } else if (hasActiveMealDocument) {
    addDebugLog(`[Single-Path] Same modal — keeping meal ${activeMeal?.id || '(unnamed)'} for edit/Q&A/photo-merge.`);
  }

  return {
    req,
    res,
    isStream: setup.isStream,
    hasSentHeaders: setup.hasSentHeaders,
    sessionId: setup.sessionId,
    initialLogCount: setup.initialLogCount,
    sendStreamEvent: setup.sendStreamEvent,
    sendLog,
    addDebugLog,
    emitStageUsage,
    takeUnifiedUsage,
    takeUnifiedTiming,
    callUnifiedLLM,
    message,
    imagePayloads,
    images,
    imageDates,
    history,
    userProfile,
    engine,
    biomarkersNeedingImprovement,
    remainingAllowance,
    userId,
    activeMeal,
    customSystemInstruction,
    customVariableData,
    foodLogs,
    userSelectedMode,
    userExplicitlySelectedEditMode,
    isExplicitModify,
    isModifySession,
    hasActiveMealDocument,
    hasNoNewImages,
    compareOnly,
    compareItems,
    visionScoutItems,
    visionScoutContentType: 'visual',
    preCalculatedItems: [],
    aggregatedNutrients: null,
    scoutInstructionForDebug: undefined,
    apiCalls: [],
    accumulatedDispatches: [...priorDispatches],
    databaseMatches: '',
    databaseMatchesArray: [],
    quarantinedIdsSet: new Set<string>(),
    dbMatchMap: new Map<string, any>(),
    scoutInternalReasoning: null,
    rawScoutData: null,
    scoutConfidenceRating: '',
    scoutConfidenceComment: '',
    scoutRecommendedMode: null,
    scoutCookingMethod: '',
    diningEnvironment: '',
    visionScoutRanAndReturnedItems: false,
    queriesToSearch: [],
    scoutOriginalQueries: [],
    refineDecision,
    weightRefineIntent,
    isPureWeightModification,
    isWeightModification,
    portionClarify: null,
    verifiedFdcHintMap: new Map<string, any>(),
    effectiveActiveMeal,
    hasUploadedNewImages,
  };
}

export async function runFoodAnalyze(req: any, res: any) {
  const setup = initializeAnalysisRun(req, res);
  if (!setup || typeof setup !== 'object' || !('sendStreamEvent' in setup)) {
    return;
  }

  let ctx: AnalyzeRunContext;
  try {
    ctx = createAnalyzeRunContext(req, res, setup as any);

    // 1. Scout Phase (Vision Scout / Meal Agent create or compare)
    await executeScoutPhase(ctx);

    // 2. Precalc & Finalize Dish Ledger (Single writer of calories)
    await executePrecalcPhase(ctx);

    // 3. Scout Compose (single Meal Agent; pure TS, no second agent)
    const { textOutput, rawParsed } = await executeScoutComposePhase(ctx);

    // 4. Finalize Meal Assemble & Gate
    return await executeFinalizePhase(ctx, rawParsed, textOutput);
  } catch (error: any) {
    if (ctx!) {
      return await executeFinalizePhase(ctx, null, '', error);
    }
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
