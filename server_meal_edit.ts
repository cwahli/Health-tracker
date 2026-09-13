/**
 * server_meal_edit.ts
 *
 * FOOD_SINGLE_PATH F-8.3: pure TS edit executor.
 * Commands patch the same meal; finalizeDishLedger owns calories for new identities.
 * Empty commands = Q&A (card unchanged).
 */

import { finalizeDishLedger, parseOcrLabel } from './server_dish_finalize.js';
import { applyNutrientModifiers, computeCaloriesFromMacros, computeSolubleFibre } from './server_derivation.js';
import { findItemIndexInList, formatMealReceiptTable, synthesizeEditCommandsFromBreakdown, itemsMatchByName } from './server_pure_helpers.js';
import { NUTRIENT_KEYS } from './src/utils/nutrients.js';
import { sumItemNutrients } from './server_meal_from_finalize.js';
import {
  applyUserLockedSlots,
  diffScoutToEditCommands,
  displayName,
  invalidateStaleIdentityMetadata,
  isSameMealMergeRequest,
  itemsReferSame,
  itemsShareSubstance,
  mergeLocksFromCommands,
  reaggregateDishWeightFromComponents,
  type UserLockedSlot,
} from './server_edit_patch_ledger.js';

export const CONDIMENT_NAME_RE = /\b(sauce|dressing|dip|mayo|mayonnaise|ketchup|vinaigrette|gravy|sambal|sos)\b/i;

export type ScoutEstimate = {
  protein?: number | null;
  carbohydrates?: number | null;
  totalFat?: number | null;
  saturatedFat?: number | null;
  sodium?: number | null;
  addedSugar?: number | null;
  totalFibre?: number | null;
  sugar?: number | null;
  cookingMethod?: string | null;
  foodType?: string | null;
  diningEnvironment?: string | null;
  nutrients?: Record<string, any> | null;
  [key: string]: any;
};

export type MealEditCommand = {
  action: string;
  itemName?: string;
  newItemName?: string;
  replacementItemName?: string;
  targetItemName?: string;
  sourceItemName?: string;
  newWeightGrams?: number | null;
  targetDbId?: string | null;
  componentName?: string | null;
  modifier?: string | null;
  count?: number | null;
  estimate?: ScoutEstimate | null;
  into?: Array<{ name: string; grams?: number; role?: string; estimate?: ScoutEstimate | null }>;
  sourceImageIndex?: number | null;
  boundingBox2D?: number[] | null;
};

export type MealEditResult = {
  items: any[];
  nutrients: Record<string, number>;
  weightGrams: number;
  changed: boolean;
  qa: boolean;
  receiptTable: string;
  notes: string[];
  beforeItems?: any[];
};

function itemNames(it: any): string {
  return `${it?.name || ''} ${it?.canonicalDbName || ''} ${it?.originalName || ''} ${it?.keyword || ''}`.toLowerCase();
}

function userMentioned(name: string, message: string): boolean {
  if (!name || !message) return false;
  const msg = message.toLowerCase();
  const tokens = String(name)
    .toLowerCase()
    .split(/[\s,_\-/]+/)
    .filter((t) => t.length > 2 && !['the', 'and', 'with', 'for'].includes(t));
  if (tokens.length === 0) return msg.includes(String(name).toLowerCase());
  return tokens.some((t) => msg.includes(t));
}

export function applyModifierToItemName(orig: string, modifier: string): string {
  if (!orig) return orig;
  const mod = (modifier || '').toLowerCase();
  const isUnsweetened = /unsweet|unsweat|no sugar|zero sugar|tawar|sugar/.test(mod);
  if (isUnsweetened) {
    if (/es\s+teh\s+manis/i.test(orig)) return orig.replace(/es\s+teh\s+manis/gi, 'Es Teh Tawar');
    if (/teh\s+manis/i.test(orig)) return orig.replace(/teh\s+manis/gi, 'Teh Tawar');
    if (/\bmanis\b/i.test(orig)) return orig.replace(/\bmanis\b/gi, 'Tawar');
    if (/sweet\s+iced?\s+tea/i.test(orig)) return orig.replace(/sweet\s+iced?\s+tea/gi, 'Unsweetened Iced Tea');
    if (/^sweet(ened)?\s+/i.test(orig)) return orig.replace(/^sweet(ened)?\s+/i, 'Unsweetened ');
    if (!/unsweetened|unsweatened|tawar/i.test(orig)) return `Unsweetened ${orig}`;
    return orig;
  }
  const modLabel = modifier ? modifier.charAt(0).toUpperCase() + modifier.slice(1) : '';
  if (modLabel && !orig.toLowerCase().includes(mod.toLowerCase())) return `${modLabel} ${orig}`;
  return orig;
}

export function scaleItemNutrients(item: any, ratio: number, newWeight?: number): any {
  const next = { ...item };
  const oldW = Number(item.weightGrams) || 0;
  const w = newWeight != null ? newWeight : Math.round(oldW * ratio);
  next.weightGrams = w;
  const base = { ...(item.nutrients || {}) };
  for (const k of NUTRIENT_KEYS) {
    const v = base[k] ?? item[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      base[k] = Math.round(v * ratio * 10) / 10;
    }
  }
  const locked = Array.isArray(item.lockedNutrientKeys) ? item.lockedNutrientKeys : [];
  if (!locked.includes('calories')) {
    base.calories = computeCaloriesFromMacros(base.protein, base.carbohydrates, base.totalFat);
  }
  if (!locked.includes('solubleFibre') && (base.solubleFibre == null || base.solubleFibre === 0) && base.totalFibre) {
    base.solubleFibre = computeSolubleFibre(base.totalFibre, item.name || item.originalName);
  }
  next.nutrients = base;
  next.calories = base.calories ?? 0;
  next.protein = base.protein ?? 0;
  next.totalFat = base.totalFat ?? 0;
  next.saturatedFat = base.saturatedFat ?? 0;
  next.carbohydrates = base.carbohydrates ?? 0;
  next.sodium = base.sodium ?? 0;
  if (Array.isArray(next.componentsDetailList)) {
    next.componentsDetailList = next.componentsDetailList.map((c: any) => scaleItemNutrients(c, ratio));
  }
  if (Array.isArray(next.components) && next.components[0] && typeof next.components[0] === 'object') {
    next.components = next.components.map((c: any) => (typeof c === 'object' ? scaleItemNutrients(c, ratio) : c));
  }
  return next;
}

function estimateToScoutItem(name: string, grams: number, estimate: ScoutEstimate | null | undefined, media: any): any {
  const e: any = estimate || {};
  const n: Record<string, any> = {};
  const ALL_KEYS = [
    'calories', 'protein', 'totalFat', 'saturatedFat', 'transFat', 'unsaturatedFat',
    'carbohydrates', 'sugar', 'totalSugar', 'addedSugar', 'totalFibre', 'solubleFibre',
    'sodium', 'potassium', 'magnesium', 'calcium', 'iron', 'zinc', 'selenium', 'iodine',
    'phosphorus', 'vitaminD', 'vitaminB12', 'folate', 'vitaminC', 'vitaminE', 'vitaminK',
    'vitaminA', 'vitaminB6', 'thiamine', 'riboflavin', 'niacin', 'omega3'
  ];
  for (const k of ALL_KEYS) {
    if (e[k] !== undefined && e[k] !== null && Number.isFinite(Number(e[k]))) {
      n[k] = Number(e[k]);
    }
  }
  return {
    originalName: name,
    keyword: name,
    estimatedWeightGrams: grams,
    nutrientBasisWeight: grams,
    cookingMethod: e.cookingMethod || 'unknown',
    foodType: e.foodType || null,
    boundingBox2D: media?.boundingBox2D ?? null,
    sourceImageIndex: media?.sourceImageIndex ?? null,
    nutrients: n,
    foods: e.foods || e.components || [],
    components: e.components || e.foods || [],
    componentsDetailList: e.componentsDetailList || [],
  };
}

