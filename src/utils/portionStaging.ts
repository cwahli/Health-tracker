/**
 * portionStaging.ts — staged multi-dropdown portion selection.
 *
 * Class PORTION_MIXUP: the per-dish / per-component portion dropdowns on the
 * meal card must (a) never address the wrong dish and (b) recalculate meal
 * totals exactly once, when the selection set is complete — never once per
 * dropdown change.
 *
 * Two defects this closes:
 *  1. Positional keys — a portion map keyed by render index (`i`, always 0 in
 *     the single-dish tab view) or by bare keyword lets one dish's selection
 *     overwrite another's, and a displayed-list index reaches straight into
 *     `itemsBreakdown`, hitting a flattened component row instead of the dish.
 *  2. Eager recalc — every dropdown change fired `onScalePortion` immediately,
 *     so a half-finished multi-dropdown selection produced wrong intermediate
 *     meal totals. Selections are staged locally; the parent rescales once on
 *     apply.
 */

/** Stable per-dish identity. scoutIndex survives the display mapping. */
export function dishKeyFor(item: any, fallbackIndex: number): string {
  const stable = item?.scoutIndex ?? item?.id ?? item?.dbId;
  if (stable !== undefined && stable !== null && String(stable).trim() !== '') {
    return `scout:${String(stable)}`;
  }
  const name = item?.keyword || item?.originalName || item?.name || item?.canonicalDbName;
  if (name !== undefined && name !== null && String(name).trim() !== '') {
    return `name:${String(name).toLowerCase().trim()}#${fallbackIndex}`;
  }
  return `idx:${fallbackIndex}`;
}

/** Canonical staged-selection key: one dish, one tab. No fallback aliases. */
export function stagedPortionKey(dishKey: string, tab: number): string {
  return `${dishKey}::tab${tab}`;
}

/**
 * The stable (1.0-ratio) base weight of a dish: the weight its current
 * `portionRatio` was measured from. Whole-dish dropdown ratios must divide by
 * this base — never by the live weight, which already includes earlier
 * scalings (dividing by the live weight compounds them).
 */
export function staticBaseWeight(currentWeightGrams: number, portionRatio?: number | null): number {
  const ratio = Number(portionRatio) || 1.0;
  if (!(currentWeightGrams > 0) || !(ratio > 0)) return currentWeightGrams > 0 ? Math.round(currentWeightGrams) : 100;
  return Math.max(1, Math.round(currentWeightGrams / ratio));
}

/**
 * Resolve a displayed-dish reference to its `itemsBreakdown` row.
 * The displayed list filters out flattened component rows
 * (`role === 'component'`), so a displayed position is NOT a breakdown
 * index. Match by stable identity; fall back to the positional index only
 * when nothing matches. Returns -1 when unresolvable.
 */
export function resolveBreakdownIndex(
  itemsBreakdown: any[] | null | undefined,
  dishKey: string,
  fallbackIndex: number
): number {
  const rows = Array.isArray(itemsBreakdown) ? itemsBreakdown : [];
  if (dishKey.startsWith('scout:')) {
    const want = dishKey.slice('scout:'.length);
    const hit = rows.findIndex(
      (r: any) => r != null && String(r.scoutIndex ?? r.id ?? r.dbId ?? '') === want
    );
    if (hit >= 0) return hit;
  } else if (dishKey.startsWith('name:')) {
    const want = dishKey.slice('name:'.length).split('#')[0];
    const hit = rows.findIndex((r: any) => {
      if (r == null || r.role === 'component' || r.isFlattenedComponent) return false;
      const n = String(r.keyword || r.originalName || r.name || r.canonicalDbName || '')
        .toLowerCase()
        .trim();
      return n !== '' && n === want;
    });
    if (hit >= 0) return hit;
  }
  if (Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < rows.length) {
    return fallbackIndex;
  }
  return -1;
}

export interface StagedDishTotal {
  /** Combined dish weight from staged component selections + untouched defaults. */
  totalGrams: number;
  /** True when every component has an explicit staged selection (or override). */
  allSelected: boolean;
  selectedCount: number;
  requiredCount: number;
  /** True when the staged total differs from the dish's current weight. */
  dirty: boolean;
}

/**
 * Combine staged per-component portion selections into one dish total.
 * Components without an explicit staged selection keep their default weight,
 * so the preview never invents grams — but the set only counts as complete
 * (`allSelected`) when every component was explicitly chosen, which is when
 * the parent may recalculate.
 */
export function combineStagedDishWeight(
  subComps: any[],
  staged: Record<string, number>,
  dishKey: string,
  staticTotalGrams: number,
  currentDishGrams: number,
  resolveDefaultWeight: (comp: any, staticTotal: number, count: number) => number,
  wholeDishOverrideGrams?: number
): StagedDishTotal {
  const comps = Array.isArray(subComps) ? subComps : [];
  if (wholeDishOverrideGrams !== undefined && wholeDishOverrideGrams > 0) {
    return {
      totalGrams: Math.round(wholeDishOverrideGrams),
      allSelected: true,
      selectedCount: comps.length,
      requiredCount: comps.length,
      dirty: Math.round(wholeDishOverrideGrams) !== Math.round(currentDishGrams),
    };
  }
  let selectedCount = 0;
  let total = 0;
  comps.forEach((comp: any, cIdx: number) => {
    const key = stagedPortionKey(dishKey, cIdx + 1);
    const v = staged[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      selectedCount += 1;
      total += v;
    } else {
      total += resolveDefaultWeight(comp, staticTotalGrams, comps.length);
    }
  });
  const totalGrams = Math.round(total);
  return {
    totalGrams,
    allSelected: comps.length > 0 && selectedCount === comps.length,
    selectedCount,
    requiredCount: comps.length,
    dirty: totalGrams !== Math.round(currentDishGrams),
  };
}
