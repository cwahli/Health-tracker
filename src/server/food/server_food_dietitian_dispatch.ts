import { t, interpolate } from '../../utils/i18n.js';
import { NUTRIENT_KEYS } from '../../utils/nutrients.js';
import { reconcileMessageWithLedger } from '../../mealBuild/narration.js';

/**
 * F-8.10 shard 4 — dietitian dispatch seams, extracted verbatim from
 * runFoodAnalyze. Pure input→output units; streaming/LLM calls stay inline.
 */

export interface DietitianSkipArgs {
  isPureWeightModification: boolean;
  activeMeal: any;
  userSelectedMode?: string;
  weightRefineIntent: { isRefine?: boolean; weightGrams?: number; targetHint?: string; kind?: string };
  message?: string;
}

/** Pure-scale refine gate: label-locked weight refines scale without an LLM call.
 * (The single-agent-create gate is gone with the dietitian call — every create
 * goes through the projector.) */
export function computeDietitianSkipGates(args: DietitianSkipArgs): {
  canSkipDietitianForPureScale: boolean;
} {
  const {
    isPureWeightModification,
    activeMeal,
    userSelectedMode,
    weightRefineIntent,
    message,
  } = args;
  const canSkipDietitianForPureScale = Boolean(
    isPureWeightModification &&
    activeMeal &&
    userSelectedMode !== 'compare' &&
    weightRefineIntent.isRefine &&
    typeof weightRefineIntent.weightGrams === 'number' &&
    weightRefineIntent.weightGrams > 0 &&
    !weightRefineIntent.targetHint &&
    (weightRefineIntent.kind === 'absolute_grams' || weightRefineIntent.kind === 'whole_pack') &&
    (!Array.isArray(activeMeal.itemsBreakdown) || activeMeal.itemsBreakdown.length <= 1) &&
    !/\b(only|remove|delete|without|except|no|instead|replace|add|plus|with|not|didn't|did\s+not)\b/i.test(message || '')
  );
  return { canSkipDietitianForPureScale };
}

export type PureScaleSkipArgs = DietitianSkipArgs;
export const computePureScaleSkipGates = computeDietitianSkipGates;

export interface ScoutTotals {
  totalSugar: number;
  totalSatFat: number;
  totalP: number;
  totalCals?: number;
  totalC?: number;
  totalF?: number;
}

/**
 * F-8.10 shard 15 — single-agent-create verdict ladder, extracted verbatim
 * from runFoodAnalyze. Existing scout verdicts pass through untouched.
 */
export function decideScoutVerdict(args: {
  scoutVerdict: any;
  totals: ScoutTotals;
  mealName?: string;
  language?: unknown;
}): any {
  const { totals, mealName, language } = args;
  let scoutVerdict = args.scoutVerdict;
  if (!scoutVerdict || typeof scoutVerdict !== 'object' || !scoutVerdict.label) {
    if (totals.totalSugar >= 30) {
      scoutVerdict = { label: t(language, 'verdictHighGlycemicSugar'), level: 'warning' };
    } else if (totals.totalSatFat >= 15) {
      scoutVerdict = { label: t(language, 'verdictElevatedSatFat'), level: 'warning' };
    } else if (totals.totalP >= 25) {
      scoutVerdict = { label: t(language, 'verdictLeanMuscle'), level: 'good' };
    } else if (/probiotic|fermented|yogurt|kefir|yakult/i.test(mealName || '')) {
      scoutVerdict = { label: t(language, 'verdictGutMicrobiome'), level: totals.totalSugar >= 25 ? 'neutral' : 'good' };
    } else {
      scoutVerdict = { label: t(language, 'verdictSupportsMetabolicEnergy'), level: 'neutral' };
    }
  }
  return scoutVerdict;
}

/**
 * F-8.10 shard 15 — single-agent-create advice ladder, extracted verbatim
 * from runFoodAnalyze. Existing scout advice passes through untouched.
 */
export function decideScoutAdvice(args: {
  rawAdvice: any;
  totals: ScoutTotals;
  mealName?: string;
  language?: unknown;
}): string {
  const { totals, mealName, language } = args;
  let rawAdvice = args.rawAdvice;
  if (!rawAdvice || String(rawAdvice).trim().length === 0) {
    if (/probiotic|yakult|kefir|yogurt/i.test(mealName || '')) {
      rawAdvice = t(language, 'adviceProbioticSugar').replace('{grams}', String(Math.round(totals.totalSugar)));
    } else if (totals.totalP >= 20) {
      rawAdvice = t(language, 'adviceSolidProtein').replace('{grams}', String(Math.round(totals.totalP)));
    } else if (totals.totalSugar >= 30) {
      rawAdvice = t(language, 'adviceHighSugar').replace('{grams}', String(Math.round(totals.totalSugar)));
    } else {
      rawAdvice = t(language, 'adviceLoggedBalanced').replace('{name}', String(mealName));
    }
  } else {
    // Synchronize cited macro quantities with authoritative ledger totals
    let syncAdvice = String(rawAdvice);
    if (totals.totalSatFat !== undefined) {
      syncAdvice = syncAdvice.replace(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:of\s*)?(saturated\s*fat|sat\s*fat)/gi, (m, oldVal, label) => {
        return `${Math.round(totals.totalSatFat * 10) / 10}g of ${label}`;
      });
    }
    if (totals.totalP !== undefined) {
      syncAdvice = syncAdvice.replace(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:of\s*)?((?:clean\s*|solid\s*)?protein)/gi, (m, oldVal, label) => {
        return `${Math.round(totals.totalP * 10) / 10}g of ${label}`;
      });
    }
    if (totals.totalCals !== undefined && totals.totalCals > 0) {
      syncAdvice = syncAdvice.replace(/(\d+(?:\.\d+)?)\s*(?:kcal|calories)\b/gi, () => {
        return `${Math.round(totals.totalCals)} kcal`;
      });
    }
    if (totals.totalSugar !== undefined) {
      syncAdvice = syncAdvice.replace(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:of\s*)?(?:added\s*|total\s*)?(sugar)/gi, (m, oldVal, label) => {
        return `${Math.round(totals.totalSugar * 10) / 10}g of sugar`;
      });
    }
    rawAdvice = syncAdvice;
  }
  return rawAdvice;
}

