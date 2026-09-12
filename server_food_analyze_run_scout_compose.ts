import { AnalyzeRunContext } from './server_food_analyze_run_types.js';
import {
  computeDietitianSkipGates,
  isAcceptDefaultsWithinTolerance,
  composeAcceptDefaultsParsed,
  decideScoutVerdict,
  decideScoutAdvice,
  buildPureScaleResponse,
  sumPrecalcTotals,
  buildCreateSkipResponse,
  resolveCreateMealTitle,
} from './src/server/food/server_food_dietitian_dispatch.js';
import { getCurrentDateInTimezone } from './src/utils/dateUtils.js';
import { interpolate, t } from './src/utils/i18n.js';
import { diffScoutToEditCommands } from './server_edit_patch_ledger.js';
import { normalizeParsedPostDietitian } from './src/server/food/server_food_mode_routing.js';
import { applyServerAverageNutrients, enrichBilingualItemName } from './server_pure_helpers.js';

/**
 * Scout compose phase (single Meal Agent owns response composition).
 *
 * Formerly the projector phase in the deleted dietitian owner file.
 * There is no dietitian and no narrator: every branch below is pure TypeScript
 * composing rawParsed from scout outputs + the math engine. No narrator
 * dispatch is emitted anywhere; the scout leg is the only dispatch.
 */
