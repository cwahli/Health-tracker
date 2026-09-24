/**
 * F-8.10 shard 9 — scout item sourcing, extracted verbatim from
 * runFoodAnalyze. Decides where visionScoutItems come from when no fresh
 * vision dispatch runs: active-meal inherit, compare mapper, or prior-run
 * (skipScout / portionChoices / history fallback) resolution.
 */

import { getFallbackCategoryProfile } from '../../../server_food_catalog.js';
import { isPackagedBindItem, inferChainNameFromPackageLabel } from '../../../server_brand_match.js';
import { userSafeScoutFailureMessage, parseAndHealVisionScout } from '../../../server_vision_scout.js';
import { isGeminiQuotaError, isGeminiUnavailableError, nextGeminiFallbackEngine } from '../../../server_gemini_retry.js';
import { t, withScoutLanguage } from '../../utils/i18n.js';
import { extractFoodSearchQueriesFromText } from './server_food_analyze_helpers.js';
import { scoutSystemInstruction } from '../../../agents/scoutInstructions.js';
import { scoutOnlyCompareSystemInstruction } from '../../../prototype/meallog/compare/scout_only_compare_instructions.js';
import { enrichBilingualItemName } from '../../../server_pure_helpers.js';
import { visionScoutResponseSchema, scoutOnlyCompareResponseSchema } from './server_food_analyze_schema.js';
import { applyPortionChoices } from '../../../server_portion_clarify.js';
import {
  applyWeightRefineToScoutItems,
  priorScoutHasLabelLocks,
  REFINE_SCALE_ONLY_LOG,
} from '../../../server_refine_scale.js';
import { applyUserLockedSlots, namesShareSubstance, type UserLockedSlot } from '../../../server_edit_patch_ledger.js';

export interface ScoutInheritArgs {
  isModifySession: boolean;
  visionScoutItems: any[];
  activeMeal: any;
  onLog: (msg: string) => void;
}