/** Pure-scale refine response: label-locked meal scaled without an LLM call. */
export function buildPureScaleResponse(args: { targetWeightGrams: number; language?: unknown }): {
  textOutput: string;
  rawParsed: any;
} {
  const { targetWeightGrams: targetWeight, language } = args;
  const textOutput = JSON.stringify({
    _internalReasoning: `[Refine] scale-only: Scaled meal directly to ${targetWeight}g`,
    verdict: { label: t(language, 'verdictPortionControl'), level: "neutral" },
    message: interpolate(t(language, 'messageScaledPortion'), { grams: targetWeight }),
    mode: "modify",
    modificationCommand: [
      {
        action: "update_weight",
        itemName: "total",
        newWeightGrams: targetWeight
      }
    ]
  });
  return { textOutput, rawParsed: JSON.parse(textOutput) };
}

/** Sums precalc ledgers into create-path totals. */
export function sumPrecalcTotals(preCalculatedItems: any): {
  totalGrams: number;
  totalCals: number;
  totalP: number;
  totalC: number;
  totalF: number;
  totalSugar: number;
  totalAddedSugar: number;
  totalSatFat: number;
} {
  return {
    totalGrams: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.estimatedWeightGrams) || 0), 0),
    totalCals: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.calories) || 0), 0),
    totalP: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.protein) || 0), 0),
    totalC: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.carbohydrates) || 0), 0),
    totalF: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.totalFat) || 0), 0),
    totalSugar: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.sugar ?? it.nutrients?.totalSugar ?? it.nutrients?.addedSugar) || 0), 0),
    totalAddedSugar: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.addedSugar) || 0), 0),
    totalSatFat: preCalculatedItems.reduce((sum: number, it: any) => sum + (Number(it.nutrients?.saturatedFat) || 0), 0),
  };
}