async function finalizeFromEstimate(name: string, grams: number, estimate: ScoutEstimate | null | undefined, media: any, scoutIndex: number): Promise<any> {
  const ledger = await finalizeDishLedger({
    item: { ...estimateToScoutItem(name, grams, estimate, media), scoutIndex },
    nutrientBasisWeight: grams,
    consumedWeight: grams,
    diningEnvironment: estimate?.diningEnvironment || media?.diningEnvironment,
  });
  const n = { ...(ledger.nutrients || {}) };
  return {
    scoutIndex,
    name,
    canonicalDbName: name,
    originalName: name,
    keyword: name,
    weightGrams: grams,
    calories: n.calories ?? 0,
    protein: n.protein ?? 0,
    totalFat: n.totalFat ?? 0,
    saturatedFat: n.saturatedFat ?? 0,
    carbohydrates: n.carbohydrates ?? 0,
    sodium: n.sodium ?? 0,
    addedSugar: n.addedSugar ?? 0,
    nutrients: n,
    lockedNutrientKeys: ledger.lockedNutrientKeys || [],
    dbSource: ledger.dbSource || 'estimated',
    dbId: ledger.dbId || null,
    boundingBox2D: media?.boundingBox2D ?? null,
    sourceImageIndex: media?.sourceImageIndex ?? null,
    cookingMethod: estimate?.cookingMethod || null,
    foodType: estimate?.foodType || ledger.dishClass || null,
    components: ledger.componentsDetailList || ledger.components || [],
    componentsDetailList: ledger.componentsDetailList || [],
    hasComponents: Boolean(ledger.hasComponents),
    isDishEstimate: true,
    role: 'food',
    isFlattenedComponent: false,
    textAdded: media?.sourceImageIndex == null,
  };
}

function nextScoutIndex(items: any[]): number {
  let max = -1;
  for (const it of items) {
    const n = Number(it?.scoutIndex);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function renameIdentityRows(rows: any, oldNames: string[], newName: string): any[] {
  if (!Array.isArray(rows)) return rows;
  const oldSet = new Set(oldNames.filter(Boolean).map((n) => String(n).trim().toLowerCase()));
  const renameOne = (row: any): any => {
    if (!row || typeof row !== 'object') return row;
    const next = { ...row };
    for (const key of ['name', 'canonicalDbName', 'originalName', 'keyword']) {
      const val = String(next[key] || '').trim().toLowerCase();
      if (val && oldSet.has(val)) next[key] = newName;
    }
    if (Array.isArray(next.componentsDetailList)) next.componentsDetailList = next.componentsDetailList.map(renameOne);
    if (Array.isArray(next.components)) next.components = next.components.map(renameOne);
    return next;
  };
  return rows.map(renameOne);
}

function componentsOf(item: any): any[] {
  const list = item?.componentsDetailList || item?.components || item?.compositeSiblings || [];
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && typeof c === 'object');
}

const ENTREE_TOKEN_RE = /\b(steak|chicken|beef|pork|fish|fillet|burger|cutlet|seitan|tempeh|lamb|turkey|shrimp|prawn|tofu|meat)\b/i;
const SIDE_TOKEN_RE = /\b(vegetable|vegetables|veggie|veggies|salad|slaw|coleslaw|corn|carrots|peas|wedges|fries|potatoes|rice|noodle|noodles)\b/i;

function isEntreeWithSauce(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return ENTREE_TOKEN_RE.test(n) && /\b(with|and)\b/.test(n) && CONDIMENT_NAME_RE.test(n);
}

function isSauce(name: string): boolean {
  const n = String(name || '').toLowerCase();
  if (SIDE_TOKEN_RE.test(n)) return false;
  if (isEntreeWithSauce(n)) return false;
  return CONDIMENT_NAME_RE.test(n);
}

/** "Seitan Cutlet with Chili Gravy" → "Chili Gravy" */
export function extractSauceName(compName: string): string | null {
  const m = String(compName || '').match(/\bwith\s+(.+?(?:sauce|dressing|gravy|dip|mayo|mayonnaise|sambal|sos))\s*$/i);
  if (!m) return null;
  const sauce = m[1].trim();
  return sauce.length >= 3 ? sauce : null;
}

function componentMatchesPart(comp: any, partName: string): boolean {
  const cn = String(comp?.name || comp?.searchQuery || comp?.keyword || '').toLowerCase();
  const pn = String(partName || '').toLowerCase();
  if (!cn || !pn) return false;
  if (cn.includes(pn) || pn.includes(cn)) return true;
  const pTokens = pn.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !['with', 'and', 'the'].includes(t));
  const cTokens = cn.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  if (pTokens.length === 0) return false;
  const overlap = pTokens.filter((t) => cTokens.includes(t));
  return overlap.length >= Math.min(2, pTokens.length) || (overlap.length >= 1 && ENTREE_TOKEN_RE.test(pn));
}

function capCondimentProtein(row: any): any {
  const grams = Number(row.weightGrams) || 0;
  if (grams <= 0) return row;
  const maxP = Math.round(grams * 0.025 * 10) / 10;
  const p = Number(row.protein ?? row.nutrients?.protein) || 0;
  if (p <= maxP) return row;
  const n = { ...(row.nutrients || {}) };
  n.protein = maxP;
  n.calories = computeCaloriesFromMacros(n.protein, n.carbohydrates ?? row.carbohydrates, n.totalFat ?? row.totalFat);
  return {
    ...row,
    protein: maxP,
    nutrients: n,
    calories: n.calories,
  };
}

function toComponentRow(source: any, grams: number, name: string, parent: any, scoutIndex: number): any {
  const oldW = Number(source.weightGrams) || grams || 1;
  const ratio = grams / oldW;
  let row = scaleItemNutrients({ ...source, name }, ratio, grams);
  row.name = name;
  row.canonicalDbName = name;
  row.originalName = name;
  row.keyword = name;
  row.role = 'component';
  row.isFlattenedComponent = true;
  row.scoutIndex = scoutIndex;
  row.boundingBox2D = source.boundingBox2D || parent?.boundingBox2D || null;
  row.sourceImageIndex = typeof (source.sourceImageIndex ?? parent?.sourceImageIndex) === 'number'
    ? (source.sourceImageIndex ?? parent.sourceImageIndex)
    : null;
  row.dbSource = source.dbSource || parent?.dbSource || 'estimated';
  row.isDishEstimate = true;
  if (isSauce(name) || extractSauceName(String(source.name || ''))) {
    row = capCondimentProtein(row);
  }
  const n = { ...(row.nutrients || {}) };
  if (!(Number(n.calories) > 0) && (Number(n.protein) + Number(n.carbohydrates) + Number(n.totalFat) > 0)) {
    n.calories = computeCaloriesFromMacros(n.protein, n.carbohydrates, n.totalFat);
    row.nutrients = n;
    row.calories = n.calories;
  }
  return row;
}

/**
 * Map legacy remove+add (identity / composite split) onto replace_identity / split_item
 * so the dietitian's old few-shot cannot mint 0-kcal rows or invent side grams.
 */
