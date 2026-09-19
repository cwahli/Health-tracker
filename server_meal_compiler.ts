import { NUTRIENT_KEYS } from "./src/utils/nutrients";
import { t, interpolate } from "./src/utils/i18n";
import { AggregatedNutrientsResult } from "./server_nutrient_aggregation";
import { checkIfItemIsAlreadyPrepared, applyNutrientRealityChecks, sanitizeMealWeight, sanitizeString } from "./server_pure_helpers";
import { calculateUniversalAddedNutrients } from "./server_food_db";
import { finalizeDishLedger } from "./server_dish_finalize";
import { sumItemNutrients } from "./server_meal_from_finalize";

const LIQUID_KEYWORDS = new Set([
  'juice', 'tea', 'coffee', 'water', 'soda', 'milk', 'drink', 'beverage',
  'soup', 'broth', 'cider', 'smoothie', 'latte', 'cappuccino', 'syrup', 'beer', 'wine', 'fluid', 'oil', 'vinegar'
]);

export function isLiquidItem(itemName: string): boolean {
  if (!itemName) return false;
  const clean = itemName.toLowerCase().trim().replace(/[^a-z0-9]/g, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);
  return tokens.some(t => LIQUID_KEYWORDS.has(t));
}

export function formatPortionVolumeOrWeight(weightGrams: number, itemName: string): string {
  const g = Math.round(weightGrams || 0);
  if (isLiquidItem(itemName)) {
    if (g >= 1000) {
      const liters = Math.round((g / 1000) * 10) / 10;
      return `${liters}L`;
    }
    return `${g}ml`;
  }
  return `${g}g`;
}

export interface MealItem {
  itemId: string;
  canonicalDbName: string;
  name?: string;
  originalName?: string;
  keyword?: string;
  weightGrams: number;
  cookingMethod?: string | null;
  diningEnvironment?: string;
  dbSource?: string;
  dbId?: string | number | null;
  foodType?: string;
  nutrients?: Record<string, number>;
  saucesDetailList?: any[];
  cookingAdded?: any;
  components?: any[];
  primaryBase100g?: Record<string, number> | null;
  primaryBaseMatchName?: string | null;
  primaryBaseWeightG?: number;
  labelNutrientsPerServing?: Record<string, number> | null;
  /** Printed-label evidence (provenance for the OCR badge, never math). */
  rawNutritionLabel?: Record<string, any> | null;
}

export interface MealState {
  stateVersion: number;
  itemsBreakdown: MealItem[];
  grandTotals?: AggregatedNutrientsResult;
  receiptTable?: string;
  dangerBadges?: string[];
  biomarkerStatus?: "recommended" | "caution" | "avoid";
  targetOptionId?: string | number | null;
}

export interface StructuralOp {
  op: "rename" | "replace" | "set_weight" | "set_cooking" | "add" | "remove";
  targetId?: string;
  targetName?: string;
  newName?: string;
  canonicalDbName?: string;
  weightGrams?: number;
  cookingMethod?: string;
  fatMedium?: string;
  item?: Partial<MealItem>;
  rematch?: boolean;
}

export interface CompileOptions {
  userProfile?: any;
  diningEnvironment?: string;
  targetOptionId?: string | number | null;
  addDebugLog?: (msg: string) => void;
  dbLookupFn?: (query: string) => Promise<any>;
}

export interface CompileResult {
  success: boolean;
  state?: MealState;
  clarificationRequired?: boolean;
  clarificationMessage?: string;
  error?: string;
}

export interface OptionCard {
  optionId: string | number;
  optionTitle?: string;
  itemsBreakdown: MealItem[];
  grandTotals?: AggregatedNutrientsResult;
  dangerBadges?: string[];
  biomarkerStatus?: "recommended" | "caution" | "avoid";
  rank?: number;
}

/**
 * Customizes a target evaluation card in Mode D and re-ranks all option cards dynamically.
 */
