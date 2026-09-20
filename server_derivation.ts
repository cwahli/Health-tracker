/**
 * server_derivation.ts
 *
 * Pure TypeScript derivation utilities for nutrients:
 * - Bottom-Up Calories (kcal) = Math.round((4 * Protein) + (4 * Carbohydrates) + (9 * TotalFat))
 * - Unsaturated Fat (g) = Math.max(0, TotalFat - (SaturatedFat + TransFat))
 * - Salt (g) = (Sodium in mg * 2.54) / 1000
 * - Soluble Fibre (g) = Derived from Total Dietary Fibre based on food category / matrix
 * - Carbohydrates from energy fallback (g) = Math.max(0, (Calories - (4 * Protein) - (9 * TotalFat)) / 4) [Fallback only when C is missing]
 * - rebalanceNutrientProfile: Ensures 100% thermodynamic consistency and physical density clamping
 */

import { deduceSugarBreakdown } from './server_sugar_engine';

export function computeCaloriesFromMacros(
  protein?: number | null,
  carbohydrates?: number | null,
  totalFat?: number | null
): number {
  const p = Math.max(0, protein ?? 0);
  const c = Math.max(0, carbohydrates ?? 0);
  const tf = Math.max(0, totalFat ?? 0);
  return Math.round((4 * p) + (4 * c) + (9 * tf));
}

export function computeUnsaturatedFat(
  totalFat?: number | null,
  saturatedFat?: number | null,
  transFat?: number | null
): number {
  const tf = totalFat ?? 0;
  const sf = saturatedFat ?? 0;
  const tr = transFat ?? 0;
  const raw = tf - (sf + tr);
  return Math.max(0, Math.round(raw * 10) / 10);
}

export function computeSaltFromSodium(sodiumMg?: number | null): number {
  const na = sodiumMg ?? 0;
  const rawSalt = (na * 2.54) / 1000;
  return Math.round(rawSalt * 100) / 100;
}

/**
 * Re-derive the two fields TypeScript owns from their macro sources:
 *   unsaturatedFat = totalFat - (saturatedFat + transFat)   [>= 0]
 *   salt           = sodium(mg) * 2.54 / 1000
 *
 * These are derived, never agent/label facts. Any pass that rewrites
 * totalFat / saturatedFat / transFat / sodium in place must call this as its
 * last write, or a derived value can outlive the macro it came from - which is
 * how a ledger printed `unsaturatedFat: 29.2` beside `totalFat: 3.4`
 * (job_1789920526160_7rwiexoqd, class DERIVED_STALE).
 *
 * Mutates and returns the same bag so call sites can chain.
 */
export function reapplyDerivedNutrients<T extends Record<string, any> | null | undefined>(nutrients: T): T {
  if (!nutrients || typeof nutrients !== 'object') return nutrients;
  const bag = nutrients as Record<string, any>;
  bag.unsaturatedFat = computeUnsaturatedFat(bag.totalFat, bag.saturatedFat, bag.transFat);
  bag.salt = computeSaltFromSodium(bag.sodium);
  return nutrients;
}

export function computeSolubleFibre(
  totalFibre?: number | null,
  foodNameOrCategory?: string | null
): number {
  const tf = totalFibre ?? 0;
  if (!Number.isFinite(tf) || tf <= 0) return 0;

  const hay = (foodNameOrCategory || '').toLowerCase();

  // 1. Pure animal products, fats/oils, and non-plant beverages (0 soluble fiber)
  if (
    /\b(meats?|beef|pork|chickens?|poultry|turkeys?|fish(es)?|salmons?|tunas?|seafood|eggs?|oils?|butters?|lard|fats?)\b/i.test(hay) &&
    !/\b(breaded|fried\s+rice|salad|with|curry|veg|stew|patty|burger|murtabak|martabak|nasi|mie)\b/i.test(hay)
  ) {
    return 0;
  }

  // 2. High-soluble fiber foods (~35-45% of total fiber): oats, barley, legumes/beans/lentils, citrus, apples, berries, chia, psyllium, avocado
  if (
    /\b(oat|oats|oatmeal|barley|bean|beans|lentil|lentils|chickpea|chickpeas|pea|peas|legume|hummus|citrus|orange|lemon|lime|grapefruit|jeruk|apple|berries|berry|strawberry|blueberry|raspberry|blackberry|chia|flax|psyllium|avocado)\b/i.test(hay)
  ) {
    return Math.max(0, Math.round(tf * 0.38 * 10) / 10);
  }

  // 3. Moderate soluble fiber foods (~25-30% of total fiber): cooked vegetables, potatoes, roots, rice, wheat, noodles, bakery, general mixed dishes
  return Math.max(0, Math.round(tf * 0.28 * 10) / 10);
}

