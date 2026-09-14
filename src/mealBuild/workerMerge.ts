/**
 * workerMerge.ts - F-10.3 Worker Merge for Adaptive Meal Agent
 *
 * Invariant Laws:
 * - Workers receive locked grams + dish crop, not the full multi-image set.
 * - Merge results back into lead items strictly matching by dishId / itemId.
 * - Preserve lead-locked grams, OCR label text, and source tracking.
 * - Single source of truth for calories (via calculateDerivedNutrients / Atwater math), never a second kcal book.
 */

import { calculateDerivedNutrients } from '../../server_derivation';

export interface WorkerDishInput {
  dishId: string;
  originalName: string;
  lockedWeightGrams: number;
  boundingBox2D?: number[] | null;
  cropCoordinates?: { x: number; y: number; width: number; height: number } | null;
  sourceImageIndex?: number | null;
  packageLabelText?: string | null;
  rawNutritionLabel?: Record<string, any> | null;
}

export interface WorkerDishResult {
  dishId: string;
  originalName?: string;
  nutrients?: {
    protein?: number | null;
    carbohydrates?: number | null;
    totalFat?: number | null;
    saturatedFat?: number | null;
    transFat?: number | null;
    sodium?: number | null;
    totalSugar?: number | null;
    addedSugar?: number | null;
    totalFibre?: number | null;
    [key: string]: any;
  } | null;
  ingredients?: string[] | null;
  cookingMethod?: string | null;
  verdict?: string | null;
  confidence?: number | null;
}

export interface LeadDishItem {
  dishId: string;
  originalName: string;
  weightGrams: number;
  lockedWeightGrams?: number;
  boundingBox2D?: number[] | null;
  cropCoordinates?: { x: number; y: number; width: number; height: number } | null;
  sourceImageIndex?: number | null;
  packageLabelText?: string | null;
  rawNutritionLabel?: Record<string, any> | null;
  lockedNutrientKeys?: string[];
  nutrients?: Record<string, any> | null;
  ingredients?: string[];
  cookingMethod?: string | null;
  verdict?: string | null;
  [key: string]: any;
}

/** Prepares a worker dispatch payload: locks grams and passes isolated crop metadata. */
export function buildWorkerTask(leadItem: LeadDishItem): WorkerDishInput {
  const lockedGrams = leadItem.lockedWeightGrams ?? leadItem.weightGrams ?? 0;
  return {
    dishId: leadItem.dishId,
    originalName: leadItem.originalName,
    lockedWeightGrams: lockedGrams,
    boundingBox2D: leadItem.boundingBox2D ?? null,
    cropCoordinates: leadItem.cropCoordinates ?? null,
    sourceImageIndex: leadItem.sourceImageIndex ?? null,
    packageLabelText: leadItem.packageLabelText ?? null,
    rawNutritionLabel: leadItem.rawNutritionLabel ?? null,
  };
}

/** Merges specialist worker results back into lead items strictly by dishId. */
export function mergeWorkerDishResults(
  leadItems: LeadDishItem[],
  workerResults: WorkerDishResult[]
): LeadDishItem[] {
  const workerMap = new Map<string, WorkerDishResult>();
  for (const wr of workerResults) {
    if (wr.dishId) {
      workerMap.set(wr.dishId, wr);
    }
  }

  return leadItems.map((lead) => {
    const worker = workerMap.get(lead.dishId);
    if (!worker) {
      return lead;
    }

    // Preserve locked grams and lead identity
    const lockedWeight = lead.lockedWeightGrams ?? lead.weightGrams;

    // Merge nutrients: start with lead, apply worker nutrient updates
    const mergedNutrients: Record<string, any> = {
      ...(lead.nutrients || {}),
      ...(worker.nutrients || {}),
    };

    // Calculate derived nutrients (Atwater calories, unsaturated fat, salt)
    const derived = calculateDerivedNutrients({
      protein: mergedNutrients.protein,
      carbohydrates: mergedNutrients.carbohydrates,
      totalFat: mergedNutrients.totalFat,
      saturatedFat: mergedNutrients.saturatedFat,
      transFat: mergedNutrients.transFat,
      sodium: mergedNutrients.sodium,
    });

    mergedNutrients.calories = derived.calories;
    mergedNutrients.carbohydrates = derived.carbohydrates;
    mergedNutrients.unsaturatedFat = derived.unsaturatedFat;
    mergedNutrients.salt = derived.salt;

    return {
      ...lead,
      weightGrams: lockedWeight,
      lockedWeightGrams: lockedWeight,
      nutrients: mergedNutrients,
      ingredients: worker.ingredients ?? lead.ingredients,
      cookingMethod: worker.cookingMethod ?? lead.cookingMethod,
      verdict: worker.verdict ?? lead.verdict,
      workerMerged: true,
    };
  });
}
