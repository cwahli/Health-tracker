/**
 * Pure calculation and data aggregation helper for composite multi-item meals.
 * Used by LogChat compose tray and verified by the master scorecard.
 */
import { getCurrentDateInTimezone, toYYYYMMDD } from './dateUtils';
import { collectSavedMealImageUrls } from './foodImageSources';
import { foodLogFingerprint, normalizeFoodName, hasUsableFoodImage } from './foodLogDedupe';


export interface StagedFoodTag {
  dbId?: string;
  name: string;
  weightGrams?: number;
  source?: 'catalog_tag' | 'previous_meal' | string;
  imageUrl?: string;
  originalLog?: any;
  item?: any;
  nutrients?: any;
  calories?: number;
  protein?: number;
  carbohydrates?: number;
  fat?: number;
  saturatedFat?: number;
  totalFibre?: number;
  fiber?: number;
  sodium?: number;
  servingGrams?: number;
}

export interface CompositeItemBreakdown {
  id: string;
  name: string;
  displayName: string;
  portion: string;
  weightGrams: number;
  weight: string;
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  totalFat: number;
  saturatedFat: number;
  totalFibre: number;
  fiber: number;
  sodium: number;
  salt: number;
  imageUrl?: string;
  source: string;
  scoutIndex: number;
  dbSource?: string;
  rawNutritionLabel?: any;
  labelNutrientsPerServing?: any;
  /**
   * Mirror of the flat values above. Item tables (NutritionLabelTable) read
   * `item.nutrients.*` / `item.truthNutrients.*` and never the flat fields,
   * so a composite item without this object renders blank cells.
   */
  nutrients: Record<string, number>;
}

export interface CompositeMealCalculation {
  dishName: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalSatFat: number;
  totalFibre: number;
  totalSodium: number;
  totalWeight: number;
  roundedCal: number;
  roundedProt: number;
  roundedCarb: number;
  roundedFat: number;
  roundedSat: number;
  roundedFib: number;
  roundedSod: number;
  allImages: string[];
  primaryImageUrl?: string;
  itemsBreakdown: CompositeItemBreakdown[];
}

/**
 * OCR evidence passthrough (T-7): when a staged source already carries
 * label-OCR fields (dbSource 'label', rawNutritionLabel,
 * labelNutrientsPerServing), carry them onto the composite item so the card
 * can badge "Nutrition Facts (OCR Label)" with no new agent call. Label
 * per-serving nutrients scale with the portion factor; the raw label is
 * evidence and passes through unscaled.
 */
function tagOcrFields(src: any, factor: number): Record<string, any> {
  if (!src || typeof src !== 'object') return {};
  const db = src.dbSource;
  const raw = src.rawNutritionLabel;
  const label = src.labelNutrientsPerServing;
  const hasRaw = raw && typeof raw === 'object' && Object.keys(raw).length > 0;
  const hasLabel = label && typeof label === 'object' && Object.keys(label).length > 0;
  if (db !== 'label' && !hasRaw && !hasLabel) return {};
  let scaledLabel = label;
  if (hasLabel && Number.isFinite(factor) && factor !== 1) {
    scaledLabel = {};
    for (const [k, v] of Object.entries(label)) {
      scaledLabel[k] = typeof v === 'number' && Number.isFinite(v) ? Math.round((v as number) * factor * 100) / 100 : v;
    }
  }
  return {
    dbSource: db || 'label',
    ...(hasRaw ? { rawNutritionLabel: raw } : {}),
    ...(scaledLabel ? { labelNutrientsPerServing: scaledLabel } : {}),
  };
}