/** Inherits finalize-shaped items from the active meal as scout items for edits. */
export function inheritActiveMealScoutItems(args: ScoutInheritArgs): {
  items: any[];
  ran: boolean;
} {
  const { isModifySession, visionScoutItems, activeMeal, onLog } = args;
  if (isModifySession && visionScoutItems.length === 0 && activeMeal) {
    const activeList = Array.isArray(activeMeal.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0
      ? activeMeal.itemsBreakdown
      : (Array.isArray(activeMeal.items) ? activeMeal.items : []);
    if (activeList.length > 0) {
      const items = activeList.map((it: any, idx: number) => {
        const sIdx = it.scoutIndex !== undefined && it.scoutIndex !== null ? it.scoutIndex : idx;
        it.scoutIndex = sIdx; // Mutate the original activeMeal item to ensure it matches by scoutIndex during consolidation
        return {
          itemId: it.itemId || it.id || undefined,
          scoutIndex: sIdx,
          originalName: it.originalName || it.canonicalDbName || it.name || "Food Item",
          keyword: it.keyword || it.canonicalDbName || it.originalName || it.name,
          estimatedWeightGrams: Number(it.weightGrams) || 100,
          nutrientBasisWeight: Number(it.weightGrams) || 100,
          nutrients: it.nutrients || it.truthNutrients || null,
          lockedNutrientKeys: it.lockedNutrientKeys || [],
          _alreadyFinalized: Boolean(it.nutrients && (it.lockedNutrientKeys?.length || it.dbSource === 'label' || it.dbSource === 'usda_direct_hint')),
          cookingMethod: it.cookingMethod || 'raw',
          ingredients: it.ingredients || (it.ingredientsList ? String(it.ingredientsList).split(',').map((s: string) => s.trim()) : []),
          visualIngredients: it.visualIngredients || [],
          rawNutritionLabel: it.rawNutritionLabel || null,
          chainName: it.chainName || null,
          dbSource: it.dbSource || 'estimated',
          dbId: it.dbId || null,
          boundingBox2D: it.boundingBox2D || null,
          sourceImageIndex: it.sourceImageIndex ?? 0,
          componentsDetailList: it.componentsDetailList || [],
          components: it.components || [],
          hasComponents: it.hasComponents || false,
        };
      });
      onLog(`[Edit Continuity] Inherited ${items.length} items from activeMeal into visionScoutItems for edit.`);
      return { items, ran: true };
    }
  }
  return { items: visionScoutItems, ran: false };
}

/** Maps compare-mode item names to scout-shaped rows. */
export function mapCompareItemsToScoutItems(compareItems: any): any[] {
  return (compareItems || []).map((name: string, index: number) => ({
    scoutIndex: index,
    keyword: name,
    originalName: name,
    estimatedWeightGrams: 100,
    source: "compare_request"
  }));
}

export interface PriorScoutArgs {
  body: any;
  history: any;
  activeMeal: any;
}

/** Resolves prior-run scout items across activeScoutItems / scoutItems / meal / history. */
export function resolvePriorScoutItems(args: PriorScoutArgs): any[] {
  const { body, history, activeMeal } = args;
  let priorScout = (Array.isArray(body.activeScoutItems) && body.activeScoutItems.length > 0)
    ? body.activeScoutItems
    : ((Array.isArray(body.scoutItems) && body.scoutItems.length > 0)
      ? body.scoutItems
      : (Array.isArray(activeMeal?.scoutItems) && activeMeal.scoutItems.length > 0
        ? activeMeal.scoutItems
        : (Array.isArray(activeMeal?.itemsBreakdown) && activeMeal.itemsBreakdown.length > 0
          ? activeMeal.itemsBreakdown
          : (Array.isArray(activeMeal?.items) && activeMeal.items.length > 0
            ? activeMeal.items
            : []))));
  if (priorScout.length === 0 && Array.isArray(history) && history.length > 0) {
    // Fallback: search history messages for scoutItems or portionClarify items
    const clarifyMsg = [...history].reverse().find((m: any) =>
      (m.data?.scoutItems && m.data.scoutItems.length > 0) ||
      (m.data?.portionClarify?.scoutItems && m.data.portionClarify.scoutItems.length > 0) ||
      (m.data?.portionClarify?.items && m.data.portionClarify.items.length > 0) ||
      (m.data?.agentResult?.scoutItems && m.data.agentResult.scoutItems.length > 0) ||
      (m.data?.clean_result?.scoutItems && m.data.clean_result.scoutItems.length > 0) ||
      (m.data?.result?.scoutItems && m.data.result.scoutItems.length > 0)
    );
    if (clarifyMsg?.data) {
      priorScout = clarifyMsg.data.scoutItems ||
        clarifyMsg.data.portionClarify?.scoutItems ||
        clarifyMsg.data.portionClarify?.items ||
        clarifyMsg.data.agentResult?.scoutItems ||
        clarifyMsg.data.clean_result?.scoutItems ||
        clarifyMsg.data.result?.scoutItems || [];
    }
  }
  return priorScout;
}

/**
 * F-8.10 shard 10 — scout-prep seams. Mutates the passed arrays in place,
 * exactly as the inline blocks did.
 */

export interface BracketPreExtractArgs {
  bracketItems: any[];
  visionScoutItems: any[];
  queriesToSearch: string[];
  onLog: (msg: string) => void;
}

/** Purges OCR/label duplicates of bracket items and stamps fallback nutrients. */
export function applyBracketPreExtract(args: BracketPreExtractArgs): void {
  const { bracketItems, visionScoutItems, queriesToSearch, onLog } = args;
  bracketItems.forEach((bItem: any) => {
    const bName = (bItem.originalName || '').toLowerCase().trim();
    // Remove any scout items that match this bracket item (clean purge of OCR/label reference photos)
    for (let idx = visionScoutItems.length - 1; idx >= 0; idx--) {
      const it = visionScoutItems[idx];
      const itName = (it.originalName || it.keyword || '').toLowerCase().trim();
      if (!itName) continue;
      const match = itName === bName || itName.includes(bName) || bName.includes(itName);
      if (match) {
        onLog(`[Bracket Pre-Extracted] Dropping Scout item "${it.originalName || it.keyword}" in favor of pre-extracted bracket item "${bItem.originalName}" (${bItem.estimatedWeightGrams}g).`);
        visionScoutItems.splice(idx, 1);
      }
    }
    // Add clean bracket pre-extracted item with standard nutrient breakdown
    const baseNuts = getFallbackCategoryProfile(bItem.originalName || bItem.keyword || '');
    const factor = (bItem.estimatedWeightGrams || 100) / 100;
    const bNuts = {
      calories: Math.round((baseNuts.calories || 389) * factor),
      protein: Math.round((baseNuts.protein || 12.43) * factor * 10) / 10,
      carbohydrates: Math.round((baseNuts.carbohydrates || 67.0) * factor * 10) / 10,
      totalFat: Math.round((baseNuts.totalFat || 6.86) * factor * 10) / 10,
      saturatedFat: Math.round((baseNuts.saturatedFat || 0.57) * factor * 10) / 10,
      transFat: 0,
      totalFibre: Math.round((baseNuts.totalFibre || 10.43) * factor * 10) / 10,
      sodium: Math.round((baseNuts.sodium || 4.29) * factor),
      addedSugar: 0,
      sugar: Math.round((baseNuts.sugar || 1.0) * factor * 10) / 10,
      potassium: Math.round((baseNuts.potassium || 421) * factor),
      calcium: Math.round((baseNuts.calcium || 54) * factor),
      iron: Math.round((baseNuts.iron || 4.7) * factor * 10) / 10,
      magnesium: Math.round((baseNuts.magnesium || 177) * factor),
      vitaminD: 0,
      omega3: 0.1
    };
    bItem.scoutIndex = visionScoutItems.length;
    bItem.source = 'bracket_pre_extracted';
    bItem.isBracketPreExtracted = true;
    bItem.nutrients = bNuts;
    bItem.truthNutrients = { ...bNuts };
    bItem.nutrientBasisWeight = bItem.estimatedWeightGrams;
    bItem.components = [{
      name: bItem.originalName,
      searchQuery: bItem.originalName,
      weightGrams: bItem.estimatedWeightGrams,
      estimatedWeightGrams: bItem.estimatedWeightGrams,
      nutrients: bNuts,
      calories: bNuts.calories,
      protein: bNuts.protein,
      carbohydrates: bNuts.carbohydrates,
      carbs: bNuts.carbohydrates,
      totalFat: bNuts.totalFat,
      fat: bNuts.totalFat,
      saturatedFat: bNuts.saturatedFat,
      sodium: bNuts.sodium,
      dbSource: 'estimated',
      dbId: null,
    }];
    bItem.componentsDetailList = bItem.components;
    bItem.compositeSiblings = bItem.components;
    bItem.ingredients = [bItem.originalName];
    bItem.visualIngredients = [bItem.originalName];
    visionScoutItems.push(bItem);
    const q = bItem.originalName || bItem.keyword;
    if (q && !queriesToSearch.includes(q)) {
      queriesToSearch.push(q);
    }
  });
}

export interface ExplicitTagsArgs {
  visionScoutItems: any[];
  explicitFoodTags: any[];
  onLog: (msg: string) => void;
}

/** Injects catalog tags directly into vision items (unique offset scoutIndex). */
export function injectExplicitFoodTags(args: ExplicitTagsArgs): void {
  const { visionScoutItems, explicitFoodTags, onLog } = args;
  explicitFoodTags.forEach((tag: any, idx: number) => {
    const existing = visionScoutItems.find((vi: any) => vi.dbId === tag.dbId || vi.keyword === tag.name);
    if (!existing) {
      visionScoutItems.push({
        scoutIndex: 1000 + idx, // unique offset
        keyword: tag.name,
        originalName: tag.name,
        estimatedWeightGrams: tag.weightGrams,
        source: tag.source || 'catalog_tag',
        dbId: tag.dbId,
        dbSource: tag.source === 'previous_meal' ? 'previous_meal' : 'internal_catalog',
        imageUrl: tag.imageUrl || tag.originalLog?.imageUrl || tag.originalLog?.imageUrls?.[0] || undefined,
        nutrients: tag.nutrients || tag.originalLog?.nutrients || undefined,
      });
    }
  });
  onLog(`[Explicit Food Tags] Injected ${explicitFoodTags.length} catalog tags directly into vision items.`);
}

/** Infers chainName from package labels on packaged-bind items. */
export function inferPackagedBindChains(args: { packagedBindItems: any[]; onLog: (msg: string) => void }): void {
  const { packagedBindItems, onLog } = args;
  for (const it of packagedBindItems) {
    if (!it.chainName && it.packageLabelText) {
      const brandGuess = inferChainNameFromPackageLabel(it.packageLabelText);
      if (brandGuess) {
        it.chainName = brandGuess;
        onLog(`[PackagedBind] Inferred chainName "${brandGuess}" from packageLabelText for "${it.originalName || it.keyword}".`);
      }
    }
  }
}

/** Maps text-search queries to scout-shaped rows with cooking-method sniffing. */
export function mapTextQueriesToScoutItems(extractedQueries: string[]): any[] {
  return extractedQueries.map((q, idx) => ({
    scoutIndex: idx,
    keyword: q,
    originalName: q,
    estimatedWeightGrams: 100,
    source: "text_query",
    cookingMethod: /\b(fried|deep_fried|pan_fried|roasted|grilled|baked|boiled|steamed)\b/i.exec(q)?.[0] || "raw",
    visualIngredients: []
  }));
}

/**
 * F-8.10 shard 11 — scout result handling. The retry loop and LLM call stay
 * inline; classification, state application, meal merge, and item logging
 * move here verbatim.
 */

/** Classifies a dead scout run into the user-facing error (quota/503/corrupt/generic). */
export function buildScoutFailureError(lastScoutErr: any, language?: unknown): Error {
  const raw = userSafeScoutFailureMessage(lastScoutErr);
  const msg = String(lastScoutErr?.message || '');
  const isQuota = /429|RESOURCE_EXHAUSTED|quota exceeded/i.test(msg);
  const isUnavailable = /503|UNAVAILABLE|overloaded|fetch failed|stalled/i.test(msg);
  if (/Vision Scout Corrupted/i.test(msg)) {
    throw new Error(t(language, 'analysisFailed'));
  }
  if (isQuota) {
    throw new Error(
      `Vision Scout Failed: Gemini quota (429) on this model — wait the retry-after window or switch model. Not a bad photo. (Details: ${raw})`
    );
  }
  if (isUnavailable) {
    throw new Error(`Vision Scout Failed: Gemini unavailable (503). Retry shortly. (Details: ${raw})`);
  }
  throw new Error(`Vision Scout Failed: Couldn't reliably read this image, please try again or re-upload. (Details: ${raw})`);
}

/**
 * Mode D empty-extraction guard: counts every form of compare evidence
 * (parsed items, comparison groups, the allExtractedDishes transcription
 * list). A photo compare run totalling zero must retry, never ship empty.
 */
export function countCompareExtracted(rawScoutData: any, visionScoutItems: any[]): number {
  const items = Array.isArray(visionScoutItems) ? visionScoutItems.length : 0;
  const rawItems = Array.isArray(rawScoutData?.items) ? rawScoutData.items.length : 0;
  const groups = Array.isArray(rawScoutData?.groups) ? rawScoutData.groups.length : 0;
  const extracted = Array.isArray(rawScoutData?.allExtractedDishes) ? rawScoutData.allExtractedDishes.length : 0;
  return items + rawItems + groups + extracted;
}

export interface ScoutResultStateArgs {
  scoutResult: any;
  requestedMode?: string;
  hasActiveMealDocument: boolean;
  activeMealDining?: string;
  currentRecommendedMode?: string | null;
  onLog: (msg: string) => void;
  onEvent: (type: string, stage: string, message: string, data?: any) => void;
  onStream: (event: any) => void;
}

/** Applies a successful scout result to pipeline state (items, confidence, mode, queries). */
export function applyScoutResultState(args: ScoutResultStateArgs): {
  scoutInternalReasoning: string | null;
  rawScoutData: any;
  visionScoutItems: any[];
  scoutConfidenceRating: any;
  scoutConfidenceComment: any;
  scoutCookingMethod: any;
  visionScoutContentType: any;
  diningEnvironment: string;
  scoutRecommendedMode: string | null;
  queriesToSearch: string[];
  visionScoutRanAndReturnedItems: boolean;
  verdict?: any;
  clinicalAdvice?: string | null;
  message?: string | null;
  mealName?: string | null;
} {
  const {
    scoutResult,
    requestedMode,
    hasActiveMealDocument,
    activeMealDining,
    currentRecommendedMode,
    onLog,
    onEvent,
    onStream,
  } = args;
  const scoutInternalReasoning = scoutResult.internalReasoning || scoutResult._internalReasoning || null;
  const rawScoutData = scoutResult.rawScoutJson || scoutResult.rawDishes || null;
  if (scoutInternalReasoning) {
    onLog(`[Vision Scout Internal Reasoning] ${scoutInternalReasoning}`);
  }
  if (requestedMode === 'compare' && rawScoutData && Array.isArray(rawScoutData.items)) {
    rawScoutData.items.forEach((it: any) => {
      if (it && (it.name || it.originalName)) {
        it.name = enrichBilingualItemName(it.name || it.originalName);
      }
    });
  }
  // Mode D empty-extraction heal (lives here, NOT in server_vision_scout.ts,
  // per the food_log_instruction_leaked standing invariant): the compare
  // schema requires BOTH allExtractedDishes and items, but a model may fill
  // only the transcription list and leave items[] empty — which used to ship
  // as a zero-item "successful" comparison with an ungrounded recommendation.
  // Promote transcription entries so the extraction work is never dropped.
  // NOTE: the field name below is compare-domain vocabulary handled entirely
  // in this compare-owned module; the shared meal parser stays untouched.
  let stateItems: any[] = Array.isArray(scoutResult.items) ? scoutResult.items : [];
  if (requestedMode === 'compare' && stateItems.length === 0 && rawScoutData) {
    if (Array.isArray(rawScoutData.allExtractedDishes) && rawScoutData.allExtractedDishes.length > 0) {
      stateItems = rawScoutData.allExtractedDishes.map((entry: any, idx: number) => {
        const obj = (entry && typeof entry === 'object') ? entry : null;
        const name = obj
          ? (obj.name || obj.dish || obj.product || obj.originalName || obj.keyword || 'Unnamed item')
          : (typeof entry === 'string' && entry.trim() ? entry.trim() : 'Unnamed item');
        return {
          ...(obj || {}),
          scoutIndex: idx,
          keyword: name,
          originalName: name,
          name,
          estimatedWeightGrams: 100,
          nutrientBasisWeight: 100,
          source: 'visual',
          sourceImageIndex: typeof obj?.sourceImageIndex === 'number' ? obj.sourceImageIndex : 0,
          rawNutritionLabel: null,
          nutrients: null,
          per100g: {},
        };
      });
      rawScoutData.items = stateItems;
      onLog(`[Vision Scout Compare Heal] items[] empty — promoted ${stateItems.length} allExtractedDishes transcription(s).`);
    } else if (Array.isArray(rawScoutData.groups) && rawScoutData.groups.length > 0) {
      const groupDishes: any[] = [];
      rawScoutData.groups.forEach((g: any) => {
        if (Array.isArray(g?.items)) {
          g.items.forEach((entry: any) => {
            const obj = (entry && typeof entry === 'object') ? entry : null;
            const name = obj
              ? (obj.name || obj.dish || obj.product || obj.originalName || obj.keyword || 'Unnamed item')
              : (typeof entry === 'string' && entry.trim() ? entry.trim() : 'Unnamed item');
            groupDishes.push({
              ...(obj || {}),
              scoutIndex: groupDishes.length,
              keyword: name,
              originalName: name,
              name,
              estimatedWeightGrams: 100,
              nutrientBasisWeight: 100,
              source: 'visual',
              sourceImageIndex: typeof obj?.sourceImageIndex === 'number' ? obj.sourceImageIndex : (typeof g.sourceImageIndex === 'number' ? g.sourceImageIndex : 0),
              boundingBox2D: obj?.boundingBox2D || g.boundingBox2D || [0, 0, 1000, 1000],
              rawNutritionLabel: null,
              nutrients: null,
              per100g: {},
            });
          });
        }
      });
      if (groupDishes.length > 0) {
        stateItems = groupDishes;
        rawScoutData.items = stateItems;
        onLog(`[Vision Scout Compare Heal] items[] empty — promoted ${stateItems.length} group item(s).`);
      }
    }
  }
  const visionScoutItems = stateItems.map((item: any) => {
    const rawName = item.name || item.originalName || item.keyword;
    const enrichedName = (requestedMode === 'compare') ? enrichBilingualItemName(rawName) : rawName;
    return {
      ...item,
      name: enrichedName,
      internalReasoning: scoutInternalReasoning,
      // Vision Scout's schema/prompt never asks the model to populate `source`, so
      // photographed dishes arrive with it undefined. Tag anything without a
      // transcribed printed nutrition label as 'visual' so the single-serve-photo
      // guard in detectPortionAmbiguity() (server_portion_clarify.ts) can actually
      // fire. Items with a genuine rawNutritionLabel (OCR'd package) are left as-is
      // so they still flow through multi-serve-pack portion clarification.
      source: item.source || (item.rawNutritionLabel ? 'label' : 'visual'),
    };
  });
  const scoutConfidenceRating = scoutResult.scoutConfidenceRating;
  const scoutConfidenceComment = scoutResult.scoutConfidenceComment;
  const scoutCookingMethod = scoutResult.scoutCookingMethod;
  const visionScoutContentType = scoutResult.visionScoutContentType;
  const diningEnvironment = (scoutResult.diningEnvironment && scoutResult.diningEnvironment !== 'unknown')
    ? scoutResult.diningEnvironment
    : (activeMealDining || "unknown");
  let scoutRecommendedMode = currentRecommendedMode ?? null;
  if (requestedMode === 'review' && !hasActiveMealDocument) {
    scoutRecommendedMode = "new_log";
    onLog(`[Mode Override] User explicitly selected 'review' mode via UI pill. Forcing mode to 'new_log'.`);
  } else if (hasActiveMealDocument && requestedMode === 'review') {
    scoutRecommendedMode = "modify";
    onLog(`[Mode Override] Review pill on an existing modal meal — staying on the same document (edit/merge).`);
  } else if (requestedMode === 'compare') {
    scoutRecommendedMode = "evaluation";
    onLog(`[Mode Override] User explicitly selected 'compare' mode via UI pill. Forcing mode to 'evaluation'.`);
  } else if (visionScoutItems && visionScoutItems.length <= 1 && scoutRecommendedMode === "evaluation") {
    scoutRecommendedMode = "new_log";
  }
  const queriesToSearch: string[] = [...(scoutResult.queriesToSearch || [])];
  const visionScoutRanAndReturnedItems = scoutResult.visionScoutRanAndReturnedItems;
  const scoutItemsSummary = visionScoutItems.map((it: any) => ({
    name: it.originalName || it.keyword,
    keyword: it.keyword,
    weight: it.estimatedWeightGrams
  }));
  const scoutItemsSummaryStr = scoutItemsSummary.map((i: any) => `${i.name} (~${i.weight}g)`).join(', ');
  onEvent('scout_answer', 'scout', `Scout identified ${visionScoutItems.length} item(s): ${scoutItemsSummaryStr}`, {
    items: scoutItemsSummary
  });
  onStream({ type: 'status', stage: 'scout', status: 'completed', message: 'Vision Scout completed.' });
  onLog(`[Vision Scout] Exploded high density rows into ${visionScoutItems.length} individual item(s) to process:`);
  return {
    scoutInternalReasoning,
    rawScoutData,
    visionScoutItems,
    scoutConfidenceRating,
    scoutConfidenceComment,
    scoutCookingMethod,
    visionScoutContentType,
    diningEnvironment,
    scoutRecommendedMode,
    queriesToSearch,
    visionScoutRanAndReturnedItems,
    verdict: scoutResult.verdict || null,
    clinicalAdvice: scoutResult.clinicalAdvice || scoutResult.message || null,
    message: scoutResult.message || scoutResult.clinicalAdvice || null,
    mealName: scoutResult.mealName || null,
  };
}

/** Merges fresh scout dishes into the same meal behind existing items (index offset). */
export interface ScoutMealMergeArgs {
  activeMealItemsBreakdown: any[];
  visionScoutItems: any[];
  onLog: (msg: string) => void;
  isModify?: boolean;
  userLockedSlots?: UserLockedSlot[] | null;
  userMessage?: string;
}

export function mergeScoutIntoActiveMeal(args: ScoutMealMergeArgs): any[] {
  const { activeMealItemsBreakdown, onLog, isModify, userMessage } = args;
  let visionScoutItems = args.visionScoutItems;
  if (isModify && args.userLockedSlots && args.userLockedSlots.length > 0) {
    const locked = applyUserLockedSlots({
      scoutItems: visionScoutItems || [],
      locks: args.userLockedSlots,
      userMessage: args.userMessage,
    });
    for (const n of locked.notes) onLog(n);
    visionScoutItems = locked.items;
  }
  if (!visionScoutItems || visionScoutItems.length === 0) {
    return activeMealItemsBreakdown || [];
  }
  if (!activeMealItemsBreakdown || activeMealItemsBreakdown.length === 0) {
    return visionScoutItems;
  }
  if (isModify) {
    onLog(`[Single-Path] Edit turn: updating active meal with ${visionScoutItems.length} refined scout dish(es) in same meal.`);
    const result = activeMealItemsBreakdown.map((ex: any) => ({ ...ex }));
    const matchedPriorIndices = new Set<number>();

    for (let i = 0; i < visionScoutItems.length; i++) {
      const newcomer = visionScoutItems[i];
      const newName = (newcomer.originalName || newcomer.keyword || newcomer.name || '').toLowerCase().trim();

      // Check for matching prior item by name
      let matchIdx = result.findIndex((ex, idx) => {
        if (matchedPriorIndices.has(idx)) return false;
        const exName = (ex.originalName || ex.keyword || ex.canonicalDbName || ex.name || '').toLowerCase().trim();
        return exName && newName && (exName === newName || exName.includes(newName) || newName.includes(exName) || namesShareSubstance(exName, newName));
      });

      // Match by sourceImageIndex if both have it and it's non-null
      if (matchIdx < 0 && newcomer.sourceImageIndex != null) {
        matchIdx = result.findIndex((ex, idx) => !matchedPriorIndices.has(idx) && ex.sourceImageIndex === newcomer.sourceImageIndex);
      }

      // Check if userMessage explicitly asked to replace/substitute a prior item, or mentions keywords of prior item
      if (matchIdx < 0 && userMessage) {
        const msg = userMessage.toLowerCase();
        const hasReplaceWord = /\b(replace|substitute|instead of|change .* to|switch)\b/i.test(msg);
        if (hasReplaceWord) {
          matchIdx = result.findIndex((ex, idx) => {
            if (matchedPriorIndices.has(idx)) return false;
            const exName = (ex.originalName || ex.keyword || ex.canonicalDbName || ex.name || '').toLowerCase().trim();
            return exName && msg.includes(exName);
          });
        } else {
          // Check if user message mentions substantive keywords of prior item (e.g. "beef dish")
          const keywordIdx = result.findIndex((ex, idx) => {
            if (matchedPriorIndices.has(idx)) return false;
            const exName = (ex.originalName || ex.keyword || ex.canonicalDbName || ex.name || '').toLowerCase().trim();
            const tokens = exName.split(/[^a-z0-9]+/).filter((w: string) => w.length > 2 && !['and', 'with', 'the', 'dish', 'hot', 'style'].includes(w));
            return tokens.length > 0 && tokens.some((t: string) => msg.includes(t));
          });
          if (keywordIdx >= 0) {
            matchIdx = keywordIdx;
          }
        }
      }

      // If full meal re-emission (same length), allow positional fallback
      if (matchIdx < 0 && visionScoutItems.length === result.length && !matchedPriorIndices.has(i)) {
        matchIdx = i;
      }

      const isDummyBox = !newcomer.boundingBox2D ||
        (Array.isArray(newcomer.boundingBox2D) &&
          (newcomer.boundingBox2D.length === 0 || (newcomer.boundingBox2D[0] === 0 && newcomer.boundingBox2D[1] === 0 && newcomer.boundingBox2D[2] === 100 && newcomer.boundingBox2D[3] === 100)));

      const scoutW = Number(newcomer.estimatedWeightGrams ?? newcomer.weightGrams);
      const adoptedWeight = (Number.isFinite(scoutW) && scoutW > 0) ? scoutW : undefined;

      if (matchIdx >= 0) {
        matchedPriorIndices.add(matchIdx);
        const priorMatch = result[matchIdx];
        const resolvedBox = (isDummyBox && priorMatch?.boundingBox2D)
          ? priorMatch.boundingBox2D
          : newcomer.boundingBox2D;

        const resolvedImg = (newcomer.sourceImageIndex == null && priorMatch?.sourceImageIndex != null)
          ? priorMatch.sourceImageIndex
          : newcomer.sourceImageIndex;

        const resolvedComponents = (Array.isArray(newcomer.components) && newcomer.components.length > 0)
          ? newcomer.components
          : (priorMatch?.components || priorMatch?.componentsDetailList || undefined);

        result[matchIdx] = {
          ...priorMatch,
          ...newcomer,
          keyword: newcomer.keyword || newcomer.canonicalDbName || newcomer.originalName || priorMatch?.keyword || priorMatch?.canonicalDbName,
          boundingBox2D: resolvedBox,
          sourceImageIndex: resolvedImg,
          ...(resolvedComponents ? { components: resolvedComponents } : {}),
          ...(adoptedWeight != null ? { estimatedWeightGrams: adoptedWeight, weightGrams: adoptedWeight } : {}),
        };
      } else {
        // New item added in this edit turn
        const maxIdx = result.reduce((m: number, it: any) => Math.max(m, Number(it.scoutIndex) || 0), -1);
        result.push({
          ...newcomer,
          scoutIndex: maxIdx + 1,
          keyword: newcomer.keyword || newcomer.canonicalDbName || newcomer.originalName || newcomer.name,
          boundingBox2D: isDummyBox ? null : newcomer.boundingBox2D,
          sourceImageIndex: newcomer.sourceImageIndex ?? null,
          ...(adoptedWeight != null ? { estimatedWeightGrams: adoptedWeight, weightGrams: adoptedWeight } : {}),
        });
      }
    }
    return result;
  }
  const existing = activeMealItemsBreakdown.map((it: any) => ({
    ...it,
    keyword: it.keyword || it.canonicalDbName || it.originalName || it.name,
  }));
  const maxIdx = existing.reduce((m: number, it: any) => Math.max(m, Number(it.scoutIndex) || 0), -1);
  const additions: any[] = [];
  for (let i = 0; i < visionScoutItems.length; i++) {
    const newcomer = visionScoutItems[i];
    const matchIdx = existing.findIndex(ex => {
      const exName = (ex.originalName || ex.keyword || ex.name || '').toLowerCase().trim();
      const newName = (newcomer.originalName || newcomer.keyword || newcomer.name || '').toLowerCase().trim();
      return exName && newName && (exName === newName || exName.includes(newName) || newName.includes(exName));
    });
    if (matchIdx >= 0) {
      existing[matchIdx] = { ...existing[matchIdx], ...newcomer };
    } else {
      additions.push({
        ...newcomer,
        scoutIndex: (typeof newcomer.scoutIndex === 'number' ? newcomer.scoutIndex : i) + maxIdx + 1,
      });
    }
  }
  const merged = [...existing, ...additions];
  onLog(`[Single-Path] Merged scout items into same meal (${existing.length} updated/existing, ${additions.length} added).`);
  return merged;
}

/** Per-item scout debug lines (label/confidence/flags). */
export function logScoutItemSummaries(items: any[], onLog: (msg: string) => void): void {
  items.forEach((item: any) => {
    const rawLabelHasRealData = item.rawNutritionLabel && typeof item.rawNutritionLabel === 'object'
      ? Object.keys(item.rawNutritionLabel).some((k: string) => {
          if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
          const v = item.rawNutritionLabel[k];
          return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
        })
      : false;
    const flagStr = (item.anomalyFlags && item.anomalyFlags.length > 0) ? ` | Flags: [${item.anomalyFlags.join(', ')}]` : '';
    const confStr = item.itemConfidence ? ` | Confidence: ${item.itemConfidence}` : '';
    const labelStr = rawLabelHasRealData ? ` | Nutrition Label: ${JSON.stringify(item.rawNutritionLabel)}` : '';
    onLog(`[Vision Scout] - Index: ${item.scoutIndex} | Name: "${item.originalName || item.keyword}" | Keyword: "${item.keyword}"${labelStr}${flagStr}${confStr}`);
  });
}

/**
 * Per-image grounding inventory: which input images the scout's dishes came
 * from. Prefers the model's own 'perImage' block (required by the INGESTION
 * rule); falls back to deriving coverage from dishes' sourceImageIndex.
 * Returns the normalized entries plus zero-coverage image indices so a
 * future targeted second pass can trigger on them (attention-drop recovery).
 */
export function summarizeScoutImageInventory(args: {
  perImage?: any;
  imageCount?: number;
  items?: any[];
}): { entries: Array<{ imageIndex: number; itemsFound: string[] }>; uncovered: number[]; unmatched: string[] } {
  const count = Number(args.imageCount) || 0;
  const entries: Array<{ imageIndex: number; itemsFound: string[] }> = [];
  const modelRows = Array.isArray(args.perImage) ? args.perImage : [];
  for (let i = 0; i < count; i++) {
    const row = modelRows.find((r: any) => Number(r?.imageIndex) === i);
    if (row && Array.isArray(row.itemsFound)) {
      entries.push({ imageIndex: i, itemsFound: row.itemsFound.map((n: any) => String(n)) });
    } else {
      const names = (Array.isArray(args.items) ? args.items : [])
        .filter((it: any) => Number(it?.sourceImageIndex) === i)
        .map((it: any) => String(it?.dishName || it?.originalName || it?.keyword || it?.name || 'Dish'));
      entries.push({ imageIndex: i, itemsFound: names });
    }
  }
  const uncovered = entries.filter((e) => e.itemsFound.length === 0).map((e) => e.imageIndex);
  // Claimed-but-not-extracted: names the model listed in perImage that match
  // no emitted dish. Distinguishes "looked and declined" from "never looked"
  // and is the trigger a targeted second pass would use. Two anchors, either
  // one silences the WARN: the name matches a dish (fuzzy), or some dish
  // carries that row's image index (exact — names wobble, indices don't).
  // Only checked when the model actually emitted perImage (derived entries
  // come from dishes, so they trivially match).
  const unmatched: string[] = [];
  if (modelRows.length > 0) {
    const dishList: any[] = Array.isArray(args.items) ? args.items : [];
    const dishNames = dishList.map((it: any) =>
      String(it?.dishName || it?.originalName || it?.keyword || it?.name || ''));
    const indices = new Set(
      dishList.map((it: any) => Number(it?.sourceImageIndex)).filter((n: number) => Number.isInteger(n))
    );
    const norm = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    const matchesDish = (name: string): boolean => {
      const n = norm(name);
      if (n.length === 0) return true;
      return dishNames.some((d: string) => {
        const dn = norm(String(d));
        if (dn.length === 0) return false;
        if (dn.join(' ').includes(n.join(' ')) || n.join(' ').includes(dn.join(' '))) return true;
        const shared = n.filter((w) => dn.includes(w)).length;
        return shared / Math.min(n.length, dn.length) >= 0.5;
      });
    };
    for (const row of modelRows) {
      const idx = Number(row?.imageIndex);
      const names = Array.isArray(row?.itemsFound) ? row.itemsFound.map((n: any) => String(n)) : [];
      if (names.length === 0) continue;
      const indexAnchored = Number.isInteger(idx) && indices.has(idx);
      for (const name of names) {
        if (!matchesDish(name) && !indexAnchored && !unmatched.includes(name)) unmatched.push(name);
      }
    }
  }
  return { entries, uncovered, unmatched };
}

/** Single-line scout inventory log plus a WARN per zero-coverage image. */
export function logScoutImageInventory(args: {
  perImage?: any;
  imageCount?: number;
  items?: any[];
  onLog: (msg: string) => void;
}): { uncovered: number[]; unmatched: string[] } {
  const { entries, uncovered, unmatched } = summarizeScoutImageInventory(args);
  const count = Number(args.imageCount) || 0;
  args.onLog(
    `[ScoutInventory] ${count} image(s) attached; ` +
    (entries.length > 0
      ? entries.map((e) => `img${e.imageIndex}: [${e.itemsFound.join(', ') || 'none'}]`).join('; ')
      : 'no images attached')
  );
  for (const idx of uncovered) {
    args.onLog(`[ScoutInventory] WARN image ${idx} grounded 0 dishes — possible attention drop; check framing or re-query that image alone.`);
  }
  for (const name of unmatched) {
    args.onLog(`[ScoutInventory] WARN "${name}" claimed in perImage but no dish emitted — looked-and-declined (often a label/pack shot with no portion cue).`);
  }
  return { uncovered, unmatched };
}

/**
 * F-8.10 shard 16 — shortcut-chain seams. B5 scale-only reuse, turn-1
 * candidate restore, and scout retry delay. Streaming/LLM calls stay inline.
 */

export interface WeightModShortcutArgs {
  activeScoutItems: any;
  portionChoices: any;
  weightRefineIntent: any;
  scoutContentType?: string;
  refineDecision: { reason?: string };
  priorScoutForRefine: any[];
  imagePayloads: any;
  onLog: (msg: string) => void;
}

/** B5 scale-only: re-uses prior scout, applies portionChoices or refine grams. */
export function applyWeightModShortcut(args: WeightModShortcutArgs): {
  visionScoutItems: any[];
  visionScoutContentType: string;
  ran: boolean;
} {
  const {
    activeScoutItems,
    portionChoices,
    weightRefineIntent,
    scoutContentType,
    refineDecision,
    priorScoutForRefine,
    imagePayloads,
    onLog,
  } = args;
  // B5 scale-only: re-use prior scout, apply portionChoices and/or parsed refine grams
  onLog(
    `${REFINE_SCALE_ONLY_LOG} reason=${refineDecision.reason} locks=${priorScoutHasLabelLocks(priorScoutForRefine)} images=${imagePayloads?.length || 0}`
  );
  onLog(`[Shortcut] Weight modification detected on active meal. Skipping Vision Scout and DB Search.`);
  let visionScoutItems = Array.isArray(activeScoutItems) ? [...activeScoutItems] : [];
  if (portionChoices) {
    visionScoutItems = applyPortionChoices(visionScoutItems, portionChoices);
  } else if (weightRefineIntent.isRefine) {
    visionScoutItems = applyWeightRefineToScoutItems(visionScoutItems, weightRefineIntent);
  }
  return {
    visionScoutItems,
    visionScoutContentType: scoutContentType || 'visual',
    ran: visionScoutItems.length > 0,
  };
}

export interface TurnOneRestoreArgs {
  resolvedDbCandidates: any;
  databaseMatchesArray: any[];
  dbMatchMap: Map<string, any>;
  onLog: (msg: string) => void;
}

/** Restores pre-resolved DB candidates from the turn-1 portionClarify payload. */
export function restoreTurnOneCandidates(args: TurnOneRestoreArgs): number {
  const { resolvedDbCandidates, databaseMatchesArray, dbMatchMap, onLog } = args;
  // Task 3: Restore pre-resolved DB candidates from turn-1 portionClarify payload.
  // This prevents the DB search from re-running from scratch and avoids cross-match bugs.
  const priorCandidates = Array.isArray(resolvedDbCandidates) ? resolvedDbCandidates : [];
  if (priorCandidates.length > 0) {
    onLog(`[PortionResume] Restoring ${priorCandidates.length} pre-resolved DB candidates from turn-1 payload. DB search will be skipped.`);
    priorCandidates.forEach((c: any) => {
      databaseMatchesArray.push(c);
      const cid = String(c.id || c.fdcId || '');
      if (cid) dbMatchMap.set(cid, c.nutrients || c);
    });
  }
  return priorCandidates.length;
}

/** Scout retry backoff: 503/UNAVAILABLE waits longer than other failures. */
export function computeScoutRetryDelay(lastScoutErr: any): number {
  return lastScoutErr?.message?.includes('503') || lastScoutErr?.message?.includes('UNAVAILABLE') ? 2500 : 1000;
}

export interface SkipScoutShortcutArgs {
  body: any;
  history: any;
  activeMeal: any;
  onLog: (msg: string) => void;
}

/**
 * F-8.10 shard 17 — skipScout/portionChoices branch: inherits prior scout,
 * applies portion choices, resolves dining environment.
 */
export function applySkipScoutShortcut(args: SkipScoutShortcutArgs): {
  visionScoutItems: any[];
  visionScoutContentType: string;
  diningEnvironment?: string;
  ran: boolean;
} {
  const { body, history, activeMeal, onLog } = args;
  const priorScout = resolvePriorScoutItems({ body, history, activeMeal });
  let visionScoutItems: any[] = [];
  let visionScoutContentType = 'visual';
  let diningEnvironment: string | undefined;
  let ran = false;
  if (priorScout.length > 0) {
    onLog(`[Shortcut] skipScout or portionChoices is true. Inheriting ${priorScout.length} scout items from previous run.`);
    visionScoutItems = applyPortionChoices(
      priorScout,
      body.portionChoices
    );
    visionScoutContentType = body.scoutContentType || 'visual';
    if (body.diningEnvironment && body.diningEnvironment !== 'unknown') {
      diningEnvironment = body.diningEnvironment;
    } else if (priorScout?.[0]?.diningEnvironment && priorScout[0].diningEnvironment !== 'unknown') {
      diningEnvironment = priorScout[0].diningEnvironment;
    }
    ran = true;
  } else {
    onLog(`[PortionChoices] portionChoices provided but priorScout is empty; proceeding with standard pipeline.`);
  }
  return { visionScoutItems, visionScoutContentType, diningEnvironment, ran };
}

export interface ResumedTurnArgs {
  body: any;
  visionScoutItems: any;
  history: any;
}

/**
 * F-8.10 shard 20 — resumed-image-turn predicate, extracted verbatim from
 * runFoodAnalyze. True when this turn continues an image-bearing turn.
 */
export function checkResumedFromImageTurn(args: ResumedTurnArgs): boolean {
  const { body, visionScoutItems, history } = args;
  return !!(
    body.portionChoices ||
    body.skipScout ||
    body.photoUrl ||
    (Array.isArray(body.activeScoutItems) && body.activeScoutItems.length > 0) ||
    (Array.isArray(visionScoutItems) && visionScoutItems.length > 0) ||
    (Array.isArray(history) && history.some((m: any) => m.data?.photoUrl || m.photoUrl || m.data?.hasImage || m.data?.pendingFoodLog?.imageUrl || m.data?.pendingFoodLog?.imageUrls?.length))
  );
}

export interface TextQueryShortcutArgs {
  message?: string;
  isExplicitModify: boolean;
  isPureWeightModification: boolean;
  onLog: (msg: string) => void;
}

/**
 * F-8.10 shard 22 — text-query branch, extracted verbatim from
 * runFoodAnalyze. Splits a text-only message into search queries and,
 * outside edit flows, seeds scout items + new_log mode.
 */
export function applyTextQueryShortcut(args: TextQueryShortcutArgs): {
  queriesToSearch: string[];
  visionScoutItems: any[];
  scoutRecommendedMode: string | null;
} {
  const { message, isExplicitModify, isPureWeightModification, onLog } = args;
  const queriesToSearch: string[] = [];
  let visionScoutItems: any[] = [];
  let scoutRecommendedMode: string | null = null;
  if (message) {
    onLog(`[Text Search Extraction] No image supplied. Extracting search terms from message: "${message}"`);
    const extractedQueries = extractFoodSearchQueriesFromText(message);
    if (extractedQueries.length > 0) {
      onLog(`[Text Search Extraction] Extracted clean food search queries: ${JSON.stringify(extractedQueries)}`);
      queriesToSearch.push(...extractedQueries);
      if (!isExplicitModify && !isPureWeightModification) {
        scoutRecommendedMode = "new_log";
        visionScoutItems = mapTextQueriesToScoutItems(extractedQueries);
      }
    } else {
      onLog(`[Text Search Extraction] Message classified as conversational or non-food query. Skipping database matches.`);
    }
  }
  return { queriesToSearch, visionScoutItems, scoutRecommendedMode };
}

export interface MenuScaleArgs {
  visionScoutContentType?: string;
  scoutRecommendedMode?: string | null;
}

/**
 * F-8.10 shard 22 — menu-scale bypass rule. A menu-board photo taken to log
 * one specific dish (scoutRecommendedMode === "new_log") still gets real
 * nutrition search; only true browse/evaluation mode skips it.
 */
export function checkMenuScaleBypass(args: MenuScaleArgs): boolean {
  const { visionScoutContentType, scoutRecommendedMode } = args;
  return (visionScoutContentType === "menu_or_poster" || visionScoutContentType === "text") && scoutRecommendedMode !== "new_log";
}

export interface ScoutCallArgs {
  engine: any;
  language?: unknown;
  scoutPromptText: string;
  imagePayloads: any;
  isCompare?: boolean;
  /** Full system instruction already assembled (targets + personalization). If omitted, the raw log/compare pack is used. */
  systemInstruction?: string;
}

/**
 * F-8.10 shard 25 — scout LLM call args, extracted verbatim from
 * runFoodAnalyze. The SSE onStream hookup stays inline (res-bound).
 */
export function buildScoutCallArgs(args: ScoutCallArgs): Record<string, any> {
  const { engine, language, scoutPromptText, imagePayloads, isCompare, systemInstruction } = args;
  const pack = isCompare
    ? withScoutLanguage(scoutOnlyCompareSystemInstruction, language)
    : withScoutLanguage(scoutSystemInstruction, language);
  return {
    modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
    systemInstruction: systemInstruction || pack,
    promptText: scoutPromptText,
    imagePayloads,
    responseMimeType: "application/json",
    maxOutputTokens: 8192,
    temperature: 0.1,
    // Native reasoning stays ON for scout: the 5-image extraction call is
    // where attention drops land (always the hardest image), and the
    // thinking pass measurably improves full-coverage rate for ~+4s and
    // ~+1.5k tokens. Timeout fallback retries with skipThinking anyway.
    skipThinking: false,
    logStagePrefix: 'scout',
    responseSchema: isCompare ? scoutOnlyCompareResponseSchema : visionScoutResponseSchema,
  };
}

export interface ScoutRetryArgs {
  engine: any;
  language?: unknown;
  scoutPromptText: string;
  imagePayloads: any;
  isCompare: boolean;
  systemInstruction?: string;
  message?: string;
  maxAttempts?: number;
  callUnifiedLLM: (args: any) => Promise<any>;
  sleep: (ms: number) => Promise<void>;
  onLog: (msg: string) => void;
  onStreamChunk?: (chunk: string, isThought?: boolean) => void;
}

/**
 * F-8.10 shard 29 — scout retry loop, extracted verbatim from
 * runFoodAnalyze. The LLM call and sleep are injected (stubbable);
 * parsing, quota policy, and logging stay real. The SSE onStream hookup
 * arrives prebuilt (res-bound) via onStreamChunk.
 */
export async function runScoutRetryLoop(args: ScoutRetryArgs): Promise<{
  scoutResult: any;
  attempts: number;
  lastScoutErr: any;
}> {
  const {
    engine, language, scoutPromptText, imagePayloads, isCompare, systemInstruction, message,
    maxAttempts = 3, callUnifiedLLM, sleep, onLog, onStreamChunk,
  } = args;
  
  let currentEngine = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
  let alreadyFellBack = false;

  let scoutResult: any = null;
  let attempts = 0;
  let lastScoutErr: any = null;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      if (attempts > 1) {
        const fallback = nextGeminiFallbackEngine(currentEngine, lastScoutErr, alreadyFellBack);
        if (fallback) {
          onLog(`[Vision Scout] Switching engine from ${currentEngine} to fallback ${fallback} due to stall/unavailable.`);
          currentEngine = fallback;
          alreadyFellBack = true;
        } else if (isGeminiQuotaError(lastScoutErr)) {
          break;
        } else if (isGeminiUnavailableError(lastScoutErr) && currentEngine === 'gemini-3.1-flash-lite') {
          // If gemini-3.1-flash-lite ALSO 503s under peak demand, hop to gemini-2.5-flash as emergency safety net
          onLog(`[Vision Scout] gemini-3.1-flash-lite also unavailable (503). Switching to gemini-2.5-flash emergency fallback.`);
          currentEngine = 'gemini-2.5-flash';
        }

        const delay = computeScoutRetryDelay(lastScoutErr);
        onLog(`[Vision Scout] Waiting ${delay}ms before retry...`);
        await sleep(delay);
        onLog(`[Vision Scout] Retrying LLM call (Attempt ${attempts} of ${maxAttempts}) using engine ${currentEngine}...`);
      }
      
      const callArgs: any = buildScoutCallArgs({ engine: currentEngine, language, scoutPromptText, imagePayloads, isCompare, systemInstruction });
      if (onStreamChunk) callArgs.onStream = onStreamChunk;

      const scoutOutput = await callUnifiedLLM(callArgs);
      // Yield to the event loop before heavy synchronous parsing
      await new Promise(resolve => setImmediate(resolve));
      scoutResult = parseAndHealVisionScout(scoutOutput, onLog, isCompare, message);
      break; // Success! Break out of the loop
    } catch (scoutErr: any) {
      lastScoutErr = scoutErr;
      onLog(`[Vision Scout Attempt ${attempts} Failed] Error: ${scoutErr.message}`);
      if (isGeminiQuotaError(scoutErr)) {
        const fallback = nextGeminiFallbackEngine(currentEngine, scoutErr, alreadyFellBack);
        if (!fallback) {
          onLog(`[Vision Scout] Aborting further scout retries — 429 quota on this model. Switch model or wait.`);
          break;
        }
      }
    }
  }
  return { scoutResult, attempts, lastScoutErr };
}