export async function compileComparisonOptionSet(
  optionsSet: OptionCard[],
  targetOptionId: string | number,
  ops: StructuralOp[],
  compileOptions?: CompileOptions
): Promise<{ success: boolean; options?: OptionCard[]; clarificationRequired?: boolean; clarificationMessage?: string }> {
  if (!optionsSet || !Array.isArray(optionsSet) || optionsSet.length === 0) {
    return { success: false, clarificationRequired: true, clarificationMessage: t(compileOptions?.userProfile?.language, 'compilerNoOptions') };
  }

  const targetCardIndex = optionsSet.findIndex(card => String(card.optionId) === String(targetOptionId));
  if (targetCardIndex === -1) {
    return { success: false, clarificationRequired: true, clarificationMessage: interpolate(t(compileOptions?.userProfile?.language, 'compilerOptionNotFound'), { id: targetOptionId }) };
  }

  const targetCard = optionsSet[targetCardIndex];
  const prevState: MealState = {
    stateVersion: 1,
    itemsBreakdown: targetCard.itemsBreakdown || []
  };

  const res = await compileMealState(prevState, ops, compileOptions);
  if (!res.success || !res.state) {
    return { success: false, clarificationRequired: res.clarificationRequired, clarificationMessage: res.clarificationMessage };
  }

  const updatedCard: OptionCard = {
    ...targetCard,
    itemsBreakdown: res.state.itemsBreakdown,
    grandTotals: res.state.grandTotals,
    dangerBadges: res.state.dangerBadges,
    biomarkerStatus: res.state.biomarkerStatus
  };

  const updatedSet = [...optionsSet];
  updatedSet[targetCardIndex] = updatedCard;

  // Dynamic Re-ranking Policy: Recommended (Rank 1) -> Caution (Rank 2) -> Avoid (Rank 3)
  const rankWeight = (status?: string) => {
    if (status === "recommended") return 1;
    if (status === "caution") return 2;
    if (status === "avoid") return 3;
    return 2;
  };

  updatedSet.sort((a, b) => rankWeight(a.biomarkerStatus) - rankWeight(b.biomarkerStatus));
  updatedSet.forEach((card, idx) => {
    card.rank = idx + 1;
  });

  return { success: true, options: updatedSet };
}

/**
 * Classifies text user interaction intent for Mode B query bypass vs Mode C edit.
 */
export function detectTextInteractionIntent(message: string, activeMeal?: any): "query" | "edit" {
  if (!message || typeof message !== "string") return "query";
  const msgLower = message.trim().toLowerCase();

  // Explicit edit/mutation keywords
  const editRegex = /\b(change|modify|update|remove|delete|correct|instead|replace|swap|adjust|add|extra|more|less|omit|baked|fried|grilled|steamed|boiled|raw|grams?)\b/i;

  // Explicit query keywords
  const queryRegex = /^(is|why|how|what|can i|should i|does|will|explain|tell me|is it safe|are there|what are)\b/i;

  if (queryRegex.test(msgLower) && !editRegex.test(msgLower)) {
    return "query";
  }

  if (editRegex.test(msgLower)) {
    return "edit";
  }

  if (msgLower.endsWith("?")) {
    return "query";
  }

  return "edit";
}

/**
 * Mints a durable unique item ID if one is missing.
 */
export function mintItemId(existingId?: string, index: number = 0): string {
  if (existingId && typeof existingId === "string" && existingId.trim().length > 0) {
    return existingId.trim();
  }
  const rand = Math.random().toString(36).substring(2, 7);
  return `item_${Date.now()}_${index}_${rand}`;
}

/**
 * Resolves target item within meal using targetId or fuzzy name matching.
 */
