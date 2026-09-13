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

export function extractNutrientValue(nutrients: any, key: string): number {
  if (!nutrients || typeof nutrients !== 'object' || !key) return 0;
  if (nutrients[key] !== undefined && nutrients[key] !== null) {
    return cleanNutrientVal(nutrients[key]);
  }
  const clean = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [k, v] of Object.entries(nutrients)) {
    if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === clean) {
      return cleanNutrientVal(v);
    }
  }
  return 0;
}

export function getTopTargetNutrientKeys(report?: any, profile?: any): string[] {
  if (Array.isArray(profile?.topTargetNutrientKeys) && profile.topTargetNutrientKeys.length > 0) {
    return profile.topTargetNutrientKeys;
  }
  if (Array.isArray(report?.topTargetNutrientKeys) && report.topTargetNutrientKeys.length > 0) {
    return report.topTargetNutrientKeys;
  }
  if (report?.dailyNutrientTargets && typeof report.dailyNutrientTargets === 'object') {
    const keys = Object.keys(report.dailyNutrientTargets).filter(Boolean);
    if (keys.length > 0) return keys.slice(0, 5);
  }
  if (profile?.targets && typeof profile.targets === 'object') {
    const keys = Object.keys(profile.targets).filter(Boolean);
    if (keys.length > 0) return keys.slice(0, 5);
  }
  return [...PRIMARY_NUTRIENTS];
}



