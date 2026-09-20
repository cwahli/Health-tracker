/**
 * server_dish_finalize.ts
 *
 * Core mathematical engine and truth hierarchy resolver for dish estimates:
 * - One scaler rule: R = consumedWeight / nutrientBasisWeight
 * - 3-rung truth hierarchy: OCR -> Brand Menu -> Scout Direct Nutrients
 * - Atomic staple USDA overlay without component assembly
 * - Post-Atwater pure TypeScript derivation of unsaturated fat, salt, and carbohydrate fallback
 */

import { classifyDishAtomic } from './server_dish_classify';
import { matchBrandMenu, BrandMatchResult } from './server_brand_match';
import { lookupCanonicalBaseFood } from './server_food_db';
import {
  computeCaloriesFromMacros,
  computeUnsaturatedFat,
  computeSaltFromSodium,
  computeSolubleFibre,
  reapplyDerivedNutrients,
  deriveCarbohydratesFromEnergy,
  decomposeSaucedEntree,
} from './server_derivation';
import { backfillSparseMicronutrients } from './server_pure_helpers';
import { deduceSugarBreakdown } from './server_sugar_engine';
import { classifyUniversalPhysicalFormV3 } from './server_matching_engine';
import { decidePrepAddition } from './server_prep_policy';
import { inferBasisFromServingText } from './server_nutrient_basis';

export interface FinalizeInput {
  item: any;
  nutrientBasisWeight?: number;
  consumedWeight?: number;
  diningEnvironment?: string;
  storedBrandLock?: {
    id: string;
    basisType: 'per_dish' | 'per_100g' | string;
    servingGrams: number | null;
    keys: string[];
    valuesAtBasis: Record<string, number>;
    per100g?: Record<string, number> | null;
  } | null;
  storedOcrLock?: {
    basisType: 'per_dish' | 'per_100g' | string;
    servingGrams: number | null;
    keys: string[];
    valuesAtBasis: Record<string, number>;
  } | null;
}

export interface DishLedger {
  /** Official brand menu dish name when brand_official matched. */
  brandDisplayName?: string | null;
  scoutIndex: number;
  originalName: string;
  keyword?: string;
  chainName: string | null;
  weightGrams: number;
  nutrientBasisWeight: number;
  ingredients: string[];
  visualIngredients: string[];
  nutrients: Record<string, number | null>;
  lockedNutrientKeys: string[];
  brandLock?: FinalizeInput['storedBrandLock'];
  dishClass: 'atomic' | 'composed';
  dbSource: 'label' | 'brand_official' | 'usda' | 'estimated';
  dbId: string | null;
  /**
   * Printed-label evidence (provenance for the OCR badge, never math).
   * Set only when dbSource === 'label'; the badge requires rawNutritionLabel.
   */
  rawNutritionLabel?: Record<string, any> | null;
  labelNutrientsPerServing?: Record<string, number> | null;
  /** Brand-rung residual: HIT / MULTI / MISS / SKIPPED. Honest MISS does not invent micronutrients. */
  bindStatus?: 'HIT' | 'MULTI' | 'MISS' | 'SKIPPED' | null;
  atwaterFlag: { deviationPct: number; flagged: boolean } | null;
  usdaQueries: string[];
  components?: any[];
  componentsDetailList?: any[];
  compositeSiblings?: any[];
  hasComponents?: boolean;
  ingredientsList?: string | null;
  /** Honest residual from diningEnvironment × cookingMethod (not a second kcal book). */
  prepAddition?: { addedFat: number; addedSodium: number; addedSaturatedFat: number; addedCalories: number; reason?: string };
}

const ATWATER_TOLERANCE = 0.35;