export async function executeScoutComposePhase(ctx: AnalyzeRunContext): Promise<{ textOutput: string; rawParsed: any }> {
  let textOutput: string = '';
  let rawParsed: any;

  const { canSkipDietitianForPureScale } = computeDietitianSkipGates({
    isPureWeightModification: ctx.isPureWeightModification,
    activeMeal: ctx.activeMeal,
    userSelectedMode: ctx.userSelectedMode,
    weightRefineIntent: ctx.weightRefineIntent,
    message: ctx.message,
  });

  if (canSkipDietitianForPureScale && ctx.weightRefineIntent.isRefine && ctx.weightRefineIntent.weightGrams) {
    const targetWeight = ctx.weightRefineIntent.weightGrams;
    ctx.addDebugLog(`[Refine] skip-agent: Scaled label-locked meal directly to ${targetWeight}g without LLM call.`);
    ctx.sendStreamEvent({
      type: 'status',
      stage: 'finalize',
      status: 'completed',
      message: interpolate(t(ctx.userProfile?.language, 'statusScaledPortion'), { grams: targetWeight }),
    });
    const pureScale = buildPureScaleResponse({ targetWeightGrams: targetWeight, language: ctx.userProfile?.language });
    textOutput = pureScale.textOutput;
    rawParsed = pureScale.rawParsed;
  } else if (
    isAcceptDefaultsWithinTolerance({
      portionChoices: ctx.req.body.portionChoices,
      scoutItems: ctx.visionScoutItems,
      isResume: Boolean(ctx.req.body.skipScout || ctx.req.body.portionChoices),
    })
  ) {
    ctx.addDebugLog('[Accept] portion choices within 30% of estimates: composing from ledger without LLM call.');
    ctx.sendStreamEvent({ type: 'status', stage: 'finalize', status: 'completed', message: 'Meal analysis finalized.' });
    const acceptMealName =
      ctx.activeMeal?.name ||
      ctx.visionScoutItems.map((v: any) => v?.keyword || v?.originalName || v?.name).filter(Boolean).slice(0, 3).join(', ') ||
      undefined;
    const acceptParsed = composeAcceptDefaultsParsed({
      items: ctx.visionScoutItems,
      mealName: acceptMealName,
      language: ctx.userProfile?.language,
      targets: ctx.req.body.dailyNutrientTargets,
      foodLogs: ctx.req.body.foodLogs,
      todayStr: getCurrentDateInTimezone(ctx.userProfile?.timezone),
    });
    textOutput = JSON.stringify(acceptParsed);
    rawParsed = acceptParsed;
  } else if (ctx.visionScoutRanAndReturnedItems || (ctx.visionScoutItems && ctx.visionScoutItems.length > 0) || ctx.rawScoutData) {
    // Empty arrays are truthy — require NON-EMPTY compare content, otherwise
    // a zero-extraction scout run falls into this path and ships an empty
    // comparison with an ungrounded recommendation (Mode D empty bug).
    const compareContentCount = (ctx.rawScoutData?.groups?.length || 0)
      + (ctx.rawScoutData?.items?.length || 0)
      + (ctx.rawScoutData?.allExtractedDishes?.length || 0);
    if (ctx.userSelectedMode === 'compare' && (ctx.rawScoutData?.comparisonTitle || compareContentCount > 0)) {
      ctx.addDebugLog('[MealAgent] Single-agent compare path: using Scout comparison directly without secondary LLM call.');
      ctx.sendStreamEvent({ type: 'status', stage: 'finalize', status: 'completed', message: 'Comparison analysis finalized.' });
      const enrichedGroups = applyServerAverageNutrients(ctx.rawScoutData.groups || [], {});
      const enrichedItems = (ctx.rawScoutData.items || ctx.visionScoutItems || []).map((it: any) => {
        const name = it.name || it.originalName || '';
        return {
          ...it,
          name: enrichBilingualItemName(name),
        };
      });
      // Never emit a NAMED recommendation with nothing behind it: an
      // ungrounded product name is worse than an honest empty state.
      const recOption = compareContentCount > 0
        ? (ctx.rawScoutData.recommendedOption
          ? enrichBilingualItemName(ctx.rawScoutData.recommendedOption)
          : (enrichedGroups[0]?.items?.[0]?.name || enrichedGroups[0]?.groupName || 'Recommended Choice'))
        : null;
      rawParsed = {
        _internalReasoning: ctx.scoutInternalReasoning || '[MealAgent] Single-agent compare path',
        mode: 'evaluation',
        message: compareContentCount > 0
          ? (ctx.rawScoutData.summary || ctx.rawScoutData.message || ctx.rawScoutData.clinicalAdvice || 'Here is the product evaluation.')
          : t(ctx.userProfile?.language, 'compareEmptyExtraction'),
        comparison: {
          comparisonTitle: ctx.rawScoutData.comparisonTitle,
          comparisonType: ctx.rawScoutData.comparisonType,
          summary: ctx.rawScoutData.summary,
          recommendedOption: recOption,
          items: enrichedItems,
          groups: enrichedGroups,
        },
        items: enrichedItems,
        scoutItems: ctx.visionScoutItems,
      };
      textOutput = JSON.stringify(rawParsed);
    } else if (ctx.isModifySession) {
      ctx.addDebugLog('[MealAgent] Single-agent edit path: diffing Scout output into active meal.');
      ctx.sendStreamEvent({ type: 'status', stage: 'finalize', status: 'completed', message: 'Meal update finalized.' });
      const scoutDishes = (ctx.rawScoutData?.dishes && Array.isArray(ctx.rawScoutData.dishes))
        ? ctx.rawScoutData.dishes
        : (ctx.visionScoutItems || []);
      const priorItems = Array.isArray(ctx.activeMeal?.itemsBreakdown) ? ctx.activeMeal.itemsBreakdown : (ctx.activeMeal?.items || []);
      const editCommands = diffScoutToEditCommands({
        priorItems,
        scoutItems: scoutDishes,
        userMessage: ctx.message,
        portionChoices: (ctx.req.body as any)?.portionChoices,
      });
      const totals = sumPrecalcTotals(priorItems);
      const scoutVerdict = decideScoutVerdict({
        scoutVerdict: ctx.rawScoutData?.verdict || null,
        totals,
        mealName: ctx.activeMeal?.name,
        language: ctx.userProfile?.language,
      });
      const rawAdvice = decideScoutAdvice({
        rawAdvice: ctx.rawScoutData?.clinicalAdvice || ctx.rawScoutData?.message || '',
        totals,
        mealName: ctx.activeMeal?.name,
        language: ctx.userProfile?.language,
      });
      const systemCurrentDate = new Date().toISOString().split('T')[0];
      const mealDate = (ctx.isModifySession && ctx.activeMeal?.date)
        ? ctx.activeMeal.date
        : (ctx.imageDates?.[0] ? ctx.imageDates[0].split('T')[0] : systemCurrentDate);
      rawParsed = {
        _internalReasoning: ctx.scoutInternalReasoning || '[MealAgent] Single-agent edit path',
        mode: 'modify',
        message: rawAdvice || 'I have updated your meal.',
        verdict: scoutVerdict,
        modificationCommand: editCommands,
        foodData: {
          name: ctx.activeMeal?.name,
          date: mealDate,
        },
      };
      textOutput = JSON.stringify(rawParsed);
    } else {
      ctx.addDebugLog('[MealAgent] Single-agent create path: using Scout verdict & clinical advice with finalized ledger.');
      ctx.sendStreamEvent({ type: 'status', stage: 'finalize', status: 'completed', message: 'Meal analysis finalized.' });
      const totals = sumPrecalcTotals(ctx.preCalculatedItems);
      const scoutVerdict = decideScoutVerdict({
        scoutVerdict: ctx.rawScoutData?.verdict || null,
        totals,
        mealName: resolveCreateMealTitle(ctx.rawScoutData, ctx.visionScoutItems, ctx.userProfile?.language),
        language: ctx.userProfile?.language,
      });
      const rawAdvice = decideScoutAdvice({
        rawAdvice: ctx.rawScoutData?.clinicalAdvice || ctx.rawScoutData?.message || '',
        totals,
        mealName: resolveCreateMealTitle(ctx.rawScoutData, ctx.visionScoutItems, ctx.userProfile?.language),
        language: ctx.userProfile?.language,
      });
      const createSkip = buildCreateSkipResponse({
        rawScoutData: ctx.rawScoutData,
        visionScoutItems: ctx.visionScoutItems,
        preCalculatedItems: ctx.preCalculatedItems,
        totals,
        scoutVerdict,
        rawAdvice,
        scoutConfidenceRating: ctx.scoutConfidenceRating,
        scoutConfidenceComment: ctx.scoutConfidenceComment,
        scoutCookingMethod: ctx.scoutCookingMethod,
        scoutInternalReasoning: ctx.scoutInternalReasoning,
        diningEnvironment: ctx.diningEnvironment,
        language: ctx.userProfile?.language,
      });
      textOutput = createSkip.textOutput;
      rawParsed = createSkip.rawParsed;
    }
  } else {
    ctx.addDebugLog('[MealAgent] Fallback projector: finalizing empty/text response from available ledger.');
    const totals = sumPrecalcTotals(ctx.preCalculatedItems || []);
    const scoutVerdict = decideScoutVerdict({
      scoutVerdict: ctx.rawScoutData?.verdict || null,
      totals,
      mealName: resolveCreateMealTitle(ctx.rawScoutData, ctx.visionScoutItems || [], ctx.userProfile?.language),
      language: ctx.userProfile?.language,
    });
    const rawAdvice = decideScoutAdvice({
      rawAdvice: ctx.rawScoutData?.clinicalAdvice || ctx.rawScoutData?.message || '',
      totals,
      mealName: resolveCreateMealTitle(ctx.rawScoutData, ctx.visionScoutItems || [], ctx.userProfile?.language),
      language: ctx.userProfile?.language,
    });
    const createSkip = buildCreateSkipResponse({
      rawScoutData: ctx.rawScoutData,
      visionScoutItems: ctx.visionScoutItems || [],
      preCalculatedItems: ctx.preCalculatedItems || [],
      totals,
      scoutVerdict,
      rawAdvice,
      scoutConfidenceRating: ctx.scoutConfidenceRating,
      scoutConfidenceComment: ctx.scoutConfidenceComment,
      scoutCookingMethod: ctx.scoutCookingMethod,
      scoutInternalReasoning: ctx.scoutInternalReasoning,
      diningEnvironment: ctx.diningEnvironment,
      language: ctx.userProfile?.language,
    });
    textOutput = createSkip.textOutput;
    rawParsed = createSkip.rawParsed;
  }

  if (rawParsed._internalReasoning) {
    ctx.addDebugLog(`[MealAgent Internal Reasoning]\n${rawParsed._internalReasoning}`);
  }
  ctx.sendStreamEvent({ type: 'status', stage: 'finalize', status: 'completed', message: 'Meal analysis finalized.' });

  normalizeParsedPostDietitian({
    rawParsed,
    isExplicitModify: ctx.isExplicitModify,
    userSelectedMode: ctx.userSelectedMode,
    visionScoutItems: ctx.visionScoutItems,
  });

  return { textOutput, rawParsed };
}