export function coalesceLegacyCommands(commands: MealEditCommand[], items: any[], userMessage: string): MealEditCommand[] {
  if (!Array.isArray(commands) || commands.length === 0) return [];
  const removes = commands.filter((c) => c.action === 'remove_item');
  const adds = commands.filter((c) => c.action === 'add_item');
  const others = commands.filter((c) => c.action !== 'remove_item' && c.action !== 'add_item');

  if (removes.length === 1 && adds.length === 1) {
    const isExplicitReplace = /\b(instead|replace|change|swap|substitute|switch)\b/i.test(userMessage);
    const isExplicitAdd = /\b(add|plus|also|include)\b/i.test(userMessage);
    
    if (isExplicitReplace || !isExplicitAdd) {
      const parentIdx = findItemIndexInList(items, removes[0].itemName || '', removes[0].targetDbId || null);
      if (parentIdx !== -1) {
        return [
          ...others,
          {
            action: 'replace_identity',
            itemName: removes[0].itemName,
            targetDbId: removes[0].targetDbId,
            newItemName: adds[0].itemName || adds[0].newItemName,
            newWeightGrams: adds[0].newWeightGrams,
            estimate: adds[0].estimate,
          },
        ];
      }
    }
  }

  if (removes.length === 1 && adds.length >= 2) {
    const parentIdx = findItemIndexInList(items, removes[0].itemName || '', removes[0].targetDbId || null);
    if (parentIdx !== -1) {
      const parent = items[parentIdx];
      const comps = componentsOf(parent);
      const into: MealEditCommand['into'] = [];
      for (const add of adds) {
        const addName = add.itemName || add.newItemName || '';
        const mentioned = userMentioned(addName, userMessage);
        const matchingComp = comps.find((c) => itemNames(c).includes(String(addName).toLowerCase()) || String(addName).toLowerCase().includes(String(c.name || '').toLowerCase()));
        if (matchingComp && !mentioned) {
          // Unmentioned leftover — keep saved grams; do not take few-shot weight.
          continue;
        }
        into.push({
          name: addName,
          grams: mentioned ? (Number(add.newWeightGrams) || matchingComp?.weightGrams) : (matchingComp?.weightGrams || add.newWeightGrams),
          role: isSauce(addName) ? 'component' : 'food',
          estimate: add.estimate,
        });
      }
      return [
        ...others,
        {
          action: 'split_item',
          itemName: removes[0].itemName,
          targetDbId: removes[0].targetDbId,
          into,
        },
      ];
    }
  }

  if (removes.length === 1 && adds.length === 0 && items.length >= 2) {
    const removeIdx = findItemIndexInList(items, removes[0].itemName || '', removes[0].targetDbId || null);
    if (removeIdx >= 0) {
      const itemToRemove = items[removeIdx];
      const otherItem = items.find((_, i) => i !== removeIdx);
      const isSameMeal = isSameMealMergeRequest(userMessage);
      const sharesFood = otherItem && (itemsReferSame(itemToRemove, otherItem) || itemsShareSubstance(itemToRemove, otherItem));
      if (otherItem && (isSameMeal || sharesFood || Boolean(itemToRemove.rawNutritionLabel))) {
        return [
          ...others,
          {
            action: 'merge_dishes',
            itemName: displayName(itemToRemove),
            targetItemName: displayName(otherItem),
            newItemName: displayName(otherItem),
            newWeightGrams: removes[0].newWeightGrams ?? null,
            targetDbId: removes[0].targetDbId || null,
            sourceImageIndex: removes[0].sourceImageIndex,
          },
        ];
      }
    }
  }

  return commands;
}

function normalizeAction(action: string): string {
  const a = String(action || '').toLowerCase();
  if (a === 'update_weight') return 'set_weight';
  if (a === 'update_modifier') return 'set_modifier';
  if (a === 'replace_item') return 'replace_identity';
  if (a === 'update_count' || a === 'set_count') return 'set_count';
  if (a === 'combine_dishes' || a === 'combine_items' || a === 'merge_items') return 'merge_dishes';
  return a;
}