export function deriveCarbohydratesFromEnergy(
  calories?: number | null,
  protein?: number | null,
  totalFat?: number | null
): number {
  const cal = calories ?? 0;
  const p = protein ?? 0;
  const tf = totalFat ?? 0;
  const rawCarbs = (cal - 4 * p - 9 * tf) / 4;
  return Math.max(0, Math.round(rawCarbs * 10) / 10);
}

export interface BaseNutrientInputs {
  calories?: number | null;
  protein?: number | null;
  totalFat?: number | null;
  saturatedFat?: number | null;
  transFat?: number | null;
  sodium?: number | null;
  carbohydrates?: number | null;
  totalFibre?: number | null;
  solubleFibre?: number | null;
  foodName?: string | null;
}

export interface DerivedNutrientOutputs {
  calories: number;
  unsaturatedFat: number;
  salt: number;
  carbohydrates: number;
  solubleFibre: number;
}

export function calculateDerivedNutrients(base: BaseNutrientInputs): DerivedNutrientOutputs {
  const p = base.protein ?? 0;
  const tf = base.totalFat ?? 0;
  const unsaturatedFat = computeUnsaturatedFat(base.totalFat, base.saturatedFat, base.transFat);
  const salt = computeSaltFromSodium(base.sodium);
  const solubleFibre = (base.solubleFibre !== undefined && base.solubleFibre !== null && Number(base.solubleFibre) > 0)
    ? Math.round(Number(base.solubleFibre) * 10) / 10
    : computeSolubleFibre(base.totalFibre, base.foodName);

  // Carbohydrates: use emitted value if present, else derive from energy equation
  const carbohydrates = typeof base.carbohydrates === 'number'
    ? Math.round(base.carbohydrates * 10) / 10
    : deriveCarbohydratesFromEnergy(base.calories, p, tf);

  // Calories: if P/C/F are all numbers, calculate bottom-up; else retain or compute
  const calories = (typeof base.protein === 'number' && typeof base.carbohydrates === 'number' && typeof base.totalFat === 'number')
    ? computeCaloriesFromMacros(p, carbohydrates, tf)
    : (typeof base.calories === 'number' ? Math.round(base.calories) : computeCaloriesFromMacros(p, carbohydrates, tf));

  return {
    calories,
    unsaturatedFat,
    salt,
    carbohydrates,
    solubleFibre,
  };
}

/**
 * Rebalances a nutrient profile dictionary post-mutation (e.g. from Dietitian corrections),
 * ensuring complete thermodynamic consistency between macros and calories, deriving
 * unsaturated fat, salt, soluble fiber, and enforcing physical density bounds.
 */
