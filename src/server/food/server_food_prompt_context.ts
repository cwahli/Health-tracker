/**
 * F-8.10 shard 3 — dietitian prompt assembly, extracted verbatim from
 * runFoodAnalyze. Pure string builders; the route supplies values and
 * stitches the results. No streaming/DB/LLM deps.
 */

import {
  buildModeAEditInstruction,
  buildModeAReviewInstruction,
  buildModeDCompareInstruction,
  buildModeDEditInstruction,
  buildFoodAnalyzeInstruction,
} from '../../../agents/dietitianInstructions.js';
import { buildSavableMealFromParsed } from '../../../server_meal_orchestrator.js';
import { projectDietInput } from '../../mealBuild/projectors.js';
import { beginStage, formatDietProjectionBlock } from '../../mealBuild/stageLifecycle.js';

export function buildUserContext(userProfile: any): string {
  let userCtx = "";
  if (userProfile) {
    userCtx = `\nUSER DIETARY PROFILE & DEMOGRAPHICS:\n` +
      `- Age: ${userProfile.age || 'Unknown'} years old\n` +
      `- Gender: ${userProfile.gender || 'Unknown'}\n` +
      `- Weight: ${userProfile.weight || 'Unknown'} kg\n` +
      `- Height: ${userProfile.height || 'Unknown'} cm\n` +
      `- Ethnicity: ${userProfile.ethnicity || 'Unknown'}\n`;
  }
  return userCtx;
}

export interface TimeContextArgs {
  timezone?: string;
  activeMealDate?: string | null;
  hasImageDates?: boolean;
  message?: string;
}

export function buildTimeContext(args: TimeContextArgs): string {
  const { timezone, activeMealDate, hasImageDates, message } = args;
  const userTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let localDateStr: string;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    localDateStr = formatter.format(new Date());
  } catch (e) {
    localDateStr = new Date().toISOString().split("T")[0];
  }
  const localTime = new Date().toLocaleTimeString();
  const userMentionsDate = /\b(yesterday|tomorrow|last night|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2})\b/i.test(message || '');
  let timeCtx = `\nCURRENT TIME CONTEXT: ${localDateStr} ${localTime}\n`;
  if (activeMealDate && !userMentionsDate && !hasImageDates) {
    timeCtx += `CRITICAL INSTRUCTION: This is an edit/update to an active meal originally logged on "${activeMealDate}". You MUST use "${activeMealDate}" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.\n`;
  } else {
    timeCtx += `CRITICAL INSTRUCTION: You MUST use "${localDateStr}" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.\n`;
  }
  return timeCtx;
}

export function buildImageContext(imagePayloads: any, imageDates: any): string {
  let imageCtx = "";
  if (imagePayloads && imagePayloads.length > 0) {
    if (imagePayloads.length > 1) {
      imageCtx = `\n[Context: ${imagePayloads.length} images are attached above. One or more may be a close-up photo of a printed Nutrition Facts label rather than the food itself. First determine which image(s), if any, show a nutrition facts/label panel. For any such label image: read its exact printed per-serving values and stated serving size, then mathematically scale those exact numbers to the actual weight/quantity consumed as shown in the other image(s) or described by the user — do not substitute your own estimate when a label is legible. For any remaining image(s) showing the actual food, rely on visual cues for portion sizing, ingredients, and freshness as usual.]\n`;
    } else {
      imageCtx = `\n[Context: An image is uploaded and attached above. If it is a close-up of a printed Nutrition Facts label, read its exact printed values and stated serving size, then scale them to the actual weight/quantity consumed; otherwise rely on visual cues for portion sizing, ingredients, and freshness.]\n`;
    }
    if (imageDates && imageDates.length > 0) {
      const primaryImageDate = imageDates[0];
      imageCtx += `\n[CRITICAL DATE OVERRIDE: The uploaded image was taken on ${primaryImageDate}. You MUST use this exact date or its nearest YYYY-MM-DD representation as the "date" field in "foodData", completely overriding the CURRENT TIME CONTEXT, unless the user explicitly asks otherwise.]\n`;
    }
  }
  return imageCtx;
}

export function buildHistoryContext(history: any): string {
  let historyContext = "";
  if (history && Array.isArray(history) && history.length > 0) {
    const cleanHistory: any[] = [];
    history.forEach((h: any) => {
      if (!h || !h.content) return;
      const last = cleanHistory[cleanHistory.length - 1];
      if (!last || last.role !== h.role || String(last.content).trim() !== String(h.content).trim()) {
        cleanHistory.push(h);
      }
    });
    if (cleanHistory.length > 0) {
      historyContext = "PAST DISCUSSIONS & MEALS CHAT HISTORY:\n" +
        cleanHistory.slice(-10).map((h: any) => `${h.role.toUpperCase()}: ${h.content}`).join("\n") + "\n\n";
    }
  }
  return historyContext;
}