export interface DensityCheckArgs {
  preCalculatedItems: any[];
  aggregatedNutrients: any;
  beveragePattern: RegExp;
  onLog: (msg: string) => void;
}

/**
 * F-8.10 shard 19 — pre-dietitian density check, extracted verbatim from
 * runFoodAnalyze. Rescales implausible beverage calories and rolls up
 * aggregated nutrients. Mutates items in place, as inline.
 */
export function applyPreDietitianDensityCheck(args: DensityCheckArgs): Record<string, number> {
  const { preCalculatedItems, aggregatedNutrients: incoming, beveragePattern, onLog } = args;
  let aggregatedNutrients = incoming;
  if (Array.isArray(preCalculatedItems)) {
    preCalculatedItems.forEach((it: any) => {
      if (!it || !it.weightGrams || !it.nutrients) return;
      const cals = Number(it.nutrients.calories || 0);
      const nameLower = String(it.name || it.keyword || '').toLowerCase();
      const isBeverage = beveragePattern.test(nameLower) || nameLower.includes('latte') || nameLower.includes('coffee') || nameLower.includes('drink');
      if (isBeverage && it.weightGrams >= 150 && cals > 600) {
        const maxAllowedCals = Math.round((it.weightGrams / 100) * 110);
        const factor = maxAllowedCals / cals;
        onLog(`[Pre-Dietitian Reality Check] Rescaling beverage item "${it.name}" from ${cals} kcal -> ${maxAllowedCals} kcal prior to Dietitian prompt payload.`);
        NUTRIENT_KEYS.forEach(k => {
          if (it.nutrients[k] != null && typeof it.nutrients[k] === 'number') {
            it.nutrients[k] = Math.round(it.nutrients[k] * factor * 10) / 10;
          }
        });
      }
    });
    if (preCalculatedItems.length > 0) {
      if (!aggregatedNutrients || typeof aggregatedNutrients !== 'object') {
        aggregatedNutrients = {};
      }
      NUTRIENT_KEYS.forEach(k => {
        const sum = preCalculatedItems.reduce((acc: number, item: any) => acc + (Number(item?.nutrients?.[k]) || 0), 0);
        aggregatedNutrients[k] = Math.round(sum * 10) / 10;
      });
    }
  }
  return aggregatedNutrients;
}

export const applyPreProjectorDensityCheck = applyPreDietitianDensityCheck;

export interface CreateSkipSynthesisArgs {
  rawScoutData: any;
  visionScoutItems: any[];
  preCalculatedItems: any[];
  totals: {
    totalGrams: number; totalCals: number; totalP: number; totalC: number;
    totalF: number; totalSugar: number; totalAddedSugar: number; totalSatFat: number;
  };
  scoutVerdict: any;
  rawAdvice: string;
  scoutConfidenceRating?: string;
  scoutConfidenceComment?: string;
  scoutCookingMethod?: string;
  scoutInternalReasoning?: string | null;
  diningEnvironment?: string;
  language?: unknown;
}

/**
 * Create-path meal title: prefer the scout's own mealName, else join the
 * dish names (same "A, B, and C" shape as formatMultiItemMealTitle).
 * Generic fallback only when there are no dish names at all.
 */
export function resolveCreateMealTitle(rawScoutData: any, visionScoutItems: any[], language?: unknown): string {
  const direct = rawScoutData?.mealName || rawScoutData?.name;
  if (direct && String(direct).trim()) return String(direct).trim();
  const names = (visionScoutItems || [])
    .map((it: any) => it?.originalName || it?.keyword || it?.name)
    .filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  if (names.length > 3) {
    const primary = names.slice(0, 2);
    const remainingCount = names.length - 2;
    return `${primary.join(', ')}, and ${remainingCount} other ${remainingCount === 1 ? 'dish' : 'dishes'}`;
  }
  return t(language, 'balancedMealFallbackName');
}

/**
 * F-8.10 shard 28 — single-agent-create synthesis, extracted verbatim from
 * runFoodAnalyze. Reconciles the message with the ledger and serializes
 * the dietitian-shaped response (which the caller re-parses, as inline).
 */