export function rebalanceNutrientProfile(
  nutrients: Record<string, any>,
  weightGrams?: number | null,
  foodName?: string | null
): Record<string, any> {
  const result = { ...nutrients };
  const p = result.protein !== null && result.protein !== undefined ? Number(result.protein) : null;
  let c = result.carbohydrates !== null && result.carbohydrates !== undefined ? Number(result.carbohydrates) : null;
  const tf = result.totalFat !== null && result.totalFat !== undefined ? Number(result.totalFat) : null;
  const sf = result.saturatedFat !== null && result.saturatedFat !== undefined ? Number(result.saturatedFat) : null;
  const tr = result.transFat !== null && result.transFat !== undefined ? Number(result.transFat) : null;
  const na = result.sodium !== null && result.sodium !== undefined ? Number(result.sodium) : null;
  const cal = result.calories !== null && result.calories !== undefined ? Number(result.calories) : null;
  const fib = result.totalFibre !== null && result.totalFibre !== undefined ? Number(result.totalFibre) : null;

  // Physical density clamping if weight is known
  if (weightGrams && weightGrams > 0) {
    const maxDensity = weightGrams * 0.95;
    if (c !== null && c > maxDensity) c = maxDensity;
  }

  if (c !== null && p !== null && tf !== null) {
    // Both macros present -> derive calories bottom-up
    result.calories = computeCaloriesFromMacros(p, c, tf);
    result.carbohydrates = Math.round(c * 10) / 10;
  } else if (c === null && cal !== null && p !== null && tf !== null) {
    // Carbs missing -> back-solve via Atwater
    result.carbohydrates = deriveCarbohydratesFromEnergy(cal, p, tf);
  } else if (p !== null || c !== null || tf !== null) {
    result.calories = computeCaloriesFromMacros(p ?? 0, c ?? 0, tf ?? 0);
  }

  // Derive dependent metrics
  result.unsaturatedFat = computeUnsaturatedFat(tf, sf, tr);
  result.salt = computeSaltFromSodium(na);
  if (fib !== null && fib > 0 && (result.solubleFibre == null || Number(result.solubleFibre) === 0)) {
    result.solubleFibre = computeSolubleFibre(fib, foodName || result.name || result.originalName);
  }

  return result;
}

/**
 * Decomposes sauced entrees into solid protein mass and liquid sauce glaze,
 * ensuring cooked meat protein density does not exceed biological limits (<= 26g / 100g solid meat).
 */
export function decomposeSaucedEntree(
  name: string,
  totalWeightGrams: number,
  proteinEstimate: number | null | undefined
): { netSolidWeightGrams: number; netSauceWeightGrams: number; boundedProtein: number | null } {
  const isSauced = /\b(sauce|gravy|curry|glaze|stew|salsa|teriyaki|black\s*pepper|bbq|sweet\s*and\s*sour|stroganoff)\b/i.test(name);
  const isProtein = /\b(steak|beef|chicken|pork|lamb|fish|salmon|chop|fillet|ribs|turkey|duck|daging|ayam|ikan)\b/i.test(name);

  if (!isSauced || !isProtein || !totalWeightGrams || totalWeightGrams <= 0) {
    return {
      netSolidWeightGrams: totalWeightGrams,
      netSauceWeightGrams: 0,
      boundedProtein: proteinEstimate ?? null,
    };
  }

  // In standard sauced platters, solid meat represents 55-65% of the total dish mass
  const netSolidWeight = Math.round(totalWeightGrams * 0.60);
  const netSauceWeight = Math.max(0, totalWeightGrams - netSolidWeight);

  // Maximum biological protein capacity of solid cooked meat is ~24-26g / 100g
  const maxSolidProtein = Math.round((netSolidWeight * 0.24) * 10) / 10;
  const sauceProtein = Math.round((netSauceWeight * 0.015) * 10) / 10;
  const maxTotalProtein = Math.round((maxSolidProtein + sauceProtein) * 10) / 10;

  let boundedProtein = proteinEstimate ?? null;
  if (boundedProtein !== null && boundedProtein > maxTotalProtein) {
    boundedProtein = maxTotalProtein;
  }

  return {
    netSolidWeightGrams: netSolidWeight,
    netSauceWeightGrams: netSauceWeight,
    boundedProtein,
  };
}

export interface NutrientModifierOptions {
  message?: string | null;
  foodType?: string | null;
  physicalForm?: string | null;
  name?: string | null;
}

/**
 * Universal Nutrient Modifier Matrix: Applies semantic culinary modifiers (e.g. zero-sugar,
 * salt-free, oil-free) directly to nutrient profiles bottom-up without food-specific hardcoding.
 */