function dedupeModifierCommands(commands: MealEditCommand[]): MealEditCommand[] {
  const seen = new Set<string>();
  const out: MealEditCommand[] = [];
  for (const c of commands) {
    const action = normalizeAction(c.action);
    if (action === 'set_modifier') {
      const key = `mod:${String(c.itemName || '').toLowerCase()}:${String(c.modifier || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(c);
  }
  return out;
}

export async function applyMealEdits(opts: {
  items: any[];
  commands: MealEditCommand[] | null | undefined;
  userMessage?: string;
  scoutItems?: any[] | null;
  priorLocks?: UserLockedSlot[] | null;
  turn?: number;
}): Promise<MealEditResult & { userLockedSlots?: UserLockedSlot[]; appliedCommands?: MealEditCommand[] }> {
  const notes: string[] = [];
  const snapshotOf = (rows: any[]) =>
    JSON.stringify(
      Array.isArray(rows)
        ? rows.map((i) => [
            i.name,
            i.canonicalDbName || i.name || null,
            i.weightGrams,
            i.calories ?? i.nutrients?.calories,
            i.nutrients?.addedSugar ?? 0,
            i.count ?? null,
            i.pieceCount ?? null,
          ])
        : [],
    );
  const originalSnapshot = snapshotOf(opts.items);
  const original = Array.isArray(opts.items) ? opts.items.map((it) => ({ ...it, nutrients: { ...(it.nutrients || {}) } })) : [];
  let commandsIn = Array.isArray(opts.commands) ? opts.commands : [];

  // Structural patch: prefer index-aligned scout↔ledger diff over empty commands.
  // User-message synthesis remains as a secondary fallback for modifier-only turns.
  let scoutForDiff = Array.isArray(opts.scoutItems) ? opts.scoutItems : [];
  if (scoutForDiff.length > 0 && Array.isArray(opts.priorLocks) && opts.priorLocks.length > 0) {
    const locked = applyUserLockedSlots({
      scoutItems: scoutForDiff,
      locks: opts.priorLocks,
      userMessage: opts.userMessage,
    });
    scoutForDiff = locked.items;
    notes.push(...locked.notes);
  }
  if (commandsIn.length === 0) {
    const fromDiff = diffScoutToEditCommands({
      priorItems: original,
      scoutItems: scoutForDiff,
      userMessage: opts.userMessage,
      portionChoices: (opts as any).portionChoices,
    });
    if (fromDiff.length > 0) {
      commandsIn = fromDiff as MealEditCommand[];
      notes.push(`PatchLedger: synthesized ${fromDiff.length} edit command(s) from scout↔ledger diff`);
    }
  }
  if (commandsIn.length === 0 && opts.userMessage) {
    const synthesized = synthesizeEditCommandsFromBreakdown({ itemsBreakdown: original }, [], opts.userMessage);
    if (synthesized && synthesized.length > 0) {
      commandsIn = synthesized;
      notes.push(`Synthesized ${synthesized.length} edit command(s) from user message`);
    }
  }

  if (commandsIn.length === 0) {
    const nutrients = sumItemNutrients(original);
    const weightGrams = Math.round(original.reduce((a, it) => a + (Number(it.weightGrams) || 0), 0));
    return {
      items: original,
      nutrients,
      weightGrams,
      changed: false,
      qa: true,
      receiptTable: formatMealReceiptTable(original, nutrients, weightGrams),
      notes: ['Q&A: modificationCommand empty — meal unchanged'],
      userLockedSlots: Array.isArray(opts.priorLocks) ? opts.priorLocks : [],
      appliedCommands: [],
    };
  }

  const coalesced = coalesceLegacyCommands(commandsIn, original, opts.userMessage || '');
  const commands = dedupeModifierCommands(coalesced);
  let items = original;

  for (const raw of commands) {
    const action = normalizeAction(raw.action);
    const itemName = raw.itemName || '';
    let idx = findItemIndexInList(items, itemName, raw.targetDbId || null);

    if (action === 'set_weight') {
      if (idx < 0) { notes.push(`set_weight: no item "${itemName}"`); continue; }
      const item = items[idx];
      const oldW = Number(item.weightGrams) || 0;
      const newW = Number(raw.newWeightGrams);
      if (!(newW > 0) || oldW <= 0) { notes.push(`set_weight: invalid grams for "${itemName}"`); continue; }
      items[idx] = scaleItemNutrients(item, newW / oldW, newW);
      notes.push(`set_weight "${itemName}" ${oldW}g → ${newW}g`);
    } else if (action === 'set_count') {
      if (idx < 0) { notes.push(`set_count: no item "${itemName}"`); continue; }
      const item = items[idx];
      const oldCount = Number(item.count || item.pieceCount) || null;
      const newCount = Number(raw.count != null ? raw.count : raw.newWeightGrams);
      if (!(newCount > 0)) { notes.push(`set_count: invalid count for "${itemName}"`); continue; }
      // Piece annotation on the already-weighed portion. Do not double grams
      // ("2 otak" on an 85g skewer is count=2 at 85g, not 170g).
      items[idx] = { ...item, count: newCount, pieceCount: newCount };
      notes.push(`set_count "${itemName}" ${oldCount ?? 'unset'} → ${newCount} (${item.weightGrams}g kept)`);
    } else if (action === 'set_modifier') {
      if (idx < 0 && (itemName.toLowerCase().includes('tea') || itemName.toLowerCase().includes('drink') || itemName.toLowerCase().includes('beverage') || itemName.toLowerCase().includes('kopi') || itemName.toLowerCase().includes('coffee') || itemName.toLowerCase().includes('teh'))) {
        idx = items.findIndex((it: any) => {
          const names = itemNames(it);
          return names.includes('tea') || names.includes('teh') || names.includes('coffee') || names.includes('kopi') || names.includes('drink') || names.includes('beverage') || it.foodType === 'beverage';
        });
      }
      if (idx < 0) { notes.push(`set_modifier: no item "${itemName}"`); continue; }
      const item = items[idx];
      const modifier = String(raw.modifier || raw.newItemName || 'unsweetened');
      const n = { ...(item.nutrients || {}) };
      const modRes = applyNutrientModifiers(n, {
        message: modifier,
        foodType: item.foodType,
        name: item.name || item.canonicalDbName || itemName,
      });
      item.nutrients = modRes.updatedNutrients;
      item.calories = item.nutrients.calories;
      item.protein = item.nutrients.protein;
      item.totalFat = item.nutrients.totalFat;
      item.carbohydrates = item.nutrients.carbohydrates;
      item.sodium = item.nutrients.sodium;
      item.addedSugar = item.nutrients.addedSugar;
      item.sugar = item.nutrients.sugar;
      if (modRes.lockedKeys.length) {
        item.lockedNutrientKeys = Array.from(new Set([...(item.lockedNutrientKeys || []), ...modRes.lockedKeys]));
      }
      const newName = raw.newItemName || applyModifierToItemName(item.name || item.canonicalDbName || itemName, modifier);
      const purged = invalidateStaleIdentityMetadata(item, newName);
      Object.assign(item, purged);
      item.name = newName;
      item.canonicalDbName = newName;
      item.originalName = newName;
      item.keyword = newName;

      // Propagate the modifier changes to nested components/ingredients list so the formatted
      // receipt table renders the corrected nutrient values instead of stale sweetened values.
      if (Array.isArray(item.componentsDetailList)) {
        item.componentsDetailList = item.componentsDetailList.map((c: any) => {
          const cRes = { ...c };
          const cModRes = applyNutrientModifiers({ ...(c.nutrients || {}) }, {
            message: modifier,
            foodType: c.foodType,
            name: c.name || c.canonicalDbName || '',
          });
          cRes.nutrients = cModRes.updatedNutrients;
          cRes.calories = cRes.nutrients.calories;
          cRes.protein = cRes.nutrients.protein;
          cRes.totalFat = cRes.nutrients.totalFat;
          cRes.carbohydrates = cRes.nutrients.carbohydrates;
          cRes.sodium = cRes.nutrients.sodium;
          cRes.addedSugar = cRes.nutrients.addedSugar;
          cRes.sugar = cRes.nutrients.sugar;
          cRes.name = applyModifierToItemName(c.name || '', modifier);
          cRes.canonicalDbName = cRes.name;
          cRes.originalName = cRes.name;
          cRes.keyword = cRes.name;
          return cRes;
        });
      }
      if (Array.isArray(item.components)) {
        item.components = item.components.map((c: any) => {
          if (typeof c !== 'object' || !c) return c;
          const cRes = { ...c };
          const cModRes = applyNutrientModifiers({ ...(c.nutrients || {}) }, {
            message: modifier,
            foodType: c.foodType,
            name: c.name || c.canonicalDbName || '',
          });
          cRes.nutrients = cModRes.updatedNutrients;
          cRes.calories = cRes.nutrients.calories;
          cRes.protein = cRes.nutrients.protein;
          cRes.totalFat = cRes.nutrients.totalFat;
          cRes.carbohydrates = cRes.nutrients.carbohydrates;
          cRes.sodium = cRes.nutrients.sodium;
          cRes.addedSugar = cRes.nutrients.addedSugar;
          cRes.sugar = cRes.nutrients.sugar;
          cRes.name = applyModifierToItemName(c.name || '', modifier);
          cRes.canonicalDbName = cRes.name;
          cRes.originalName = cRes.name;
          cRes.keyword = cRes.name;
          return cRes;
        });
      }

      items[idx] = item;
      notes.push(`set_modifier "${itemName}" → ${newName}`);
    } else if (action === 'merge_dishes') {
      const sourceName = raw.itemName || raw.sourceItemName || '';
      const targetName = raw.targetItemName || raw.newItemName || '';
      let srcIdx = findItemIndexInList(items, sourceName, raw.targetDbId || null);
      let tgtIdx = targetName ? findItemIndexInList(items, targetName, null) : -1;
      if (tgtIdx < 0 && items.length === 2 && srcIdx >= 0) {
        tgtIdx = items.findIndex((_, i) => i !== srcIdx);
      }
      if (srcIdx < 0 && items.length === 2 && tgtIdx >= 0) {
        srcIdx = items.findIndex((_, i) => i !== tgtIdx);
      }
      if (srcIdx < 0 && tgtIdx < 0 && items.length === 2) {
        srcIdx = 0;
        tgtIdx = 1;
      }
      if (srcIdx < 0 || tgtIdx < 0 || srcIdx === tgtIdx) {
        notes.push(`merge_dishes: unable to locate distinct source ("${sourceName}") and target ("${targetName}")`);
        continue;
      }

      const itemA = items[srcIdx];
      const itemB = items[tgtIdx];

      // Prioritize rawNutritionLabel: identify which item has the label truth
      const hasLabelA = Boolean(itemA.rawNutritionLabel && typeof itemA.rawNutritionLabel === 'object' && Object.keys(itemA.rawNutritionLabel).length > 0);
      const hasLabelB = Boolean(itemB.rawNutritionLabel && typeof itemB.rawNutritionLabel === 'object' && Object.keys(itemB.rawNutritionLabel).length > 0);
      const labelItem = hasLabelA ? itemA : (hasLabelB ? itemB : itemA);
      const nonLabelItem = labelItem === itemA ? itemB : itemA;

      // Determine merged weight without summing weights (never weightA + weightB)
      let mergedWeight = 0;
      if (Number(raw.newWeightGrams) > 0) {
        mergedWeight = Number(raw.newWeightGrams);
      } else if (opts.userMessage) {
        const wMatch = opts.userMessage.match(/\b(\d+(?:\.\d+)?)\s*g(?:rams)?\b/i);
        if (wMatch && Number(wMatch[1]) > 0) {
          mergedWeight = Math.round(Number(wMatch[1]));
        }
      }
      if (!mergedWeight && Array.isArray(opts.priorLocks) && opts.priorLocks.length > 0) {
        const lock = opts.priorLocks.find((l) => (l.scoutIndex === itemA.scoutIndex || l.scoutIndex === itemB.scoutIndex) && l.field === 'weightGrams');
        if (lock && Number(lock.value) > 0) {
          mergedWeight = Math.round(Number(lock.value));
        }
      }
      if (!mergedWeight) {
        // If labelItem has non-zero weight (e.g. user-selected 100g portion), preserve it as user basis
        mergedWeight = Number(labelItem.weightGrams) || Number(nonLabelItem.weightGrams) || 100;
      }

      // Compute nutrients for merged dish prioritizing rawNutritionLabel
      let mergedNutrients: Record<string, number> = {};
      let lockedNutrientKeys: string[] = [];
      const rawLabel = labelItem.rawNutritionLabel;
      if (rawLabel && typeof rawLabel === 'object' && Object.keys(rawLabel).length > 0) {
        const parsed = parseOcrLabel(rawLabel, mergedWeight, 1);
        if (parsed.ocrNutrients && Object.keys(parsed.ocrNutrients).length > 0) {
          mergedNutrients = { ...(labelItem.nutrients || {}), ...parsed.ocrNutrients };
          lockedNutrientKeys = parsed.lockedKeys;
        }
      }
      if (Object.keys(mergedNutrients).length === 0 || !mergedNutrients.calories) {
        const baseW = Number(labelItem.weightGrams) || mergedWeight || 100;
        const ratio = mergedWeight / baseW;
        const scaled = scaleItemNutrients(labelItem, ratio, mergedWeight);
        mergedNutrients = scaled.nutrients || {};
        lockedNutrientKeys = Array.isArray(labelItem.lockedNutrientKeys) ? labelItem.lockedNutrientKeys : [];
      }

      if (!lockedNutrientKeys.includes('calories') && mergedNutrients.protein != null) {
        mergedNutrients.calories = computeCaloriesFromMacros(mergedNutrients.protein, mergedNutrients.carbohydrates, mergedNutrients.totalFat);
      }

      // Dish name: combine brand from labelItem with prepared name
      let mergedName = nonLabelItem.name || labelItem.name || 'Dish';
      const brandToken = (labelItem.brandLock ? labelItem.name.split(/\s+/)[0] : '') || (labelItem.name.match(/\b(Quaker|Lidl|Kellogg|Nestle|Indomie)\b/i)?.[0]);
      if (brandToken && !mergedName.toLowerCase().includes(brandToken.toLowerCase())) {
        mergedName = `${brandToken} ${mergedName}`;
      }

      let mergedComps = componentsOf(nonLabelItem);
      if (mergedComps.length > 1) {
        const pIdx = mergedComps.findIndex((c) => itemsReferSame(c, labelItem) || itemsShareSubstance(c, labelItem));
        if (pIdx >= 0) {
          mergedComps[pIdx] = {
            ...mergedComps[pIdx],
            name: labelItem.name,
            weightGrams: mergedWeight,
            nutrients: mergedNutrients,
            calories: mergedNutrients.calories,
            protein: mergedNutrients.protein,
            carbohydrates: mergedNutrients.carbohydrates,
            totalFat: mergedNutrients.totalFat,
            rawNutritionLabel: labelItem.rawNutritionLabel,
          };
        }
      } else {
        mergedComps = [{
          name: mergedName,
          canonicalDbName: labelItem.canonicalDbName || mergedName,
          originalName: mergedName,
          keyword: mergedName.toLowerCase(),
          weightGrams: mergedWeight,
          calories: mergedNutrients.calories ?? 0,
          protein: mergedNutrients.protein ?? 0,
          totalFat: mergedNutrients.totalFat ?? 0,
          saturatedFat: mergedNutrients.saturatedFat ?? 0,
          carbohydrates: mergedNutrients.carbohydrates ?? 0,
          sodium: mergedNutrients.sodium ?? 0,
          nutrients: mergedNutrients,
          rawNutritionLabel: labelItem.rawNutritionLabel,
        }];
      }

      const mergedItem = {
        ...nonLabelItem,
        ...labelItem,
        name: mergedName,
        canonicalDbName: labelItem.canonicalDbName || mergedName,
        originalName: mergedName,
        keyword: mergedName.toLowerCase(),
        weightGrams: mergedWeight,
        estimatedWeightGrams: mergedWeight,
        calories: mergedNutrients.calories ?? 0,
        protein: mergedNutrients.protein ?? 0,
        totalFat: mergedNutrients.totalFat ?? 0,
        saturatedFat: mergedNutrients.saturatedFat ?? 0,
        carbohydrates: mergedNutrients.carbohydrates ?? 0,
        sodium: mergedNutrients.sodium ?? 0,
        addedSugar: mergedNutrients.addedSugar ?? 0,
        sugar: mergedNutrients.sugar ?? 0,
        nutrients: mergedNutrients,
        rawNutritionLabel: labelItem.rawNutritionLabel,
        packageLabelText: labelItem.packageLabelText || nonLabelItem.packageLabelText || null,
        brandLock: labelItem.brandLock || nonLabelItem.brandLock || null,
        dbSource: labelItem.dbSource || 'brand_official',
        lockedNutrientKeys,
        components: mergedComps,
        componentsDetailList: mergedComps,
        hasComponents: mergedComps.length > 1,
        sourceImageIndex: nonLabelItem.sourceImageIndex ?? labelItem.sourceImageIndex ?? null,
      };

      const survivingIdx = Math.min(srcIdx, tgtIdx);
      const redundantIdx = Math.max(srcIdx, tgtIdx);
      items = items.filter((_, i) => i !== redundantIdx);
      items[survivingIdx] = mergedItem;
      notes.push(`merge_dishes: combined "${itemA.name}" and "${itemB.name}" into "${mergedName}" (${mergedWeight}g, label truth preserved: ${mergedItem.calories} kcal)`);
    } else if (action === 'remove_item') {
      if (idx < 0) { notes.push(`remove_item: no item "${itemName}"`); continue; }
      const itemToRemove = items[idx];
      const otherItem = items.find((_, i) => i !== idx);
      const isSameMeal = isSameMealMergeRequest(opts.userMessage);
      const sharesFood = otherItem && (itemsReferSame(itemToRemove, otherItem) || itemsShareSubstance(itemToRemove, otherItem));
      if (otherItem && (isSameMeal || sharesFood || Boolean(itemToRemove.rawNutritionLabel))) {
        // Fallback: merge dishes rather than discarding label truth
        const labelItem = itemToRemove.rawNutritionLabel ? itemToRemove : otherItem;
        const nonLabelItem = labelItem === itemToRemove ? otherItem : itemToRemove;
        let mergedWeight = 0;
        if (opts.userMessage) {
          const wMatch = opts.userMessage.match(/\b(\d+(?:\.\d+)?)\s*g(?:rams)?\b/i);
          if (wMatch && Number(wMatch[1]) > 0) mergedWeight = Math.round(Number(wMatch[1]));
        }
        if (!mergedWeight && Array.isArray(opts.priorLocks) && opts.priorLocks.length > 0) {
          const lock = opts.priorLocks.find((l) => (l.scoutIndex === itemToRemove.scoutIndex || l.scoutIndex === otherItem.scoutIndex) && l.field === 'weightGrams');
          if (lock && Number(lock.value) > 0) mergedWeight = Math.round(Number(lock.value));
        }
        if (!mergedWeight) mergedWeight = Number(labelItem.weightGrams) || Number(nonLabelItem.weightGrams) || 100;

        let mergedNutrients = { ...(labelItem.nutrients || {}) };
        let lockedNutrientKeys = Array.isArray(labelItem.lockedNutrientKeys) ? [...labelItem.lockedNutrientKeys] : [];
        if (labelItem.rawNutritionLabel && typeof labelItem.rawNutritionLabel === 'object') {
          const parsed = parseOcrLabel(labelItem.rawNutritionLabel, mergedWeight, 1);
          if (parsed.ocrNutrients && Object.keys(parsed.ocrNutrients).length > 0) {
            mergedNutrients = { ...mergedNutrients, ...parsed.ocrNutrients };
            lockedNutrientKeys = parsed.lockedKeys;
          }
        }
        const oIdx = items.indexOf(otherItem);
        items[oIdx] = {
          ...otherItem,
          ...labelItem,
          name: otherItem.name,
          weightGrams: mergedWeight,
          calories: mergedNutrients.calories ?? otherItem.calories,
          nutrients: mergedNutrients,
          rawNutritionLabel: labelItem.rawNutritionLabel,
          packageLabelText: labelItem.packageLabelText || otherItem.packageLabelText,
          brandLock: labelItem.brandLock || otherItem.brandLock,
          dbSource: labelItem.dbSource || 'brand_official',
          lockedNutrientKeys,
        };
        items = items.filter((_, i) => i !== idx);
        notes.push(`remove_item (merged into "${otherItem.name}"): preserved label truth from "${itemToRemove.name}" (${mergedWeight}g, ${items[items.indexOf(otherItem)].calories} kcal)`);
      } else {
        notes.push(`remove_item "${items[idx].name}"`);
        items = items.filter((_, i) => i !== idx);
      }
    } else if (action === 'replace_identity') {
      if (idx < 0) { notes.push(`replace_identity: no item "${itemName}"`); continue; }
      const prev = items[idx];
      const newName = raw.newItemName || raw.replacementItemName || itemName;
      const grams = Number(raw.newWeightGrams) > 0 ? Number(raw.newWeightGrams) : Number(prev.weightGrams) || 100;
      const media = {
        boundingBox2D: prev.boundingBox2D || raw.boundingBox2D || null,
        sourceImageIndex: typeof prev.sourceImageIndex === 'number' ? prev.sourceImageIndex : (raw.sourceImageIndex ?? null),
      };
      let next = await finalizeFromEstimate(newName, grams, raw.estimate, media, prev.scoutIndex ?? nextScoutIndex(items));
      next = invalidateStaleIdentityMetadata(next, newName);
      const isSameDishFamily = itemsMatchByName(prev.name || prev.originalName || '', newName);
      const estAny = raw.estimate as any;
      const estimateHasComponents = (Array.isArray(estAny?.foods) && estAny.foods.length > 0) ||
        (Array.isArray(estAny?.components) && estAny.components.length > 0) ||
        (Array.isArray(estAny?.componentsDetailList) && estAny.componentsDetailList.length > 0);
      const oldIdentityNames = [prev.name, prev.canonicalDbName, prev.originalName, prev.keyword, itemName, raw.itemName]
        .filter(Boolean)
        .map(String);
      const estFoods = estAny?.foods || estAny?.components || estAny?.componentsDetailList || [];
      const hasDeltaActions = Array.isArray(estFoods) && estFoods.some((f: any) => f && (f.action === 'add' || f.action === 'replace' || f.action === 'delete' || f.replacesFood));
      if (isSameDishFamily && hasDeltaActions) {
        let mergedComps = [...componentsOf(prev)];
        for (const f of estFoods) {
          const fAction = f.action || 'replace';
          const fName = String(f.foodName || f.name || '').trim();
          const fRep = String(f.replacesFood || '').trim();
          const fWeight = Number(f.weightGrams ?? f.estimatedWeightGrams) || 0;
          const fNutrients = f.nutrients || {};
          if (fAction === 'delete' || fAction === 'remove') {
            mergedComps = mergedComps.filter(c => !String(c.name || c.foodName || '').toLowerCase().includes((fRep || fName).toLowerCase()));
          } else if (fAction === 'add') {
            mergedComps.push({
              name: fName,
              foodName: fName,
              canonicalDbName: fName,
              weightGrams: fWeight > 0 ? fWeight : 50,
              nutrients: fNutrients,
              sourceImageIndex: f.sourceImageIndex ?? next.sourceImageIndex ?? null,
            });
          } else if (fAction === 'replace') {
            const target = fRep || fName;
            const cIdx = mergedComps.findIndex(c => String(c.name || c.foodName || '').toLowerCase().includes(target.toLowerCase()));
            const repComp = {
              name: fName,
              foodName: fName,
              canonicalDbName: fName,
              weightGrams: fWeight > 0 ? fWeight : (cIdx >= 0 ? mergedComps[cIdx].weightGrams : 50),
              nutrients: fNutrients,
              sourceImageIndex: f.sourceImageIndex ?? next.sourceImageIndex ?? null,
            };
            if (cIdx >= 0) mergedComps[cIdx] = repComp;
            else mergedComps.push(repComp);
          }
        }
        next.components = mergedComps;
        next.componentsDetailList = mergedComps;
        next.hasComponents = mergedComps.length > 1;
        const baseNutrients: Record<string, number> = {};
        for (const c of mergedComps) {
          const cn = c.nutrients || {};
          for (const k of NUTRIENT_KEYS) {
            const v = cn[k] ?? c[k];
            if (typeof v === 'number' && Number.isFinite(v)) {
              baseNutrients[k] = (baseNutrients[k] || 0) + v;
            }
          }
        }
        if (!next.nutrients) next.nutrients = {};
        for (const k of NUTRIENT_KEYS) {
          if (typeof baseNutrients[k] === 'number') {
            (next.nutrients as any)[k] = Math.round(baseNutrients[k] * 10) / 10;
            if (['calories', 'protein', 'totalFat', 'saturatedFat', 'carbohydrates', 'sodium'].includes(k)) {
              (next as any)[k] = (next.nutrients as any)[k];
            }
          }
        }
        const compWTotal = mergedComps.reduce((a: number, c: any) => a + (Number(c.weightGrams) || 0), 0);
        if (compWTotal > 0) {
          next.weightGrams = Math.round(compWTotal);
          next.estimatedWeightGrams = Math.round(compWTotal);
        }
      } else if (isSameDishFamily && !estimateHasComponents) {
        const renamedComponents = renameIdentityRows(prev.components, oldIdentityNames, newName);
        const renamedDetail = renameIdentityRows(prev.componentsDetailList, oldIdentityNames, newName);
        const renamedSiblings = renameIdentityRows(prev.compositeSiblings, oldIdentityNames, newName);
        const componentsSource = Array.isArray(renamedComponents) && renamedComponents.length > 0
          ? renamedComponents
          : (Array.isArray(renamedDetail) && renamedDetail.length > 0 ? renamedDetail : []);
        const detailSource = Array.isArray(renamedDetail) && renamedDetail.length > 0
          ? renamedDetail
          : (Array.isArray(renamedComponents) && renamedComponents.length > 0 ? renamedComponents : []);
        next.components = componentsSource;
        next.componentsDetailList = detailSource;
        next.compositeSiblings = Array.isArray(renamedSiblings) ? renamedSiblings : [];
        next.hasComponents = prev.hasComponents;
      } else if (Array.isArray(next.componentsDetailList) && next.componentsDetailList.length > 0) {
        next.hasComponents = next.componentsDetailList.length > 1;
        if (!Array.isArray(next.components) || next.components.length === 0) {
          next.components = next.componentsDetailList;
        }
      } else {
        const component = {
          name: newName,
          canonicalDbName: newName,
          originalName: newName,
          keyword: newName,
          weightGrams: grams,
          calories: next.calories,
          protein: next.protein,
          totalFat: next.totalFat,
          carbohydrates: next.carbohydrates,
          sodium: next.sodium,
        };
        next.components = [component];
        next.componentsDetailList = [component];
        next.compositeSiblings = [];
        next.hasComponents = false;
      }
      if (prev.count != null || prev.pieceCount != null) {
        next.count = prev.count ?? prev.pieceCount;
        next.pieceCount = prev.pieceCount ?? prev.count;
      }
      if (raw.count != null) {
        next.count = raw.count;
        next.pieceCount = raw.count;
      }
      items[idx] = next;
      notes.push(`replace_identity "${itemName}" → "${newName}" (${grams}g, photo kept)`);
    } else if (action === 'split_item') {
      if (idx < 0) { notes.push(`split_item: no item "${itemName}"`); continue; }
      const parent = items[idx];
      const comps = componentsOf(parent);
      const into = Array.isArray(raw.into) ? raw.into : [];
      if (into.length === 0) {
        notes.push(`split_item "${itemName}" ignored (empty into)`);
        continue;
      }
      const created: any[] = [];
      const claimedGrams = new Map<string, number>();

      for (const part of into) {
        const partName = part.name;
        if (!partName) continue;
        const blended = comps.filter((c) => isEntreeWithSauce(String(c.name || c.searchQuery || '')));
        const matchingComp = comps.find((c) => componentMatchesPart(c, partName))
          || (blended.length === 1 ? blended[0] : undefined);
        const grams = Number(part.grams) > 0
          ? Number(part.grams)
          : (Number(matchingComp?.weightGrams) || Math.round((Number(parent.weightGrams) || 100) / Math.max(into.length, 1)));
        if (part.role === 'component' || isSauce(partName)) {
          continue;
        }
        const media = {
          boundingBox2D: matchingComp?.boundingBox2D || parent.boundingBox2D || null,
          sourceImageIndex: typeof (matchingComp?.sourceImageIndex ?? parent.sourceImageIndex) === 'number'
            ? (matchingComp?.sourceImageIndex ?? parent.sourceImageIndex)
            : null,
        };
        const row = await finalizeFromEstimate(partName, grams, part.estimate, media, nextScoutIndex([...items, ...created]));
        created.push(row);
        if (matchingComp) {
          const key = String(matchingComp.name || matchingComp.searchQuery || '').toLowerCase();
          claimedGrams.set(key, (claimedGrams.get(key) || 0) + grams);
        }
      }

      const leftoverComponents: any[] = [];
      for (const c of comps) {
        const key = String(c.name || c.searchQuery || c.keyword || '').toLowerCase();
        if (into.some((p) => String(p.name).toLowerCase() === key)) continue;
        const full = Number(c.weightGrams) || 0;
        const taken = claimedGrams.get(key) || 0;
        const remaining = Math.round(full - taken);
        if (remaining <= 0) continue;
        const sauceFromEntree = taken > 0 ? extractSauceName(String(c.name || '')) : null;
        const displayName = sauceFromEntree || (c.name || c.searchQuery || 'Side');
        leftoverComponents.push(toComponentRow(
          c,
          remaining,
          displayName,
          parent,
          nextScoutIndex([...items, ...created, ...leftoverComponents]),
        ));
      }

      if (leftoverComponents.length > 0 && created.length > 0) {
        const host = created[0];
        host.components = leftoverComponents;
        host.componentsDetailList = leftoverComponents;
        host.compositeSiblings = leftoverComponents;
        host.hasComponents = true;
      }
      for (const row of leftoverComponents) created.push(row);

      items = [...items.slice(0, idx), ...created, ...items.slice(idx + 1)];
      notes.push(`split_item "${itemName}" → ${created.map((c) => c.name).join(', ')}`);
    } else if (action === 'add_item') {
      const newName = raw.newItemName || raw.itemName || 'Item';
      const grams = Number(raw.newWeightGrams) > 0 ? Number(raw.newWeightGrams) : 100;
      const media = {
        boundingBox2D: raw.boundingBox2D ?? null,
        sourceImageIndex: typeof raw.sourceImageIndex === 'number' ? raw.sourceImageIndex : null,
      };
      const row = await finalizeFromEstimate(newName, grams, raw.estimate, media, nextScoutIndex(items));
      items.push(row);
      notes.push(`add_item "${newName}" ${grams}g (finalize from estimate)`);
    } else if (action === 'update_component_weight') {
      if (idx < 0) { notes.push(`update_component_weight: no item "${itemName}"`); continue; }
      const item = items[idx];
      const comps = componentsOf(item);
      const cIdx = comps.findIndex((c) => {
        const cn = String(c.name || c.searchQuery || c.keyword || '').toLowerCase();
        return cn && cn.includes(String(raw.componentName || '').toLowerCase());
      });
      if (cIdx < 0) { notes.push(`update_component_weight: no component "${raw.componentName}"`); continue; }
      const comp = comps[cIdx];
      const oldW = Number(comp.weightGrams) || 0;
      const newW = Number(raw.newWeightGrams);
      if (!(newW > 0) || oldW <= 0) continue;
      comps[cIdx] = scaleItemNutrients(comp, newW / oldW, newW);
      item.components = comps;
      item.componentsDetailList = comps;
      items[idx] = reaggregateDishWeightFromComponents({ ...item, components: comps, componentsDetailList: comps, hasComponents: true });
      notes.push(`update_component_weight "${raw.componentName}" ${oldW}g → ${newW}g`);
    } else if (action === 'remove_component') {
      if (idx < 0) { notes.push(`remove_component: no item "${itemName}"`); continue; }
      if (!raw.componentName) { notes.push('remove_component: missing componentName'); continue; }
      const item = items[idx];
      const comps = componentsOf(item);
      const cIdx = comps.findIndex((c) => {
        const cn = String(c.name || c.searchQuery || c.keyword || '').toLowerCase();
        return cn && cn.includes(String(raw.componentName || '').toLowerCase());
      });
      if (cIdx < 0) { notes.push(`remove_component: no component "${raw.componentName}"`); continue; }
      const [dropped] = comps.splice(cIdx, 1);
      const dropW = Number(dropped.weightGrams ?? dropped.estimatedWeightGrams) || 0;
      // Subtract the LOCKED component nutrients — never rescale by weight share
      // (composition is uneven: the dropped food may hold most of one nutrient).
      const dropN = dropped.nutrients || {};
      const base = { ...(item.nutrients || {}) };
      for (const k of NUTRIENT_KEYS) {
        const iv = base[k] ?? (item as any)[k];
        const dv = dropN[k] ?? (dropped as any)[k];
        if (typeof iv === 'number' && Number.isFinite(iv) && typeof dv === 'number' && Number.isFinite(dv)) {
          base[k] = Math.max(0, Math.round((iv - dv) * 10) / 10);
        }
      }
      const locked = Array.isArray(item.lockedNutrientKeys) ? item.lockedNutrientKeys : [];
      if (!locked.includes('calories')) {
        base.calories = computeCaloriesFromMacros(base.protein, base.carbohydrates, base.totalFat);
      }
      const compW = comps.reduce((a: number, c: any) => a + (Number(c.weightGrams ?? c.estimatedWeightGrams) || 0), 0);
      const next = {
        ...item,
        nutrients: base,
        weightGrams: Math.round(compW),
        estimatedWeightGrams: Math.round(compW),
        components: comps,
        componentsDetailList: comps,
      };
      for (const k of ['calories', 'protein', 'totalFat', 'saturatedFat', 'carbohydrates', 'sodium'] as const) {
        if (typeof (base as any)[k] === 'number') (next as any)[k] = (base as any)[k];
      }
      items[idx] = reaggregateDishWeightFromComponents({ ...next, hasComponents: true });
      notes.push(`remove_component "${raw.componentName}" from "${itemName}" (−${dropW}g)`);
    } else if (action === 'add_component') {
      if (idx < 0) { notes.push(`add_component: no item "${itemName}"`); continue; }
      const compName = raw.componentName || raw.newItemName || raw.itemName;
      if (!compName) { notes.push('add_component: missing componentName'); continue; }
      const item = items[idx];
      const comps = [...componentsOf(item)];
      const compW = Number(raw.newWeightGrams) > 0 ? Number(raw.newWeightGrams) : 50;
      const compNutrients = raw.estimate?.nutrients || raw.estimate || {};
      const newComp = {
        name: compName,
        foodName: compName,
        canonicalDbName: compName,
        originalName: compName,
        keyword: compName.toLowerCase(),
        weightGrams: compW,
        estimatedWeightGrams: compW,
        nutrients: compNutrients,
        sourceImageIndex: typeof raw.sourceImageIndex === 'number' ? raw.sourceImageIndex : (item.sourceImageIndex ?? null),
        role: 'component',
      };
      comps.push(newComp);
      const base = { ...(item.nutrients || {}) };
      for (const k of NUTRIENT_KEYS) {
        const iv = base[k] ?? (item as any)[k];
        const av = compNutrients[k] ?? (newComp as any)[k];
        if (typeof iv === 'number' && Number.isFinite(iv) && typeof av === 'number' && Number.isFinite(av)) {
          base[k] = Math.round((iv + av) * 10) / 10;
        } else if (typeof av === 'number' && Number.isFinite(av)) {
          base[k] = av;
        }
      }
      const locked = Array.isArray(item.lockedNutrientKeys) ? item.lockedNutrientKeys : [];
      if (!locked.includes('calories')) {
        base.calories = computeCaloriesFromMacros(base.protein, base.carbohydrates, base.totalFat);
      }
      const compWTotal = comps.reduce((a: number, c: any) => a + (Number(c.weightGrams ?? c.estimatedWeightGrams) || 0), 0);
      const next = {
        ...item,
        nutrients: base,
        weightGrams: Math.round(compWTotal),
        estimatedWeightGrams: Math.round(compWTotal),
        components: comps,
        componentsDetailList: comps,
        hasComponents: true,
      };
      for (const k of ['calories', 'protein', 'totalFat', 'saturatedFat', 'carbohydrates', 'sodium'] as const) {
        if (typeof (base as any)[k] === 'number') (next as any)[k] = (base as any)[k];
      }
      items[idx] = reaggregateDishWeightFromComponents({ ...next, hasComponents: true });
      notes.push(`add_component "${compName}" (${compW}g) to "${itemName}"`);
    } else if (action === 'replace_component') {
      if (idx < 0) { notes.push(`replace_component: no item "${itemName}"`); continue; }
      if (!raw.componentName) { notes.push('replace_component: missing componentName'); continue; }
      const newCompName = raw.newItemName || raw.componentName;
      const item = items[idx];
      const comps = [...componentsOf(item)];
      const cIdx = comps.findIndex((c) => {
        const cn = String(c.name || c.searchQuery || c.keyword || c.foodName || '').toLowerCase();
        return cn && cn.includes(String(raw.componentName || '').toLowerCase());
      });
      if (cIdx < 0) { notes.push(`replace_component: no component "${raw.componentName}"`); continue; }
      const oldComp = comps[cIdx];
      const oldW = Number(oldComp.weightGrams ?? oldComp.estimatedWeightGrams) || 0;
      const newW = Number(raw.newWeightGrams) > 0 ? Number(raw.newWeightGrams) : oldW;
      const compNutrients = raw.estimate?.nutrients || raw.estimate || oldComp.nutrients || {};
      const replacedComp = {
        ...oldComp,
        name: newCompName,
        foodName: newCompName,
        canonicalDbName: newCompName,
        originalName: newCompName,
        keyword: newCompName.toLowerCase(),
        weightGrams: newW,
        estimatedWeightGrams: newW,
        nutrients: compNutrients,
        sourceImageIndex: typeof raw.sourceImageIndex === 'number' ? raw.sourceImageIndex : (oldComp.sourceImageIndex ?? item.sourceImageIndex ?? null),
      };
      comps[cIdx] = replacedComp;
      const oldN = oldComp.nutrients || {};
      const base = { ...(item.nutrients || {}) };
      for (const k of NUTRIENT_KEYS) {
        const iv = base[k] ?? (item as any)[k];
        const ov = oldN[k] ?? (oldComp as any)[k];
        const nv = compNutrients[k] ?? (replacedComp as any)[k];
        if (typeof iv === 'number' && Number.isFinite(iv)) {
          let updatedVal = iv;
          if (typeof ov === 'number' && Number.isFinite(ov)) updatedVal -= ov;
          if (typeof nv === 'number' && Number.isFinite(nv)) updatedVal += nv;
          base[k] = Math.max(0, Math.round(updatedVal * 10) / 10);
        } else if (typeof nv === 'number' && Number.isFinite(nv)) {
          base[k] = nv;
        }
      }
      const locked = Array.isArray(item.lockedNutrientKeys) ? item.lockedNutrientKeys : [];
      if (!locked.includes('calories')) {
        base.calories = computeCaloriesFromMacros(base.protein, base.carbohydrates, base.totalFat);
      }
      const compWTotal = comps.reduce((a: number, c: any) => a + (Number(c.weightGrams ?? c.estimatedWeightGrams) || 0), 0);
      const next = {
        ...item,
        nutrients: base,
        weightGrams: Math.round(compWTotal),
        estimatedWeightGrams: Math.round(compWTotal),
        components: comps,
        componentsDetailList: comps,
        hasComponents: true,
      };
      for (const k of ['calories', 'protein', 'totalFat', 'saturatedFat', 'carbohydrates', 'sodium'] as const) {
        if (typeof (base as any)[k] === 'number') (next as any)[k] = (base as any)[k];
      }
      items[idx] = reaggregateDishWeightFromComponents({ ...next, hasComponents: true });
      notes.push(`replace_component "${raw.componentName}" → "${newCompName}" (${newW}g) in "${itemName}"`);
    } else if (action === 'rename_alias') {
      if (idx < 0) continue;
      const newName = raw.newItemName || itemName;
      items[idx] = { ...items[idx], name: newName, canonicalDbName: newName, originalName: newName };
      notes.push(`rename_alias → "${newName}"`);
    } else {
      notes.push(`skipped unknown action "${raw.action}"`);
    }
  }

  const nutrients = sumItemNutrients(items);
  const weightGrams = Math.round(items.reduce((a, it) => a + (Number(it.weightGrams) || 0), 0));
  const userLockedSlots = mergeLocksFromCommands({
    priorLocks: opts.priorLocks || [],
    commands,
    itemsAfter: items,
    turn: opts.turn || 1,
    userMessage: opts.userMessage,
  });
  return {
    items,
    nutrients,
    weightGrams,
    changed: snapshotOf(items) !== originalSnapshot,
    qa: false,
    receiptTable: formatMealReceiptTable(items, nutrients, weightGrams),
    notes,
    beforeItems: original,
    userLockedSlots,
    appliedCommands: commands,
  };
}

export function mealItemsHaveAtwaterCalories(items: any[]): boolean {
  return (items || []).every((it) => {
    const cal = Number(it?.nutrients?.calories ?? it?.calories) || 0;
    const p = Number(it?.nutrients?.protein ?? it?.protein) || 0;
    const c = Number(it?.nutrients?.carbohydrates ?? it?.carbohydrates) || 0;
    const f = Number(it?.nutrients?.totalFat ?? it?.totalFat) || 0;
    if (p + c + f <= 1) return true;
    return cal > 0;
  });
}