export function buildCreateSkipResponse(args: CreateSkipSynthesisArgs): {
  textOutput: string;
  rawParsed: any;
} {
  const {
    rawScoutData, visionScoutItems, preCalculatedItems, totals, scoutVerdict, rawAdvice,
    scoutConfidenceRating, scoutConfidenceComment, scoutCookingMethod,
    scoutInternalReasoning, diningEnvironment, language,
  } = args;
  const { totalGrams, totalCals, totalP, totalC, totalF } = totals;
  const mealName = resolveCreateMealTitle(rawScoutData, visionScoutItems, language);
  const formattedMsg = reconcileMessageWithLedger(rawAdvice, {
    mealName,
    weightGrams: totalGrams,
    calories: Math.round(totalCals),
    protein: Math.round(totalP * 10) / 10,
    carbohydrates: Math.round(totalC * 10) / 10,
    totalFat: Math.round(totalF * 10) / 10,
  }, language);
  // preCalculatedItems is captured from the caller scope via totals source
  const textOutput = JSON.stringify({
    _internalReasoning: scoutInternalReasoning || '[MealAgent] Single-agent create path',
    mode: 'new_log',
    message: formattedMsg,
    verdict: scoutVerdict,
    foodData: {
      name: mealName,
      weightGrams: String(totalGrams),
      cookingMethod: scoutCookingMethod || t(language, 'cookingMethodUnknown'),
      scoutConfidenceRating: scoutConfidenceRating || 'High (>90%)',
      scoutConfidenceComment: scoutConfidenceComment || '',
      diningEnvironment: diningEnvironment || 'unknown',
      itemsBreakdown: preCalculatedItems.map((p: any) => ({
        canonicalDbName: p.keyword || p.originalName,
        originalName: p.originalName,
        weightGrams: String(p.estimatedWeightGrams),
        dbSource: p.dbSource || 'estimated',
        dbId: p.dbId || null,
        foodType: p.foodType || 'composed',
        rawNutritionLabel: p.rawNutritionLabel || null,
        labelNutrientsPerServing: p.labelNutrientsPerServing || null,
      }))
    }
  });
  return { textOutput, rawParsed: JSON.parse(textOutput) };
}

/**
 * F-8.10 shard 28 — salvaged aggregates, extracted verbatim from
 * runFoodAnalyze. Zero-fills and sums the 31 keys over precalc items.
 */
export function sumSalvagedAggregates(preCalculatedItems: any): Record<string, number> {
  const salvagedAggregatedNutrients: Record<string, number> = {};
  NUTRIENT_KEYS.forEach(k => salvagedAggregatedNutrients[k] = 0);
  if (preCalculatedItems && Array.isArray(preCalculatedItems)) {
    preCalculatedItems.forEach((p: any) => {
      if (p.nutrients) {
        NUTRIENT_KEYS.forEach(k => {
          salvagedAggregatedNutrients[k] = parseFloat(((salvagedAggregatedNutrients[k] || 0) + (Number(p.nutrients[k]) || 0)).toFixed(2));
        });
      }
    });
  }
  return salvagedAggregatedNutrients;
}

/**
 * Salvage plausibility gate: a summed ledger can inherit garbage from an
 * unscaled estimator (observed: 9600 kcal / 2276 g protein from a baseline
 * runaway; 6300 kcal / 70g from a 1-gram serving parse). Refuse success on
 * physically impossible ledgers so the job fails retryably instead of
 * logging absurd numbers as a completed meal.
 *
 * kcal/g > 9.2 is unsavable at any consumed weight (not only ≥100g). Pure
 * fat is 9 kcal/g; a 70g pastry at 6300 kcal is 90 kcal/g and must not log.
 */