export function applyNutrientModifiers(
  nutrients: Record<string, any>,
  options: NutrientModifierOptions
): { updatedNutrients: Record<string, any>; lockedKeys: string[] } {
  const n = { ...nutrients };
  const lockedKeys: string[] = [];
  const msg = (options.message || '').toLowerCase();
  const name = (options.name || '').toLowerCase();
  // Exclude water plants (water spinach, watercress, watermelon, kangkung) and non-beverage categories
  const isWaterPlant = /\bwater\s*(spinach|cress|chestnut|melon|apple|lily)\b/i.test(name) || /\b(kangkung|kangkong)\b/i.test(name);
  const isNonBeverageCategory = Boolean(
    options.foodType &&
    /^(vegetable|produce|salad|protein|meat|poultry|seafood|fish|grain|carb|side)$/i.test(String(options.foodType).trim())
  );

  const isBeverage = !isNonBeverageCategory && !isWaterPlant && (
    options.foodType === 'beverage' ||
    options.physicalForm === 'LIQUID_BEVERAGE' ||
    /\b(tea|coffee|drink|beverage|juice|soda|latte|lemonade|teh|chai|matcha|smoothie|kombucha|es\s*(?:manis|tawar|teh|jeruk|kopi|sirup))\b/i.test(name) ||
    (/\bwater\b/i.test(name) && !/\b(spinach|cress|chestnut|melon|apple|lily)\b/i.test(name))
  );

  // If user explicitly named a beverage (e.g. "tea", "coffee"), ensure the item matches that beverage
  const mentionedTea = /\b(tea|teh)\b/i.test(msg);
  const mentionedCoffee = /\b(coffee|kopi)\b/i.test(msg);
  const isTeaItem = /\b(tea|teh|chai|matcha|es\s*(?:manis|tawar|teh))\b/i.test(name);
  const isCoffeeItem = /\b(coffee|kopi|espresso|latte|cappuccino|es\s*kopi)\b/i.test(name);
  const beverageMatchesIntent = (!mentionedTea && !mentionedCoffee) || (mentionedTea && isTeaItem) || (mentionedCoffee && isCoffeeItem);

  // 1. Zero-Sugar / Unsweetened Modifier
  const isZeroSugar = /\b(unsweetened|unsweatened|no sugar|sugar free|zero sugar|without sugar|tanpa gula|tawar|diet|zero calorie)\b/i.test(msg);
  if (isZeroSugar && isBeverage && beverageMatchesIntent) {
    const isFruitOrDairyBeverage = /\b(juice|jus|orange|jeruk|lemon|lime|fruit|apple|coconut|kelapa|milk|latte|susu|smoothie|berry|melon)\b/i.test(name);
    if (!isFruitOrDairyBeverage) {
      n.sugar = 0;
      n.addedSugar = 0;
      n.carbohydrates = 0;
      n.calories = computeCaloriesFromMacros(n.protein, 0, n.totalFat);
      lockedKeys.push('sugar', 'addedSugar', 'carbohydrates', 'calories');
    } else {
      n.addedSugar = 0;
      const sugarResult = deduceSugarBreakdown({
        carbohydrates: n.carbohydrates,
        totalFibre: n.totalFibre,
        physicalForm: options.physicalForm || 'LIQUID_BEVERAGE',
        foodType: options.foodType || 'beverage',
        foodName: options.name,
      });
      n.sugar = sugarResult.sugar;
      n.calories = computeCaloriesFromMacros(n.protein, n.carbohydrates, n.totalFat);
      lockedKeys.push('sugar', 'addedSugar', 'calories');
    }
  }

  // 2. Zero-Sodium / Unsalted Modifier
  const isZeroSodium = /\b(no salt|unsalted|salt free|zero sodium|without salt|tanpa garam)\b/i.test(msg);
  if (isZeroSodium) {
    n.sodium = 0;
    n.salt = 0;
    lockedKeys.push('sodium', 'salt');
  }

  // 3. Oil-Free / Fat-Free Modifier
  const isOilFree = /\b(no oil|oil free|without oil|steamed without oil|dry grilled|tanpa minyak)\b/i.test(msg);
  if (isOilFree) {
    const rawFat = Number(n.totalFat) || 0;
    n.totalFat = Math.max(0, Math.round(rawFat * 0.3 * 10) / 10);
    n.saturatedFat = Math.max(0, Math.round((Number(n.saturatedFat) || 0) * 0.3 * 10) / 10);
    n.unsaturatedFat = computeUnsaturatedFat(n.totalFat, n.saturatedFat, n.transFat);
    n.calories = computeCaloriesFromMacros(n.protein, n.carbohydrates, n.totalFat);
    lockedKeys.push('totalFat', 'saturatedFat', 'unsaturatedFat', 'calories');
  }

  return {
    updatedNutrients: n,
    lockedKeys,
  };
}