export function calculateCompositeMeal(explicitFoodTags: StagedFoodTag[]): CompositeMealCalculation {
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  let totalSatFat = 0;
  let totalFibre = 0;
  let totalSodium = 0;
  let totalWeight = 0;
  const itemsBreakdown: CompositeItemBreakdown[] = [];
  const allImages: string[] = [];

  explicitFoodTags.forEach((tag, idx) => {
    let cal = 0;
    let prot = 0;
    let carb = 0;
    let fat = 0;
    let sat = 0;
    let fib = 0;
    let sod = 0;
    let weight = Number(tag.weightGrams) || 100;
    let img = collectSavedMealImageUrls(tag)[0] || tag.imageUrl;
    let ocrFields: Record<string, any> = {};

    if (tag.source === 'previous_meal' && tag.originalLog) {
      const orig = tag.originalLog;
      const origWeight = Number(orig.weightGrams || orig.portionGrams || orig.weight_grams || orig.consumed_amount) || 100;
      const factor = tag.weightGrams ? Number(tag.weightGrams) / origWeight : 1;
      const origNutr = orig.nutrients || {};
      cal = (Number(orig.calories ?? origNutr.calories) || 0) * factor;
      prot = (Number(orig.protein ?? origNutr.protein) || 0) * factor;
      carb = (Number(orig.carbohydrates ?? origNutr.carbohydrates ?? origNutr.carbs) || 0) * factor;
      fat = (Number(orig.totalFat ?? orig.fat ?? origNutr.totalFat ?? origNutr.fat ?? origNutr.total_fat) || 0) * factor;
      sat = (Number(orig.saturatedFat ?? orig.saturated_fat ?? origNutr.saturatedFat ?? origNutr.saturated_fat) || 0) * factor;
      fib = (Number(orig.totalFibre ?? orig.fiber ?? origNutr.totalFibre ?? origNutr.fiber ?? origNutr.total_fibre) || 0) * factor;
      sod = (Number(orig.sodium ?? origNutr.sodium) || 0) * factor;
      weight = tag.weightGrams ? Number(tag.weightGrams) : origWeight;
      if (!img) {
        img = collectSavedMealImageUrls({ ...tag, originalLog: orig })[0];
      }
      ocrFields = tagOcrFields(orig, factor);
    } else {
      const item = tag.item || {};
      const nutr = item.nutrients || tag.nutrients || {};
      const baseServing = Number(item.serving_grams || tag.servingGrams) || 100;
      const factor = tag.weightGrams ? Number(tag.weightGrams) / baseServing : 1;
      cal = (Number(item.calories ?? nutr.calories ?? tag.calories) || 0) * factor;
      prot = (Number(item.protein ?? nutr.protein ?? tag.protein) || 0) * factor;
      carb = (Number(item.carbohydrates ?? nutr.carbohydrates ?? tag.carbohydrates) || 0) * factor;
      fat = (Number(item.total_fat ?? nutr.totalFat ?? nutr.fat ?? tag.fat) || 0) * factor;
      sat = (Number(item.saturated_fat ?? nutr.saturatedFat ?? tag.saturatedFat) || 0) * factor;
      fib = (Number(item.total_fibre ?? nutr.totalFibre ?? nutr.fiber ?? tag.totalFibre) || 0) * factor;
      sod = (Number(item.sodium ?? nutr.sodium ?? tag.sodium) || 0) * factor;
      weight = tag.weightGrams ? Number(tag.weightGrams) : baseServing;
      if (!img) {
        img = collectSavedMealImageUrls({ ...tag, item })[0];
      }
      ocrFields = tagOcrFields(item, factor);
    }

    const extraImgs = collectSavedMealImageUrls(tag);
    extraImgs.forEach((u) => {
      if (u && !allImages.includes(u)) allImages.push(u);
    });

    totalCalories += cal;
    totalProtein += prot;
    totalCarbs += carb;
    totalFat += fat;
    totalSatFat += sat;
    totalFibre += fib;
    totalSodium += sod;
    totalWeight += weight;

    if (img && !allImages.includes(img)) {
      allImages.push(img);
    }

    itemsBreakdown.push({
      id: tag.dbId || `item_${idx}`,
      name: tag.name,
      displayName: tag.name,
      portion: `${Math.round(weight)}g`,
      weightGrams: Math.round(weight),
      weight: `${Math.round(weight)}g`,
      calories: Math.round(cal),
      protein: Math.round(prot * 10) / 10,
      carbohydrates: Math.round(carb * 10) / 10,
      fat: Math.round(fat * 10) / 10,
      totalFat: Math.round(fat * 10) / 10,
      saturatedFat: Math.round(sat * 10) / 10,
      totalFibre: Math.round(fib * 10) / 10,
      fiber: Math.round(fib * 10) / 10,
      sodium: Math.round(sod),
      salt: Math.round((sod / 400) * 10) / 10,
      nutrients: {
        calories: Math.round(cal),
        protein: Math.round(prot * 10) / 10,
        carbohydrates: Math.round(carb * 10) / 10,
        carbs: Math.round(carb * 10) / 10,
        fat: Math.round(fat * 10) / 10,
        totalFat: Math.round(fat * 10) / 10,
        saturatedFat: Math.round(sat * 10) / 10,
        fiber: Math.round(fib * 10) / 10,
        totalFibre: Math.round(fib * 10) / 10,
        sodium: Math.round(sod),
        salt: Math.round((sod / 400) * 10) / 10,
      },
      imageUrl: img,
      ...ocrFields,
      source: tag.source || 'catalog_tag',
      scoutIndex: idx
    });
  });

  const dishName = explicitFoodTags.length === 1 ? explicitFoodTags[0].name : explicitFoodTags.map(t => t.name).join(' + ');
  const primaryImageUrl = allImages[0] || undefined;
  const roundedCal = Math.round(totalCalories);
  const roundedProt = Math.round(totalProtein * 10) / 10;
  const roundedCarb = Math.round(totalCarbs * 10) / 10;
  const roundedFat = Math.round(totalFat * 10) / 10;
  const roundedSat = Math.round(totalSatFat * 10) / 10;
  const roundedFib = Math.round(totalFibre * 10) / 10;
  const roundedSod = Math.round(totalSodium);

  return {
    dishName,
    totalCalories,
    totalProtein,
    totalCarbs,
    totalFat,
    totalSatFat,
    totalFibre,
    totalSodium,
    totalWeight,
    roundedCal,
    roundedProt,
    roundedCarb,
    roundedFat,
    roundedSat,
    roundedFib,
    roundedSod,
    allImages,
    primaryImageUrl,
    itemsBreakdown
  };
}