export function resolveTargetItemIndex(
  items: MealItem[],
  targetId?: string,
  targetName?: string
): { index: number; ambiguous: boolean; matches: number } {
  if (!items || items.length === 0) {
    return { index: -1, ambiguous: false, matches: 0 };
  }

  // 1. Explicit targetId match (highest priority)
  if (targetId && typeof targetId === "string" && targetId.trim().length > 0) {
    const cleanId = targetId.trim();
    const exactIdx = items.findIndex((it) => it.itemId === cleanId);
    if (exactIdx !== -1) {
      return { index: exactIdx, ambiguous: false, matches: 1 };
    }
  }

  // 2. Fuzzy name matching
  const searchStr = (targetName || targetId || "").trim().toLowerCase();
  if (!searchStr) {
    return { index: -1, ambiguous: false, matches: 0 };
  }

  const matchingIndices: number[] = [];
  items.forEach((it, idx) => {
    const cName = (it.canonicalDbName || "").toLowerCase();
    const oName = (it.originalName || "").toLowerCase();
    const name = (it.name || "").toLowerCase();
    const kw = (it.keyword || "").toLowerCase();

    if (
      cName === searchStr ||
      oName === searchStr ||
      name === searchStr ||
      kw === searchStr ||
      (cName.length > 0 && searchStr.includes(cName)) ||
      (searchStr.length > 0 && cName.includes(searchStr))
    ) {
      matchingIndices.push(idx);
    }
  });

  if (matchingIndices.length === 1) {
    return { index: matchingIndices[0], ambiguous: false, matches: 1 };
  } else if (matchingIndices.length > 1) {
    return { index: -1, ambiguous: true, matches: matchingIndices.length };
  }

  return { index: -1, ambiguous: false, matches: 0 };
}

/**
 * Absolute State Compiler (Pure TypeScript Code Engine).
 * Applies structural ops deterministically to an active meal state.
 */
