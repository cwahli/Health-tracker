/**
 * Saved-meal lineage: parent/child links between restaged meals.
 *
 * A child log stores `sourceMealId` (its parent's id). The master is the root
 * ancestor found by walking those links. Chains nest: restaging a child makes
 * a grandchild pointing at the child.
 *
 * Propagation rule (user-confirmed): a master edit flows nutrients, photos and
 * name down to direct children. Each child keeps its OWN weightGrams —
 * portion size is specific per log; nutrients re-scale to it.
 */

export interface StagedTagLike {
  dbId?: string;
  name?: string;
  source?: string;
  originalLog?: any;
  weightGrams?: number;
}

/** Id of the saved meal a staged tag was restaged from, if any. */
export function parentIdOfTag(tag: StagedTagLike | null | undefined): string | undefined {
  if (!tag || typeof tag !== 'object') return undefined;
  if (tag.source !== 'previous_meal') return undefined;
  const raw = tag.dbId || tag.originalLog?.id || tag.originalLog?.food_id;
  const id = String(raw || '').trim();
  return id || undefined;
}

export interface StampedLineage {
  sourceMealId?: string;
  items: any[];
}

/**
 * Lineage stamp for a composite save. `itemsBreakdown` must be the
 * 1:1-per-tag output of calculateCompositeMeal (same order as `tags`).
 * Single saved-meal tray → child of that meal. Mixed or multi-master trays →
 * no single parent, but each item keeps its own parentMealId.
 */
export function stampChildLineage(tags: StagedTagLike[] | null | undefined, itemsBreakdown: any[] | null | undefined): StampedLineage {
  const list = Array.isArray(tags) ? tags : [];
  const items = Array.isArray(itemsBreakdown) ? itemsBreakdown : [];
  const parents = list.map(parentIdOfTag);
  const stamped = items.map((item, idx) => {
    const p = parents[idx];
    if (!p || !item || typeof item !== 'object') return item;
    if ((item as any).parentMealId) return item;
    return { ...item, parentMealId: p };
  });
  // Only a pure restage (every tag from the same single master) claims the
  // log-level parent. Mixed trays stay parentless but keep per-item parents.
  const uniq = Array.from(new Set(parents.filter(Boolean) as string[]));
  const pure = list.length > 0 && parents.every(Boolean) && uniq.length === 1;
  if (pure) return { sourceMealId: uniq[0], items: stamped };
  return { sourceMealId: undefined, items: stamped };
}

