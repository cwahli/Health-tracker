import { z } from "zod";

export const LABEL_STOPWORDS = new Set([
  'nutrition', 'facts', 'label', 'back', 'of', 'package', 'informasi', 'nilai', 'gizi', 'komposisi', 'the', 'a', 'and',
]);
const GENERIC_FOOD_TOKENS = new Set([
  'ham', 'pork', 'chicken', 'beef', 'meat', 'cheese', 'milk', 'bread', 'rice', 'pasta', 'sauce', 'salad',
  'juice', 'water', 'oil', 'salt', 'sugar', 'egg', 'fruit', 'slice', 'sliced', 'cured', 'cooked',
]);
const HAM_DRY_CURED = new Set(['serrano', 'iberico', 'prosciutto', 'parma', 'jamon', 'reserva', 'gran']);
const HAM_COOKED_FORMED = new Set(['reformed', 'formed', 'cooked']);
export function tokenizeScoutName(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !LABEL_STOPWORDS.has(t))
    .map((t) => (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t));
}
/** Pure: should a standalone nutrition-label scout item fold into this food item? */
export function canMergeScoutLabelIntoFood(
  labelItem: { originalName?: string; keyword?: string },
  foodItem: { originalName?: string; keyword?: string }
): { ok: boolean; score: number; reason: string } {
  const labelTokens = tokenizeScoutName(labelItem.originalName || labelItem.keyword || '');
  const foodTokens = tokenizeScoutName(foodItem.originalName || foodItem.keyword || '');
  if (!labelTokens.length || !foodTokens.length) {
    return { ok: false, score: 0, reason: 'empty name' };
  }
  const overlap = labelTokens.filter((t) => foodTokens.includes(t));
  const score = overlap.length / Math.min(labelTokens.length, foodTokens.length);
  const distinctiveOverlap = overlap.filter((t) => !GENERIC_FOOD_TOKENS.has(t));
  const labelDry = labelTokens.some((t) => HAM_DRY_CURED.has(t));
  const foodDry = foodTokens.some((t) => HAM_DRY_CURED.has(t));
  const labelFormed = labelTokens.some((t) => HAM_COOKED_FORMED.has(t));
  const foodFormed = foodTokens.some((t) => HAM_COOKED_FORMED.has(t));
  if ((labelDry && foodFormed) || (labelFormed && foodDry)) {
    return { ok: false, score, reason: 'conflicting ham type (dry-cured vs reformed/cooked)' };
  }
  if (distinctiveOverlap.length >= 1 && score >= 0.5) {
    return { ok: true, score, reason: `distinctive overlap ${distinctiveOverlap.join(',')}` };
  }
  const foodExtraType = foodTokens.filter((t) => !GENERIC_FOOD_TOKENS.has(t) && !labelTokens.includes(t));
  if (distinctiveOverlap.length === 0 && foodExtraType.length > 0) {
    return { ok: false, score, reason: `only generic overlap; food has extra type (${foodExtraType.slice(0, 3).join(',')})` };
  }
  if (score >= 0.67 && distinctiveOverlap.length === 0 && foodExtraType.length === 0) {
    return { ok: true, score, reason: 'same generic product' };
  }
  return { ok: false, score, reason: 'name overlap too weak' };
}
export function validateOrFallback<T>(
  schema: z.ZodType<T>,
  parsed: any,
  rawText: string,
  label: string,
  fallback: T,
  addDebugLog: (msg: string) => void
): T {
  const result = schema.safeParse(parsed);
  if (!result.success) {
    addDebugLog(`[Zod Validation Failed] ${label}: ${result.error.message}. Attempting soft recovery...`);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      parsed.items = parsed.items.map((item: any) => {
        if (!item || typeof item !== 'object') return item;
        if (item.ingredients === null) item.ingredients = undefined;
        if (item.components === null) item.components = undefined;
        if (item.lockedNutrientKeys === null) item.lockedNutrientKeys = undefined;
        if (item.boundingBox2D === null) item.boundingBox2D = undefined;
        return item;
      });
      const retryResult = schema.safeParse(parsed);
      if (retryResult.success) {
        addDebugLog(`[Zod Recovery Success] ${label}: Recovered parsed items after sanitizing null fields.`);
        return retryResult.data;
      }
    }
    addDebugLog(`[Zod Hard Fallback] ${label}: Unrecoverable validation error. Raw output: ${rawText}`);
    return fallback;
  }
  return result.data;
}
export function mergeScoutItems(visionItems: any[], llmItems: any[] | null | undefined): any[] {
  if (!visionItems || visionItems.length === 0) {
    return (llmItems && llmItems.length > 0) ? llmItems : [];
  }
  if (!llmItems || llmItems.length === 0) {
    return visionItems;
  }
  return visionItems.map((vItem: any, idx: number) => {
    const lItem = llmItems.find((l: any) => l.scoutIndex === vItem.scoutIndex) || llmItems[idx];
    if (lItem) {
      return {
        ...vItem,
        ...lItem,
        originalName: lItem.originalName ?? vItem.originalName,
        keyword: lItem.keyword ?? vItem.keyword,
        chainName: lItem.chainName ?? vItem.chainName,
        rawNutritionLabel: vItem.rawNutritionLabel,
        nutritionFacts: vItem.nutritionFacts,
        ingredientsList: vItem.ingredientsList,
        ingredients: vItem.ingredients ?? lItem.ingredients ?? [],
        visualIngredients: vItem.visualIngredients || vItem.ingredients || lItem.ingredients || [],
        boundingBox2D: vItem.boundingBox2D,
        sourceImageIndex: vItem.sourceImageIndex,
        source: vItem.source,
        nutrients: vItem.nutrients ?? lItem.nutrients,
        nutrientBasisWeight: vItem.nutrientBasisWeight ?? lItem.nutrientBasisWeight ?? vItem.estimatedWeightGrams,
        lockedNutrientKeys: vItem.lockedNutrientKeys ?? lItem.lockedNutrientKeys,
        // Soft scout kcal must survive ledger merge (same priority as vision OCR fields)
        estimatedCalories: vItem.estimatedCalories ?? lItem.estimatedCalories,
        estimatedWeightGrams: vItem.estimatedWeightGrams ?? lItem.estimatedWeightGrams,
        // Component structure: vision wins when present; never let empty LLM array wipe vision rows
        components:
          Array.isArray(vItem.components) && vItem.components.length > 0
            ? vItem.components
            : (lItem.components ?? vItem.components),
      };
    }
    return vItem;
  });
}
/** Diet/Meal Agent boxes are [ymin, xmin, ymax, xmax] in 0–1000. */
export function isUsableBoundingBox(box: any): box is number[] {
  return Array.isArray(box) && box.length === 4 && box.every((n) => Number.isFinite(Number(n)));
}

