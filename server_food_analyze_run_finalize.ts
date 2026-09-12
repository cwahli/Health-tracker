import { AnalyzeRunContext } from './server_food_analyze_run_types.js';
import {
  buildDiscussionResponse,
  buildEvaluationResponse,
  buildNewLogResponse,
  buildModifyNoMealResponse,
  buildModifyResponse,
  buildDegradeResponse,
} from './src/server/food/server_food_responses.js';
import { buildFoodApiCalls } from './src/server/food/server_food_mode_routing.js';
import {
  runEvaluationFinalize,
  assembleEvaluationComparison,
  buildFallbackItemsBreakdown,
  assembleParsedMealHeader,
  mapFinalizeToMeal,
  deriveMealComposition,
  resolveMealImageUrls,
  mergeModifyPathScoutItems,
  mergeFinalScoutItems,
  buildNewLogGateInput,
  buildGateInput,
  backfillEditCommandEstimates,
  syncEditScoutItems,
  resolveModifyIncomingTitle,
  resolveEditedMealTitle,
  appendEditHistoryEntry,
} from './src/server/food/server_food_meal_assemble.js';
import { mergeScoutItems } from './server_vision_scout.js';
import { attachHappyPathMealBuild, buildSavableMealFromParsed, markDietitianDegraded } from './server_meal_orchestrator.js';
import { evaluateMealGate } from './server_meal_gate.js';
import { checkResumedFromImageTurn, checkMenuScaleBypass } from './src/server/food/server_food_scout_source.js';
import { applyMealEdits } from './server_meal_edit.js';
import { reconcileMessageWithLedger } from './src/mealBuild/narration.js';
import { buildEditExpertDispatch } from './server_edit_patch_ledger.js';
import { toPendingFoodLog } from './src/mealBuild/adapters.js';
import { sumSalvagedAggregates, salvageLedgerPlausibility } from './src/server/food/server_food_dietitian_dispatch.js';
import { retrieveFoodImages } from './server.js';
import { getInMemoryServerJob } from './serverJobs.js';
import { sanitizeVerdictLabel } from './server_pure_helpers.js';

