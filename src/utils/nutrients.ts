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

/** Extra tracked keys that are not in NUTRIENT_KEYS but still have polarity. */
const EXTRA_NUTRIENT_KEYS = ["cholesterol", "salt", "steps"] as const;

/**
 * Ceiling nutrients: going over the target is harmful (red).
 * Floor / goal nutrients (protein, fibre, unsaturated fat, micronutrients, steps)
 * are everything else — reaching or exceeding the target is success (green).
 *
 * Coach reports often emit snake_case (`saturated_fat`); callers must use
 * `isLimitNutrient` / `canonicalNutrientKey`, never a raw `.includes('saturatedFat')`.
 */
export const LIMIT_NUTRIENT_KEYS = [
  "calories",
  "totalFat",
  "saturatedFat",
  "transFat",
  "cholesterol",
  "sodium",
  "salt",
  "sugar",
  "addedSugar",
  "carbohydrates",
] as const;

export type NutrientPolarity = "limit" | "goal";

/** Aliases whose slug is not already the canonical key with punctuation stripped. */
const NUTRIENT_KEY_ALIASES: Record<string, string> = {
  calorie: "calories",
  kcal: "calories",
  energy: "calories",
  proteins: "protein",
  fat: "totalFat",
  fats: "totalFat",
  totallipid: "totalFat",
  totallipids: "totalFat",
  satfat: "saturatedFat",
  satfats: "saturatedFat",
  transfa: "transFat",
  unsatfat: "unsaturatedFat",
  omega3fattyacids: "omega3",
  omega3s: "omega3",
  carb: "carbohydrates",
  carbs: "carbohydrates",
  carbohydrate: "carbohydrates",
  sugars: "sugar",
  totalsugar: "sugar",
  totalsugars: "sugar",
  addedsugars: "addedSugar",
  fiber: "totalFibre",
  fibre: "totalFibre",
  totalfiber: "totalFibre",
  dietaryfiber: "totalFibre",
  dietaryfibre: "totalFibre",
  solublefiber: "solubleFibre",
  na: "sodium",
  chol: "cholesterol",
  dietarycholesterol: "cholesterol",
  step: "steps",
  vitaminb9: "folate",
  vitaminb1: "thiamine",
  vitaminb2: "riboflavin",
  vitaminb3: "niacin",
};

export function nutrientKeySlug(key: string): string {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map any wire shape (`saturated_fat`, `Sat Fat`, `fiber`) to the camelCase code. */
export function canonicalNutrientKey(key: string): string {
  const slug = nutrientKeySlug(key);
  if (!slug) return key;
  const fromCatalog = NUTRIENT_KEYS.find((k) => nutrientKeySlug(k) === slug);
  if (fromCatalog) return fromCatalog;
  const extra = (EXTRA_NUTRIENT_KEYS as readonly string[]).find((k) => nutrientKeySlug(k) === slug);
  if (extra) return extra;
  return NUTRIENT_KEY_ALIASES[slug] || key;
}

export function nutrientPolarity(key: string): NutrientPolarity {
  return isLimitNutrient(key) ? "limit" : "goal";
}

/** True when exceeding the daily/weekly target is harmful (sat fat, sodium, calories, …). */
export function isLimitNutrient(key: string): boolean {
  if (!key) return false;
  const slug = nutrientKeySlug(canonicalNutrientKey(key));
  return (LIMIT_NUTRIENT_KEYS as readonly string[]).some((k) => nutrientKeySlug(k) === slug);
}

export function isNutrientOverLimit(key: string, actual: number, target: number): boolean {
  return isLimitNutrient(key) && target > 0 && actual > target;
}

export function isNutrientGoalMet(key: string, actual: number, target: number): boolean {
  return !isLimitNutrient(key) && target > 0 && actual >= target;
}

/** Read a target/totals bag that may mix camelCase and snake_case keys. */
export function lookupByNutrientKey<T = any>(
  bag: Record<string, T> | null | undefined,
  key: string
): T | undefined {
  if (!bag || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(bag, key) && bag[key] !== undefined) return bag[key];
  const canon = canonicalNutrientKey(key);
  if (canon !== key && Object.prototype.hasOwnProperty.call(bag, canon) && bag[canon] !== undefined) {
    return bag[canon];
  }
  const slugs = new Set([nutrientKeySlug(key), nutrientKeySlug(canon)].filter(Boolean));
  if (slugs.size === 0) return undefined;
  for (const [k, v] of Object.entries(bag)) {
    if (slugs.has(nutrientKeySlug(k))) return v as T;
  }
  return undefined;
}

export const isCoreNutrient = (key: string): boolean => {
  if (!key) return false;
  const slug = nutrientKeySlug(canonicalNutrientKey(key));
  if (!slug || slug === "steps") return false;
  return CORE_NUTRIENT_KEYS.some((k) => nutrientKeySlug(k) === slug);
};

export const isAdditionalNutrient = (key: string): boolean => {
  if (!key) return false;
  const slug = nutrientKeySlug(canonicalNutrientKey(key));
  if (!slug || slug === "steps") return false;
  return ADDITIONAL_NUTRIENT_KEYS.some((k) => nutrientKeySlug(k) === slug);
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
  const found = lookupByNutrientKey(nutrients, key);
  if (found === undefined || found === null) return 0;
  return cleanNutrientVal(found);
}

function collectNutrientKeyList(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item: any) => (typeof item === 'string' ? item : item?.nutrientKey || item?.key || item?.nutrient))
      .filter((k: any) => typeof k === 'string' && k.length > 0);
  }
  if (typeof raw === 'object') return Object.keys(raw).filter(Boolean);
  return [];
}

function keysFromHealthCategories(report?: any): string[] {
  const cats = report?.healthBaselineCategories || report?.riskCategories || [];
  if (!Array.isArray(cats)) return [];
  const out: string[] = [];
  for (const cat of cats) {
    const nts = cat?.priorityNutrientTargets || cat?.nutrientTargets || [];
    out.push(...collectNutrientKeyList(nts));
  }
  return out;
}

/** Home / cards / scout share this list. Core nutrients only; never `steps`. */
export function getTopTargetNutrientKeys(report?: any, profile?: any): string[] {
  const ranked = [
    ...collectNutrientKeyList(report?.topNutrientTargets),
    ...keysFromHealthCategories(report),
    ...collectNutrientKeyList(profile?.topNutrientsToMonitor),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of ranked) {
    if (!k) continue;
    const canon = canonicalNutrientKey(k);
    if (!canon || nutrientKeySlug(canon) === "steps") continue;
    if (!isCoreNutrient(canon)) continue;
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push(canon);
  }
  if (out.length > 0) return out;
  return PRIMARY_NUTRIENTS.filter((k) => nutrientKeySlug(k) !== "steps");
}