export interface VisionScoutContextArgs {
  visionScoutItems: any;
  visionScoutContentType?: string;
  scoutConfidenceRating?: string;
  scoutConfidenceComment?: string;
  scoutCookingMethod?: string;
  diningEnvironment?: string;
  userSelectedMode?: string;
  isExplicitModify?: boolean;
  hasActiveMeal?: boolean;
  hasComparison?: boolean;
  hasImages?: boolean;
}

export function buildVisionScoutContext(args: VisionScoutContextArgs): string {
  const {
    visionScoutItems,
    visionScoutContentType,
    scoutConfidenceRating,
    scoutConfidenceComment,
    scoutCookingMethod,
    diningEnvironment,
    userSelectedMode,
    isExplicitModify,
    hasActiveMeal,
    hasComparison,
    hasImages,
  } = args;
  let visionScoutCtx = "";
  const isPureTextEdit = (isExplicitModify || hasActiveMeal || hasComparison) && !hasImages;
  if (!isPureTextEdit && visionScoutItems && visionScoutItems.length > 0) {
    const itemsList = visionScoutItems.map((item: any, idx: number) => {
      // Use the item's real scoutIndex (assigned earlier, and possibly non-sequential
      // after Multi-Photo Merge removes a duplicate) instead of array position. The
      // Dietitian is instructed to copy this Index verbatim into its own output, and a
      // later step matches the Dietitian's items back to backend-precalculated nutrients
      // by this exact scoutIndex — showing array position here silently mismatches items
      // whenever a merge has created a gap (e.g. a cross-photo duplicate was removed).
      const displayIndex = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : idx;
      const facts = item.nutritionFacts;
      let scaledNutrientsStr = facts ? ` | NutritionFacts: ${JSON.stringify(facts)}` : "";
      return `- Index: ${displayIndex} | Scout Item: "${item.keyword}" | Weight: ${item.estimatedWeightGrams}g | Observed/Local Context: "${item.originalName}"${scaledNutrientsStr}`;
    }).join('\n');
    visionScoutCtx = `\n=== VISUAL FOOD SCOUT IDENTIFIED ITEMS ===\n${itemsList}\n` +
      `Content Type: ${visionScoutContentType} (${visionScoutItems.length} items identified)\n` +
      `Visual Scout Confidence Rating: ${scoutConfidenceRating}\n` +
      (scoutConfidenceComment ? `Visual Scout Confidence Comment: ${scoutConfidenceComment}\n` : "") +
      `Identified Cooking Method & Preparation/Seasonings: ${scoutCookingMethod}\n` +
      (userSelectedMode === 'review' ? `diningEnvironment: ${diningEnvironment}\n` : "");
  }
  return visionScoutCtx;
}

export function buildDatabaseMatchesContext(preCalculatedCtx: any, databaseMatches: any): string {
  let databaseMatchesCtx = "";
  if (preCalculatedCtx) {
    databaseMatchesCtx += preCalculatedCtx;
  }
  if (databaseMatches) {
    databaseMatchesCtx += `\n=== VERIFIED DATABASE MATCHES ===\n${databaseMatches}\n`;
  }
  return databaseMatchesCtx;
}

export function buildBiomarkersContext(biomarkersNeedingImprovement: any): string {
  let biomarkersCtx = "";
  if (biomarkersNeedingImprovement && biomarkersNeedingImprovement.length > 0) {
    biomarkersCtx = `\nCRITICAL PATIENT BIOMARKER WARNINGS:\n` +
      biomarkersNeedingImprovement.map((b: any) => {
        if (typeof b === "string") return `• ${b}`;
        if (b && typeof b === "object" && b.name) {
          const statusStr = b.status ? ` is ${String(b.status).toUpperCase()}` : "";
          const valStr = b.value !== undefined ? ` (${b.value} ${b.unit || ""}, normal range: ${b.normalRange || ""})` : "";
          return `• ${b.name}${statusStr}${valStr}`;
        }
        return `• ${String(b)}`;
      }).join("\n") + "\n";
  }
  return biomarkersCtx;
}

export interface FoodPromptArgs {
  customSystemInstruction?: string;
  systemInstruction?: string;
  userSelectedMode?: string;
  customVariableData?: string;
  biomarkersCtx?: string;
  visionScoutCtx?: string;
  databaseMatchesCtx?: string;
  historyContext?: string;
  pastMealsCtx?: string;
  userCtx?: string;
  timeCtx?: string;
  imageCtx?: string;
  message?: string;
}

