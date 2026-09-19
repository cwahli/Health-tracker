/**
 * `/api/food/search` previous_meal projection.
 *
 * This is NOT a lossy whitelist. A saved meal reused from history is rendered on
 * the client straight from this row, so it must arrive with its pictures,
 * nutrition values and OCR provenance. The old inline projection forwarded only
 * id/name/calories/portion/images and silently dropped `dbSource`,
 * `rawNutritionLabel` and `labelNutrientsPerServing` — which is why a reused
 * saved meal lost its values and could never badge "Nutrition Facts (OCR Label)".
 *
 * A single-item meal keeps its evidence on `items_breakdown[0]` (that is where
 * the composite save puts per-item OCR tags), so it is lifted to the top level
 * here. That makes the row directly usable without a local donor row.
 */

const ABSENT = Symbol('absent');

const isPresent = (v: unknown): boolean =>
  v !== undefined &&
  v !== null &&
  v !== '' &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/**
 * Stored rows default numbers to `0` (`food.calories || food.nutrients?.calories || 0`),
 * so a zero here means "unknown", not a measured zero. Treating it as present would
 * hide the item-level values behind a placeholder.
 */
const isEvidencePresent = (v: unknown): boolean => {
  if (!isPresent(v)) return false;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') return v.trim() !== '' && Number(v) !== 0;
  return true;
};

/** Stored evidence keys that identify label-OCR provenance. */
const PROVENANCE_KEYS = ['dbSource', 'rawNutritionLabel', 'labelNutrientsPerServing', 'nutritionFacts'] as const;

/** Nutrition keys forwarded verbatim (top level, else the single item). */
const NUTRIENT_KEYS = [
  'calories',
  'protein',
  'carbohydrates',
  'carbs',
  'totalFat',
  'fat',
  'saturatedFat',
  'saturated_fat',
  'totalFibre',
  'fiber',
  'total_fibre',
  'sodium',
  'salt',
  'sugar',
  'addedSugar',
  'transFat',
] as const;

/** Prefix for duplicate-pointer photo tokens (see handleDuplicateFoodLog). */
export const REF_PHOTO_PREFIX = 'ref:';

/** Usable photo URLs for a stored food-log row, falling back to the photo proxy. */
export function previousMealImageUrls(f: any): string[] {
  const raw = Array.isArray(f?.image_urls)
    ? f.image_urls
    : Array.isArray(f?.imageUrls)
      ? f.imageUrls
      : (f?.image_urls || f?.imageUrl || f?.image_url ? [f.image_urls || f.imageUrl || f.image_url] : []);
  const urls = raw.filter((u: unknown) =>
    typeof u === 'string' &&
    u.trim() &&
    !u.startsWith(REF_PHOTO_PREFIX) &&
    !u.includes('image_removed_for_snapshot') &&
    !u.includes('Image reference preserved') &&
    u !== 'loading'
  );
  if (urls.length > 0) return urls;
  const id = String(f?.id || '').trim();
  if (!id || id.startsWith('brand_')) return [];
  const safe = id.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  return [`/photos/${safe}.jpg`];
}

/**
 * Collect `ref:<id>` photo-pointer ids from a batch of stored rows
 * (top-level photo fields only — that is where duplicate-to-today writes them).
 */
export function collectRefPhotoIds(rows: any[]): string[] {
  const ids: string[] = [];
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    const fields = [row.imageUrl, row.image_url, row.image_urls, row.imageUrls];
    for (const field of fields) {
      const list = Array.isArray(field) ? field : [field];
      for (const v of list) {
        if (typeof v === 'string' && v.startsWith(REF_PHOTO_PREFIX)) {
          const id = v.slice(REF_PHOTO_PREFIX.length).trim();
          if (id && !ids.includes(id)) ids.push(id);
        }
      }
    }
  }
  return ids;
}

/**
 * Substitute resolved primary photos for `ref:` tokens ahead of projection.
 * `photoMap` maps primary id → its usable photo URLs. Unresolvable tokens are
 * dropped (never shipped as dangling pointers).
 */