export function parseOcrLabel(rawLabel: any, targetWeight: number, defaultR: number, storedOcrLock?: any) {
  const ocrNutrients: Record<string, number> = {};
  const lockedKeys: string[] = [];
  
  if (!rawLabel || typeof rawLabel !== 'object') {
    return { ocrNutrients, lockedKeys };
  }

  const isPer100gFlag = rawLabel.basisType === 'per_100g' ||
    rawLabel.servingSize === '100g' ||
    rawLabel.serving === '100g' ||
    (storedOcrLock && storedOcrLock.basisType === 'per_100g');

  let ocrServingGrams: number | null = null;
  const servingText = String(rawLabel.servingSize || rawLabel.serving || '').trim();
  const hadServingText = servingText.length > 0;
  if (rawLabel.servingGrams && Number(rawLabel.servingGrams) > 0) {
    ocrServingGrams = Number(rawLabel.servingGrams);
  } else if (hadServingText) {
    if (/fl\s*oz/i.test(servingText)) {
      const parsedNum = parseFloat(servingText.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(parsedNum) && parsedNum > 0) {
        ocrServingGrams = Math.round(parsedNum * 29.57);
      }
    } else {
      const inferred = inferBasisFromServingText(servingText, targetWeight);
      const explicit100 = /\b100\s*(?:g|ml)\b/i.test(servingText) || /per\s*100/i.test(servingText);
      if (inferred.basisType === 'per_100g' && (explicit100 || inferred.servingGrams === 100)) {
        ocrServingGrams = 100;
      } else if (inferred.servingGrams && inferred.servingGrams > 0 && inferred.basisType !== 'per_100g') {
        ocrServingGrams = inferred.servingGrams;
      }
    }
  } else if ((rawLabel.servingsPerContainer || rawLabel.jumlahSajianPerKemasan || rawLabel.servings_per_container) && Number(rawLabel.servingsPerContainer || rawLabel.jumlahSajianPerKemasan || rawLabel.servings_per_container) > 1 && targetWeight > 10) {
    ocrServingGrams = Math.round(targetWeight / Number(rawLabel.servingsPerContainer || rawLabel.jumlahSajianPerKemasan || rawLabel.servings_per_container));
  }

  const rawCalStr = rawLabel.calories ?? rawLabel.energy ?? rawLabel.kcal ?? rawLabel.energyKcal ?? rawLabel.energiTotal ?? rawLabel.energi ?? rawLabel.kalori;
  const ocrCal = typeof rawCalStr === 'number'
    ? rawCalStr
    : (rawCalStr ? parseFloat(String(rawCalStr).replace(/[^0-9.]/g, '')) : NaN);

  // Sanity check: if ocrServingGrams is small (<= 15) and targetWeight > ocrServingGrams
  // If calorie density exceeds pure fat (> 9.2 kcal/g), ocrServingGrams was parsed as a serving COUNT (e.g. 2.25 or 2.5 servings in container), NOT grams.
  if (ocrServingGrams && ocrServingGrams > 0 && ocrServingGrams <= 15 && targetWeight > ocrServingGrams) {
    const calPerGram = Number.isFinite(ocrCal) && ocrCal > 0 ? (ocrCal / ocrServingGrams) : 0;
    if (calPerGram > 9.2) {
      // It is a serving count N; true serving size is targetWeight / N
      ocrServingGrams = targetWeight / ocrServingGrams;
    }
  }

  const isPer100g = !!(isPer100gFlag || ocrServingGrams === 100);
  // Serving text without parseable grams: never apply an R>9 leftover from a 1g basis.
  const fallbackScale = (hadServingText && defaultR > 9.2) ? 1 : defaultR;
  let ocrScale = isPer100g
    ? (targetWeight / 100)
    : ((ocrServingGrams && ocrServingGrams > 0) ? (targetWeight / ocrServingGrams) : fallbackScale);

  // Physical Safeguard: When scaling up (ocrScale > 1), ocrScale must never cause calories to exceed physical maximum of pure fat (9.2 kcal/g)
  if (ocrScale > 1 && Number.isFinite(ocrCal) && ocrCal > 0 && targetWeight > 0) {
    const maxScale = (targetWeight * 9.2) / ocrCal;
    if (ocrScale > maxScale) {
      ocrScale = maxScale;
    }
  }

  if (Number.isFinite(ocrCal) && ocrCal > 0) {
    ocrNutrients.calories = Math.round(ocrCal * ocrScale);
    lockedKeys.push('calories');
  }

  const DAILY_VALUE_REFERENCE: Record<string, { value: number; unit: 'mg' | 'mcg' | 'g' }> = {
    vitaminD: { value: 15, unit: 'mcg' }, // 15 mcg (600 IU) BPOM/FDA
    calcium: { value: 1100, unit: 'mg' }, // 1100 mg BPOM reference
    iron: { value: 18, unit: 'mg' },
    potassium: { value: 4700, unit: 'mg' },
    magnesium: { value: 400, unit: 'mg' },
    zinc: { value: 11, unit: 'mg' },
    vitaminA: { value: 900, unit: 'mcg' },
    vitaminC: { value: 90, unit: 'mg' },
    vitaminE: { value: 15, unit: 'mg' },
    vitaminK: { value: 120, unit: 'mcg' },
    vitaminB6: { value: 1.7, unit: 'mg' },
    vitaminB12: { value: 2.4, unit: 'mcg' },
    folate: { value: 400, unit: 'mcg' },
    thiamine: { value: 1.2, unit: 'mg' },
    riboflavin: { value: 1.3, unit: 'mg' },
    niacin: { value: 16, unit: 'mg' },
    phosphorus: { value: 700, unit: 'mg' },
    iodine: { value: 150, unit: 'mcg' },
    selenium: { value: 55, unit: 'mcg' },
    sodium: { value: 2000, unit: 'mg' },
  };

  const OCR_FIELD_ALIASES: Record<string, string[]> = {
    protein: ['protein', 'proteins', 'protein_total', 'proteinTotal'],
    totalFat: ['totalFat', 'fat', 'total_fat', 'lipids', 'lemakTotal', 'lemak_total', 'lemak'],
    saturatedFat: ['saturatedFat', 'satFat', 'saturated_fat', 'sat_fat', 'lemakJenuh', 'lemak_jenuh'],
    transFat: ['transFat', 'trans_fat', 'lemakTrans', 'lemak_trans'],
    carbohydrates: ['carbohydrates', 'totalCarbohydrate', 'totalCarbohydrates', 'carbohydrate', 'carbs', 'totalCarb', 'total_carbohydrate', 'karbohidratTotal', 'karbohidrat_total', 'karbohidrat'],
    sugar: ['sugar', 'sugars', 'totalSugar', 'totalSugars', 'total_sugar', 'gula', 'gulaTotal', 'gula_total'],
    addedSugar: ['addedSugar', 'addedSugars', 'added_sugar', 'includesAddedSugars', 'sukrosa'],
    sodium: ['sodium', 'na', 'natrium'],
    salt: ['salt', 'garam'],
    totalFibre: ['totalFibre', 'totalFiber', 'fiber', 'fibre', 'dietaryFiber', 'dietary_fiber', 'seratPangan', 'serat_pangan', 'serat'],
    solubleFibre: ['solubleFibre', 'solubleFiber'],
    potassium: ['potassium', 'k', 'kalium'],
    calcium: ['calcium', 'ca', 'kalsium'],
    iron: ['iron', 'fe', 'zatBesi', 'zat_besi'],
    magnesium: ['magnesium', 'mg'],
    vitaminD: ['vitaminD', 'vitD', 'vitamin_d', 'vit_d'],
    vitaminA: ['vitaminA', 'vitA', 'vitamin_a', 'vit_a'],
    vitaminC: ['vitaminC', 'vitC', 'vitamin_c', 'vit_c'],
    vitaminE: ['vitaminE', 'vitE', 'vitamin_e', 'vit_e'],
    vitaminB12: ['vitaminB12', 'vitB12', 'vitamin_b12', 'vit_b12'],
    folate: ['folate', 'folicAcid', 'folic_acid', 'asamFolat', 'asam_folat'],
    zinc: ['zinc', 'zn', 'seng'],
    iodine: ['iodine', 'yodium'],
    omega3: ['omega3', 'omega_3'],
  };

  for (const [normKey, aliases] of Object.entries(OCR_FIELD_ALIASES)) {
    let rawVal: any = undefined;
    for (const alias of aliases) {
      if (rawLabel[alias] !== undefined && rawLabel[alias] !== null && rawLabel[alias] !== '' && rawLabel[alias] !== '-' && rawLabel[alias] !== '--') {
        rawVal = rawLabel[alias];
        break;
      }
    }
    if (rawVal !== undefined && rawVal !== null) {
      const isPercent = typeof rawVal === 'string' && /%|\bakg\b|\bdv\b/i.test(rawVal);
      const parsedNum = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(parsedNum)) {
        let metricValue = parsedNum;
        if (isPercent && DAILY_VALUE_REFERENCE[normKey]) {
          metricValue = (parsedNum / 100) * DAILY_VALUE_REFERENCE[normKey].value;
        }
        ocrNutrients[normKey] = (normKey === 'sodium' || normKey === 'potassium' || normKey === 'calcium' || normKey === 'magnesium' || normKey === 'phosphorus')
          ? Math.round(metricValue * ocrScale)
          : Math.round(metricValue * ocrScale * 10) / 10;
        lockedKeys.push(normKey);
      }
    }
  }
  if (ocrNutrients.salt != null && (ocrNutrients.sodium == null || !lockedKeys.includes('sodium'))) {
    ocrNutrients.sodium = Math.round(Number(ocrNutrients.salt) * 400);
    lockedKeys.push('sodium');
  }
  return { ocrNutrients, lockedKeys };
}