export function isDummyFullFrameBox(box: number[]): boolean {
  return (
    (box[0] <= 10 && box[1] <= 10 && box[2] >= 990 && box[3] >= 990) ||
    (box[0] === 100 && box[1] === 100 && box[2] === 900 && box[3] === 900)
  );
}

/** Stack slices of a parent crop by weight so each unrolled top-level item has its own zoom box. */
export function sliceParentBoxByWeights(parent: number[], weights: number[], index: number): number[] {
  const ymin = Number(parent[0]) || 0;
  const xmin = Number(parent[1]) || 0;
  const ymax = Number(parent[2]) || 1000;
  const xmax = Number(parent[3]) || 1000;
  const safe = weights.map((w) => (Number(w) > 0 ? Number(w) : 1));
  const total = safe.reduce((a, w) => a + w, 0) || 1;
  let start = 0;
  for (let i = 0; i < index; i++) start += safe[i];
  const end = start + safe[index];
  const h = Math.max(1, ymax - ymin);
  return [
    Math.round(ymin + (start / total) * h),
    xmin,
    Math.round(ymin + (end / total) * h),
    xmax,
  ];
}

export function boxForUnrolledFood(
  foodBox: any,
  parentBox: any,
  weights: number[],
  index: number,
): number[] {
  if (isUsableBoundingBox(foodBox) && !isDummyFullFrameBox(foodBox.map(Number))) {
    return foodBox.map(Number);
  }
  if (isUsableBoundingBox(parentBox) && !isDummyFullFrameBox(parentBox.map(Number))) {
    return sliceParentBoxByWeights(parentBox, weights, index);
  }
  if (isUsableBoundingBox(parentBox)) return parentBox.map(Number);
  return [0, 0, 1000, 1000];
}