export interface RemainingAllowanceInput {
  profile: any;
  activeFoodLogs: any[] | null;
  report: any;
}

export function computeRemainingAllowance(args: RemainingAllowanceInput) {
  const { profile, activeFoodLogs, report } = args;
    const todayStr = getCurrentDateInTimezone(profile?.timezone);
    const todaysFoods = activeFoodLogs ? activeFoodLogs.filter(f => f.date === todayStr) : [];
    const todaysTotals = todaysFoods.reduce((acc, curr) => {
      if (curr.nutrients) {
        Object.keys(curr.nutrients).forEach(k => {
          const key = k as keyof typeof curr.nutrients;
          acc[key] = (Number(acc[key]) || 0) + (Number(curr.nutrients[key]) || 0);
        });
      }
      return acc;
    }, {} as { [key: string]: number });
    const parseTarget = (val: any, fallback: number) => {
      if (val === null || val === undefined) return fallback;
      const cleanStr = String(val).replace(/,/g, '');
      const matches = cleanStr.match(/\d+(\.\d+)?/g);
      if (!matches || matches.length === 0) return fallback;
      const parsed = parseFloat(matches[0]);
      return isNaN(parsed) ? fallback : parsed;
    };
    const activeTargets = {
      calories: Number(todaysTotals.calories || 0),
      caloriesTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800,
      satFat: Number(todaysTotals.saturatedFat || 0),
      satFatTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15,
      sodium: Number(todaysTotals.sodium || 0),
      sodiumTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200,
      addedSugar: Number(todaysTotals.addedSugar || 0),
      addedSugarTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.addedSugar, 50) : 50,
      carbohydrates: Number(todaysTotals.carbohydrates || 0),
      carbohydratesTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.carbohydrates, 250) : 250,
      solubleFibre: Number(todaysTotals.solubleFibre || 0),
      solubleFibreTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.solubleFibre, 15) : 15,
      protein: Number(todaysTotals.protein || 0),
      proteinTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.protein, 50) : 50,
      potassium: Number(todaysTotals.potassium || 0),
      potassiumTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.potassium, 3500) : 3500,
      unsaturatedFat: Number(todaysTotals.unsaturatedFat || 0),
      unsaturatedFatTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.unsaturatedFat, 40) : 40,
    };
    const rollingDaysStr = localStorage.getItem('foodTracker_rollingDays');
    const rollingDays = rollingDaysStr ? parseInt(rollingDaysStr, 10) : 7;
    const showAverageInBar = localStorage.getItem('foodTracker_showAverageInBar') === 'true';
    const getAverageIntake = (key: string, numDays: number) => {
      let totalIntake = 0;
      for (let d = 0; d < numDays; d++) {
        const parts = todayStr.split('-');
        const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const targetDate = new Date(todayDate);
        targetDate.setDate(todayDate.getDate() - d);
        const y = targetDate.getFullYear();
        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const dStr = `${y}-${m}-${day}`;
        const dayFoods = activeFoodLogs ? activeFoodLogs.filter(f => f.date === dStr) : [];
        const dayTotal = dayFoods.reduce((acc, curr) => {
          return acc + (Number(curr.nutrients?.[key as keyof typeof curr.nutrients]) || 0);
        }, 0);
        totalIntake += dayTotal;
      }
      return totalIntake / numDays;
    };
    const averages = {
      calories: getAverageIntake('calories', rollingDays),
      saturatedFat: getAverageIntake('saturatedFat', rollingDays),
      sodium: getAverageIntake('sodium', rollingDays),
      addedSugar: getAverageIntake('addedSugar', rollingDays),
      carbohydrates: getAverageIntake('carbohydrates', rollingDays),
      solubleFibre: getAverageIntake('solubleFibre', rollingDays),
      protein: getAverageIntake('protein', rollingDays),
      potassium: getAverageIntake('potassium', rollingDays),
      unsaturatedFat: getAverageIntake('unsaturatedFat', rollingDays),
    };
    return {
      calories: Math.max(0, activeTargets.caloriesTarget - activeTargets.calories),
      saturatedFat: Math.max(0, activeTargets.satFatTarget - activeTargets.satFat),
      sodium: Math.max(0, activeTargets.sodiumTarget - activeTargets.sodium),
      addedSugar: Math.max(0, activeTargets.addedSugarTarget - activeTargets.addedSugar),
      carbohydrates: Math.max(0, activeTargets.carbohydratesTarget - activeTargets.carbohydrates),
      solubleFibre: Math.max(0, activeTargets.solubleFibreTarget - activeTargets.solubleFibre),
      protein: Math.max(0, activeTargets.proteinTarget - activeTargets.protein),
      potassium: Math.max(0, activeTargets.potassiumTarget - activeTargets.potassium),
      unsaturatedFat: Math.max(0, activeTargets.unsaturatedFatTarget - activeTargets.unsaturatedFat),
      caloriesLogged: activeTargets.calories,
      saturatedFatLogged: activeTargets.satFat,
      sodiumLogged: activeTargets.sodium,
      proteinLogged: activeTargets.protein,
      caloriesTarget: activeTargets.caloriesTarget,
      saturatedFatTarget: activeTargets.satFatTarget,
      sodiumTarget: activeTargets.sodiumTarget,
      addedSugarTarget: activeTargets.addedSugarTarget,
      carbohydratesTarget: activeTargets.carbohydratesTarget,
      solubleFibreTarget: activeTargets.solubleFibreTarget,
      proteinTarget: activeTargets.proteinTarget,
      potassiumTarget: activeTargets.potassiumTarget,
      unsaturatedFatTarget: activeTargets.unsaturatedFatTarget,
      averages,
      rollingDays,
    };
}