export async function compileMealState(
  prevState: MealState | null,
  ops: StructuralOp[],
  options: CompileOptions = {}
): Promise<CompileResult> {
  const addDebugLog = options.addDebugLog || (() => {});
  addDebugLog(`[MealCompiler] Starting compilation for ${ops ? ops.length : 0} op(s).`);

  const prevItems: MealItem[] = prevState?.itemsBreakdown
    ? JSON.parse(JSON.stringify(prevState.itemsBreakdown))
    : [];

  // Ensure all previous items have durable itemIds
  prevItems.forEach((it, idx) => {
    it.itemId = mintItemId(it.itemId, idx);
  });

  const nextVersion = (prevState?.stateVersion || 0) + 1;
  const currentItems: MealItem[] = JSON.parse(JSON.stringify(prevItems));

  // --- Step 1: All-or-Nothing Op Target Resolution & Validation ---
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.op === "add") continue; // New items don't have existing targets

    const res = resolveTargetItemIndex(currentItems, op.targetId, op.targetName || op.canonicalDbName);
    if (res.ambiguous) {
      addDebugLog(`[MealCompiler] Ambiguous target for op #${i + 1} (${op.op} "${op.targetName || op.targetId}"). Matches: ${res.matches}.`);
      return {
        success: false,
        clarificationRequired: true,
        clarificationMessage: interpolate(t(options.userProfile?.language, 'compilerMultipleMatch'), { name: op.targetName || op.targetId })
      };
    }
    if (res.index === -1) {
      addDebugLog(`[MealCompiler] Target not found for op #${i + 1} (${op.op} "${op.targetName || op.targetId}").`);
      return {
        success: false,
        clarificationRequired: true,
        clarificationMessage: interpolate(t(options.userProfile?.language, 'compilerNotFound'), { name: op.targetName || op.targetId })
      };
    }
  }

  // --- Step 2: Apply Structural Ops Mutually & Atomically ---
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    addDebugLog(`[MealCompiler] Executing op #${i + 1}: ${op.op}`);

    if (op.op === "add") {
      const newItem: MealItem = {
        itemId: mintItemId(op.item?.itemId, currentItems.length),
        canonicalDbName: op.item?.canonicalDbName || op.canonicalDbName || op.item?.name || "Unspecified Item",
        name: op.item?.name || op.item?.canonicalDbName || op.canonicalDbName || "Unspecified Item",
        weightGrams: sanitizeMealWeight(op.item?.weightGrams || op.weightGrams, 100),
        cookingMethod: op.item?.cookingMethod || op.cookingMethod || null,
        dbSource: op.item?.dbSource || "estimated",
        foodType: op.item?.foodType || "unknown",
        primaryBase100g: op.item?.primaryBase100g || null
      };
      currentItems.push(newItem);
      continue;
    }

    const { index } = resolveTargetItemIndex(currentItems, op.targetId, op.targetName || op.canonicalDbName);
    const targetItem = currentItems[index];

    if (op.op === "remove") {
      currentItems.splice(index, 1);
    } else if (op.op === "set_weight") {
      if (op.weightGrams && op.weightGrams > 0) {
        targetItem.weightGrams = sanitizeMealWeight(op.weightGrams, targetItem.weightGrams);
      }
    } else if (op.op === "set_cooking") {
      if (op.cookingMethod) {
        targetItem.cookingMethod = op.cookingMethod;
        // Invalidate stale cooking/sauce properties before physics calculation
        delete targetItem.cookingAdded;
        targetItem.saucesDetailList = [];
      }
    } else if (op.op === "rename") {
      const newName = op.newName || op.canonicalDbName;
      if (newName) {
        targetItem.canonicalDbName = newName;
        targetItem.name = newName;
        targetItem.originalName = newName;
        targetItem.keyword = newName;
        // Mandatory DB rematch unless rematch: false
        if (op.rematch !== false) {
          targetItem.dbSource = "estimated";
          delete targetItem.primaryBase100g;
          delete targetItem.primaryBaseMatchName;
          delete targetItem.labelNutrientsPerServing;
          delete (targetItem as any).bestMatchDbId;
          delete targetItem.dbId;
          delete targetItem.cookingAdded;
          targetItem.components = [];
          targetItem.saucesDetailList = [];
        }
      }
    } else if (op.op === "replace") {
      const newName = op.canonicalDbName || op.newName || targetItem.canonicalDbName;
      targetItem.canonicalDbName = newName;
      targetItem.name = newName;
      targetItem.originalName = newName;
      targetItem.keyword = newName;
      if (op.weightGrams && op.weightGrams > 0) {
        targetItem.weightGrams = sanitizeMealWeight(op.weightGrams, targetItem.weightGrams);
      }
      if (op.cookingMethod) {
        targetItem.cookingMethod = op.cookingMethod;
      }
      targetItem.dbSource = "estimated";
      delete targetItem.primaryBase100g;
      delete targetItem.primaryBaseMatchName;
      delete targetItem.labelNutrientsPerServing;
      delete (targetItem as any).bestMatchDbId;
      delete targetItem.dbId;
      delete targetItem.cookingAdded;
      targetItem.components = [];
      targetItem.saucesDetailList = [];
    }
  }

  // --- Step 3: Same calorie owner as Mode A/Edit (finalizeDishLedger) ---
  const finalizedItems: MealItem[] = [];
  for (let idx = 0; idx < currentItems.length; idx++) {
    const it = currentItems[idx];
    const grams = sanitizeMealWeight(it.weightGrams, 100);
    let nutrients = it.nutrients ? { ...it.nutrients } : undefined;
    if (!nutrients && it.primaryBase100g) {
      nutrients = {};
      const R = grams / 100;
      for (const [k, v] of Object.entries(it.primaryBase100g)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          nutrients[k] = k === 'calories' || k === 'sodium' || k === 'potassium' || k === 'calcium' || k === 'magnesium'
            ? Math.round(v * R)
            : Math.round(v * R * 10) / 10;
        }
      }
    }
    const ledger = await finalizeDishLedger({
      item: {
        originalName: it.canonicalDbName || it.name || it.originalName || 'Item',
        keyword: it.keyword || it.name,
        estimatedWeightGrams: grams,
        nutrientBasisWeight: it.primaryBase100g ? 100 : grams,
        nutrients,
        cookingMethod: it.cookingMethod,
        components: it.components,
      },
      consumedWeight: grams,
      nutrientBasisWeight: it.primaryBase100g ? 100 : grams,
      diningEnvironment: it.diningEnvironment || options.diningEnvironment,
    });
    finalizedItems.push({
      ...it,
      itemId: mintItemId(it.itemId, idx),
      weightGrams: grams,
      nutrients: ledger.nutrients as Record<string, number>,
      dbSource: ledger.dbSource || it.dbSource,
      dbId: ledger.dbId ?? it.dbId,
      // Printed-label evidence rides with the numbers it produced. Without
      // this the savable item can never badge "Nutrition Facts (OCR Label)".
      rawNutritionLabel: (ledger as any).rawNutritionLabel ?? (it as any).rawNutritionLabel ?? null,
      labelNutrientsPerServing: (ledger as any).labelNutrientsPerServing ?? (it as any).labelNutrientsPerServing ?? null,
    });
    addDebugLog(`[MealCompiler] finalize idx=${idx} "${it.canonicalDbName}" kcal=${ledger.nutrients.calories} source=${ledger.dbSource}`);
  }
  const summed = sumItemNutrients(finalizedItems);
  const grandTotals: AggregatedNutrientsResult = {
    nutrients: summed,
    itemsBreakdown: finalizedItems,
  };

  // --- Step 4: Evaluate Code-Driven Danger Warning Badges ---
  const dangerBadges: string[] = [];
  let biomarkerStatus: "recommended" | "caution" | "avoid" = "recommended";

  const userProfile = options.userProfile;
  const cal = grandTotals.nutrients.calories || 0;
  const satFat = grandTotals.nutrients.saturatedFat || 0;
  const sodium = grandTotals.nutrients.sodium || 0;
  const sugar = grandTotals.nutrients.addedSugar || 0;

  if (sodium > 800) {
    dangerBadges.push("HIGH_SODIUM_WARNING");
    biomarkerStatus = "caution";
  }
  if (sodium > 1200) {
    biomarkerStatus = "avoid";
  }
  if (satFat > 7) {
    dangerBadges.push("SAT_FAT_WARNING");
    if (biomarkerStatus === "recommended") biomarkerStatus = "caution";
  }
  if (satFat > 12) {
    biomarkerStatus = "avoid";
  }
  if (sugar > 15) {
    dangerBadges.push("ADDED_SUGAR_WARNING");
    if (biomarkerStatus === "recommended") biomarkerStatus = "caution";
  }

  // --- Step 5: Render 5-Column Markdown Receipt Table ---
  const receiptRows = finalizedItems.map((it) => {
    const c = Math.round(it.nutrients?.calories || 0);
    const p = Math.round((it.nutrients?.protein || 0) * 10) / 10;
    const f = Math.round((it.nutrients?.totalFat || 0) * 10) / 10;
    const s = Math.round(it.nutrients?.sodium || 0);
    return `| **${it.canonicalDbName}** | ${formatPortionVolumeOrWeight(it.weightGrams, it.canonicalDbName)} | ${c} kcal | ${p}g P / ${f}g F | ${s}mg Na |`;
  });

  const receiptTable = [
    "| Item | Weight | Calories | Macros | Sodium |",
    "|---|---|---|---|---|",
    ...receiptRows,
    `| **GRAND TOTAL** | **${Math.round(finalizedItems.reduce((a, it) => a + (it.weightGrams || 0), 0))}g** | **${Math.round(grandTotals.nutrients.calories)} kcal** | **${Math.round(grandTotals.nutrients.protein)}g P / ${Math.round(grandTotals.nutrients.totalFat)}g F** | **${Math.round(grandTotals.nutrients.sodium)}mg Na** |`
  ].join("\n");

  const compiledState: MealState = {
    stateVersion: nextVersion,
    itemsBreakdown: finalizedItems,
    grandTotals,
    receiptTable,
    dangerBadges,
    biomarkerStatus,
    targetOptionId: options.targetOptionId || null
  };

  addDebugLog(`[MealCompiler] Successfully compiled state v${nextVersion} with ${finalizedItems.length} item(s).`);
  return {
    success: true,
    state: compiledState
  };
}
