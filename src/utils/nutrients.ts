export const NUTRIENT_KEYS = [
  "calories", "protein", "totalFat", "saturatedFat", "transFat", "unsaturatedFat", "omega3", 
  "carbohydrates", "sugar", "addedSugar", "totalFibre", "solubleFibre", "sodium", "potassium", 
  "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
  "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
  "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
];

export const CORE_NUTRIENT_KEYS = [
  "calories", "solubleFibre", "saturatedFat", "protein", "potassium", "transFat", "addedSugar", "carbohydrates", "totalFibre", "sodium"
];

export const ADDITIONAL_NUTRIENT_KEYS = [
  "unsaturatedFat", "omega3", "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus",
  "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
];

export const PRIMARY_NUTRIENTS = ["calories", "saturatedFat", "sodium"];

export const isCoreNutrient = (key: string): boolean => {
  if (!key) return false;
  const clean = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean === 'carbs' || clean === 'fibre' || clean === 'calorie') return true;
  return CORE_NUTRIENT_KEYS.some(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === clean);
};

export const isAdditionalNutrient = (key: string): boolean => {
  if (!key) return false;
  const clean = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['vitaminb9', 'vitaminb1', 'vitaminb2', 'vitaminb3', 'omega3fattyacids'].includes(clean)) return true;
  return ADDITIONAL_NUTRIENT_KEYS.some(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === clean);
};

export function cleanNutrientVal(val: any): number {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  let num = Number(val);
  if (num < 0) num = 0;
  // Eliminate floating point representation noise (e.g., 61.699999999999996 -> 61.7)
  num = Math.round(num * 100) / 100;
  if (num >= 10) {
    num = Math.round(num * 10) / 10;
  }
  return num;
}

export function formatNutrientDisplayValue(val: any, unit: string = ''): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '--';
  const cleaned = cleanNutrientVal(val);
  return unit ? `${cleaned} ${unit}` : `${cleaned}`;
}

/**
 * Single source of truth for Top Target nutrient keys across the application.
 * Extracts prioritized core nutrients from report and user profile, strictly
 * excluding non-nutrient activity metrics (e.g. 'steps').
 */
export function getTopTargetNutrientKeys(report?: any, profile?: any): string[] {
  const rawKeys: string[] = [];
  if (Array.isArray(report?.topNutrientTargets) && report.topNutrientTargets.length > 0) {
    report.topNutrientTargets.forEach((k: any) => {
      const strKey = typeof k === 'string' ? k : (k?.nutrientKey || k?.key);
      if (strKey && !rawKeys.includes(strKey)) rawKeys.push(strKey);
    });
  }
  const cats = report?.healthBaselineCategories || (report as any)?.riskCategories || [];
  if (Array.isArray(cats)) {
    cats.forEach((cat: any) => {
      if (Array.isArray(cat.nutrientTargets) || Array.isArray(cat.priorityNutrientTargets)) {
        (cat.priorityNutrientTargets || cat.nutrientTargets).forEach((nt: any) => {
          const strKey = typeof nt === 'string' ? nt : (nt?.nutrientKey || nt?.key);
          if (strKey && isCoreNutrient(strKey) && !rawKeys.includes(strKey)) rawKeys.push(strKey);
        });
      }
    });
  }
  if (profile?.topNutrientsToMonitor && profile.topNutrientsToMonitor.length > 0) {
    profile.topNutrientsToMonitor.forEach((k: any) => {
      if (typeof k === 'string' && !rawKeys.includes(k)) rawKeys.push(k);
    });
  }
  if (rawKeys.length === 0) {
    PRIMARY_NUTRIENTS.forEach(k => rawKeys.push(k));
  }
  // Filter strictly to core nutrients while maintaining rank order, excluding non-nutrients like steps
  const coreOnly = rawKeys.filter(k => isCoreNutrient(k) && k.toLowerCase() !== 'steps');
  const set = new Set<string>();
  coreOnly.forEach(k => set.add(k));
  if (set.size === 0) {
    PRIMARY_NUTRIENTS.forEach(k => set.add(k));
  }
  return Array.from(set);
}

/**
 * Safely extracts numeric nutrient value from a food/meal nutrients record,
 * handling case differences, special characters, and common alias fallbacks.
 */
export function extractNutrientValue(nutrients: Record<string, any> | undefined | null, targetKey: string): number {
  if (!nutrients || typeof nutrients !== 'object') return 0;
  if (nutrients[targetKey] !== undefined && nutrients[targetKey] !== null) {
    const v = Number(nutrients[targetKey]);
    return Number.isFinite(v) ? v : 0;
  }
  const cleanTarget = targetKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [k, v] of Object.entries(nutrients)) {
    if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget) {
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    }
  }
  // Common aliases
  if (cleanTarget === 'saturatedfat' && nutrients['satFat'] !== undefined) {
    const v = Number(nutrients['satFat']);
    return Number.isFinite(v) ? v : 0;
  }
  if (cleanTarget === 'totalfibre' && (nutrients['dietaryFiber'] !== undefined || nutrients['fiber'] !== undefined)) {
    const v = Number(nutrients['dietaryFiber'] ?? nutrients['fiber']);
    return Number.isFinite(v) ? v : 0;
  }
  if (cleanTarget === 'carbohydrates' && nutrients['carbs'] !== undefined) {
    const v = Number(nutrients['carbs']);
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}