export function stitchFoodPrompt(args: FoodPromptArgs): {
  promptText: string;
  fullPromptSent: string;
  finalSystemInstruction: string;
} {
  const {
    customSystemInstruction,
    systemInstruction,
    userSelectedMode,
    customVariableData,
    biomarkersCtx,
    visionScoutCtx,
    databaseMatchesCtx,
    historyContext,
    pastMealsCtx,
    userCtx,
    timeCtx,
    imageCtx,
    message,
  } = args;
  const finalSystemInstruction = customSystemInstruction || systemInstruction;
  const modeDPromptSuffix = (userSelectedMode === 'compare')
    ? `\n\nIf MODE D (evaluation/comparison) applies: reference every item ONLY by its Index number from the Scout list above inside "scoutItemIndices". Every Index must be assigned to at least one group — including duplicate-named items, which are still separate indices. You are allowed to map the same Scout Index to multiple groups if a physical shelf contains items belonging to both categories. Do not restate names, bounding boxes, or database IDs.`
    : ``;
  const promptText = (customVariableData
    ? `${customVariableData}\n${biomarkersCtx}\n${visionScoutCtx}\n${databaseMatchesCtx}\nCurrent User Input: "${message}"`
    : `${historyContext}${pastMealsCtx}Analyze this current food request.
${userCtx}
${biomarkersCtx}
${timeCtx}
${imageCtx}
${visionScoutCtx}
${databaseMatchesCtx}
Current User Input: "${message}"`) + modeDPromptSuffix;
  const fullPromptSent = `System Instruction:\n${finalSystemInstruction}\n\n${promptText}`;
  return { promptText, fullPromptSent, finalSystemInstruction: finalSystemInstruction as string };
}

export interface SystemInstructionArgs {
  userSelectedMode?: string;
  isExplicitModify: boolean;
  effectiveActiveMeal: any;
  activeComparisonState: any;
  biomarkersNeedingImprovement: any;
  remainingAllowance: any;
  foodLogs: any;
  userProfile: any;
  visionScoutItems: any;
}

/**
 * F-8.10 shard 15 — mode-specific system instruction router, extracted
 * verbatim from runFoodAnalyze.
 */
export function selectSystemInstruction(args: SystemInstructionArgs): string {
  const {
    userSelectedMode,
    isExplicitModify,
    effectiveActiveMeal,
    activeComparisonState,
    biomarkersNeedingImprovement,
    remainingAllowance,
    foodLogs,
    userProfile,
    visionScoutItems,
  } = args;
  let systemInstruction = "";
  if (userSelectedMode === 'review' || userSelectedMode === 'edit') {
    if (isExplicitModify || effectiveActiveMeal !== null) {
      systemInstruction = buildModeAEditInstruction({ biomarkersNeedingImprovement, remainingAllowance, activeMeal: effectiveActiveMeal, foodLogs, userProfile });
    } else {
      systemInstruction = buildModeAReviewInstruction({ biomarkersNeedingImprovement, remainingAllowance, foodLogs, userProfile });
    }
  } else if (userSelectedMode === 'compare') {
    if (activeComparisonState !== null) {
      systemInstruction = buildModeDEditInstruction({ biomarkersNeedingImprovement, remainingAllowance, activeComparison: activeComparisonState, foodLogs, userProfile });
    } else {
      systemInstruction = buildModeDCompareInstruction({ biomarkersNeedingImprovement, remainingAllowance, foodLogs, userProfile });
    }
  } else {
    systemInstruction = buildFoodAnalyzeInstruction({
      biomarkersNeedingImprovement,
      remainingAllowance,
      activeMeal: effectiveActiveMeal,
      compareItemCount: userSelectedMode === 'review' ? 0 : (visionScoutItems ? visionScoutItems.length : 0),
      forceModifyMode: isExplicitModify,
      foodLogs,
      userProfile
    });
  }
  return systemInstruction;
}

export interface PrecalcBlockArgs {
  preCalculatedItems: any;
  activeMeal: any;
  aggregatedNutrients: any;
  userProfile: any;
  promptText: string;
  fullPromptSent: string;
  onLog: (msg: string) => void;
}

/**
 * F-8.10 shard 23 — precalc prompt block, extracted verbatim from
 * runFoodAnalyze. Projects the finalize ledger into the diet prompt.
 */
export function assemblePrecalcPromptBlock(args: PrecalcBlockArgs): {
  promptText: string;
  fullPromptSent: string;
} {
  const { preCalculatedItems, activeMeal, aggregatedNutrients, userProfile, promptText, fullPromptSent, onLog } = args;
  onLog('[MealBuild] projector diet');
  const dietTempMeal = buildSavableMealFromParsed(preCalculatedItems || [], activeMeal, aggregatedNutrients, null);
  const lifeStart = beginStage(dietTempMeal, 'diet', { actor: 'server' });
  if (!lifeStart.allowed) {
    onLog(`[MealBuild] stage-limits: ${lifeStart.limitReason}`);
  } else {
    onLog('[MealBuild] stage diet started');
  }
  const dietProjection = projectDietInput(dietTempMeal, userProfile);
  const precalcBlock = formatDietProjectionBlock(dietProjection);
  onLog('[MealBuild] projector diet applied');
  return {
    promptText: `${promptText}\n\n${precalcBlock}`,
    fullPromptSent: `${fullPromptSent}\n\n${precalcBlock}`,
  };
}