export function substituteRefPhotos(rows: any[], photoMap: Map<string, string[]>): any[] {
  if (!photoMap || photoMap.size === 0) return rows;
  const lookup = (token: string): string[] | undefined => {
    const photos = photoMap.get(token.slice(REF_PHOTO_PREFIX.length).trim());
    return photos && photos.length > 0 ? photos : undefined;
  };
  return (rows || []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const out: any = { ...row };
    for (const key of ['imageUrl', 'image_url'] as const) {
      if (typeof out[key] === 'string' && out[key].startsWith(REF_PHOTO_PREFIX)) {
        const photos = lookup(out[key]);
        if (photos) out[key] = photos[0];
        else delete out[key];
      }
    }
    for (const key of ['imageUrls', 'image_urls'] as const) {
      const cur = out[key];
      if (Array.isArray(cur)) {
        const next: string[] = [];
        for (const v of cur) {
          if (typeof v === 'string' && v.startsWith(REF_PHOTO_PREFIX)) {
            const photos = lookup(v);
            if (photos) next.push(...photos);
          } else {
            next.push(v);
          }
        }
        out[key] = next;
      } else if (typeof cur === 'string' && cur.startsWith(REF_PHOTO_PREFIX)) {
        const photos = lookup(cur);
        out[key] = photos ? [...photos] : [];
      }
    }
    return out;
  });
}

/**
 * Project a stored food-log row into the `previous_meal` search result shape.
 * Accepts either DB snake_case or client camelCase input.
 */
export function mapPreviousMealRow(f: any): any {
  const row = f && typeof f === 'object' ? f : {};
  const imageUrls = previousMealImageUrls(row);
  const items = Array.isArray(row.items_breakdown)
    ? row.items_breakdown
    : Array.isArray(row.itemsBreakdown)
      ? row.itemsBreakdown
      : [];
  // Per-item evidence only describes the meal itself when there is exactly one item.
  const solo = items.length === 1 && items[0] && typeof items[0] === 'object' ? items[0] : null;
  const evidence = (key: string) => {
    const top = row[key];
    if (isEvidencePresent(top)) return top;
    if (solo && isEvidencePresent(solo[key])) return solo[key];
    return ABSENT;
  };

  const nutrients: Record<string, any> = {};
  for (const source of [solo?.nutrients, row.nutrients]) {
    if (source && typeof source === 'object') {
      for (const [k, v] of Object.entries(source)) {
        if (!isEvidencePresent(nutrients[k]) && isEvidencePresent(v)) nutrients[k] = v;
      }
    }
  }
  // `nutrients.calories` is the field the composite path reads first.
  const mealCalories = isEvidencePresent(row.calories) ? row.calories : solo?.calories;
  if (!isEvidencePresent(nutrients.calories) && isEvidencePresent(mealCalories)) nutrients.calories = mealCalories;

  const weight = row.weight_grams || row.weightGrams || row.consumed_amount || solo?.weightGrams || 100;
  const result: any = {
    id: row.id,
    name: row.name,
    food_id: row.id,
    dish_name: row.name,
    display_name: row.name,
    portionGrams: weight,
    weightGrams: weight,
    type: 'previous_meal',
    date: row.date,
    imageUrl: imageUrls[0],
    imageUrls,
  };

  // Flat keys and the `nutrients` object are both read by consumers; keep the two
  // spellings consistent so a row is usable whichever one the caller looks at.
  for (const key of NUTRIENT_KEYS) {
    const flat = evidence(key);
    const value = flat !== ABSENT && isEvidencePresent(flat) ? flat : nutrients[key];
    if (!isEvidencePresent(value)) continue;
    result[key] = value;
    if (!isEvidencePresent(nutrients[key])) nutrients[key] = value;
  }
  for (const key of PROVENANCE_KEYS) {
    const value = evidence(key);
    if (value !== ABSENT) result[key] = value;
  }
  if (Object.keys(nutrients).length > 0) result.nutrients = nutrients;
  // Lineage: a restaged child must know its parent so the client can badge it
  // and chain further restages to the root master.
  const parentId = row.sourceMealId || row.source_meal_id;
  if (typeof parentId === 'string' && parentId.trim()) {
    result.sourceMealId = parentId.trim();
    result.source_meal_id = parentId.trim();
  }
  if (items.length > 0) {
    result.items_breakdown = items;
    // The client renders tiles and item photos from the camelCase spelling.
    result.itemsBreakdown = items;
  }
  return result;
}
