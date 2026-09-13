/**
 * server_meal_gate.ts
 *
 * Hard validation gate for meal calculations and edits (FOOD_SINGLE_PATH F-8.1).
 * Computes deterministic trial-balance check on every meal before saving or returning.
 * Refuses saving (savable: false, pass: false) if fundamental physical invariants fail.
 */

export interface MealGateItem {
  name: string;
  weightGrams?: number;
  calories?: number | null;
  protein?: number | null;
  carbohydrates?: number | null;
  totalFat?: number | null;
  saturatedFat?: number | null;
  sodium?: number | null;
  addedSugar?: number | null;
  totalFibre?: number | null;
  sourceImageIndex?: number | null;
  boundingBox2D?: number[] | null;
  lockedNutrientKeys?: string[];
  dbSource?: string;
  role?: 'food' | 'component';
  isFlattenedComponent?: boolean;
}

export interface MealGateInput {
  mealId?: string;
  name?: string;
  weightGrams?: number;
  calories?: number | null;
  protein?: number | null;
  carbohydrates?: number | null;
  totalFat?: number | null;
  items: MealGateItem[];
  mealHasImages?: boolean;
  imageCount?: number;
  narrative?: string | null;
  staleDietNarrative?: boolean;
  /** Backcompat: pre-rename stored meals carry staleDietitianNarrative. */
  staleDietitianNarrative?: boolean;
  previousMeal?: {
    items?: MealGateItem[];
    weightGrams?: number;
    calories?: number;
    protein?: number;
  } | null;
  commands?: Array<{
    action: string;
    itemName?: string;
    newWeightGrams?: number | null;
    componentName?: string | null;
    modifier?: string | null;
    newItemName?: string | null;
    replacementItemName?: string | null;
  }> | null;
}

export interface GateFailure {
  code:
    | 'ZERO_KCAL_WITH_MACROS'
    | 'ATWATER_DEVIATION'
    | 'SUM_MISMATCH'
    | 'NARRATIVE_MISMATCH'
    | 'MISSING_PHOTO_INDEX'
    | 'UNSPECIFIED_WEIGHT_MUTATION'
    | 'CONDIMENT_HIGH_PROTEIN';
  message: string;
  itemName?: string;
  details?: any;
}

export interface MealGateResult {
  pass: boolean;
  savable: boolean;
  failures: GateFailure[];
  calculatedTotals: {
    weightGrams: number;
    calories: number;
    protein: number;
    carbohydrates: number;
    totalFat: number;
  };
  summary: string;
}

const CONDIMENT_REGEX = /\b(sauce|dressing|dip|mayo|mayonnaise|ketchup|vinaigrette|gravy|sambal|sos)\b/i;