/**
 * Parse a staged-tray gram field keystroke. Empty/non-numeric input yields
 * undefined so the field can be cleared mid-edit (T-3); callers clamp with
 * normalizeTrayGrams on blur/submit instead of snapping while typing.
 */
export function parseTrayGramInput(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

/** Clamp a parsed tray weight to the submittable range (≥ 1g). */
export function normalizeTrayGrams(w: number | undefined): number {
  if (w === undefined || !Number.isFinite(w)) return 1;
  return Math.max(1, Math.round(w));
}

/**
 * Target-based summary for the instant composite path (no agent call, so no
 * dietitian copy). Derives from the remaining allowance, which already encodes
 * the user's daily targets: calories left after this meal plus protein
 * progress. Falls back to the generic line when no allowance is available.
 */
export function buildCompositeHealthImpact(
  meal: { calories: number; protein: number },
  allowance?: {
    caloriesTarget: number;
    calories: number;
    proteinTarget: number;
    proteinLogged: number;
  } | null,
): string {
  const cal = Math.round(Number(meal?.calories) || 0);
  const prot = Math.round((Number(meal?.protein) || 0) * 10) / 10;
  if (!allowance || !Number.isFinite(Number(allowance.caloriesTarget))) {
    return 'Balanced intake from selected items.';
  }
  const target = Math.round(Number(allowance.caloriesTarget));
  const remainingAfter = Math.max(0, Math.round(Number(allowance.calories) - cal));
  const protTarget = Math.round(Number(allowance.proteinTarget) || 0);
  const protAfter = Math.round((Number(allowance.proteinLogged) + (Number(meal?.protein) || 0)) * 10) / 10;
  const protClause = protTarget > 0 ? ` · ${prot}g protein (${protAfter} of ${protTarget}g)` : ` · ${prot}g protein`;
  return `${cal} kcal · ${remainingAfter} kcal remaining of ${target} target${protClause}`;
}

/**
 * Donor hydration (T-8): /api/food/search previous_meal rows are thin
 * (id/name/portion, sometimes a single preview image). The full log already
 * in memory carries the nutrients, OCR evidence and full image set — merge it
 * in wherever the API row is thin. API scalars always win when present.
 */
const DONOR_MERGE_KEYS = [
  // Full nutrient alias union (matches foodLogDedupe EVIDENCE_NUTRIENT_KEYS +
  // server NUTRIENT_KEYS): a thin row may miss any spelling, the donor may hold another.
  'nutrients', 'calories', 'energy', 'protein', 'carbohydrates', 'carbs',
  'totalCarbohydrate', 'totalFat', 'fat', 'saturatedFat', 'saturated_fat',
  'totalFibre', 'total_fibre', 'fiber', 'sodium', 'salt', 'sugar',
  'addedSugar', 'added_sugar', 'transFat',
  'dbSource', 'rawNutritionLabel', 'labelNutrientsPerServing', 'nutritionFacts',
  'items_breakdown', 'itemsBreakdown', 'weight_grams', 'consumed_amount',
  'portionGrams', 'weightGrams', 'date',
];

const isBlankDonorValue = (v: unknown): boolean => {
  if (v === undefined || v === null || v === '') return true;
  if (typeof v === 'number') return !Number.isFinite(v) || v === 0;
  if (typeof v === 'string') return v.trim() === '' || Number(v) === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
};

/**
 * Find the full log backing a thin previous_meal search row.
 * Pass 1 is the exact id. Passes 2–3 cover the same record under a different
 * id (sync/cloud copies, retries, per-date re-logs): exact fingerprint, else
 * same-day + exact normalized name. Candidates holding a usable photo win so
 * the search tile can render. API scalars still win field-by-field downstream.
 */
function findHydrationDonor(item: any, foodLogs: any[]): any | undefined {
  const id = String(item?.id || item?.food_id || '').trim();
  if (id) {
    const exact = foodLogs.find((f) => f && typeof f === 'object' && String((f as any).id) === id);
    if (exact) return exact;
  }
  let fp = '';
  try {
    fp = foodLogFingerprint({ ...(item as object), id: id || undefined } as any);
  } catch {
    fp = '';
  }
  const nameKey = normalizeFoodName((item as any)?.name || (item as any)?.dish_name);
  const day = toYYYYMMDD((item as any)?.date);
  if (!fp && !nameKey) return undefined;
  const scored: Array<{ log: any; rank: number }> = [];
  for (const log of foodLogs) {
    if (!log || typeof log !== 'object') continue;
    if (id && String((log as any).id) === id) continue;
    let rank = 0;
    if (fp) {
      try {
        if (foodLogFingerprint(log as any) === fp) rank = 2;
      } catch {
        /* ignore */
      }
    }
    if (!rank && nameKey) {
      const logDay = toYYYYMMDD((log as any).date);
      if (normalizeFoodName((log as any).name) === nameKey && (!day || !logDay || logDay === day)) rank = 1;
    }
    if (rank) scored.push({ log, rank });
  }
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => {
    const ai = hasUsableFoodImage(a.log) ? 0 : 1;
    const bi = hasUsableFoodImage(b.log) ? 0 : 1;
    if (ai !== bi) return ai - bi;
    if (b.rank !== a.rank) return b.rank - a.rank;
    return Number((b.log as any).updated_at || 0) - Number((a.log as any).updated_at || 0);
  });
  return scored[0].log;
}

