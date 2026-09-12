import { AnalyzeRunContext } from './server_food_analyze_run_types.js';
import { runScoutRetryLoop, applyScoutResultState, mergeScoutIntoActiveMeal, logScoutItemSummaries, logScoutImageInventory, applyWeightModShortcut, applySkipScoutShortcut, buildScoutFailureError, mapCompareItemsToScoutItems, countCompareExtracted } from './src/server/food/server_food_scout_source.js';
import { scoutSystemInstruction, buildVisualScoutPrompt, buildScoutPersonalizationBlock } from './agents/scoutInstructions.js';
import { scoutOnlyCompareSystemInstruction, buildScoutComparePrompt } from './prototype/meallog/compare/scout_only_compare_instructions.js';
import { withScoutLanguage } from './src/utils/i18n.js';
import { formatLockedSlotsForPrompt } from './server_edit_patch_ledger.js';
import { buildNutritionTargetStatus, pickExplicitTargets } from './src/utils/nutritionTargetStatus.js';
import { getCurrentDateInTimezone } from './src/utils/dateUtils.js';

export async function executeScoutPhase(ctx: AnalyzeRunContext): Promise<void> {
  if (ctx.compareOnly) {
    ctx.addDebugLog(`[Shortcut] Compare mode detected. Skipping Vision Scout and DB Search.`);
    if (ctx.compareItems && ctx.compareItems.length > 0) {
      ctx.visionScoutItems = mapCompareItemsToScoutItems(ctx.compareItems);
    }
  } else {
    let skipScoutApplied = false;
    if (ctx.req.body.skipScout || ctx.req.body.portionChoices) {
      const skipOut = applySkipScoutShortcut({
        body: ctx.req.body, history: ctx.history, activeMeal: ctx.activeMeal, onLog: ctx.addDebugLog,
      });
      if (skipOut.ran) {
        ctx.visionScoutItems = skipOut.visionScoutItems;
        ctx.visionScoutContentType = skipOut.visionScoutContentType;
        if (skipOut.diningEnvironment) ctx.diningEnvironment = skipOut.diningEnvironment;
        ctx.visionScoutRanAndReturnedItems = true;
        logScoutItemSummaries(ctx.visionScoutItems, ctx.addDebugLog);
        skipScoutApplied = true;
      }
    }
    if (!skipScoutApplied && ctx.isWeightModification && ctx.visionScoutItems.length > 0) {
      const weightModOut = applyWeightModShortcut({
        activeScoutItems: ctx.visionScoutItems, portionChoices: ctx.req.body.portionChoices,
        weightRefineIntent: ctx.weightRefineIntent, scoutContentType: ctx.req.body.scoutContentType,
        refineDecision: ctx.refineDecision, priorScoutForRefine: ctx.visionScoutItems,
        imagePayloads: ctx.imagePayloads, onLog: ctx.addDebugLog,
      });
      if (weightModOut.ran) {
        ctx.visionScoutItems = weightModOut.visionScoutItems; ctx.visionScoutContentType = weightModOut.visionScoutContentType;
        ctx.visionScoutRanAndReturnedItems = true; logScoutItemSummaries(ctx.visionScoutItems, ctx.addDebugLog); skipScoutApplied = true;
      }
    }
    if (!skipScoutApplied) {
      const hasImage = ctx.imagePayloads && ctx.imagePayloads.length > 0;
      const isEditOrText = Boolean(ctx.message || ctx.isModifySession || ctx.hasActiveMealDocument);
      if (hasImage || isEditOrText) {
        ctx.sendStreamEvent({ type: 'status', stage: 'scout', status: 'started', message: ctx.isModifySession ? 'Refining meal with Scout agent...' : 'Reading your photos...' });
        const imageCount = ctx.imagePayloads?.length || 0; let scoutPromptText = '';
        if (ctx.isModifySession && (ctx.activeMeal || (ctx.req.body.activeScoutItems && ctx.req.body.activeScoutItems.length > 0))) {
          const priorMealItems = ctx.activeMeal?.itemsBreakdown || ctx.activeMeal?.items || ctx.req.body.activeScoutItems || [];
          const priorSummary = priorMealItems.map((it: any, idx: number) => {
            const photoLabel = it.sourceImageIndex != null ? ` [Photo #${it.sourceImageIndex}]` : '';
            const comps = it.components || it.foods || it.componentsDetailList || [];
            const compStr = Array.isArray(comps) && comps.length > 0 ? comps.map((c: any) => c.foodName || c.name || c.searchQuery || c.keyword || '').filter(Boolean).join(', ') : '';
            return `Dish ${idx + 1}${photoLabel}: ${it.originalName || it.keyword || it.name || 'Dish'} (${it.estimatedWeightGrams || it.weightGrams || 100}g)${compStr ? ` [Ingredients: ${compStr}]` : ''}`;
          }).join('; ');
          const lockPrompt = formatLockedSlotsForPrompt(ctx.activeMeal?.userLockedSlots);
          const mealDate = (ctx.isModifySession && ctx.activeMeal?.date) ? ctx.activeMeal.date : (ctx.imageDates?.[0] ? ctx.imageDates[0].split('T')[0] : new Date().toISOString().split('T')[0]);
          scoutPromptText = `The user is modifying/refining an existing logged meal.\n` + `MEAL DATE: ${mealDate}\n` + `User modification instruction: "${(ctx.message || '').trim()}".\n` + `Prior Meal Dishes: ${priorSummary}.\n` + (lockPrompt || '') + `\n` + `CRITICAL INSTRUCTIONS FOR MODIFICATION:\n` + `1. TARGETED UPDATE (DISH OR SUBITEM): Output only modified or new items. Support action "replace" | "add" | "delete" at dish or foods[] subitem level.\n` + `- For new or edited dishes: populate full nutrients amount (protein, carbs, fat, sodium, sugar, fibre) the same way you populate a new item.\n` + `- For dishes: set dish action "replace" | "add" | "delete" with replacesDish and/or targetDishIndex. Always include sourceImageIndex.\n` + `- For subitems/components inside a dish: in foods[], set action "replace" | "add" | "delete", replacesFood, full nutrients, and sourceImageIndex.\n` + `2. FULL NUTRIENT VALUES: Always provide complete, accurate nutrients for any new or edited dish or food component.\n` + `3. SEPARATE DISHES: Keep distinct plated items, sides, and beverages as separate distinct dishes in dishes[]. Never merge drinks into food dishes.\n` + `4. CLINICAL ADVICE & NARRATIVE: Provide an updated direct 35-70 word clinicalAdvice in 2nd person ("You got...") on the FULL updated meal (all dishes at their locked weights — never just the edited item). Lead with the most significant finding: flag plainly any nutrient far over budget and compounding against the 7-day average, state the health impact, then one actionable next step/movement.`;
        } else if (ctx.userSelectedMode === 'compare') {
          scoutPromptText = buildScoutComparePrompt(ctx.message || '', imageCount, {
            biomarkersNeedingImprovement: ctx.biomarkersNeedingImprovement || ctx.userProfile?.topNutrientsToMonitor,
            remainingAllowance: ctx.remainingAllowance || ctx.userProfile?.threeDayExcesses || ctx.req.body?.dailyNutrientTargets || undefined,
          });
        } else {
          scoutPromptText = buildVisualScoutPrompt(ctx.message || '', imageCount, false);
        }
        const scoutPersonalization = buildScoutPersonalizationBlock({ biomarkersNeedingImprovement: ctx.biomarkersNeedingImprovement });
        const nutritionTargetStatus = buildNutritionTargetStatus({ logs: ctx.req.body.foodLogs, targets: pickExplicitTargets(ctx.req.body.dailyNutrientTargets), todayStr: getCurrentDateInTimezone(ctx.userProfile?.timezone) });
        const resolvedScoutSystemInstruction = (ctx.userSelectedMode === 'compare'
          ? withScoutLanguage(scoutOnlyCompareSystemInstruction, ctx.userProfile?.language)
          : withScoutLanguage(scoutSystemInstruction, ctx.userProfile?.language))
          + (scoutPersonalization ? `\n${scoutPersonalization}` : '')
          + (nutritionTargetStatus ? `\n${nutritionTargetStatus}` : '');
        ctx.scoutInstructionForDebug = { systemInstruction: resolvedScoutSystemInstruction, userPrompt: scoutPromptText };
        ctx.sendLog('scout_instruction', 'scout', `Vision Scout Instruction dispatched (model: ${ctx.engine || "gemini-3.5-flash-lite"}). Prompt length: ${scoutPromptText.length} chars — see [UnifiedLLM-Prompt:scout] below for full text.`);
        ctx.sendLog('scout_system_instruction', 'scout', `Vision Scout System Instruction dispatched (model: ${ctx.engine || "gemini-3.5-flash-lite"}) — see [UnifiedLLM-Prompt:scout] below for full text.`);
        ctx.addDebugLog(`[Vision Scout] Running Stage 3 lightweight vision scout with retry protection...`);
        const scoutLegStartMs = Date.now();
        let { scoutResult, lastScoutErr } = await runScoutRetryLoop({
          engine: ctx.engine, language: ctx.userProfile?.language, scoutPromptText, imagePayloads: ctx.imagePayloads,
          isCompare: ctx.userSelectedMode === 'compare', systemInstruction: resolvedScoutSystemInstruction, message: ctx.message, callUnifiedLLM: ctx.callUnifiedLLM,
          sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), onLog: ctx.addDebugLog,
          onStreamChunk: (chunk: string, isThought?: boolean) => {
            if (ctx.isStream && ctx.hasSentHeaders) {
              try {
                ctx.res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'scout' })}\n\n`);
                if (typeof (ctx.res as any).flush === 'function') (ctx.res as any).flush();
              } catch (e) {}
            }
          },
        });
        if (!scoutResult) {
          ctx.addDebugLog(`[Vision Scout Failed Permanently] Both attempts failed. Last error: ${lastScoutErr?.message}`);
          throw buildScoutFailureError(lastScoutErr, ctx.userProfile?.language);
        }
        const scoutState = applyScoutResultState({
          scoutResult, requestedMode: ctx.req.body.userSelectedMode, hasActiveMealDocument: ctx.hasActiveMealDocument,
          activeMealDining: ctx.activeMeal?.diningEnvironment, currentRecommendedMode: ctx.scoutRecommendedMode,
          onLog: ctx.addDebugLog, onEvent: (type, stage, message, data) => ctx.sendLog(type, stage, message, data),
          onStream: (event) => ctx.sendStreamEvent(event),
        });
        const applyState = (st: ReturnType<typeof applyScoutResultState>) => {
          ctx.scoutInternalReasoning = st.scoutInternalReasoning; ctx.rawScoutData = st.rawScoutData;
          ctx.visionScoutItems = st.visionScoutItems; ctx.scoutConfidenceRating = st.scoutConfidenceRating;
          ctx.scoutConfidenceComment = st.scoutConfidenceComment; ctx.scoutCookingMethod = st.scoutCookingMethod;
          ctx.visionScoutContentType = st.visionScoutContentType; ctx.diningEnvironment = st.diningEnvironment;
          ctx.scoutRecommendedMode = st.scoutRecommendedMode; ctx.queriesToSearch.push(...st.queriesToSearch);
          ctx.scoutOriginalQueries.push(...st.queriesToSearch); ctx.visionScoutRanAndReturnedItems = st.visionScoutRanAndReturnedItems;
        };
        applyState(scoutState);
        // Mode D empty-extraction guard: a photo compare that extracts zero
        // products must retry once with a strengthened prompt, then fail
        // loudly (Retry visible) — never ship an empty comparison with an
        // ungrounded recommendation.
        if (ctx.userSelectedMode === 'compare' && hasImage
          && countCompareExtracted(ctx.rawScoutData, ctx.visionScoutItems) === 0) {
          ctx.addDebugLog(`[Vision Scout Empty Compare] Zero products extracted from ${imageCount} image(s) — retrying once with strengthened extraction prompt.`);
          ctx.sendStreamEvent({ type: 'status', stage: 'scout', status: 'started', message: 'Reading your photos...' });
          const strengthenedPrompt = `${scoutPromptText}\n\nCRITICAL RETRY: Your previous response listed ZERO products, but the photo(s) clearly show legible packaged products, labels, or menu dishes. Transcribe EVERY legible product or dish name into 'allExtractedDishes' AND 'items' — an empty extraction is a failure. Do not summarize without listing.`;
          const retryOut = await runScoutRetryLoop({
            engine: ctx.engine, language: ctx.userProfile?.language, scoutPromptText: strengthenedPrompt, imagePayloads: ctx.imagePayloads,
            isCompare: true, systemInstruction: resolvedScoutSystemInstruction, message: ctx.message, callUnifiedLLM: ctx.callUnifiedLLM,
            sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), onLog: ctx.addDebugLog,
            onStreamChunk: (chunk: string, isThought?: boolean) => {
              if (ctx.isStream && ctx.hasSentHeaders) {
                try {
                  ctx.res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'scout' })}\n\n`);
                  if (typeof (ctx.res as any).flush === 'function') (ctx.res as any).flush();
                } catch (e) {}
              }
            },
          });
          if (retryOut.scoutResult) {
            applyState(applyScoutResultState({
              scoutResult: retryOut.scoutResult, requestedMode: ctx.req.body.userSelectedMode, hasActiveMealDocument: ctx.hasActiveMealDocument,
              activeMealDining: ctx.activeMeal?.diningEnvironment, currentRecommendedMode: ctx.scoutRecommendedMode,
              onLog: ctx.addDebugLog, onEvent: (type, stage, message, data) => ctx.sendLog(type, stage, message, data),
              onStream: (event) => ctx.sendStreamEvent(event),
            }));
          }
          if (countCompareExtracted(ctx.rawScoutData, ctx.visionScoutItems) === 0) {
            ctx.addDebugLog(`[Vision Scout Empty Compare] Retry still extracted zero products — failing loudly so Retry stays visible.`);
            throw buildScoutFailureError(new Error('Vision Scout Empty Compare: no legible products extracted from photo(s) after retry'), ctx.userProfile?.language);
          }
          ctx.addDebugLog(`[Vision Scout Empty Compare] Retry recovered ${countCompareExtracted(ctx.rawScoutData, ctx.visionScoutItems)} extracted evidence item(s).`);
        }
        if (ctx.hasActiveMealDocument && Array.isArray(ctx.activeMeal.itemsBreakdown) && ctx.activeMeal.itemsBreakdown.length > 0) {
          ctx.visionScoutItems = mergeScoutIntoActiveMeal({ activeMealItemsBreakdown: ctx.activeMeal.itemsBreakdown, visionScoutItems: ctx.visionScoutItems, onLog: ctx.addDebugLog, isModify: ctx.isModifySession, userLockedSlots: ctx.activeMeal?.userLockedSlots, userMessage: ctx.message });
        }
        logScoutItemSummaries(ctx.visionScoutItems, ctx.addDebugLog);
        logScoutImageInventory({ perImage: (ctx.rawScoutData as any)?.perImage, imageCount: ctx.imagePayloads?.length || 0, items: ctx.visionScoutItems, onLog: ctx.addDebugLog });
        // S-10: record the scout leg in the run tree (system instruction as
        // dispatched, model, latency, output). Scout is the sole Meal Agent
        // dispatch and carries rawEmission (dishes, verdict, clinicalAdvice).
        const scoutLegs = ctx.accumulatedDispatches.filter((d: any) => d?.agent === 'scout').length;
        const scoutTurn = scoutLegs + 1;
        const scoutModel =
          (typeof ctx.engine === 'object' ? (ctx.engine as any)?.name || (ctx.engine as any)?.model : ctx.engine) ||
          'gemini-3.5-flash-lite';
        ctx.accumulatedDispatches.push({
          id: `t${scoutTurn}/scout`,
          parent: null,
          turn: scoutTurn,
          agent: 'scout',
          user: ctx.message && ctx.message.trim() ? ctx.message.trim() : (hasImage ? 'Analyze this meal photo.' : 'Text meal entry'),
          received: { mode: ctx.userSelectedMode || 'new_log' },
          systemInstruction: resolvedScoutSystemInstruction,
          userPrompt: scoutPromptText,
          instruction: [
            `=== SYSTEM INSTRUCTION ===\n${resolvedScoutSystemInstruction}`,
            `=== USER PROMPT ===\n${scoutPromptText}`,
          ].join('\n\n'),
          output: ctx.rawScoutData,
          rawEmission: ctx.rawScoutData,
          model: scoutModel,
          latency_ms: Date.now() - scoutLegStartMs,
          error: null,
        });
        ctx.emitStageUsage('scout');
      }
    }
  }
}