export async function executeFinalizePhase(
  ctx: AnalyzeRunContext,
  rawParsed: any,
  textOutput: string,
  error?: any
): Promise<any> {
  const mode = rawParsed?.mode || ctx.userSelectedMode || 'new_log';
  const originalModeIsModify = !!(
    ctx.isExplicitModify ||
    ctx.userExplicitlySelectedEditMode ||
    (ctx.req.body?.compareOnly && ctx.req.body?.activeMeal) ||
    (ctx.activeMeal && (!ctx.imagePayloads || ctx.imagePayloads.length === 0))
  );

  if (error) {
    console.error('[Food Analyze Error]:', error);
    if (
      ctx.preCalculatedItems &&
      ctx.preCalculatedItems.length > 0 &&
      ctx.preCalculatedItems.some(
        (p: any) => (p.nutrients && p.nutrients.calories != null) || (p.primaryBase100g && p.primaryBase100g.calories !== undefined)
      )
    ) {
      ctx.addDebugLog(`[Dietitian Degrade] Dietitian failed permanently, but pre-calculated math exists. Salvaging meal build.`);
      let degradeClarify: any = null;
      if (ctx.portionClarify) degradeClarify = ctx.portionClarify;
      const salvagedAggregatedNutrients = sumSalvagedAggregates(ctx.preCalculatedItems);
      const salvagedMeal = buildSavableMealFromParsed(ctx.preCalculatedItems, ctx.req.body?.activeMeal, salvagedAggregatedNutrients, null);
      const degradedMeal = markDietitianDegraded(salvagedMeal, error.message);
      const payloadData = toPendingFoodLog(degradedMeal);

      const salvageCheck = salvageLedgerPlausibility((payloadData as any)?.nutrients, (payloadData as any)?.weightGrams);
      if (!salvageCheck.ok) {
        ctx.addDebugLog(`[Dietitian Degrade] Refusing implausible salvage (${salvageCheck.reason}).`);
        const implausiblePayload: any = {
          error: `Analysis produced an implausible ledger (${salvageCheck.reason}) — nothing was saved. Please retry; pick a different model if it repeats.`,
          agentNotAvailable: true,
        };
        if (ctx.visionScoutItems && ctx.visionScoutItems.length > 0) {
          implausiblePayload.scoutItems = ctx.visionScoutItems;
          implausiblePayload.scoutContentType = ctx.visionScoutContentType;
        }
        return ctx.res.status(200).json(implausiblePayload);
      }

      const successPayload = buildDegradeResponse({
        payloadData,
        degradedMeal,
        visionScoutItems: ctx.visionScoutItems,
        scoutContentType: ctx.visionScoutContentType,
        agentInstructions: { scout: ctx.scoutInstructionForDebug },
        dispatches: ctx.accumulatedDispatches,
        apiCalls: ctx.apiCalls,
        portionClarify: degradeClarify,
      });
      ctx.addDebugLog(
        `[Dietitian Degrade] Emitting salvaged meal (kcal=${payloadData?.nutrients?.calories ?? (payloadData as any)?.calories ?? '?'}) as succeeded.`
      );
      return ctx.res.json(successPayload);
    }

    const errorPayload: any = {
      error: `Failed to process your request (Error: ${error.message || 'Connection timed out'}). Please try again with a different model from the top-left dropdown.`,
      agentNotAvailable: true,
    };
    if (ctx.visionScoutItems && ctx.visionScoutItems.length > 0) {
      errorPayload.scoutItems = ctx.visionScoutItems;
      errorPayload.scoutContentType = ctx.visionScoutContentType;
    }
    if (ctx.isStream && ctx.hasSentHeaders) {
      try {
        ctx.res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
      } catch (errStr: any) {
        ctx.res.write(`data: ${JSON.stringify({ error: 'Failed to process your request and serialize error payload.' })}\n\n`);
      }
      return ctx.res.end();
    } else {
      return ctx.res.status(200).json(errorPayload);
    }
  }

  // Normal flow
  const editCommands = ctx.rawScoutData?.modificationCommand || rawParsed.modificationCommand || [];
  ctx.addDebugLog(`[Mode Routing] Mode=${mode}, editCommands=${editCommands.length}, isModify=${ctx.isModifySession}`);

  ctx.apiCalls = buildFoodApiCalls({
    hasImage: ctx.hasNoNewImages === false,
    queriesToSearch: ctx.queriesToSearch,
    engine: ctx.engine,
  });

  const scoutRanThisTurn = Boolean(ctx.scoutInstructionForDebug || ctx.rawScoutData);
  const scoutLegs = ctx.accumulatedDispatches.filter((d: any) => d.agent === 'scout').length;
  const currentTurnNumber = scoutRanThisTurn ? (scoutLegs || 1) : (scoutLegs + 1);

  // Scout-only: no narrator dispatch is constructed here. The scout leg
  // already carries model + latency_ms, and composition output travels in
  // rawParsed (message/verdict) — not in a second dispatch.

  // CASE B: discussion mode
  if (mode === 'discussion') {
    ctx.addDebugLog(`[Mode Routing] DISCUSSION mode triggered (0 database operations).`);
    return ctx.res.json(
      buildDiscussionResponse({
        rawParsed,
        agentInstructions: { scout: ctx.scoutInstructionForDebug },
        dispatches: ctx.accumulatedDispatches,
        apiCalls: ctx.apiCalls,
      })
    );
  }

  // CASE D: evaluation mode
  if (mode === 'evaluation') {
    ctx.addDebugLog(`[Mode Routing] EVALUATION mode triggered.`);
    const comparisonData = rawParsed.comparison || { groups: [] };
    const preCalcByScoutIndex = await runEvaluationFinalize({
      visionScoutItems: ctx.visionScoutItems,
      diningEnvironment: ctx.diningEnvironment,
      onLog: ctx.addDebugLog,
    });
    const isMenuScale = checkMenuScaleBypass({
      visionScoutContentType: ctx.visionScoutContentType,
      scoutRecommendedMode: ctx.scoutRecommendedMode,
    });
    const { comparisonData: resolvedComparisonData, comparisonSet } = assembleEvaluationComparison({
      comparisonData,
      visionScoutItems: ctx.visionScoutItems,
      preCalcByScoutIndex,
      isMenuScale,
      language: ctx.userProfile?.language,
      jobId: ctx.req.body?.jobId,
      onLog: ctx.addDebugLog,
    });
    const responsePayload = buildEvaluationResponse({
      rawParsed,
      scoutInternalReasoning: ctx.scoutInternalReasoning,
      rawScoutData: ctx.rawScoutData,
      comparisonData: resolvedComparisonData,
      comparisonSet,
      scoutItems: mergeScoutItems(ctx.visionScoutItems, rawParsed.scoutItems),
      scoutContentType: ctx.visionScoutContentType,
      diningEnvironment: ctx.diningEnvironment,
      agentInstructions: { scout: ctx.scoutInstructionForDebug },
      dispatches: ctx.accumulatedDispatches,
      apiCalls: ctx.apiCalls,
    });
    return ctx.res.json(responsePayload);
  }

  // CASE A: NEW FOOD LOGGING
  if (mode === 'new_log') {
    const rawFoodData = rawParsed.foodData || {};
    if (!rawFoodData.itemsBreakdown || rawFoodData.itemsBreakdown.length === 0) {
      const fallback = buildFallbackItemsBreakdown({
        visionScoutItems: ctx.visionScoutItems,
        databaseMatchesArray: ctx.databaseMatchesArray,
        quarantinedIdsSet: ctx.quarantinedIdsSet,
        onLog: ctx.addDebugLog,
      });
      if (fallback) rawFoodData.itemsBreakdown = fallback;
    }
    const header = assembleParsedMealHeader({
      rawFoodData,
      rawParsed,
      imageDates: ctx.imageDates,
      message: ctx.message,
      originalModeIsModify,
      activeMeal: ctx.activeMeal,
      scoutCookingMethod: ctx.scoutCookingMethod,
      scoutConfidenceRating: ctx.scoutConfidenceRating,
      scoutConfidenceComment: ctx.scoutConfidenceComment,
      diningEnvironment: ctx.diningEnvironment,
      language: ctx.userProfile?.language,
    });
    const parsedData: any = header.parsedData;
    ctx.diningEnvironment = header.diningEnvironment;
    mapFinalizeToMeal({
      preCalculatedItems: ctx.preCalculatedItems,
      rawFoodData,
      diningEnvironment: ctx.diningEnvironment,
      parsedData,
      rawParsed,
      onLog: ctx.addDebugLog,
      sendLog: ctx.sendLog,
    });

    if (parsedData.itemsBreakdown && Array.isArray(parsedData.itemsBreakdown)) {
      parsedData.composition = deriveMealComposition(parsedData.itemsBreakdown);
    }
    resolveMealImageUrls({
      body: ctx.req.body,
      images: ctx.images,
      image: ctx.imagePayloads?.[0],
      parsedData,
    });
    if (originalModeIsModify) {
      parsedData.id = ctx.req.body?.activeMeal?.id;
      if (!parsedData.imageUrl) parsedData.imageUrl = ctx.req.body?.activeMeal?.imageUrl || ctx.req.body?.activeMeal?.imageUrls?.[0];
      if (!parsedData.imageUrls || (parsedData.imageUrls.length > 0 && parsedData.imageUrls[0] === '[base64_image_data_truncated]')) {
        parsedData.imageUrls = ctx.req.body?.activeMeal?.imageUrls;
      }
      const updatedScoutItems = mergeModifyPathScoutItems({
        visionScoutItems: ctx.visionScoutItems,
        activeMealScoutItems: ctx.req.body?.activeMeal?.scoutItems,
        dietitianScoutItems: rawParsed.scoutItems,
        itemsBreakdown: parsedData.itemsBreakdown,
      });
      ctx.addDebugLog('[MealBuild] modify-path');
      const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
        parsedData,
        jobId: ctx.req.body?.jobId,
        activeMeal: ctx.req.body?.activeMeal,
        scoutItems: updatedScoutItems,
        diningEnvironment: ctx.diningEnvironment,
      });
      if (ctx.portionClarify) {
        if (pendingFoodLog) (pendingFoodLog as any).portionClarify = ctx.portionClarify;
        parsedData.portionClarify = ctx.portionClarify;
      }
      // S-10: quantity resolutions ride along even when nothing was asked,
      // so "why didn't it ask" is answerable from the debug export.
      const quantityResolutionsA = (ctx as any).quantityResolutions;
      if (Array.isArray(quantityResolutionsA) && quantityResolutionsA.length > 0) {
        if (pendingFoodLog) (pendingFoodLog as any).quantityResolutions = quantityResolutionsA;
        (parsedData as any).quantityResolutions = quantityResolutionsA;
      }
      const finalMeal = pendingFoodLog || parsedData;
      const gate = evaluateMealGate(
        buildNewLogGateInput({
          finalMeal,
          jobId: ctx.req.body?.jobId,
          photoUrl: ctx.req.body?.photoUrl,
          imagePayloads: ctx.imagePayloads,
          narrative: rawParsed.message,
        })
      );
      return ctx.res.json({
        mode: 'modify',
        dietitianScratchpad: rawParsed._internalReasoning,
        text: rawParsed.message || `I have updated your meal to reflect the correction.`,
        message: rawParsed.message || `I have updated your meal to reflect the correction.`,
        data: pendingFoodLog || parsedData,
        pendingFoodLog: pendingFoodLog || parsedData,
        mealBuild,
        savable: gate.savable,
        gate,
        agentInstructions: { scout: ctx.scoutInstructionForDebug },
        scoutItems: updatedScoutItems,
        rawScout: ctx.rawScoutData,
        dispatches: ctx.accumulatedDispatches,
        apiCalls: ctx.apiCalls,
        portionClarify: ctx.portionClarify || null,
      });
    }

    const isResumedFromImageTurn = checkResumedFromImageTurn({
      body: ctx.req.body,
      visionScoutItems: ctx.visionScoutItems,
      history: ctx.history,
    });
    if (ctx.hasNoNewImages && !isResumedFromImageTurn && !parsedData.imageUrl && parsedData.name) {
      try {
        const cleanFoodQuery =
          parsedData.name.replace(/\d+\s*(g|grams|oz|lbs|kg|servings|pcs|pieces|slice|slices)?/gi, '').trim() || parsedData.name;
        ctx.addDebugLog(`[Text Search Image Lookup] Attempting auto image retrieval for text food "${cleanFoodQuery}" (from "${parsedData.name}")...`);
        const fetchedImgs = await retrieveFoodImages(cleanFoodQuery, { mode: 'light', count: 1 });
        if (fetchedImgs && fetchedImgs.length > 0 && fetchedImgs[0].imageUrl) {
          parsedData.imageUrl = fetchedImgs[0].imageUrl;
          parsedData.imageUrls = [fetchedImgs[0].imageUrl];
          ctx.addDebugLog(`[Text Search Image Lookup] Successfully attached retrieved image for "${parsedData.name}": ${parsedData.imageUrl}`);
        }
      } catch (imgErr: any) {
        ctx.addDebugLog(`[Text Search Image Lookup Error] ${imgErr?.message || imgErr}`);
      }
    }

    const finalScoutItems = mergeFinalScoutItems({
      visionScoutItems: ctx.visionScoutItems,
      dietitianScoutItems: rawParsed.scoutItems,
      preCalculatedItems: ctx.preCalculatedItems,
      itemsBreakdown: parsedData.itemsBreakdown,
    });
    ctx.addDebugLog('[MealBuild] happy-path');
    const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
      parsedData,
      jobId: ctx.req.body?.jobId,
      activeMeal: ctx.req.body?.activeMeal,
      scoutItems: finalScoutItems,
      diningEnvironment: ctx.diningEnvironment,
    });
    if (ctx.portionClarify) {
      if (pendingFoodLog) (pendingFoodLog as any).portionClarify = ctx.portionClarify;
      parsedData.portionClarify = ctx.portionClarify;
    }
    // S-10: quantity resolutions ride along even when nothing was asked.
    const quantityResolutionsB = (ctx as any).quantityResolutions;
    if (Array.isArray(quantityResolutionsB) && quantityResolutionsB.length > 0) {
      if (pendingFoodLog) (pendingFoodLog as any).quantityResolutions = quantityResolutionsB;
      (parsedData as any).quantityResolutions = quantityResolutionsB;
    }
    const finalMeal = pendingFoodLog || parsedData;
    const gate = evaluateMealGate(
      buildNewLogGateInput({
        finalMeal,
        jobId: ctx.req.body?.jobId,
        photoUrl: ctx.req.body?.photoUrl,
        imagePayloads: ctx.imagePayloads,
        narrative: rawParsed.message,
      })
    );
    const responsePayload = buildNewLogResponse({
      rawParsed,
      parsedData,
      pendingFoodLog,
      mealBuild,
      gate,
      scoutInternalReasoning: ctx.scoutInternalReasoning,
      rawScoutData: ctx.rawScoutData,
      scoutContentType: ctx.visionScoutContentType,
      diningEnvironment: ctx.diningEnvironment,
      agentInstructions: { scout: ctx.scoutInstructionForDebug },
      scoutItems: finalScoutItems,
      dispatches: ctx.accumulatedDispatches,
      apiCalls: ctx.apiCalls,
      portionClarify: ctx.portionClarify,
    });
    return ctx.res.json(responsePayload);
  }

  // CASE C: modification commands mode (Math Fallback)
  if (mode === 'modify') {
    ctx.addDebugLog(`[Mode Routing] MODIFY mode triggered (Math Fallback).`);
    const activeMeal = ctx.req.body?.activeMeal;
    if (!activeMeal) {
      ctx.addDebugLog(
        `[Modify Math Error] No active meal exists in Firestore to modify. jobId=${ctx.req.body?.jobId || 'n/a'} imageCount=${
          (ctx.imagePayloads && ctx.imagePayloads.length) || 0
        } message="${(ctx.message || '').substring(0, 80)}"`
      );
      return ctx.res.json(buildModifyNoMealResponse({ rawParsed, apiCalls: ctx.apiCalls }));
    }

    let editCommandsToApply = backfillEditCommandEstimates(rawParsed);
    const scoutTurnNumberForEdit = currentTurnNumber;
    const result = await applyMealEdits({
      items: Array.isArray(activeMeal.itemsBreakdown) ? activeMeal.itemsBreakdown : [],
      commands: Array.isArray(editCommandsToApply) ? editCommandsToApply : [],
      userMessage: ctx.message || '',
      scoutItems: ctx.visionScoutItems || ctx.preCalculatedItems || [],
      priorLocks: activeMeal?.userLockedSlots || [],
      turn: scoutTurnNumberForEdit,
    });
    for (const note of result.notes) ctx.addDebugLog(`[Single-Path Edit] ${note}`);
    if (Array.isArray((result as any).appliedCommands) && (result as any).appliedCommands.length > 0) {
      editCommandsToApply = (result as any).appliedCommands;
    }
    if (result.changed) {
      appendEditHistoryEntry({ activeMeal, message: ctx.message, result, onLog: ctx.addDebugLog });
    }
    activeMeal.itemsBreakdown = result.items;
    activeMeal.nutrients = result.nutrients;
    activeMeal.weightGrams = result.weightGrams;
    activeMeal.serving_grams = result.weightGrams;
    activeMeal.receiptTable = result.receiptTable;
    activeMeal.composition = result.items.map((it: any) => it.name).join(', ');
    const incomingTitle = resolveModifyIncomingTitle(activeMeal.name, rawParsed.foodData?.name);
    const resolvedTitle = resolveEditedMealTitle({ incomingTitle, items: result.items, editCommands: editCommandsToApply });
    if (resolvedTitle) activeMeal.name = resolvedTitle;

    const priorVerdict = activeMeal.verdict || ctx.req.body?.activeMeal?.verdict;
    const isHighSatFat = (result.nutrients?.saturatedFat || 0) >= 8;
    const isHighSodium = (result.nutrients?.sodium || 0) >= 1000;
    const isHighCalories = (result.nutrients?.calories || 0) >= 900;
    const shouldWarn = isHighSatFat || isHighSodium || isHighCalories;
    const priorLevel = priorVerdict?.level || 'neutral';
    const effectiveLevel = (priorLevel === 'warning' || priorLevel === 'alert') && shouldWarn ? priorLevel : rawParsed.verdict?.level || priorLevel;
    const effectiveRawLabel =
      rawParsed.verdict?.label || priorVerdict?.label || (effectiveLevel === 'warning' ? 'Elevated saturated fat impact' : 'Mindful balance');
    const sanitizedVerdictLabel = sanitizeVerdictLabel(effectiveRawLabel, effectiveLevel, result.nutrients, ctx.userProfile?.language);
    activeMeal.verdict = {
      label: sanitizedVerdictLabel,
      level: effectiveLevel,
    };

    const baseScoutItemsForEdit =
      activeMeal.scoutItems && activeMeal.scoutItems.length > 0
        ? activeMeal.scoutItems
        : ctx.req.body?.activeScoutItems && ctx.req.body.activeScoutItems.length > 0
        ? ctx.req.body.activeScoutItems
        : ctx.visionScoutItems || [];
    const syncedScoutItemsForEdit = syncEditScoutItems({ baseScoutItems: baseScoutItemsForEdit, resultItems: result.items });
    activeMeal.scoutItems = syncedScoutItemsForEdit;
    ctx.addDebugLog(`[ScoutSync] edit-path renamed scoutItems -> ${JSON.stringify(syncedScoutItemsForEdit.map((s: any) => s.originalName))}`);

    const rawMessage = result.qa ? rawParsed.message || 'Here is the detail on this meal.' : rawParsed.message || 'I have updated your meal.';

    const postEditSummary: any = {
      mealName: activeMeal.name,
      weightGrams: result.weightGrams,
      calories: result.nutrients.calories,
      protein: result.nutrients.protein,
      carbohydrates: result.nutrients.carbohydrates,
      totalFat: result.nutrients.totalFat,
      saturatedFat: result.nutrients.saturatedFat,
      addedSugar: result.nutrients.addedSugar,
      sugar: result.nutrients.sugar,
      sodium: result.nutrients.sodium,
      salt: result.nutrients.salt,
    };
    const finalMessage = reconcileMessageWithLedger(rawMessage, postEditSummary, ctx.userProfile?.language);

    activeMeal.message = finalMessage;
    activeMeal.healthImpact = finalMessage;

    ctx.addDebugLog('[MealBuild] edit-path (finalize executor)');
    if (Array.isArray((result as any).userLockedSlots)) {
      activeMeal.userLockedSlots = (result as any).userLockedSlots;
      ctx.addDebugLog(`[PatchLedger] userLockedSlots=${JSON.stringify(activeMeal.userLockedSlots)}`);
    }
    const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
      parsedData: activeMeal,
      jobId: ctx.req.body?.jobId,
      activeMeal: ctx.req.body?.activeMeal,
      scoutItems: syncedScoutItemsForEdit,
      diningEnvironment: activeMeal?.diningEnvironment,
    });
    mealBuild.staleDietitianNarrative = false;
    if (pendingFoodLog && Array.isArray(activeMeal.userLockedSlots)) {
      pendingFoodLog.userLockedSlots = activeMeal.userLockedSlots;
      (mealBuild as any).userLockedSlots = activeMeal.userLockedSlots;
    }
    if (ctx.req.body?.jobId && Array.isArray(activeMeal.userLockedSlots)) {
      const memJob = getInMemoryServerJob(String(ctx.req.body.jobId));
      if (memJob) {
        memJob.userLockedSlots = activeMeal.userLockedSlots;
        if (memJob.clean_result && typeof memJob.clean_result === 'object') {
          memJob.clean_result.userLockedSlots = activeMeal.userLockedSlots;
          if (memJob.clean_result.pendingFoodLog) {
            memJob.clean_result.pendingFoodLog.userLockedSlots = activeMeal.userLockedSlots;
          }
        }
        ctx.addDebugLog(`[PatchLedger] persisted ${activeMeal.userLockedSlots.length} lock(s) on job ${ctx.req.body.jobId}`);
      }
    }
    if (pendingFoodLog) {
      pendingFoodLog.itemsBreakdown = result.items;
      pendingFoodLog.items = result.items;
      pendingFoodLog.nutrients = result.nutrients;
      pendingFoodLog.weightGrams = result.weightGrams;
      if (activeMeal.date) pendingFoodLog.date = activeMeal.date;
    }
    const finalMeal = pendingFoodLog || activeMeal;
    const gate = evaluateMealGate(
      buildGateInput({
        finalMeal,
        jobId: ctx.req.body?.jobId,
        photoUrl: ctx.req.body?.photoUrl,
        imagePayloads: ctx.imagePayloads,
        finalMessage,
        previousMeal: ctx.req.body?.activeMeal,
        editCommands: editCommandsToApply,
      })
    );

    const expertTurn = currentTurnNumber;
    const effectiveEditCommands =
      Array.isArray((result as any).appliedCommands) && (result as any).appliedCommands.length > 0
        ? (result as any).appliedCommands
        : Array.isArray(editCommandsToApply)
        ? editCommandsToApply
        : [];
    const expertDispatch = buildEditExpertDispatch({
      turn: expertTurn,
      userMessage: ctx.message || '',
      finalMessage,
      editCommands: effectiveEditCommands,
      items: result.items,
      nutrients: result.nutrients,
      verdict: activeMeal.verdict || rawParsed.verdict || null,
      skipped: false,
      model: 'projector',
    });
    ctx.accumulatedDispatches.push(expertDispatch);
    ctx.sendLog('dietitian_answer', 'dietitian', finalMessage, {
      mode: 'modify',
      turn: expertTurn,
      editApplied: result.changed,
    });
    ctx.addDebugLog(`[PatchLedger] expert dispatch t${expertTurn}/dietitian recorded (edit parity).`);

    return ctx.res.json(
      buildModifyResponse({
        rawParsed,
        finalMessage,
        pendingFoodLog,
        activeMeal,
        mealBuild,
        gate,
        editApplied: result.changed,
        agentInstructions: { scout: ctx.scoutInstructionForDebug },
        scoutItems: syncedScoutItemsForEdit,
        rawScoutData: ctx.rawScoutData,
        dispatches: ctx.accumulatedDispatches,
        apiCalls: ctx.apiCalls,
      })
    );
  }
}