export async function finalizeDishLedger(input: FinalizeInput): Promise<DishLedger> {
  const item = input.item || {};
  const scoutIndex = Number(item.scoutIndex ?? 0);
  const originalName = String(item.originalName || item.keyword || 'Dish');
  const keyword = item.keyword ? String(item.keyword) : undefined;
  const chainName = item.chainName ? String(item.chainName) : null;

  const consumedWeight = Math.max(1, Math.round(Number(input.consumedWeight ?? item.estimatedWeightGrams ?? 100)));
  const nutrientBasisWeight = Math.max(1, Math.round(Number(input.nutrientBasisWeight ?? item.nutrientBasisWeight ?? item.estimatedWeightGrams ?? consumedWeight)));
  const R = consumedWeight / nutrientBasisWeight;

  const ingredients: string[] = Array.isArray(item.ingredients) ? item.ingredients : [];
  const visualIngredients: string[] = Array.isArray(item.visualIngredients) && item.visualIngredients.length > 0
    ? item.visualIngredients
    : (ingredients.length > 0 ? ingredients : []);

  const dishClass = classifyDishAtomic({ originalName, keyword, ingredients });

  const nutrients: Record<string, number | null> = {};
  const lockedNutrientKeys: string[] = [];
  let dbSource: 'label' | 'brand_official' | 'usda' | 'estimated' = 'estimated';
  let dbId: string | null = null;
  let brandLock: FinalizeInput['storedBrandLock'] = input.storedBrandLock || null;
  let bindStatus: DishLedger['bindStatus'] = null;
  let brandDisplayName: string | null = null;
  const usdaQueries: string[] = [];

  // 1. Check OCR label truth
  const rawLabel = item.rawNutritionLabel || item.nutritionFacts;
  const hasOcr = rawLabel && (typeof rawLabel === 'object') && (
    rawLabel.calories != null || rawLabel.energy != null || rawLabel.kcal != null ||
    rawLabel.energiTotal != null || rawLabel.energi != null || rawLabel.kalori != null ||
    rawLabel.energyKcal != null
  );

  if (hasOcr || input.storedOcrLock) {
    dbSource = 'label';
    const { ocrNutrients, lockedKeys } = parseOcrLabel(rawLabel, consumedWeight, R, input.storedOcrLock);
    
    for (const [k, v] of Object.entries(ocrNutrients)) {
      nutrients[k] = v;
    }
    for (const key of lockedKeys) {
      if (!lockedNutrientKeys.includes(key)) lockedNutrientKeys.push(key);
    }
  }

  // 2. Check Brand database truth (if not locked by OCR)
  // F-13.2: lock values live at the row's servingGrams (per-100g rows carry
  // servingGrams 100; per-serving rows carry the dish weight, e.g. Big Mac
  // 215). Scale by consumed/servingGrams whenever servingGrams is known, so a
  // mislabeled basis can never print per-100g values raw at 40 g again
  // (live T2 `job_1789655364725_qoestq254`: 400 kcal @ 40 g). Falls back to
  // the basis label only when servingGrams is absent.
  const lockScaleFor = (lock: FinalizeInput['storedBrandLock']): number => {
    const serving = Number(lock?.servingGrams);
    if (Number.isFinite(serving) && serving > 0) return consumedWeight / serving;
    if (lock?.basisType === 'per_100g') return consumedWeight / 100;
    return R;
  };
  if (dbSource !== 'label') {
    if (brandLock) {
      // Re-rating an already-stored brand lock (Portion edit or D8)
      dbSource = 'brand_official';
      bindStatus = 'HIT';
      dbId = brandLock.id;
      // Prefer a human dish label over a raw id when the lock was keyed by dish_name.
      const lockLabel = String(brandLock.id || '').trim();
      if (lockLabel && !/^\d+$/.test(lockLabel) && lockLabel.length > 2) {
        brandDisplayName = lockLabel;
      }
      if (!brandDisplayName) {
        const fromItem = String(item.foodName || item.canonicalDbName || item.originalName || '').trim();
        if (fromItem) brandDisplayName = fromItem;
      }
      const lockScale = lockScaleFor(brandLock);
      for (const [k, v] of Object.entries(brandLock.valuesAtBasis)) {
        nutrients[k] = Math.round(v * lockScale * 10) / 10;
        if (!lockedNutrientKeys.includes(k)) lockedNutrientKeys.push(k);
      }
      if (nutrients.calories) nutrients.calories = Math.round(nutrients.calories);
    } else {
      // First analyze match
      const hasSubcomponents = item.hasComponents || (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0) || (Array.isArray(item.components) && item.components.length > 0) || (Array.isArray(item.compositeSiblings) && item.compositeSiblings.length > 0);
      const shouldAttemptBrandMatch = !hasSubcomponents || Boolean(chainName);
      
      let brandMatch: BrandMatchResult = { matched: false, status: 'MISS' };
      if (shouldAttemptBrandMatch) {
        brandMatch = await matchBrandMenu(chainName, originalName, keyword);
        bindStatus = brandMatch.status;
      } else {
        bindStatus = 'SKIPPED';
      }

      if (brandMatch.matched && brandMatch.hit) {
        dbSource = 'brand_official';
        dbId = String(brandMatch.hit.id || brandMatch.hit.dish_name || originalName);
        brandDisplayName = String(brandMatch.hit.dish_name || brandMatch.hit.name || '').trim() || null;
        brandLock = {
          id: dbId,
          basisType: brandMatch.basisType || 'per_dish',
          servingGrams: brandMatch.servingGrams || null,
          keys: brandMatch.lockedKeys || [],
          valuesAtBasis: brandMatch.valuesAtBasis || {},
        };
        for (const [k, v] of Object.entries(brandLock.valuesAtBasis)) {
          nutrients[k] = Math.round(v * lockScaleFor(brandLock) * 10) / 10;
          if (!lockedNutrientKeys.includes(k)) lockedNutrientKeys.push(k);
        }
        if (nutrients.calories) nutrients.calories = Math.round(nutrients.calories);
      }
    }
  }

  // 3. Fill remaining unlocked nutrients from Scout base estimates scaled by R (or calorie-adjusted R for brand locks)
  const scoutNutrients = item.nutrients || {};
  const scoutCal = Number(scoutNutrients.calories ?? item.estimatedCalories ?? 0);
  const brandCal = nutrients.calories != null ? Number(nutrients.calories) : null;
  const effectiveR = (dbSource === 'brand_official' && brandCal && scoutCal > 0)
    ? (brandCal / scoutCal)
    : R;

  const SCOUT_KEYS = [
    'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat', 'unsaturatedFat',
    'carbohydrates', 'sugar', 'totalSugar', 'addedSugar', 'totalFibre', 'solubleFibre',
    'sodium', 'potassium', 'magnesium', 'calcium', 'iron', 'zinc', 'selenium', 'iodine',
    'phosphorus', 'vitaminD', 'vitaminB12', 'folate', 'vitaminC', 'vitaminE', 'vitaminK',
    'vitaminA', 'vitaminB6', 'thiamine', 'riboflavin', 'niacin', 'omega3'
  ];

  for (const k of SCOUT_KEYS) {
    const targetKey = k === 'totalSugar' ? 'sugar' : k;
    if (lockedNutrientKeys.includes(targetKey)) continue;

    const rawVal = scoutNutrients[k] ?? (k === 'calories' ? item.estimatedCalories : null);
    if (rawVal !== undefined && rawVal !== null && Number.isFinite(Number(rawVal))) {
      const numVal = Number(rawVal);
      nutrients[targetKey] = targetKey === 'calories' || targetKey === 'sodium' || targetKey === 'potassium' || targetKey === 'calcium' || targetKey === 'magnesium'
        ? Math.round(numVal * effectiveR)
        : Math.round(numVal * effectiveR * 10) / 10;
    } else {
      if (nutrients[targetKey] === undefined) {
        nutrients[targetKey] = null;
      }
    }
  }

  // Fallback if scout nutrients were absent and not locked by OCR/Brand
  const hasValidMacros = (nutrients.protein != null || nutrients.carbohydrates != null || nutrients.totalFat != null);
  if (!hasValidMacros && (nutrients.calories == null || !(nutrients.calories > 0))) {
    const hay = `${originalName} ${keyword || ''}`.toLowerCase();
    const isCoconutWater = /\b(coconut\s*water|coconut\s*juice|air\s*kelapa|kelapa\s*muda|raw\s*coconut)\b/i.test(hay) && !/\b(milk|santan|curry|cream)\b/i.test(hay);
    const isDrink = /\b(drink|juice|tea|coffee|soda|water|beverage|iced|smoothie|es\b|teh|kopi|minuman)\b/i.test(hay);
    const isNoodleRice = /\b(noodle|noodles|rice|pasta|mie|bihun|kwetiau|spaghetti|nasi|bakmi)\b/i.test(hay);
    const isMeatDumpling = /\b(dumpling|dumplings|siomay|dim sum|wonton|chicken|beef|pork|fish|meat|ikan|ayam|sapi|kambing|domba|babi|udang|daging|telur)\b/i.test(hay);

    if (isCoconutWater) {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.04 * 10) / 10;
      nutrients.sugar = Math.round(consumedWeight * 0.03 * 10) / 10;
      nutrients.addedSugar = 0;
      nutrients.protein = Math.round(consumedWeight * 0.007 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.002 * 10) / 10;
      nutrients.saturatedFat = 0;
      nutrients.potassium = Math.round(consumedWeight * 2.5);
      nutrients.sodium = Math.round(consumedWeight * 0.25);
    } else if (isDrink) {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.11 * 10) / 10;
      nutrients.sugar = Math.round(consumedWeight * 0.10 * 10) / 10;
      nutrients.protein = 0;
      nutrients.totalFat = 0;
      nutrients.saturatedFat = 0;
      nutrients.sodium = Math.round(consumedWeight * 0.05);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    } else if (isNoodleRice) {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.30 * 10) / 10;
      nutrients.protein = Math.round(consumedWeight * 0.06 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.04 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.01 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 2.5);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    } else if (isMeatDumpling) {
      nutrients.protein = Math.round(consumedWeight * 0.12 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.08 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.02 * 10) / 10;
      nutrients.carbohydrates = Math.round(consumedWeight * 0.15 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 3.5);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    } else {
      nutrients.carbohydrates = Math.round(consumedWeight * 0.20 * 10) / 10;
      nutrients.protein = Math.round(consumedWeight * 0.08 * 10) / 10;
      nutrients.totalFat = Math.round(consumedWeight * 0.05 * 10) / 10;
      nutrients.saturatedFat = Math.round(consumedWeight * 0.01 * 10) / 10;
      nutrients.sodium = Math.round(consumedWeight * 2.0);
      nutrients.calories = computeCaloriesFromMacros(nutrients.protein, nutrients.carbohydrates, nutrients.totalFat);
    }
  }

  // F-10.6: TS fat/Na critic (diningEnvironment × cookingMethod) before Atwater so kcal re-derives from macros.
  const env = input.diningEnvironment || item.diningEnvironment || 'unknown';
  const prep = decidePrepAddition({
    weightGrams: consumedWeight,
    cookingMethod: item.cookingMethod,
    physicalForm: item.physicalForm,
    dishName: originalName,
    keyword,
    canonicalDbName: item.canonicalDbName,
    foodType: item.foodType,
    componentCount: (item.componentsDetailList || item.components || []).length,
    hasLockedTruth: dbSource === 'label' || dbSource === 'brand_official' || lockedNutrientKeys.includes('calories') || lockedNutrientKeys.includes('totalFat'),
    diningEnvironment: env,
    dbSource,
    proteinMassGrams: typeof nutrients.protein === 'number' ? nutrients.protein : null,
  });
  if (!lockedNutrientKeys.includes('calories') && (prep.addedFat > 0 || prep.addedSodium > 0)) {
    const fat = Number(nutrients.totalFat) || 0;
    const sat = Number(nutrients.saturatedFat) || 0;
    const na = Number(nutrients.sodium) || 0;
    nutrients.totalFat = Math.round((fat + prep.addedFat) * 10) / 10;
    nutrients.saturatedFat = Math.round((sat + prep.addedSaturatedFat) * 10) / 10;
    nutrients.sodium = Math.round(na + prep.addedSodium);
  }

  // 4. Bottom-Up Calorie Derivation & Atwater Consistency
  if (dbSource === 'estimated' && !lockedNutrientKeys.includes('protein')) {
    const decomp = decomposeSaucedEntree(originalName, consumedWeight, nutrients.protein);
    if (decomp.boundedProtein !== null) {
      nutrients.protein = decomp.boundedProtein;
    }
  }

  const p = nutrients.protein ?? 0;
  const f = nutrients.totalFat ?? 0;
  let atwaterFlag: { deviationPct: number; flagged: boolean } | null = null;

  if (!lockedNutrientKeys.includes('calories')) {
    // Bottom-Up standard: compute calories directly from macros
    if (nutrients.carbohydrates == null) {
      nutrients.carbohydrates = deriveCarbohydratesFromEnergy(nutrients.calories, p, f);
    }
    const c = nutrients.carbohydrates ?? 0;
    nutrients.calories = computeCaloriesFromMacros(p, c, f);
  } else {
    // Calories locked by OCR or Brand Menu
    const cal = nutrients.calories ?? 0;
    if (nutrients.carbohydrates !== null && nutrients.carbohydrates !== undefined && Number.isFinite(Number(nutrients.carbohydrates))) {
      const c = Number(nutrients.carbohydrates);
      const atwaterKcal = 4 * p + 4 * c + 9 * f;
      const deviation = cal > 0 ? Math.abs(atwaterKcal - cal) / cal : 0;
      const flagged = deviation > ATWATER_TOLERANCE;
      atwaterFlag = {
        deviationPct: Math.round(deviation * 100),
        flagged,
      };
    } else {
      // Derive carbohydrates from energy when missing on label
      nutrients.carbohydrates = deriveCarbohydratesFromEnergy(cal, p, f);
      atwaterFlag = null;
    }
  }

  // 5. Derive Unsaturated Fat, Salt, and Soluble Fibre
  nutrients.unsaturatedFat = computeUnsaturatedFat(nutrients.totalFat, nutrients.saturatedFat, nutrients.transFat);
  nutrients.salt = computeSaltFromSodium(nutrients.sodium);
  if (!lockedNutrientKeys.includes('solubleFibre') && (nutrients.solubleFibre == null || Number(nutrients.solubleFibre) === 0) && nutrients.totalFibre) {
    nutrients.solubleFibre = computeSolubleFibre(nutrients.totalFibre, originalName);
  }

  // 6. Complete Micronutrient Backfill for Sparse Composite Estimates
  backfillSparseMicronutrients(originalName, consumedWeight, nutrients, dbSource, originalName);

  // 7. Structure Composite Components with Scaled Weights and Nutrients
  const rawComps = Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0
    ? item.componentsDetailList
    : (Array.isArray(item.components) && item.components.length > 0
      ? item.components
      : (Array.isArray(item.foods) && item.foods.length > 0
        ? item.foods
        : (Array.isArray(item.compositeSiblings) ? item.compositeSiblings : [])));

  let componentsDetailList: any[] | undefined = undefined;
  if (rawComps.length > 0) {
    const origWeight = Math.max(1, Number(item.estimatedWeightGrams || nutrientBasisWeight || consumedWeight));
    const scale = consumedWeight / origWeight;
    componentsDetailList = rawComps.map((c: any) => {
      const cName = String(c.name || c.foodName || c.searchQuery || c.keyword || 'Ingredient').trim();
      const origCW = Number(c.weightGrams ?? c.estimatedWeightGrams ?? (c.volumePercentage ? Math.round(origWeight * (c.volumePercentage / 100)) : 0));
      const cWeight = Math.max(1, Math.round(origCW * scale));
      const cBasisWeight = Math.max(1, Number(c.nutrientBasisWeight ?? c.estimatedWeightGrams ?? origCW));
      const cR = cWeight / cBasisWeight;

      const cNuts = c.nutrients || {};
      let cProtRaw = Number(c.protein ?? cNuts.protein ?? 0);
      let cFatRaw = Number(c.totalFat ?? c.fat ?? cNuts.totalFat ?? cNuts.fat ?? cNuts.saturatedFat ?? 0);
      let cSatRaw = Number(c.saturatedFat ?? cNuts.saturatedFat ?? 0);
      let cCarbsRaw = Number(c.carbohydrates ?? c.carbs ?? cNuts.carbohydrates ?? 0);
      let cNaRaw = Number(c.sodium ?? cNuts.sodium ?? 0);
      let cCalsRaw = Number(c.calories ?? cNuts.calories ?? 0);
      let cFibRaw = Number(c.totalFibre ?? c.fiber ?? cNuts.totalFibre ?? cNuts.fiber ?? 0);
      let cSolRaw = Number(c.solubleFibre ?? cNuts.solubleFibre ?? 0);

      // Guard against ghost components with 0 macros: resolve via canonical DB or proportional parent allocation
      const isZeroCalFood = /\b(water|diet\s*soda|zero\s*calorie|black\s*coffee|plain\s*tea|air\s*putih)\b/i.test(cName);
      if (!isZeroCalFood && cProtRaw === 0 && cFatRaw === 0 && cCarbsRaw === 0 && cCalsRaw === 0) {
        const baseLookup = lookupCanonicalBaseFood(cName) || lookupCanonicalBaseFood(c.searchQuery || '');
        if (baseLookup) {
          const bW = cBasisWeight > 0 ? cBasisWeight : 100;
          cProtRaw = Math.round((Number(baseLookup.protein || 0) * (bW / 100)) * 10) / 10;
          cFatRaw = Math.round((Number(baseLookup.totalFat ?? baseLookup.fat ?? 0) * (bW / 100)) * 10) / 10;
          cSatRaw = Math.round((Number(baseLookup.saturatedFat || 0) * (bW / 100)) * 10) / 10;
          cCarbsRaw = Math.round((Number(baseLookup.carbohydrates ?? baseLookup.carbs ?? 0) * (bW / 100)) * 10) / 10;
          cNaRaw = Math.round(Number(baseLookup.sodium || 0) * (bW / 100));
          cCalsRaw = Math.round((Number(baseLookup.calories || (4 * cProtRaw + 4 * cCarbsRaw + 9 * cFatRaw))) * (bW / 100));
        } else if (nutrients.calories && nutrients.calories > 0) {
          const share = Math.min(1, Math.max(0.05, origCW / (origWeight || 100)));
          cCalsRaw = Math.round(Number(nutrients.calories) * share);
          cProtRaw = Math.round(Number(nutrients.protein || 0) * share * 10) / 10;
          cFatRaw = Math.round(Number(nutrients.totalFat || 0) * share * 10) / 10;
          cSatRaw = Math.round(Number(nutrients.saturatedFat || 0) * share * 10) / 10;
          cCarbsRaw = Math.round(Number(nutrients.carbohydrates || 0) * share * 10) / 10;
          cNaRaw = Math.round(Number(nutrients.sodium || 0) * share);
        }
      }
      if (cCalsRaw === 0 && (cProtRaw > 0 || cFatRaw > 0 || cCarbsRaw > 0)) {
        cCalsRaw = Math.round(4 * cProtRaw + 4 * cCarbsRaw + 9 * cFatRaw);
      }

      let cProt = Math.round(cProtRaw * cR * 10) / 10;
      let cFat = Math.round(cFatRaw * cR * 10) / 10;
      let cSat = Math.round(cSatRaw * cR * 10) / 10;
      let cCarbs = Math.round(cCarbsRaw * cR * 10) / 10;
      let cNa = Math.round(cNaRaw * cR);
      let cCals = Math.round(cCalsRaw * cR);
      let cFib = Math.round(cFibRaw * cR * 10) / 10;
      let cSol = cSolRaw > 0 ? Math.round(cSolRaw * cR * 10) / 10 : computeSolubleFibre(cFib, cName);
      let childDbSource = c.dbSource || 'estimated';

      const childRawLabel = c.rawNutritionLabel;
      const childHasOcr = childRawLabel && typeof childRawLabel === 'object' && (childRawLabel.calories != null || childRawLabel.energy != null || childRawLabel.kcal != null);
      if (childHasOcr) {
        const { ocrNutrients } = parseOcrLabel(childRawLabel, cWeight, cR);
        if (ocrNutrients.calories != null) cCals = ocrNutrients.calories;
        if (ocrNutrients.protein != null) cProt = ocrNutrients.protein;
        if (ocrNutrients.totalFat != null) cFat = ocrNutrients.totalFat;
        if (ocrNutrients.saturatedFat != null) cSat = ocrNutrients.saturatedFat;
        if (ocrNutrients.carbohydrates != null) cCarbs = ocrNutrients.carbohydrates;
        if (ocrNutrients.sodium != null) cNa = ocrNutrients.sodium;
        if (ocrNutrients.totalFibre != null) cFib = ocrNutrients.totalFibre;
        if (ocrNutrients.solubleFibre != null) cSol = ocrNutrients.solubleFibre;
        childDbSource = 'label';
        Object.assign(cNuts, ocrNutrients);
      }

      const base100g = cBasisWeight > 0 ? {
        calories: Math.round((cCalsRaw / cBasisWeight) * 100),
        protein: Math.round((cProtRaw / cBasisWeight) * 100 * 10) / 10,
        totalFat: Math.round((cFatRaw / cBasisWeight) * 100 * 10) / 10,
        saturatedFat: Math.round((cSatRaw / cBasisWeight) * 100 * 10) / 10,
        carbohydrates: Math.round((cCarbsRaw / cBasisWeight) * 100 * 10) / 10,
        sodium: Math.round((cNaRaw / cBasisWeight) * 100),
        totalFibre: Math.round((cFibRaw / cBasisWeight) * 100 * 10) / 10,
        solubleFibre: Math.round(((cSolRaw > 0 ? cSolRaw : computeSolubleFibre(cFibRaw, cName)) / cBasisWeight) * 100 * 10) / 10,
      } : null;

      return {
        ...c,
        name: cName,
        searchQuery: c.searchQuery || cName,
        weightGrams: cWeight,
        estimatedWeightGrams: cWeight,
        nutrientBasisWeight: cWeight, // lock to new weight
        calories: cCals,
        protein: cProt,
        totalFat: cFat,
        fat: cFat,
        saturatedFat: cSat,
        carbohydrates: cCarbs,
        carbs: cCarbs,
        sodium: cNa,
        totalFibre: cFib,
        solubleFibre: cSol,
        nutrients: {
          ...cNuts,
          calories: cCals,
          protein: cProt,
          totalFat: cFat,
          saturatedFat: cSat,
          carbohydrates: cCarbs,
          sodium: cNa,
          totalFibre: cFib,
          solubleFibre: cSol,
        },
        dbSource: childDbSource,
        dbId: c.dbId || null,
        baseNutrients100g: c.baseNutrients100g || base100g,
      };
    });

    // Subcomponent truth takes precedence. We must physically sum the children
    // to derive the precise parent macros, rather than relying on top-level AI estimates.
    if (componentsDetailList && componentsDetailList.length > 0 && dbSource !== 'label') {
      let sumCal = 0;
      let sumProt = 0;
      let sumFat = 0;
      let sumSat = 0;
      let sumCarbs = 0;
      let sumNa = 0;
      let sumTrans = 0;
      let sumFibre = 0;
      for (const c of componentsDetailList) {
        sumCal += (c.calories || 0);
        sumProt += (c.protein || 0);
        sumFat += (c.totalFat || 0);
        sumSat += (c.saturatedFat || 0);
        sumCarbs += (c.carbohydrates || 0);
        sumNa += (c.sodium || 0);
        sumTrans += (c.transFat || c.nutrients?.transFat || 0);
        sumFibre += (c.totalFibre || c.nutrients?.totalFibre || 0);
      }
      if (sumCal > 0 || sumProt > 0 || sumFat > 0 || sumCarbs > 0) {
        nutrients.calories = Math.round(sumCal);
        nutrients.protein = Math.round(sumProt * 10) / 10;
        nutrients.totalFat = Math.round(sumFat * 10) / 10;
        nutrients.saturatedFat = Math.round(sumSat * 10) / 10;
        nutrients.carbohydrates = Math.round(sumCarbs * 10) / 10;
        nutrients.sodium = Math.round(sumNa);
        if (sumTrans > 0) nutrients.transFat = Math.round(sumTrans * 10) / 10;
        if (sumFibre > 0) nutrients.totalFibre = Math.round(sumFibre * 10) / 10;
        // The child-sum above rewrites totalFat/sat/trans/sodium AFTER step 5
        // derived unsaturatedFat/salt (e.g. from the estimated fallback when the
        // scout dish carries no top-level nutrients). Re-derive so the ledger
        // can never print unsat > totalFat or salt from a stale sodium.
        reapplyDerivedNutrients(nutrients);
        
        // Update missing locks
        ['calories', 'protein', 'totalFat', 'saturatedFat', 'carbohydrates', 'sodium'].forEach(k => {
          if (!lockedNutrientKeys.includes(k)) lockedNutrientKeys.push(k);
        });
      }
    }
  }

  // 8. Sugar and Added Sugar Breakdown
  if (!lockedNutrientKeys.includes('addedSugar') || !lockedNutrientKeys.includes('sugar')) {
    const candidateAdded = nutrients.addedSugar != null && !isNaN(Number(nutrients.addedSugar)) && Number(nutrients.addedSugar) >= 0 ? Number(nutrients.addedSugar) : null;
    let rawSugar = nutrients.sugar != null && !isNaN(Number(nutrients.sugar)) ? Number(nutrients.sugar) : (nutrients.totalSugar != null && !isNaN(Number(nutrients.totalSugar)) ? Number(nutrients.totalSugar) : null);
    if (candidateAdded != null && rawSugar != null && candidateAdded > rawSugar) {
      rawSugar = candidateAdded;
    }
    const componentNames = [
      ingredients.join(', '),
      ...(Array.isArray(item.components) ? item.components.map((c: any) => (typeof c === 'string' ? c : c.searchQuery || c.name || '')) : []),
      ...(Array.isArray(componentsDetailList) ? componentsDetailList.map((c: any) => c.name || c.searchQuery || '') : []),
    ].filter(Boolean).join(', ');

    const physicalFormObj = item.physicalFormClassification || classifyUniversalPhysicalFormV3({
      name: originalName,
      canonicalDbName: originalName,
      originalLocalName: originalName,
      keyword: keyword || originalName,
      visualIngredients,
      components: item.components || componentsDetailList,
      foodType: item.foodType,
    });

    const sugarResult = deduceSugarBreakdown({
      totalSugar: rawSugar,
      addedSugarPrinted: candidateAdded,
      carbohydrates: nutrients.carbohydrates,
      totalFibre: nutrients.totalFibre,
      physicalForm: physicalFormObj?.physicalForm,
      foodType: item.foodType,
      ingredientsList: componentNames || item.ingredientsList,
      foodName: originalName || keyword,
    });
    if (!lockedNutrientKeys.includes('sugar')) {
      nutrients.sugar = sugarResult.sugar;
    }
    if (!lockedNutrientKeys.includes('addedSugar')) {
      nutrients.addedSugar = sugarResult.addedSugar;
    }
  }

  // Physical Bounds Invariant (Pure lipid upper bound 9.2 kcal/g, macro mass <= weight)
  if (consumedWeight > 0) {
    const maxPhysCal = Math.round(consumedWeight * 9.2);
    if (nutrients.calories != null) {
      const calVal = Number(nutrients.calories);
      if (!lockedNutrientKeys.includes('calories') && calVal > maxPhysCal) {
        nutrients.calories = maxPhysCal;
      } else if (lockedNutrientKeys.includes('calories') && calVal > Math.round(consumedWeight * 15)) {
        nutrients.calories = maxPhysCal;
      }
    }
    const macroKeys = ['protein', 'totalFat', 'saturatedFat', 'transFat', 'carbohydrates', 'totalFibre', 'sugar', 'addedSugar'];
    for (const mk of macroKeys) {
      if (nutrients[mk] != null && Number(nutrients[mk]) > consumedWeight) {
        nutrients[mk] = Math.round(consumedWeight * 10) / 10;
      }
    }
    const p = Number(nutrients.protein) || 0;
    const f = Number(nutrients.totalFat) || 0;
    const c = Number(nutrients.carbohydrates) || 0;
    const sumMacros = p + f + c;
    if (sumMacros > consumedWeight * 1.05 && sumMacros > 0) {
      const macroFactor = consumedWeight / sumMacros;
      if (nutrients.protein != null) nutrients.protein = Math.round(p * macroFactor * 10) / 10;
      if (nutrients.totalFat != null) nutrients.totalFat = Math.round(f * macroFactor * 10) / 10;
      if (nutrients.carbohydrates != null) nutrients.carbohydrates = Math.round(c * macroFactor * 10) / 10;
      if (nutrients.totalFibre != null && Number(nutrients.totalFibre) > (Number(nutrients.carbohydrates) || 0)) {
        nutrients.totalFibre = nutrients.carbohydrates;
      }
    }
  }

  const finalIngredientsList = ingredients.length > 0 ? ingredients.join(', ') : (item.ingredientsList || (componentsDetailList ? componentsDetailList.map((c: any) => c.name).join(', ') : null));

  return {
    scoutIndex,
    originalName,
    // Prefer official brand menu dish name when matched (e.g. "Mr Oat Rolled Oats"
    // instead of the scout short name "Rolled Oats").
    brandDisplayName,
    keyword,
    chainName,
    weightGrams: consumedWeight,
    nutrientBasisWeight,
    ingredients: ingredients.length > 0 ? ingredients : (componentsDetailList ? componentsDetailList.map((c: any) => c.name) : []),
    visualIngredients: visualIngredients.length > 0 ? visualIngredients : (componentsDetailList ? componentsDetailList.map((c: any) => c.name) : []),
    nutrients,
    lockedNutrientKeys,
    brandLock,
    dishClass,
    dbSource,
    dbId,
    // Printed-label evidence for provenance/badging (never math). The raw label
    // is only carried when it drove the numbers (dbSource label); per-serving
    // label nutrients pass through when the scout provided them.
    rawNutritionLabel: dbSource === 'label' && rawLabel && typeof rawLabel === 'object' ? rawLabel : null,
    labelNutrientsPerServing:
      item.labelNutrientsPerServing && typeof item.labelNutrientsPerServing === 'object' ? item.labelNutrientsPerServing : null,
    bindStatus,
    atwaterFlag,
    usdaQueries,
    components: componentsDetailList || item.components || undefined,
    componentsDetailList: componentsDetailList || undefined,
    compositeSiblings: componentsDetailList || undefined,
    hasComponents: Boolean(componentsDetailList && componentsDetailList.length > 1),
    ingredientsList: finalIngredientsList,
    prepAddition: prep,
  };
}
