/**
 * server_meal_from_finalize.ts
 *
 * FOOD_SINGLE_PATH F-8.2: meal items and totals come from finalizeDishLedger.
 * Receipt is a view of that ledger. No second calorie book.
 */

import { NUTRIENT_KEYS } from './src/utils/nutrients.js';
import { rebalanceNutrientProfile } from './server_derivation.js';
import { formatMealReceiptTable } from './server_pure_helpers.js';

export function sumItemNutrients(items: any[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const k of NUTRIENT_KEYS) totals[k] = 0;
  for (const it of items || []) {
    const n = it?.nutrients && typeof it.nutrients === 'object' ? it.nutrients : it;
    for (const k of NUTRIENT_KEYS) {
      totals[k] = Math.round(((totals[k] || 0) + (Number(n?.[k]) || 0)) * 10) / 10;
    }
  }
  if (totals.sodium != null) {
    totals.salt = Math.round(((Number(totals.sodium) || 0) * 2.54 / 1000) * 100) / 100;
  }
  return totals;
}

export function ledgerToFoodItem(ledger: any, extras: {
  diningEnvironment?: string;
  boundingBox2D?: number[] | null;
  sourceImageIndex?: number | null;
  foodType?: string | null;
  cookingMethod?: string | null;
} = {}): any {
  const n = { ...(ledger?.nutrients || {}) };
  const name = ledger?.originalName || ledger?.keyword || ledger?.name || 'Food Item';
  const weight = Number(ledger?.weightGrams ?? ledger?.estimatedWeightGrams ?? 0) || 0;
  const sourceImageIndex =
    extras.sourceImageIndex !== undefined
      ? extras.sourceImageIndex
      : (typeof ledger?.sourceImageIndex === 'number' ? ledger.sourceImageIndex : 0);
  const box = extras.boundingBox2D !== undefined ? extras.boundingBox2D : (ledger?.boundingBox2D || null);
  const comps = ledger?.componentsDetailList || ledger?.components || ledger?.compositeSiblings || [];

  return {
    scoutIndex: ledger?.scoutIndex,
    name,
    canonicalDbName: name,
    originalName: name,
    keyword: ledger?.keyword || name,
    weightGrams: weight,
    calories: n.calories ?? 0,
    protein: n.protein ?? 0,
    totalFat: n.totalFat ?? 0,
    saturatedFat: n.saturatedFat ?? 0,
    carbohydrates: n.carbohydrates ?? 0,
    sodium: n.sodium ?? 0,
    addedSugar: n.addedSugar ?? 0,
    nutrients: n,
    lockedNutrientKeys: Array.isArray(ledger?.lockedNutrientKeys) ? ledger.lockedNutrientKeys : [],
    dbSource: ledger?.dbSource || 'estimated',
    dbId: ledger?.dbId || null,
    // Printed-label evidence must survive to the savable item or no downstream
    // consumer (badge, reuse projection, composite restage) can ever prove OCR.
    rawNutritionLabel: (ledger as any)?.rawNutritionLabel || null,
    labelNutrientsPerServing: (ledger as any)?.labelNutrientsPerServing || null,
    brandLock: ledger?.brandLock || null,
    atwaterFlag: ledger?.atwaterFlag || null,
    ingredientsList: ledger?.ingredientsList || (Array.isArray(ledger?.ingredients) ? ledger.ingredients.join(', ') : null),
    visualIngredients: ledger?.visualIngredients || null,
    components: comps.length > 0 ? comps : null,
    componentsDetailList: comps.length > 0 ? comps : [],
    compositeSiblings: comps.length > 0 ? comps : [],
    hasComponents: Boolean(ledger?.hasComponents || comps.length > 1),
    boundingBox2D: box,
    sourceImageIndex,
    foodType: extras.foodType || ledger?.dishClass || ledger?.foodType || null,
    cookingMethod: extras.cookingMethod || ledger?.cookingMethod || null,
    diningEnvironment: extras.diningEnvironment || ledger?.diningEnvironment || null,
    isDishEstimate: true,
  };
}

function dietRowForLedger(dietItems: any[], ledger: any): any | null {
  if (!Array.isArray(dietItems) || dietItems.length === 0) return null;

  if (ledger?.scoutIndex !== undefined && ledger?.scoutIndex !== null) {
    const byIdx = dietItems.find((d: any) => d.scoutIndex === ledger.scoutIndex);
    if (byIdx) return byIdx;
  }
  const ledgerName = String(ledger?.originalName || ledger?.keyword || ledger?.name || '').trim().toLowerCase();
  if (!ledgerName) return null;
  return dietItems.find((d: any) => {
    const n = String(d.canonicalDbName || d.name || '').trim().toLowerCase();
    return n && n === ledgerName;
  }) || null;
}

/**
 * Build the savable meal book from finalize ledgers.
 * Diet itemsBreakdown is optional: only correctedNutrients / clinical notes / names are read.
 */
export function buildMealFromFinalizeLedgers(
  ledgers: any[],
  opts: {
    dietItems?: any[] | null;
    diningEnvironment?: string;
    mealName?: string;
    date?: string;
  } = {}
): { items: any[]; nutrients: Record<string, number>; weightGrams: number; name: string; receiptTable: string } {
  const dietItems = Array.isArray(opts.dietItems) ? opts.dietItems : [];
  const items = (ledgers || []).map((ledger: any) => {
    const dItem = dietRowForLedger(dietItems, ledger);

    const food = ledgerToFoodItem(ledger, {
      diningEnvironment: opts.diningEnvironment,
      boundingBox2D: ledger.boundingBox2D,
      sourceImageIndex: typeof ledger.sourceImageIndex === 'number' ? ledger.sourceImageIndex : 0,
      foodType: dItem?.foodType,
      cookingMethod: dItem?.cookingMethod,
    });

    if (dItem?.canonicalDbName && String(dItem.canonicalDbName).trim()) {
      const nm = String(dItem.canonicalDbName).trim();
      food.name = nm;
      food.canonicalDbName = nm;
    }
    if (dItem?.correctedNutrients && typeof dItem.correctedNutrients === 'object') {
      const n = { ...food.nutrients };
      for (const [k, v] of Object.entries(dItem.correctedNutrients)) {
        if (v !== null && v !== undefined && Number.isFinite(Number(v))) n[k] = Number(v);
      }
      const rebalanced = rebalanceNutrientProfile(n, food.weightGrams);
      Object.assign(n, rebalanced);
      food.nutrients = n;
      food.calories = n.calories ?? food.calories;
      food.protein = n.protein ?? food.protein;
      food.totalFat = n.totalFat ?? food.totalFat;
      food.saturatedFat = n.saturatedFat ?? food.saturatedFat;
      food.carbohydrates = n.carbohydrates ?? food.carbohydrates;
      food.sodium = n.sodium ?? food.sodium;
      food.clinicalCorrectionNote = dItem.clinicalCorrectionNote || null;
    }
    if (dItem) food.diningEnvironment = opts.diningEnvironment || food.diningEnvironment;
    return food;
  });

  const nutrients = sumItemNutrients(items);
  const weightGrams = Math.round(items.reduce((acc, it) => acc + (Number(it.weightGrams) || 0), 0));
  const name = opts.mealName || items.map((it) => it.name).filter(Boolean).join(', ') || 'Meal';
  const receiptTable = formatMealReceiptTable(items, nutrients, weightGrams);
  return { items, nutrients, weightGrams, name, receiptTable };
}