export function salvageLedgerPlausibility(nutrients: any, weightGrams: any): { ok: boolean; reason: string } {
  const kcal = Number(nutrients?.calories) || 0;
  const protein = Number(nutrients?.protein) || 0;
  const fat = Number(nutrients?.totalFat ?? nutrients?.fat ?? nutrients?.fatGrams) || 0;
  const g = Number(weightGrams) || 0;
  const density = g > 0 ? kcal / g : 0;
  if (kcal > 8000) return { ok: false, reason: `kcal=${kcal}` };
  if (protein > 500) return { ok: false, reason: `protein=${protein}g` };
  if (g > 0 && density > 9.2) return { ok: false, reason: `density=${density.toFixed(2)}kcal/g` };
  if (g > 0 && fat > g + 1) return { ok: false, reason: `fat=${fat}g exceeds weight=${g}g` };
  return { ok: true, reason: '' };
}

/**
 * Accept-defaults gate: portion-clarify choices within `tolerance` of the
 * DEFAULT (pack weight, else the scout estimate) need no agent — the ledger
 * already says it. Returns false whenever a choice is unverifiable (unknown
 * default) or no resume context is present, so the agent still runs instead
 * of guessing.
 */
export function isAcceptDefaultsWithinTolerance(args: {
  portionChoices?: Record<string, number> | null;
  scoutItems?: any[] | null;
  isResume?: boolean;
  tolerance?: number;
}): boolean {
  const { scoutItems, tolerance = 0.3 } = args;
  const choices = args.portionChoices;
  if (!choices || typeof choices !== 'object' || !args.isResume) return false;
  const keys = Object.keys(choices);
  if (keys.length === 0) return true;
  const byIndex = new Map<string, number>();
  (scoutItems || []).forEach((it: any, i: number) => {
    const pack = Number(it?.packGrams);
    const est = Number(it?.estimatedWeightGrams);
    byIndex.set(String(it?.scoutIndex ?? i), Number.isFinite(pack) && pack > 0 ? pack : est);
  });
  let matched = 0;
  for (const k of keys) {
    const w = Number((choices as any)[k]);
    const def = byIndex.get(String(k));
    if (!Number.isFinite(w) || w <= 0) return false;
    if (!Number.isFinite(def) || (def as number) <= 0) return false;
    matched++;
    if (Math.abs(w - (def as number)) / (def as number) > tolerance) return false;
  }
  return matched > 0;
}

/**
 * Ready-made parsed result for the accept-defaults path (no agent call).
 * With explicit targets it composes the same personalised 2-paragraph shape
 * as agent advice (position vs targets, then rest-of-day steering) from TS
 * math; without targets it falls back to the generic ladder message.
 * Downstream mode resolution and response builders are untouched.
 */
const ACCEPT_TARGET_KEYS = ['calories', 'protein', 'carbohydrates', 'totalFat', 'saturatedFat', 'sugar', 'totalFibre', 'sodium'] as const;

function trimNum(v: number): string {
  const r = Math.round(v * 10) / 10;
  return String(r);
}