export function evaluateMealGate(input: MealGateInput): MealGateResult {
  const failures: GateFailure[] = [];
  const items = Array.isArray(input.items) ? input.items : [];

  let sumWeight = 0;
  let sumCal = 0;
  let sumP = 0;
  let sumC = 0;
  let sumF = 0;

  for (const item of items) {
    const w = Number(item.weightGrams) || 0;
    const cal = Number(item.calories) || 0;
    const p = Number(item.protein) || 0;
    const c = Number(item.carbohydrates) || 0;
    const f = Number(item.totalFat) || 0;

    sumWeight += w;
    sumCal += cal;
    sumP += p;
    sumC += c;
    sumF += f;

    const macroSum = p + c + f;

    // 1. Zero kcal with positive macros
    if (cal === 0 && macroSum > 1.0) {
      failures.push({
        code: 'ZERO_KCAL_WITH_MACROS',
        itemName: item.name,
        message: `Item "${item.name}" has 0 kcal but positive macros (${p}g protein, ${c}g carbs, ${f}g fat).`,
        details: { calories: cal, protein: p, carbs: c, fat: f },
      });
    }

    // 2. Atwater deviation > 35% when calories not locked
    const isLocked =
      Array.isArray(item.lockedNutrientKeys) && item.lockedNutrientKeys.includes('calories');
    const isVerifiedSource = item.dbSource === 'label' || item.dbSource === 'brand_official';

    if (!isLocked && !isVerifiedSource && macroSum > 2.0 && cal > 0) {
      const atwaterKcal = p * 4 + c * 4 + f * 9;
      if (atwaterKcal > 0) {
        const deviationPct = Math.abs(cal - atwaterKcal) / atwaterKcal;
        if (deviationPct > 0.35) {
          failures.push({
            code: 'ATWATER_DEVIATION',
            itemName: item.name,
            message: `Item "${item.name}" calories (${cal} kcal) deviate ${(deviationPct * 100).toFixed(0)}% from Atwater estimate (${atwaterKcal.toFixed(0)} kcal).`,
            details: { calories: cal, atwaterKcal, deviationPct },
          });
        }
      }
    }

    // 3. Missing photo index when meal has images.
    // Explicit null = text-only add (no crop). Undefined = forgot to copy identity photo.
    if (input.mealHasImages && (input.imageCount || 1) > 0) {
      if (item.sourceImageIndex === undefined && item.boundingBox2D == null) {
        failures.push({
          code: 'MISSING_PHOTO_INDEX',
          itemName: item.name,
          message: `Item "${item.name}" is missing sourceImageIndex on a meal with photos.`,
        });
      }
    }

    // 4. Condiment protein density check (>15% protein by weight for sauce/dressing)
    if (w >= 20 && CONDIMENT_REGEX.test(item.name)) {
      const proteinDensity = p / w;
      if (proteinDensity > 0.15) {
        failures.push({
          code: 'CONDIMENT_HIGH_PROTEIN',
          itemName: item.name,
          message: `Condiment/sauce "${item.name}" has unrealistic protein density (${p}g in ${w}g = ${(proteinDensity * 100).toFixed(0)}%).`,
          details: { protein: p, weightGrams: w, proteinDensity },
        });
      }
    }
  }

  // 5. Sum mismatch between items and top-level meal calories
  if (input.calories !== undefined && input.calories !== null) {
    const mealCal = Number(input.calories);
    const diff = Math.abs(mealCal - sumCal);
    // Allow up to 3 kcal or 1% tolerance due to rounding
    if (diff > Math.max(3, mealCal * 0.01)) {
      failures.push({
        code: 'SUM_MISMATCH',
        message: `Sum of item calories (${sumCal.toFixed(0)} kcal) does not match meal calories (${mealCal.toFixed(0)} kcal).`,
        details: { sumCalories: sumCal, mealCalories: mealCal, diff },
      });
    }
  }

  // 6. Narrative vs Ledger mismatch
  const staleNarrative = (input as any).staleDietNarrative ?? input.staleDietitianNarrative;
  if (input.narrative && !staleNarrative) {
    const text = input.narrative.toLowerCase();
    
    // Check protein claim: e.g. "42g protein", "136.2g of protein", "108.5g protein"
    const proteinMatches = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*g(?:\s+of)?\s+protein/gi));
    for (const match of proteinMatches) {
      const claimedP = parseFloat(match[1]);
      const diffP = Math.abs(claimedP - sumP);
      if (diffP > Math.max(2, sumP * 0.05)) {
        failures.push({
          code: 'NARRATIVE_MISMATCH',
          message: `Narrative claims ${claimedP}g protein, but ledger has ${sumP.toFixed(1)}g protein.`,
          details: { claimedProtein: claimedP, ledgerProtein: sumP },
        });
        break;
      }
    }

    // Check calories claim: e.g. "550 kcal", "1681 calories"
    const calMatches = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(?:kcal|calories)\b/gi));
    for (const match of calMatches) {
      const claimedCal = parseFloat(match[1]);
      // Only compare if claimedCal is in the ballpark of total meal calories (e.g. > 100)
      if (claimedCal > 100) {
        const diffCal = Math.abs(claimedCal - sumCal);
        if (diffCal > Math.max(10, sumCal * 0.05)) {
          failures.push({
            code: 'NARRATIVE_MISMATCH',
            message: `Narrative claims ${claimedCal} kcal, but ledger has ${sumCal.toFixed(0)} kcal.`,
            details: { claimedCalories: claimedCal, ledgerCalories: sumCal },
          });
          break;
        }
      }
    }
  }

  // 7. Unspecified weight mutation vs previous meal
  if (input.previousMeal && Array.isArray(input.previousMeal.items) && input.previousMeal.items.length > 0) {
    const prevItems = input.previousMeal.items;
    const cmds = Array.isArray(input.commands) ? input.commands : [];
    
    for (const prev of prevItems) {
      const prevNameLower = prev.name.toLowerCase();
      const currentMatch = items.find(
        (it) => it.name.toLowerCase() === prevNameLower || it.name.toLowerCase().includes(prevNameLower)
      );

      if (currentMatch && prev.weightGrams && currentMatch.weightGrams) {
        const weightDelta = Math.abs(currentMatch.weightGrams - prev.weightGrams);
        if (weightDelta > 5) {
          // Check if there was an explicit command targeting this item
          const hadExplicitCommand = cmds.some((c) => {
            const cName = (c.itemName || c.componentName || '').toLowerCase();
            return cName && (prevNameLower.includes(cName) || cName.includes(prevNameLower));
          });

          if (!hadExplicitCommand) {
            failures.push({
              code: 'UNSPECIFIED_WEIGHT_MUTATION',
              itemName: prev.name,
              message: `Item "${prev.name}" weight mutated from ${prev.weightGrams}g to ${currentMatch.weightGrams}g without explicit command.`,
              details: { previousWeight: prev.weightGrams, newWeight: currentMatch.weightGrams },
            });
          }
        }
      }
    }
  }

  const pass = failures.length === 0;

  return {
    pass,
    savable: pass,
    failures,
    calculatedTotals: {
      weightGrams: Math.round(sumWeight),
      calories: Math.round(sumCal),
      protein: Math.round(sumP * 10) / 10,
      carbohydrates: Math.round(sumC * 10) / 10,
      totalFat: Math.round(sumF * 10) / 10,
    },
    summary: pass ? 'GATE: PASS' : `GATE: FAIL (${failures.map((f) => f.code).join(', ')})`,
  };
}