export function clusterSpatialCompositeDishes(
  items: any[],
  addDebugLog?: (msg: string) => void,
  isCompareMode: boolean = false
): any[] {
  if (!items || items.length <= 1 || isCompareMode) return items || [];
  const getBBox = (it: any): [number, number, number, number] => {
    if (Array.isArray(it.boundingBox2D) && it.boundingBox2D.length === 4) {
      return [
        Number(it.boundingBox2D[0]) || 0,
        Number(it.boundingBox2D[1]) || 0,
        Number(it.boundingBox2D[2]) || 1000,
        Number(it.boundingBox2D[3]) || 1000
      ];
    }
    return [0, 0, 1000, 1000];
  };
  const getArea = (box: [number, number, number, number]): number => {
    const h = Math.max(0, box[2] - box[0]);
    const w = Math.max(0, box[3] - box[1]);
    return h * w;
  };
  const getOverlapRatio = (boxA: [number, number, number, number], boxB: [number, number, number, number]): { overlap: number; iou: number } => {
    const areaA = getArea(boxA);
    const areaB = getArea(boxB);
    if (areaA <= 0 || areaB <= 0) return { overlap: 0, iou: 0 };
    const interH = Math.max(0, Math.min(boxA[2], boxB[2]) - Math.max(boxA[0], boxB[0]));
    const interW = Math.max(0, Math.min(boxA[3], boxB[3]) - Math.max(boxA[1], boxB[1]));
    const interArea = interH * interW;
    const minArea = Math.min(areaA, areaB);
    const unionArea = areaA + areaB - interArea;
    return {
      overlap: minArea > 0 ? interArea / minArea : 0,
      iou: unionArea > 0 ? interArea / unionArea : 0
    };
  };
  const isDefaultBox = (b: [number, number, number, number]): boolean => {
    return (b[0] <= 10 && b[1] <= 10 && b[2] >= 990 && b[3] >= 990) ||
           (b[0] === 100 && b[1] === 100 && b[2] === 900 && b[3] === 900);
  };
  const hasDistinctNutrientLabel = (it: any): boolean => {
    const raw = it.rawNutritionLabel;
    if (!raw || typeof raw !== 'object') return false;
    const c = raw.calories ?? raw.energiTotal;
    return c != null && String(c).trim() !== '' && parseFloat(String(c).replace(/[^\d.]/g, '')) > 0;
  };
  const clusteredIndices = new Set<number>();
  const resultDishes: any[] = [];
  for (let i = 0; i < items.length; i++) {
    if (clusteredIndices.has(i)) continue;
    const primary = { ...items[i] };
    const boxA = getBBox(primary);
    const coLocatedIndices: number[] = [];
    for (let j = i + 1; j < items.length; j++) {
      if (clusteredIndices.has(j)) continue;
      const other = items[j];
      // Skip clustering if either item is from spreadsheet
      if (primary.source === 'spreadsheet' || other.source === 'spreadsheet' || primary.isSpreadsheet || other.isSpreadsheet) {
        continue;
      }
      if (primary.unrolledFromSoleDish || other.unrolledFromSoleDish) {
        continue;
      }
      // Same source image check
      const sameImg = (primary.sourceImageIndex ?? 0) === (other.sourceImageIndex ?? 0);
      if (!sameImg) continue;

      const nameA = String(primary.originalName || primary.keyword || '').toLowerCase();
      const nameB = String(other.originalName || other.keyword || '').toLowerCase();
      const cleanKeyA = nameA.replace(/[^a-z0-9\s]/g, '').trim();
      const cleanKeyB = nameB.replace(/[^a-z0-9\s]/g, '').trim();
      const isExactSameFood = cleanKeyA.length > 0 && cleanKeyA === cleanKeyB;

      // Consolidate identical duplicate item observations from the same image regardless of bounding box defaults
      if (isExactSameFood) {
        coLocatedIndices.push(j);
        continue;
      }

      if (isDefaultBox(boxA)) {
        continue;
      }
      // Avoid clustering two distinct packaged commercial items that both have distinct printed nutrition labels
      if (hasDistinctNutrientLabel(primary) && hasDistinctNutrientLabel(other)) {
        continue;
      }
      const boxB = getBBox(other);
      if (isDefaultBox(boxB)) continue;

      const { overlap, iou } = getOverlapRatio(boxA, boxB);
      // High spatial co-location inside the exact same container / bowl / plate
      const hasSeparateComponents = (primary.components?.length > 1 && other.components?.length > 1);
      if (!hasSeparateComponents && (overlap >= 0.70 || iou >= 0.55)) {
        coLocatedIndices.push(j);
      }
    }
    if (coLocatedIndices.length > 0) {
      // Aggregate into 1 composite dish
      const clusterGroup = [primary, ...coLocatedIndices.map(idx => items[idx])];
      coLocatedIndices.forEach(idx => clusteredIndices.add(idx));
      clusteredIndices.add(i);
      const totalWeight = clusterGroup.reduce((sum, it) => sum + (Math.max(10, Number(it.estimatedWeightGrams) || 100)), 0);
      // Build unified components breakdown
      const compositeComponents: any[] = [];
      clusterGroup.forEach(it => {
        const itWeight = Math.max(10, Number(it.estimatedWeightGrams) || 100);
        const itPct = Math.max(1, Math.round((itWeight / totalWeight) * 100));
        if (Array.isArray(it.components) && it.components.length > 0) {
          it.components.forEach((c: any) => {
            const cPct = Math.max(1, Math.round(((Number(c.volumePercentage) || 100) / 100) * itPct));
            const cWeight = Number(c.weightGrams ?? c.estimatedWeightGrams ?? Math.round(totalWeight * (cPct / 100)));
            const cName = String(c.name || c.searchQuery || c.keyword || it.originalName || it.keyword || 'Ingredient').trim();
            const cNuts = c.nutrients || {};
            const cProt = Number(c.protein ?? cNuts.protein ?? 0);
            const cFat = Number(c.totalFat ?? c.fat ?? cNuts.totalFat ?? cNuts.fat ?? cNuts.saturatedFat ?? 0);
            const cSat = Number(c.saturatedFat ?? cNuts.saturatedFat ?? 0);
            const cCarbs = Number(c.carbohydrates ?? c.carbs ?? cNuts.carbohydrates ?? 0);
            const cNa = Number(c.sodium ?? cNuts.sodium ?? 0);
            const rawCals = c.calories ?? cNuts.calories;
            const cCals = rawCals != null && Number.isFinite(Number(rawCals)) ? Number(rawCals) : undefined;
            compositeComponents.push({
              name: cName,
              searchQuery: c.searchQuery || cName,
              weightGrams: cWeight,
              estimatedWeightGrams: cWeight,
              volumePercentage: cPct,
              packGrams: c.packGrams ?? it.packGrams ?? null,
              rawNutritionLabel: c.rawNutritionLabel || it.rawNutritionLabel || undefined,
              nutrients: c.nutrients || undefined,
              ...(cCals != null ? { calories: cCals } : {}),
              protein: cProt,
              totalFat: cFat,
              fat: cFat,
              saturatedFat: cSat,
              carbohydrates: cCarbs,
              sodium: cNa,
              dbSource: c.dbSource || it.dbSource || 'estimated',
              dbId: c.dbId || it.dbId || null,
            });
          });
        } else {
          const cName = String(it.originalName || it.keyword || 'Ingredient').trim();
          const itNuts = it.nutrients || {};
          const itProt = Number(it.protein ?? itNuts.protein ?? 0);
          const itFat = Number(it.totalFat ?? it.fat ?? itNuts.totalFat ?? itNuts.fat ?? itNuts.saturatedFat ?? 0);
          const itSat = Number(it.saturatedFat ?? itNuts.saturatedFat ?? 0);
          const itCarbs = Number(it.carbohydrates ?? it.carbs ?? itNuts.carbohydrates ?? 0);
          const itNa = Number(it.sodium ?? itNuts.sodium ?? 0);
          const rawItCals = it.calories ?? itNuts.calories;
          const itCals = rawItCals != null && Number.isFinite(Number(rawItCals)) ? Number(rawItCals) : undefined;
          compositeComponents.push({
            name: cName,
            searchQuery: cName,
            weightGrams: itWeight,
            estimatedWeightGrams: itWeight,
            volumePercentage: itPct,
            packGrams: it.packGrams ?? null,
            rawNutritionLabel: it.rawNutritionLabel || undefined,
            nutrients: it.nutrients || undefined,
            ...(itCals != null ? { calories: itCals } : {}),
            protein: itProt,
            totalFat: itFat,
            fat: itFat,
            saturatedFat: itSat,
            carbohydrates: itCarbs,
            sodium: itNa,
            dbSource: it.dbSource || 'estimated',
            dbId: it.dbId || null,
          });
        }
      });
      // Normalize component percentages to 100%
      const compSum = compositeComponents.reduce((acc, c) => acc + (c.volumePercentage || 0), 0);
      if (compSum > 0 && compSum !== 100) {
        const factor = 100 / compSum;
        compositeComponents.forEach(c => {
          c.volumePercentage = Math.max(1, Math.round((c.volumePercentage || 0) * factor));
        });
      }
      // Union bounding box
      const min0 = Math.min(...clusterGroup.map(it => getBBox(it)[0]));
      const min1 = Math.min(...clusterGroup.map(it => getBBox(it)[1]));
      const max2 = Math.max(...clusterGroup.map(it => getBBox(it)[2]));
      const max3 = Math.max(...clusterGroup.map(it => getBBox(it)[3]));
      // Composite clean dish title
      const allCompNames = compositeComponents.map(c => c.name).filter(Boolean);
      const distinctNames = Array.from(new Set(allCompNames));
      let compositeDishTitle = primary.originalName || primary.keyword || 'Composed Dish';
      if (distinctNames.length > 1) {
        const missingNames = distinctNames.filter(n => !compositeDishTitle.toLowerCase().includes(n.toLowerCase()));
        if (missingNames.length > 0) {
          compositeDishTitle = `${compositeDishTitle} with ${missingNames.join(', ')}`;
        }
      }
      // Merge nutrients if multiple items with nutrients are clustered
      if (clusterGroup.length > 1 && clusterGroup.some(it => it.nutrients && typeof it.nutrients === 'object')) {
        const mergedNutrients: Record<string, number> = {};
        for (const it of clusterGroup) {
          if (it.nutrients && typeof it.nutrients === 'object') {
            for (const [k, v] of Object.entries(it.nutrients)) {
              if (typeof v === 'number' && Number.isFinite(v)) {
                mergedNutrients[k] = (mergedNutrients[k] || 0) + v;
              }
            }
          }
        }
        primary.nutrients = mergedNutrients;
      }
      const compNamesList = compositeComponents.map(c => c.name);
      primary.originalName = compositeDishTitle;
      primary.keyword = compositeDishTitle;
      primary.name = compositeDishTitle;
      primary.estimatedWeightGrams = totalWeight;
      primary.nutrientBasisWeight = totalWeight;
      primary.boundingBox2D = [min0, min1, max2, max3];
      primary.components = compositeComponents;
      primary.componentsDetailList = compositeComponents;
      primary.compositeSiblings = compositeComponents;
      primary.hasComponents = compositeComponents.length > 1;
      primary.ingredients = compNamesList;
      primary.visualIngredients = compNamesList;
      primary.ingredientsList = compNamesList.join(', ');
      primary.isCompositeDish = true;
      primary.itemConfidence = 'High (>90%)';
      if (addDebugLog) {
        addDebugLog(
          `[Spatial Clustering] Clustered ${clusterGroup.length} co-located ingredients into composite dish "${compositeDishTitle}" (${totalWeight}g) with ${compositeComponents.length} components.`
        );
      }
      resultDishes.push(primary);
    } else {
      resultDishes.push(primary);
    }
  }
  return resultDishes;
}