export function composeAcceptDefaultsParsed(args: {
  items?: any[] | null;
  mealName?: string;
  language?: unknown;
  targets?: Record<string, any> | null;
  foodLogs?: Array<{ date?: string; nutrients?: Record<string, any> | null }> | null;
  todayStr?: string;
}): Record<string, any> {
  const items = Array.isArray(args.items) ? args.items : [];
  const lang = args.language;
  const meal: Record<string, number> = {};
  for (const it of items) {
    const n = it?.nutrients || {};
    for (const k of [...ACCEPT_TARGET_KEYS, 'transFat']) {
      const v = Number(n[k]);
      if (Number.isFinite(v)) meal[k] = (meal[k] || 0) + v;
    }
  }
  const T: Record<string, number> = {};
  for (const k of ACCEPT_TARGET_KEYS) {
    const v = Number(args.targets?.[k]);
    if (Number.isFinite(v) && v > 0) T[k] = v;
  }
  const mealName = args.mealName || 'meal';

  if (!T.calories) {
    const totals = { totalSugar: meal.sugar || 0, totalSatFat: meal.saturatedFat || 0, totalP: meal.protein || 0 };
    const weighed = items.map((it: any) => {
      const name = it?.keyword || it?.originalName || it?.name || 'Dish';
      const w = Math.round(Number(it?.estimatedWeightGrams ?? it?.weightGrams ?? 0)) || 0;
      return `${name} ${w}g`;
    });
    const verdict = decideScoutVerdict({ scoutVerdict: null, totals, mealName, language: lang });
    const clinicalAdvice = decideScoutAdvice({ rawAdvice: '', totals, mealName, language: lang });
    const message = weighed.length > 0 ? `${mealName}: ${weighed.join('; ')}. ${clinicalAdvice}` : String(clinicalAdvice || '');
    return {
      mode: undefined, message, verdict, clinicalAdvice,
      _internalReasoning: '[Accept] portion choices within 30% of estimates; no agent call.',
      foodData: {}, editCommands: [], modificationCommand: [],
    };
  }

  const today: Record<string, number> = {};
  if (Array.isArray(args.foodLogs) && args.todayStr) {
    for (const log of args.foodLogs) {
      if (String(log?.date || '').slice(0, 10) !== args.todayStr) continue;
      const n = log?.nutrients || {};
      for (const k of [...ACCEPT_TARGET_KEYS, 'transFat']) {
        const v = Number(n[k]);
        if (Number.isFinite(v)) today[k] = (today[k] || 0) + v;
      }
    }
  }
  const r0 = (v: number) => Math.max(0, Math.round(v));
  const kcalShare = Math.round((meal.calories || 0) / T.calories * 100);
  let p1 = t(lang, 'apMealPosition')
    .replace('{kcal}', String(r0(meal.calories || 0)))
    .replace('{pct}', String(kcalShare));
  const offenders = [
    { key: 'sugar', label: t(lang, 'apNutSugar'), mult: T.sugar ? (meal.sugar || 0) / T.sugar : 0 },
    { key: 'saturatedFat', label: t(lang, 'apNutSatFat'), mult: T.saturatedFat ? (meal.saturatedFat || 0) / T.saturatedFat : 0 },
  ].filter((c) => c.mult >= 1).sort((a, b) => b.mult - a.mult);
  const worst = offenders[0];
  if (worst) {
    p1 += ' ' + t(lang, 'apOverLimit')
      .replace('{nutrient}', worst.label)
      .replace('{mult}', trimNum(worst.mult));
  }
  let verdict: any;
  if (worst?.key === 'sugar') {
    verdict = { label: t(lang, 'verdictHighGlycemicSugar'), level: worst.mult >= 2 ? 'alert' : 'warning' };
  } else if (worst?.key === 'saturatedFat') {
    verdict = { label: t(lang, 'verdictElevatedSatFat'), level: worst.mult >= 2 ? 'alert' : 'warning' };
  } else {
    verdict = decideScoutVerdict({
      scoutVerdict: null,
      totals: { totalSugar: meal.sugar || 0, totalSatFat: meal.saturatedFat || 0, totalP: meal.protein || 0 },
      mealName, language: lang,
    });
  }
  const rem = (k: string) => (T[k] || 0) - (today[k] || 0) - (meal[k] || 0);
  const sugarLeft = rem('sugar');
  const sugarLeftTxt = sugarLeft > 0 ? `${r0(sugarLeft)}g ${t(lang, 'apNutSugar')}` : t(lang, 'apNoSugar');
  let p2 = t(lang, 'apRestOfDay')
    .replace('{carbs}', String(r0(rem('carbohydrates'))))
    .replace('{sugarLeft}', sugarLeftTxt);
  p2 += ' ' + t(lang, 'apProteinSteer').replace('{protein}', String(r0(rem('protein'))));
  if ((meal.transFat || 0) > 0) {
    p2 += ' ' + t(lang, 'apTransFatWarn').replace('{grams}', trimNum(meal.transFat));
  }
  const clinicalAdvice = `${p1}\n\n${p2}`;
  return {
    mode: undefined,
    message: clinicalAdvice,
    verdict,
    clinicalAdvice,
    _internalReasoning: '[Accept] portion choices within 30% of estimates; no agent call, TS-composed personalised message.',
    foodData: {},
    editCommands: [],
    modificationCommand: [],
  };
}