export function hydratePreviousMealTag(item: any, foodLogs?: any[] | null): any {
  if (!item || typeof item !== 'object') return item;
  const id = String(item.id || item.food_id || '').trim();
  if (!id && !item.name && !item.dish_name) return item;
  if (!Array.isArray(foodLogs)) return item;
  const donor = findHydrationDonor(item, foodLogs);
  if (!donor) return item;
  const merged: any = { ...(donor as any), ...item };
  // Single-item composite saves keep per-item evidence (incl. OCR tags) on
  // itemsBreakdown[0] rather than top level — consult it as donor fallback.
  const soloList = Array.isArray((donor as any).itemsBreakdown) && (donor as any).itemsBreakdown.length === 1
    ? (donor as any).itemsBreakdown
    : (Array.isArray((donor as any).items_breakdown) && (donor as any).items_breakdown.length === 1
      ? (donor as any).items_breakdown
      : null);
  const solo = soloList ? soloList[0] : null;
  const donorVal = (k: string) => {
    const top = (donor as any)[k];
    if (!isBlankDonorValue(top)) return top;
    if (solo && typeof solo === 'object') {
      const s = (solo as any)[k];
      if (!isBlankDonorValue(s)) return s;
    }
    return undefined;
  };
  const isEmpty = (v: any) => isBlankDonorValue(v);
  for (const k of DONOR_MERGE_KEYS) {
    if (isEmpty((item as any)[k])) {
      const dv = donorVal(k);
      if (dv !== undefined) merged[k] = dv;
    }
  }
  // Keep both item-list spellings in sync: donors may carry only one.
  if (Array.isArray(merged.items_breakdown) && !Array.isArray(merged.itemsBreakdown)) {
    merged.itemsBreakdown = merged.items_breakdown;
  } else if (Array.isArray(merged.itemsBreakdown) && !Array.isArray(merged.items_breakdown)) {
    merged.items_breakdown = merged.itemsBreakdown;
  }
  const seen = new Set<string>();
  const imgs: string[] = [];
  for (const u of [
    ...collectSavedMealImageUrls(merged, null, { allowSynthesized: false }),
    ...collectSavedMealImageUrls(donor, null, { allowSynthesized: false }),
  ]) {
    if (typeof u === 'string' && u && !seen.has(u)) {
      seen.add(u);
      imgs.push(u);
    }
  }
  if (imgs.length > 0) {
    merged.imageUrls = imgs;
    if (!merged.imageUrl) merged.imageUrl = imgs[0];
  }
  return merged;
}
