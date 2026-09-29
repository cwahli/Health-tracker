/**
 * portionUtils.ts - Pure functions for whole-meal and per-dish portion scaling.
 */

export interface FoodLogLike {
  weightGrams?: number;
  calories?: number;
  saturatedFat?: number;
  sodium?: number;
  nutrients?: Record<string, any>;
  itemsBreakdown?: any[];
  portionRatio?: number;
  portionAccepted?: boolean;
  portionDescription?: string;
  receiptTable?: string;
  message?: string;
  description?: string;
  healthImpact?: string;
  [key: string]: any;
}

export function synchronizeNarrativeText(
  text: string,
  grandCal: number,
  grandP: number,
  grandFat: number,
  grandSatFat: number,
  grandNa: number,
  grandCarbs?: number,
  grandFiber?: number
): string {
  if (!text || typeof text !== 'string') return text;

  let updated = text;

  const calVal = Math.round(grandCal);
  const pVal = Math.round(grandP * 10) / 10;
  const fatVal = Math.round(grandFat * 10) / 10;
  const satFatVal = Math.round(grandSatFat * 10) / 10;
  const naVal = Math.round(grandNa);
  const naFormatted = naVal.toLocaleString('en-US');

  const safeAdj = `(?:(?!\\b(?:and|with|plus|or|including|protein|fat|calories|sugar|sodium|carbs|carbohydrates|carbohydrate|fiber|fibre)\\b)[a-zA-Z-]+\\s+){0,2}`;

  // 1. Calories
  const calRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(${safeAdj}(?:calories|kcal))\\b`, 'gi');
  updated = updated.replace(calRe, (_match, _num, rest) => `${calVal} ${rest}`);

  // 2. Sodium
  const naRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(mg\\s*(?:of\\s+)?${safeAdj}sodium)\\b`, 'gi');
  updated = updated.replace(naRe, (_match, _num, rest) => `${naFormatted}${rest}`);
  updated = updated.replace(/(sodium\s*\([^)]*)([\d,]+(?:\.\d+)?)(\s*mg[^)]*\))/gi, (_match, p1, _num, p3) => `${p1}${naFormatted}${p3}`);
  updated = updated.replace(/(sodium\s*(?:[a-zA-Z-]+\s+){0,3}(?:to|is|at|under|below|around|of|:)\s*)([\d,]+(?:\.\d+)?)(\s*mg)/gi, (_match, p1, _num, p3) => `${p1}${naFormatted}${p3}`);

  // 3. Saturated Fat
  const satFatRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}saturated\\s*fat)\\b`, 'gi');
  updated = updated.replace(satFatRe, (_match, _num, rest) => `${satFatVal}${rest}`);
  updated = updated.replace(/(saturated\s*fat\s*\([^)]*)([\d,]+(?:\.\d+)?)(\s*g[^)]*\))/gi, (_match, p1, _num, p3) => `${p1}${satFatVal}${p3}`);
  updated = updated.replace(/(saturated\s*fat\s*:\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (_match, p1, _num, p3) => `${p1}${satFatVal}${p3}`);

  // 4. Total Fat
  const fatRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}total\\s*fat)\\b`, 'gi');
  updated = updated.replace(fatRe, (_match, _num, rest) => `${fatVal}${rest}`);

  // 5. Protein
  const pRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}protein)\\b`, 'gi');
  updated = updated.replace(pRe, (_match, _num, rest) => `${pVal}${rest}`);
  updated = updated.replace(/(protein\s*\([^)]*)([\d,]+(?:\.\d+)?)(\s*g[^)]*\))/gi, (_match, p1, _num, p3) => `${p1}${pVal}${p3}`);
  updated = updated.replace(/(protein\s*:\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (_match, p1, _num, p3) => `${p1}${pVal}${p3}`);

  // 6. Carbohydrates
  if (grandCarbs !== undefined && grandCarbs > 0) {
    const carbVal = Math.round(grandCarbs * 10) / 10;
    const carbRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}(?:carbohydrates|carbs))\\b`, 'gi');
    updated = updated.replace(carbRe, (_match, _num, rest) => `${carbVal}${rest}`);
  }

  // 7. Fiber
  if (grandFiber !== undefined && grandFiber >= 0) {
    const fiberVal = Math.round(grandFiber * 10) / 10;
    const fiberRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}(?:fiber|fibre|dietary\\s*fiber))\\b`, 'gi');
    updated = updated.replace(fiberRe, (_match, _num, rest) => `${fiberVal}${rest}`);
    updated = updated.replace(/(fiber\s*\([^)]*)([\d,]+(?:\.\d+)?)(\s*g[^)]*\))/gi, (_match, p1, _num, p3) => `${p1}${fiberVal}${p3}`);
    updated = updated.replace(/(fiber\s*(?:[a-zA-Z-]+\s+){0,3}(?:to|is|at|under|below|around|of|:)\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (_match, p1, _num, p3) => `${p1}${fiberVal}${p3}`);
  }

  return updated;
}

export function buildReceiptTableFromLog(log: FoodLogLike): string {
  const items = log.itemsBreakdown || [];
  if (!items || items.length === 0) return log.receiptTable || "";

  let md = "### 🧾 Nutrition calculation\n\n";
  md += "| ITEM / INGREDIENT | KCAL | PROTEIN | SAT FAT | SODIUM |\n";
  md += "|:---|:---|:---|:---|:---|\n";

  let grandCal = 0;
  let grandP = 0;
  let grandSatFat = 0;
  let grandNa = 0;
  let grandWeight = 0;

  const fVal = (val: any, unit: string = '', isPlus: boolean = false) => {
    if (val === null || val === undefined) return `0${unit}`;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || Math.abs(num) < 0.05) return `0${unit}`;
    const rounded = Math.round(num * 10) / 10;
    if (rounded === 0) return `0${unit}`;
    const prefix = (isPlus && rounded > 0) ? '+' : '';
    return `${prefix}${rounded}${unit}`;
  };

  items.forEach((it: any, idx: number) => {
    if (!it || typeof it !== 'object') return;
    const itemWeightG = Number(it.weightGrams || it.estimatedWeightGrams || 0);
    const itemCal = Number(it.calories ?? it.nutrients?.calories ?? 0);
    const itemP = Number(it.proteinGrams ?? it.nutrients?.proteinGrams ?? it.nutrients?.protein ?? 0);
    const itemSatFat = Number(it.saturatedFat ?? it.nutrients?.saturatedFat ?? 0);
    const itemNa = Number(it.sodium ?? it.nutrients?.sodium ?? 0);

    grandWeight += itemWeightG;
    grandCal += itemCal;
    grandP += itemP;
    grandSatFat += itemSatFat;
    grandNa += itemNa;

    const dishTitle = (
      it.originalName ||
      it.originalLocalName ||
      it.keyword ||
      it.name ||
      it.canonicalDbName ||
      `Item ${idx + 1}`
    );

    const badge = it.dbSource === 'estimated_override'
      ? ` ⚠️ [SANITY CHECK OVERRIDE: ${it.overrideReason || 'Adjusted Value'}]`
      : (it.isUnverified ? " ⚠️ (Est)" : "");

    let visualBreakdownStr = "";
    if (it.visualIngredients && Array.isArray(it.visualIngredients) && it.visualIngredients.length > 0) {
      visualBreakdownStr = ` (${it.visualIngredients.join(', ')})`;
    } else if (it.components && Array.isArray(it.components) && it.components.length > 0) {
      visualBreakdownStr = ` (${it.components.map((c: any) => typeof c === 'string' ? c : c.searchQuery || c.name || c.keyword).join(', ')})`;
    }

    md += `| **${idx + 1}. ${dishTitle}**${badge} - ${itemWeightG}g${visualBreakdownStr} | - | - | - | - |\n`;
    md += `| Estimated ${dishTitle} - ${itemWeightG}g | ${fVal(itemCal)} | ${fVal(itemP, "g")} | ${fVal(itemSatFat, "g")} | ${fVal(itemNa, "mg")} |\n`;
    md += `| **Item Sub-Total - ${itemWeightG}g** | **${fVal(itemCal)}** | **${fVal(itemP, "g")}** | **${fVal(itemSatFat, "g")}** | **${fVal(itemNa, "mg")}** |\n`;
  });

  if (items.length > 1 || log.receiptTable?.includes('GRAND MEAL TOTAL')) {
    const finalW = log.weightGrams ?? grandWeight;
    const finalCal = log.calories ?? grandCal;
    const finalP = log.nutrients?.proteinGrams ?? log.nutrients?.protein ?? grandP;
    const finalSatFat = log.nutrients?.saturatedFat ?? grandSatFat;
    const finalNa = log.nutrients?.sodium ?? grandNa;

    md += `| **🏆 GRAND MEAL TOTAL - ${finalW}g** | **${fVal(finalCal)}** | **${fVal(finalP, "g")}** | **${fVal(finalSatFat, "g")}** | **${fVal(finalNa, "mg")}** |\n`;
  }

  return md;
}

function scaleNutrientObj(obj?: Record<string, any>, factor: number = 1.0): Record<string, any> | undefined {
  if (!obj || typeof obj !== 'object') return obj;
  const res: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && !isNaN(v)) {
      res[k] = Math.round(v * factor * 10) / 10;
    } else {
      res[k] = v;
    }
  }
  return res;
}

function scaleSubcomponents(subComps: any[] | undefined, factor: number): any[] | undefined {
  if (!Array.isArray(subComps)) return subComps;
  return subComps.map((c: any) => {
    if (!c || typeof c !== 'object') return c;
    const cWeight = c.weightGrams || c.estimatedWeightGrams;
    const cEstWeight = c.estimatedWeightGrams || c.weightGrams;
    const scaledItemNutrients = scaleNutrientObj(c.nutrients || c.nutritionFacts, factor);
    const scaledTruthNutrients = scaleNutrientObj(c.truthNutrients, factor);

    const scaledP = scaledItemNutrients?.protein ?? (c.protein ? Math.round(c.protein * factor * 10) / 10 : (c.proteinGrams ? Math.round(c.proteinGrams * factor * 10) / 10 : 0));
    const scaledCarbs = scaledItemNutrients?.carbohydrates ?? (c.carbohydrates ? Math.round(c.carbohydrates * factor * 10) / 10 : (c.carbs ? Math.round(c.carbs * factor * 10) / 10 : (c.carbsGrams ? Math.round(c.carbsGrams * factor * 10) / 10 : 0)));
    const scaledSatFat = c.saturatedFat ? Math.round(c.saturatedFat * factor * 10) / 10 : (scaledItemNutrients?.saturatedFat || 0);
    const rawTotalFat = scaledItemNutrients?.totalFat ?? (c.totalFat ? Math.round(c.totalFat * factor * 10) / 10 : (c.fat ? Math.round(c.fat * factor * 10) / 10 : (c.fatGrams ? Math.round(c.fatGrams * factor * 10) / 10 : 0)));
    const scaledTotalFat = Math.max(rawTotalFat, scaledSatFat);
    const scaledCal = c.calories ? Math.round(c.calories * factor) : (scaledItemNutrients?.calories || c.calories);
    const scaledSodium = c.sodium ? Math.round(c.sodium * factor) : (scaledItemNutrients?.sodium || c.sodium);

    if (scaledItemNutrients) {
      scaledItemNutrients.protein = scaledP;
      scaledItemNutrients.carbohydrates = scaledCarbs;
      scaledItemNutrients.totalFat = scaledTotalFat;
      scaledItemNutrients.saturatedFat = scaledSatFat;
      scaledItemNutrients.calories = scaledCal;
      scaledItemNutrients.sodium = scaledSodium;
    }

    return {
      ...c,
      weightGrams: cWeight ? Math.round(cWeight * factor) : cWeight,
      estimatedWeightGrams: cEstWeight ? Math.round(cEstWeight * factor) : cEstWeight,
      calories: scaledCal,
      protein: scaledP,
      proteinGrams: scaledP,
      carbohydrates: scaledCarbs,
      carbs: scaledCarbs,
      carbsGrams: scaledCarbs,
      totalFat: scaledTotalFat,
      fat: scaledTotalFat,
      fatGrams: scaledTotalFat,
      saturatedFat: scaledSatFat,
      sodium: scaledSodium,
      nutrients: scaledItemNutrients || c.nutrients,
      truthNutrients: scaledTruthNutrients || c.truthNutrients,
      nutritionFacts: scaledItemNutrients || c.nutritionFacts,
    };
  });
}

export function scaleMealPortion<T extends FoodLogLike>(currentLog: T, ratio: number): T {
  const baseScale = currentLog.portionRatio || 1.0;
  const factor = ratio / baseScale;

  const updatedNutrients = scaleNutrientObj(currentLog.nutrients, factor) || {};
  if (updatedNutrients.totalFat != null && updatedNutrients.saturatedFat != null) {
    if (updatedNutrients.totalFat < updatedNutrients.saturatedFat) {
      updatedNutrients.totalFat = updatedNutrients.saturatedFat;
    }
  }

  const updatedItems = (currentLog.itemsBreakdown || []).map((it: any) => {
    const itemWeight = it.weightGrams || it.estimatedWeightGrams;
    const itemEstWeight = it.estimatedWeightGrams || it.weightGrams;
    const newWeight = itemWeight ? Math.round(itemWeight * factor) : itemWeight;
    const newEstWeight = itemEstWeight ? Math.round(itemEstWeight * factor) : itemEstWeight;

    const scaledItemNutrients = scaleNutrientObj(it.nutrients || it.nutritionFacts, factor);
    const scaledTruthNutrients = scaleNutrientObj(it.truthNutrients, factor);

    const scaledP = scaledItemNutrients?.protein ?? (it.protein ? Math.round(it.protein * factor * 10) / 10 : (it.proteinGrams ? Math.round(it.proteinGrams * factor * 10) / 10 : 0));
    const scaledCarbs = scaledItemNutrients?.carbohydrates ?? (it.carbohydrates ? Math.round(it.carbohydrates * factor * 10) / 10 : (it.carbs ? Math.round(it.carbs * factor * 10) / 10 : (it.carbsGrams ? Math.round(it.carbsGrams * factor * 10) / 10 : 0)));
    const scaledSatFat = it.saturatedFat ? Math.round(it.saturatedFat * factor * 10) / 10 : (scaledItemNutrients?.saturatedFat || 0);
    const rawTotalFat = scaledItemNutrients?.totalFat ?? (it.totalFat ? Math.round(it.totalFat * factor * 10) / 10 : (it.fat ? Math.round(it.fat * factor * 10) / 10 : (it.fatGrams ? Math.round(it.fatGrams * factor * 10) / 10 : 0)));
    const scaledTotalFat = Math.max(rawTotalFat, scaledSatFat);
    const scaledCal = it.calories ? Math.round(it.calories * factor) : (scaledItemNutrients?.calories || it.calories);
    const scaledSodium = it.sodium ? Math.round(it.sodium * factor) : (scaledItemNutrients?.sodium || it.sodium);

    if (scaledItemNutrients) {
      scaledItemNutrients.protein = scaledP;
      scaledItemNutrients.carbohydrates = scaledCarbs;
      scaledItemNutrients.totalFat = scaledTotalFat;
      scaledItemNutrients.saturatedFat = scaledSatFat;
      scaledItemNutrients.calories = scaledCal;
      scaledItemNutrients.sodium = scaledSodium;
    }

    return {
      ...it,
      weightGrams: newWeight,
      estimatedWeightGrams: newEstWeight,
      calories: scaledCal,
      protein: scaledP,
      proteinGrams: scaledP,
      carbohydrates: scaledCarbs,
      carbs: scaledCarbs,
      carbsGrams: scaledCarbs,
      totalFat: scaledTotalFat,
      fat: scaledTotalFat,
      fatGrams: scaledTotalFat,
      saturatedFat: scaledSatFat,
      sodium: scaledSodium,
      nutrients: scaledItemNutrients || it.nutrients,
      truthNutrients: scaledTruthNutrients || it.truthNutrients,
      portionRatio: ratio,
      portionDescription: newWeight ? `${newWeight}g` : `${ratio}x`,
      compositeSiblings: scaleSubcomponents(it.compositeSiblings, factor),
      componentsDetailList: scaleSubcomponents(it.componentsDetailList, factor),
      components: scaleSubcomponents(it.components, factor),
    };
  });

  const updatedWeight = currentLog.weightGrams ? Math.round(currentLog.weightGrams * factor) : currentLog.weightGrams;
  const updatedCalories = currentLog.calories ? Math.round(currentLog.calories * factor) : (updatedNutrients.calories || 0);

  const rawScout = (currentLog as any).scoutItems || (currentLog as any).scoutSnapshot || [];
  const updatedScoutItems = Array.isArray(rawScout) && rawScout.length > 0
    ? rawScout.map((sItem: any, idx: number) => {
        const matchingBreakdown = updatedItems[idx] || updatedItems.find((it: any) => it.scoutIndex === sItem.scoutIndex) || sItem;
        return {
          ...sItem,
          weightGrams: matchingBreakdown.weightGrams,
          estimatedWeightGrams: matchingBreakdown.estimatedWeightGrams,
          portionRatio: matchingBreakdown.portionRatio,
          portionDescription: matchingBreakdown.portionDescription,
          calories: matchingBreakdown.calories,
          saturatedFat: matchingBreakdown.saturatedFat,
          sodium: matchingBreakdown.sodium,
          proteinGrams: matchingBreakdown.proteinGrams,
          carbsGrams: matchingBreakdown.carbsGrams,
          fatGrams: matchingBreakdown.fatGrams,
          nutrients: matchingBreakdown.nutrients || sItem.nutrients,
          nutritionFacts: matchingBreakdown.nutrients || sItem.nutritionFacts,
        };
      })
    : updatedItems;

  const resLog: T = {
    ...currentLog,
    initialWeightGrams: currentLog.initialWeightGrams || currentLog.weightGrams,
    weightGrams: updatedWeight,
    calories: updatedCalories,
    nutrients: updatedNutrients,
    itemsBreakdown: updatedItems,
    scoutItems: updatedScoutItems,
    portionRatio: ratio,
    portionAccepted: true,
    portionDescription: updatedWeight ? `${updatedWeight}g` : `${ratio}x`
  };

  if (currentLog.receiptTable || updatedItems.length > 0) {
    resLog.receiptTable = buildReceiptTableFromLog(resLog);
  }

  const grandCal = updatedCalories;
  const grandP = updatedNutrients.proteinGrams ?? updatedNutrients.protein ?? 0;
  const grandFat = updatedNutrients.fatGrams ?? updatedNutrients.totalFat ?? 0;
  const grandSatFat = updatedNutrients.saturatedFat ?? 0;
  const grandNa = updatedNutrients.sodium ?? 0;
  const grandCarbs = updatedNutrients.carbsGrams ?? updatedNutrients.carbohydrates ?? 0;
  const grandFiber = updatedNutrients.fiber ?? updatedNutrients.totalFibre ?? updatedNutrients.dietaryFiber ?? updatedNutrients.totalFiber ?? updatedNutrients.fiberGrams ?? 0;

  if (resLog.message) {
    resLog.message = synchronizeNarrativeText(resLog.message, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs, grandFiber);
  }
  if (resLog.description) {
    resLog.description = synchronizeNarrativeText(resLog.description, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs, grandFiber);
  }

  return resLog;
}

export function scaleSingleDishPortion<T extends FoodLogLike>(currentLog: T, dishIdx: number, ratio: number): T {
  const items = [...(currentLog.itemsBreakdown || [])];
  if (!items[dishIdx]) return currentLog;

  const targetItem = items[dishIdx];
  const prevRatio = targetItem.portionRatio || 1.0;
  const factor = ratio / prevRatio;

  const itemWeight = targetItem.weightGrams || targetItem.estimatedWeightGrams;
  const itemEstWeight = targetItem.estimatedWeightGrams || targetItem.weightGrams;
  const newWeight = itemWeight ? Math.round(itemWeight * factor) : itemWeight;
  const newEstWeight = itemEstWeight ? Math.round(itemEstWeight * factor) : itemEstWeight;

  const scaledItemNutrients = scaleNutrientObj(targetItem.nutrients || targetItem.nutritionFacts, factor);
  const scaledTruthNutrients = scaleNutrientObj(targetItem.truthNutrients, factor);

  const scaledP = scaledItemNutrients?.protein ?? (targetItem.protein ? Math.round(targetItem.protein * factor * 10) / 10 : (targetItem.proteinGrams ? Math.round(targetItem.proteinGrams * factor * 10) / 10 : 0));
  const scaledCarbs = scaledItemNutrients?.carbohydrates ?? (targetItem.carbohydrates ? Math.round(targetItem.carbohydrates * factor * 10) / 10 : (targetItem.carbs ? Math.round(targetItem.carbs * factor * 10) / 10 : (targetItem.carbsGrams ? Math.round(targetItem.carbsGrams * factor * 10) / 10 : 0)));
  const scaledSatFat = targetItem.saturatedFat ? Math.round(targetItem.saturatedFat * factor * 10) / 10 : (scaledItemNutrients?.saturatedFat || 0);
  const rawTotalFat = scaledItemNutrients?.totalFat ?? (targetItem.totalFat ? Math.round(targetItem.totalFat * factor * 10) / 10 : (targetItem.fat ? Math.round(targetItem.fat * factor * 10) / 10 : (targetItem.fatGrams ? Math.round(targetItem.fatGrams * factor * 10) / 10 : 0)));
  const scaledTotalFat = Math.max(rawTotalFat, scaledSatFat);
  const scaledCal = targetItem.calories ? Math.round(targetItem.calories * factor) : (scaledItemNutrients?.calories || targetItem.calories);
  const scaledSodium = targetItem.sodium ? Math.round(targetItem.sodium * factor) : (scaledItemNutrients?.sodium || targetItem.sodium);

  if (scaledItemNutrients) {
    scaledItemNutrients.protein = scaledP;
    scaledItemNutrients.carbohydrates = scaledCarbs;
    scaledItemNutrients.totalFat = scaledTotalFat;
    scaledItemNutrients.saturatedFat = scaledSatFat;
    scaledItemNutrients.calories = scaledCal;
    scaledItemNutrients.sodium = scaledSodium;
  }

  const updatedDish = {
    ...targetItem,
    weightGrams: newWeight,
    estimatedWeightGrams: newEstWeight,
    calories: scaledCal,
    protein: scaledP,
    proteinGrams: scaledP,
    carbohydrates: scaledCarbs,
    carbs: scaledCarbs,
    carbsGrams: scaledCarbs,
    totalFat: scaledTotalFat,
    fat: scaledTotalFat,
    fatGrams: scaledTotalFat,
    saturatedFat: scaledSatFat,
    sodium: scaledSodium,
    nutrients: scaledItemNutrients || targetItem.nutrients,
    truthNutrients: scaledTruthNutrients || targetItem.truthNutrients,
    portionRatio: ratio,
    portionDescription: newWeight ? `${newWeight}g` : `${ratio}x`,
    compositeSiblings: scaleSubcomponents(targetItem.compositeSiblings, factor),
    componentsDetailList: scaleSubcomponents(targetItem.componentsDetailList, factor),
    components: scaleSubcomponents(targetItem.components, factor),
  };
  items[dishIdx] = updatedDish;

  const newTotalWeight = items.reduce((acc, it) => acc + (Number(it.weightGrams || it.estimatedWeightGrams) || 0), 0);
  const newTotalCalories = items.reduce((acc, it) => acc + (Number(it.calories) || 0), 0);
  const newTotalSatFat = Math.round(items.reduce((acc, it) => acc + (Number(it.saturatedFat) || 0), 0) * 10) / 10;
  const newTotalSodium = items.reduce((acc, it) => acc + (Number(it.sodium) || 0), 0);

  const aggregateNutrients: Record<string, number> = { ...(currentLog.nutrients || {}) };
  aggregateNutrients.calories = newTotalCalories;
  aggregateNutrients.saturatedFat = newTotalSatFat;
  aggregateNutrients.sodium = newTotalSodium;

  const allNutrientKeys = new Set<string>();
  items.forEach(it => {
    if (it.nutrients && typeof it.nutrients === 'object') {
      Object.keys(it.nutrients).forEach(k => allNutrientKeys.add(k));
    }
  });

  allNutrientKeys.forEach(k => {
    const keySum = items.reduce((acc, it) => {
      const val = it.nutrients?.[k];
      return acc + (typeof val === 'number' ? val : 0);
    }, 0);
    aggregateNutrients[k] = Math.round(keySum * 10) / 10;
  });
  if (aggregateNutrients.totalFat != null && aggregateNutrients.saturatedFat != null) {
    if (aggregateNutrients.totalFat < aggregateNutrients.saturatedFat) {
      aggregateNutrients.totalFat = aggregateNutrients.saturatedFat;
    }
  }

  const rawScout = (currentLog as any).scoutItems || (currentLog as any).scoutSnapshot || [];
  const updatedScoutItems = Array.isArray(rawScout) && rawScout.length > 0
    ? rawScout.map((sItem: any, idx: number) => {
        const matchingBreakdown = items[idx] || items.find((it: any) => it.scoutIndex === sItem.scoutIndex) || sItem;
        return {
          ...sItem,
          weightGrams: matchingBreakdown.weightGrams,
          estimatedWeightGrams: matchingBreakdown.estimatedWeightGrams,
          portionRatio: matchingBreakdown.portionRatio,
          portionDescription: matchingBreakdown.portionDescription,
          calories: matchingBreakdown.calories,
          protein: matchingBreakdown.protein,
          carbohydrates: matchingBreakdown.carbohydrates,
          totalFat: matchingBreakdown.totalFat,
          saturatedFat: matchingBreakdown.saturatedFat,
          sodium: matchingBreakdown.sodium,
          proteinGrams: matchingBreakdown.proteinGrams,
          carbsGrams: matchingBreakdown.carbsGrams,
          fatGrams: matchingBreakdown.fatGrams,
          nutrients: matchingBreakdown.nutrients || sItem.nutrients,
          nutritionFacts: matchingBreakdown.nutrients || sItem.nutritionFacts,
        };
      })
    : items;

  const oldTotalWeight = (currentLog.itemsBreakdown || []).reduce((acc, it) => {
    const w = it.weightGrams || it.estimatedWeightGrams;
    return acc + (Number(w) || 0);
  }, 0);
  const overallRatio = oldTotalWeight > 0 && newTotalWeight > 0 ? Math.round((newTotalWeight / oldTotalWeight) * 100) / 100 : (currentLog.portionRatio || 1.0);

  const resLog: T = {
    ...currentLog,
    initialWeightGrams: currentLog.initialWeightGrams || currentLog.weightGrams,
    weightGrams: newTotalWeight,
    calories: newTotalCalories,
    nutrients: aggregateNutrients,
    itemsBreakdown: items,
    scoutItems: updatedScoutItems,
    portionRatio: overallRatio,
    portionAccepted: true,
  };

  if (currentLog.receiptTable || items.length > 0) {
    resLog.receiptTable = buildReceiptTableFromLog(resLog);
  }

  const grandCal = newTotalCalories;
  const grandP = aggregateNutrients.proteinGrams ?? aggregateNutrients.protein ?? 0;
  const grandFat = aggregateNutrients.fatGrams ?? aggregateNutrients.totalFat ?? 0;
  const grandSatFat = newTotalSatFat;
  const grandNa = newTotalSodium;
  const grandCarbs = aggregateNutrients.carbsGrams ?? aggregateNutrients.carbohydrates ?? 0;
  const grandFiber = aggregateNutrients.fiber ?? aggregateNutrients.totalFibre ?? aggregateNutrients.dietaryFiber ?? aggregateNutrients.totalFiber ?? aggregateNutrients.fiberGrams ?? 0;

  if (resLog.message) {
    resLog.message = synchronizeNarrativeText(resLog.message, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs, grandFiber);
  }
  if (resLog.description) {
    resLog.description = synchronizeNarrativeText(resLog.description, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs, grandFiber);
  }

  return resLog;
}

export interface PortionChoicesResult<T> {
  updatedLog: T;
  isOverThreshold: boolean;
  maxDiffPercent: number;
  changesSummary: string;
}

/**
 * Applies serving size clarification choices (e.g. from PortionClarifyCard) to a food log.
 * Evaluates whether any adjusted item deviates by more than 30% from its original estimated weight.
 * If <= 30%: re-scales the dishes and meal totals locally without needing an agent call.
 * If > 30%: re-scales dishes locally and flags isOverThreshold=true so an agent edit review can be triggered.
 */
export function applyPortionChoicesToLog<T extends FoodLogLike>(
  currentLog: T,
  choices: Record<string, number>
): PortionChoicesResult<T> {
  let log = { ...currentLog };
  let maxDiffPercent = 0;
  let isOverThreshold = false;
  const changeDescriptions: string[] = [];

  const items = Array.isArray(log.itemsBreakdown) ? [...log.itemsBreakdown] : [];

  const currentKcal = Number((log as any).calories ?? (log as any).nutrients?.calories ?? 0);
  const currentG = Number((log as any).weightGrams ?? 0);
  const currentFat = Number((log as any).nutrients?.totalFat ?? (log as any).nutrients?.fatGrams ?? (log as any).nutrients?.fat ?? 0);
  const currentDensity = currentG > 0 ? currentKcal / currentG : 0;
  // Insane ledger (WRONG_BASIS leftover): never take the local ≤30% shortcut.
  if ((currentG > 0 && currentDensity > 9.2) || (currentG > 0 && currentFat > currentG + 1)) {
    isOverThreshold = true;
  }

  for (const [key, targetWeight] of Object.entries(choices)) {
    const targetGrams = Math.round(Number(targetWeight));
    if (!targetGrams || targetGrams <= 0) continue;

    // Match dish by scoutIndex or array index
    const targetIdx = items.findIndex((it: any, idx: number) => {
      if (it.scoutIndex != null && String(it.scoutIndex) === String(key)) return true;
      return String(idx) === String(key);
    });

    if (targetIdx >= 0) {
      const it = items[targetIdx];
      const initialWeight = Math.round(Number(it.initialWeightGrams || it.estimatedWeightGrams || it.weightGrams || 100));
      const ratio = targetGrams / initialWeight;
      const diffRatio = Math.abs(targetGrams - initialWeight) / initialWeight;
      const diffPercent = Math.round(diffRatio * 100);

      if (diffPercent > maxDiffPercent) {
        maxDiffPercent = diffPercent;
      }
      if (diffRatio > 0.30) {
        isOverThreshold = true;
      }

      const itemName = it.name || it.originalName || it.keyword || `Item #${targetIdx + 1}`;
      changeDescriptions.push(`${itemName}: ${initialWeight}g ➔ ${targetGrams}g (${diffPercent > 0 ? (targetGrams > initialWeight ? `+${diffPercent}%` : `-${diffPercent}%`) : '0%'})`);

      log = scaleSingleDishPortion(log, targetIdx, ratio);
    }
  }

  (log as any).portionAdjustment = {
    type: isOverThreshold ? 'agent_edit' : 'local_math',
    diffPercent: maxDiffPercent,
    fromWeight: log.initialWeightGrams || log.weightGrams || 0,
    toWeight: log.weightGrams || 0,
    agentCalled: isOverThreshold,
    reason: isOverThreshold
      ? `Portion selection changed item by ${maxDiffPercent}% (> 30%). Triggered agent review edit.`
      : `Portion selection changed item by ${maxDiffPercent}% (<= 30%). Recalculated locally without extra agent call.`,
  };

  return {
    updatedLog: log,
    isOverThreshold,
    maxDiffPercent,
    changesSummary: changeDescriptions.join(', '),
  };
}