/** Walk sourceMealId links to the root master. Cycle-safe, depth-capped. */
export function findMasterMeal(log: any, logs: any[] | null | undefined, maxDepth = 8): any {
  let cur = log;
  const seen = new Set<string>();
  for (let i = 0; i < maxDepth && cur && typeof cur === 'object'; i++) {
    const id = String(cur.id || '');
    if (id) {
      if (seen.has(id)) break;
      seen.add(id);
    }
    const pid = String(cur.sourceMealId || cur.source_meal_id || '').trim();
    if (!pid) break;
    const parent = (Array.isArray(logs) ? logs : []).find((l) => l && typeof l === 'object' && String(l.id) === pid);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/** Direct children of a meal (one level). */
export function findChildMeals(parentId: string | null | undefined, logs: any[] | null | undefined): any[] {
  const pid = String(parentId || '').trim();
  if (!pid) return [];
  return (Array.isArray(logs) ? logs : []).filter(
    (l) => l && typeof l === 'object' && String(l.sourceMealId || l.source_meal_id || '').trim() === pid,
  );
}

/**
 * Propagate a master edit through the whole descendant subtree (children,
 * grandchildren, …). Each level propagates from its updated parent. Returns
 * a map of updated logs by id, INCLUDING the root itself. Cycle-safe.
 */
export function propagateDownstream(root: any, logs: any[] | null | undefined): Map<string, any> {
  const updated = new Map<string, any>();
  if (!root || typeof root !== 'object' || !root.id) return updated;
  updated.set(String(root.id), root);
  const queue: any[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    const resolved = updated.get(String(cur.id)) || cur;
    for (const child of findChildMeals(resolved.id, logs)) {
      if (updated.has(String(child.id))) continue;
      const next = propagateMasterUpdate(resolved, child);
      updated.set(String(child.id), next);
      queue.push(next);
    }
  }
  return updated;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Scale a nutrient value like the composite path (calories/sodium int, rest 1dp). */
function scaleValue(key: string, value: unknown, factor: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const scaled = n * factor;
  if (key === 'calories' || key === 'sodium') return Math.round(scaled);
  return Math.round(scaled * 10) / 10;
}

const ITEM_NUMERIC_KEYS = [
  'calories', 'protein', 'carbohydrates', 'carbs', 'totalFat', 'fat',
  'saturatedFat', 'fiber', 'totalFibre', 'sodium', 'salt', 'sugar', 'addedSugar', 'transFat',
];

/**
 * Propagate a master edit onto a direct child. Returns a NEW object.
 * - nutrients (object + flat aliases) re-scale to the CHILD's own weight,
 * - name and usable photos follow the master,
 * - child weightGrams/portion stay untouched (portion size is specific),
 * - per-item rows are matched by index (fallback: name) and gain the
 *   master's values, photos and OCR provenance,
 * - keys the master doesn't carry are preserved on the child, never erased.
 */
export function propagateMasterUpdate(master: any, child: any): any {
  if (!master || typeof master !== 'object') return child;
  if (!child || typeof child !== 'object') return child;
  const out: any = { ...child };
  const masterWeight = Number(master.weightGrams ?? master.weight_grams ?? 0);
  const childWeight = Number(child.weightGrams ?? child.weight_grams ?? 0);
  const factor = masterWeight > 0 && childWeight > 0 ? childWeight / masterWeight : 1;

  const masterNutrients = master.nutrients && typeof master.nutrients === 'object' ? master.nutrients : {};
  const childNutrients = out.nutrients && typeof out.nutrients === 'object' ? { ...out.nutrients } : {};
  for (const [k, v] of Object.entries(masterNutrients)) {
    const scaled = scaleValue(k, v, factor);
    if (scaled !== null) childNutrients[k] = scaled;
  }
  if (Object.keys(childNutrients).length > 0) out.nutrients = childNutrients;
  for (const key of ITEM_NUMERIC_KEYS) {
    const mv = (master as any)[key] ?? masterNutrients[key];
    const scaled = scaleValue(key, mv, factor);
    if (scaled !== null) out[key] = scaled;
  }

  if (typeof master.name === 'string' && master.name.trim()) out.name = master.name;
  const masterImgs = Array.isArray(master.imageUrls) && master.imageUrls.length > 0
    ? master.imageUrls
    : (master.imageUrl ? [master.imageUrl] : []);
  if (masterImgs.length > 0) {
    out.imageUrls = [...masterImgs];
    out.imageUrl = masterImgs[0];
  }

  const masterItems = Array.isArray(master.itemsBreakdown)
    ? master.itemsBreakdown
    : (Array.isArray(master.items_breakdown) ? master.items_breakdown : []);
  const childItems = Array.isArray(out.itemsBreakdown)
    ? out.itemsBreakdown
    : (Array.isArray(out.items_breakdown) ? out.items_breakdown : []);
  if (masterItems.length > 0 && childItems.length > 0) {
    out.itemsBreakdown = childItems.map((cItem: any, idx: number) => {
      if (!cItem || typeof cItem !== 'object') return cItem;
      const mItem = masterItems[idx] && typeof masterItems[idx] === 'object'
        ? masterItems[idx]
        : masterItems.find((m: any) => m && typeof m === 'object' && String(m.name || '').trim().toLowerCase() === String(cItem.name || '').trim().toLowerCase());
      if (!mItem) return cItem;
      const merged: any = { ...cItem };
      for (const key of ITEM_NUMERIC_KEYS) {
        const mv = mItem[key] ?? mItem.nutrients?.[key];
        const scaled = scaleValue(key, mv, factor);
        if (scaled !== null) {
          merged[key] = scaled;
          merged.nutrients = { ...(merged.nutrients || {}), [key]: scaled };
        }
      }
      if (typeof mItem.imageUrl === 'string' && mItem.imageUrl) merged.imageUrl = mItem.imageUrl;
      for (const key of ['dbSource', 'rawNutritionLabel', 'labelNutrientsPerServing', 'nutritionFacts'] as const) {
        if (mItem[key] !== undefined) merged[key] = mItem[key];
      }
      return merged;
    });
    if (Array.isArray(out.items_breakdown)) out.items_breakdown = out.itemsBreakdown;
  }

  out.updated_at = Date.now();
  return out;
}

/**
 * Re-review save: a fresh analysis of a saved meal keeps the reviewed log's
 * id so the save updates the whole record in place instead of duplicating it.
 * No-op for blank ids and non-objects.
 */
export function applyReviewMealId(food: any, reviewMealId: string | null | undefined): any {
  const id = String(reviewMealId || '').trim();
  if (!food || typeof food !== 'object' || !id) return food;
  return { ...food, id };
}
