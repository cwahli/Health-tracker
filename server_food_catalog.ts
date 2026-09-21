import { d1Query, isD1Configured, safeJsonParse } from './server_d1.js';
import { CANONICAL_BASE_FOODS, lookupCanonicalBaseFood } from './server_food_db';
import { NUTRIENT_KEYS } from './src/utils/nutrients';
import { ensureFoodCatalogSchema, resetFoodCatalogSchemaEnsure } from "./server_food_catalog_schema.js";
import { isKnownDatabaseBrandSync, isGroceryBrandSync } from "./serverBrandMenu.js";

export function normalizeFoodKey(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const DISH_SYNONYMS: Record<string, string> = {
  'mac_cheese': 'macaroni_and_cheese',
  'mac_and_cheese': 'macaroni_and_cheese',
  'mac_n_cheese': 'macaroni_and_cheese',
  'macaroni_cheese': 'macaroni_and_cheese',
  'macaroni_and_cheese': 'macaroni_and_cheese',
  'poke_bowl': 'poke_bowl',
  'chicken_tikka_masala': 'chicken_tikka_masala',
  'tikka_masala': 'chicken_tikka_masala',
};

export function normalizeDishKey(name: string): string {
  const norm = normalizeFoodKey(name);
  if (DISH_SYNONYMS[norm]) {
    return DISH_SYNONYMS[norm];
  }
  return norm;
}

export interface InternalFoodMatch {
  food_id: string;
  food_key: string;
  display_name: string;
  nutrients_per_100g: Record<string, number>;
  source: 'canonical_local' | 'supabase_active' | 'alias_active' | 'supabase_candidate' | 'd1_active' | 'd1_candidate';
  confidence: number;
  fdc_id?: string;
  form_tags?: string[];
  state?: string;
}

export interface InternalDishMatch {
  dish_key: string;
  display_name: string;
  core_nutrients: Record<string, number>;
  basis_type: string;
  serving_grams: number;
  confidence: number;
  source: 'supabase_active' | 'dish_alias' | 'd1_active';
}

export const STANDARD_BASE_FOODS: Record<string, { fdcId?: string; nutrients: Record<string, number> }> = {
  ranch_dressing: {
    fdcId: "170755",
    nutrients: {
      calories: 430, protein: 1.5, carbohydrates: 6.5, totalFat: 45.0, saturatedFat: 7.0, unsaturatedFat: 36.0,
      sugar: 3.5, addedSugar: 2.5, totalFibre: 0.2, solubleFibre: 0, sodium: 850,
      potassium: 75, calcium: 35, magnesium: 5, phosphorus: 40, iron: 0.3, zinc: 0.2, selenium: 1.5, iodine: 5,
      vitaminE: 3.5, vitaminK: 45, vitaminA: 20, vitaminB12: 0.1, vitaminB6: 0.02, folate: 6, riboflavin: 0.03, niacin: 0.1, thiamine: 0.02, vitaminC: 0.5, vitaminD: 0.1
    }
  },
  caesar_dressing: {
    fdcId: "173574",
    nutrients: {
      calories: 470, protein: 2.1, carbohydrates: 4.2, totalFat: 50.0, saturatedFat: 8.5, unsaturatedFat: 39.0,
      sugar: 2.8, addedSugar: 1.5, totalFibre: 0.1, solubleFibre: 0, sodium: 980,
      potassium: 55, calcium: 65, magnesium: 6, phosphorus: 45, iron: 0.4, zinc: 0.3, selenium: 2.0, iodine: 5,
      vitaminE: 4.0, vitaminK: 50, vitaminA: 25, vitaminB12: 0.15, vitaminB6: 0.03, folate: 8, riboflavin: 0.04, niacin: 0.2, thiamine: 0.02, vitaminC: 0.5, vitaminD: 0.1
    }
  },
  vinaigrette: {
    fdcId: "170756",
    nutrients: {
      calories: 380, protein: 0.5, carbohydrates: 8.0, totalFat: 39.0, saturatedFat: 5.5, unsaturatedFat: 32.0,
      sugar: 6.5, addedSugar: 5.0, totalFibre: 0.1, solubleFibre: 0, sodium: 720,
      potassium: 40, calcium: 15, magnesium: 3, phosphorus: 15, iron: 0.2, zinc: 0.1, selenium: 0.8, iodine: 2,
      vitaminE: 4.5, vitaminK: 40, vitaminA: 10, vitaminB12: 0, vitaminB6: 0.01, folate: 3, riboflavin: 0.01, niacin: 0.1, thiamine: 0.01, vitaminC: 0.5, vitaminD: 0
    }
  },
  balsamic_vinaigrette: {
    fdcId: "170756",
    nutrients: {
      calories: 350, protein: 0.4, carbohydrates: 12.0, totalFat: 33.0, saturatedFat: 4.8, unsaturatedFat: 27.0,
      sugar: 10.5, addedSugar: 8.0, totalFibre: 0.1, solubleFibre: 0, sodium: 680,
      potassium: 50, calcium: 18, magnesium: 4, phosphorus: 18, iron: 0.3, zinc: 0.1, selenium: 0.5, iodine: 2,
      vitaminE: 3.8, vitaminK: 35, vitaminA: 8, vitaminB12: 0, vitaminB6: 0.01, folate: 3, riboflavin: 0.01, niacin: 0.1, thiamine: 0.01, vitaminC: 0.5, vitaminD: 0
    }
  },
  crispy_onion: {
    fdcId: "169998",
    nutrients: {
      calories: 560, protein: 6.0, carbohydrates: 45.0, totalFat: 40.0, saturatedFat: 9.0, unsaturatedFat: 31.0,
      sugar: 4.0, addedSugar: 1.0, totalFibre: 3.5, solubleFibre: 0.8, sodium: 800,
      potassium: 200, calcium: 30, magnesium: 20, phosphorus: 70, iron: 1.8, zinc: 0.6, selenium: 5.0, iodine: 5,
      folate: 20, vitaminC: 2.0, vitaminA: 10, vitaminB6: 0.1, vitaminB12: 0.1, thiamine: 0.15, riboflavin: 0.1, niacin: 1.5, vitaminE: 3.5, vitaminK: 5.0, vitaminD: 0
    }
  },
  crispy_onions: {
    fdcId: "169998",
    nutrients: {
      calories: 560, protein: 6.0, carbohydrates: 45.0, totalFat: 40.0, saturatedFat: 9.0, unsaturatedFat: 31.0,
      sugar: 4.0, addedSugar: 1.0, totalFibre: 3.5, solubleFibre: 0.8, sodium: 800,
      potassium: 200, calcium: 30, magnesium: 20, phosphorus: 70, iron: 1.8, zinc: 0.6, selenium: 5.0, iodine: 5,
      folate: 20, vitaminC: 2.0, vitaminA: 10, vitaminB6: 0.1, vitaminB12: 0.1, thiamine: 0.15, riboflavin: 0.1, niacin: 1.5, vitaminE: 3.5, vitaminK: 5.0, vitaminD: 0
    }
  }
};

export async function resolveInternalFood(query: string): Promise<InternalFoodMatch | null> {
  if (!query) return null;
  const key = normalizeFoodKey(query);
  if (!key) return null;

  // 1. Check local canonical base foods map
  const canonical = CANONICAL_BASE_FOODS[key] || lookupCanonicalBaseFood(query);
  if (canonical) {
    const { fdcId, id, foodType, ...nutrients } = canonical as any;
    const localId = id || key;
    return {
      food_id: localId,
      food_key: key,
      display_name: query,
      nutrients_per_100g: nutrients,
      source: 'canonical_local',
      confidence: 0.95,
      fdc_id: null,
    };
  }

  // 1b. Check standard kitchen staples/dressings
  const standard = STANDARD_BASE_FOODS[key];
  if (standard) {
    return {
      food_id: standard.fdcId || key,
      food_key: key,
      display_name: query,
      nutrients_per_100g: standard.nutrients,
      source: 'canonical_local',
      confidence: 0.95,
      fdc_id: standard.fdcId,
    };
  }

  // 2. Query D1 for active/candidate food item or alias
  if (!isD1Configured()) {
    return null;
  }

  const parseNuts = (v: any): any => (typeof v === 'string' ? safeJsonParse(v, {}) : (v || {}));
  const parseTags = (v: any): any[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return safeJsonParse(v, []);
    return [];
  };

  try {
    const itemRes = await d1Query<any>(
      'SELECT food_id, food_key, display_name, nutrients_per_100g, status, confidence, fdc_id, form_tags, state FROM food_items WHERE food_key = ? LIMIT 1',
      [key]
    );
    const itemData = itemRes.results?.[0];
    if (itemData) {
      itemData.nutrients_per_100g = parseNuts(itemData.nutrients_per_100g);
      itemData.form_tags = parseTags(itemData.form_tags);
      if (itemData.status === 'active') {
        return {
          food_id: itemData.food_id,
          food_key: itemData.food_key,
          display_name: itemData.display_name,
          nutrients_per_100g: itemData.nutrients_per_100g,
          source: 'd1_active',
          confidence: itemData.confidence || 0.9,
          fdc_id: itemData.fdc_id,
          form_tags: itemData.form_tags,
          state: itemData.state,
        };
      } else if (itemData.status === 'candidate') {
        const atwater = checkAtwaterValidity(itemData.nutrients_per_100g);
        if ((itemData.confidence || 0.5) >= 0.65 && atwater.valid) {
          return {
            food_id: itemData.food_id,
            food_key: itemData.food_key,
            display_name: itemData.display_name,
            nutrients_per_100g: itemData.nutrients_per_100g,
            source: 'd1_candidate',
            confidence: itemData.confidence || 0.5,
            fdc_id: itemData.fdc_id,
            form_tags: itemData.form_tags,
            state: itemData.state,
          };
        }
      }
    }
    // Check alias
    const aliasRes = await d1Query<any>('SELECT * FROM food_aliases WHERE alias_key = ? LIMIT 1', [key]);
    const aliasData = aliasRes.results?.[0];

    if (aliasData?.food_id) {
      const fiRes = await d1Query<any>('SELECT * FROM food_items WHERE food_id = ? LIMIT 1', [aliasData.food_id]);
      const fi = fiRes.results?.[0];
      if (fi) {
        fi.nutrients_per_100g = parseNuts(fi.nutrients_per_100g);
        fi.form_tags = parseTags(fi.form_tags);
        if (fi.status === 'active' || (fi.status === 'candidate' && (fi.confidence || 0.5) >= 0.65 && checkAtwaterValidity(fi.nutrients_per_100g).valid)) {
          console.log(`[AliasHit] Found alias mapping for ${key} -> ${fi.food_id}`);
          // F-4 alias hit-rate telemetry: count reads (approximate under concurrency).
          // Fire-and-forget; resolution never waits on or depends on this write.
          d1Query(`UPDATE food_aliases SET hit_count = ? WHERE alias_key = ?`, [(aliasData.hit_count || 0) + 1, key]).catch(
            (err: any) => console.warn('[AliasHit] hit_count increment failed:', err?.message || err)
          );
          return {
            food_id: fi.food_id,
            food_key: fi.food_key,
            display_name: fi.display_name,
            nutrients_per_100g: fi.nutrients_per_100g,
            source: fi.status === 'active' ? 'alias_active' : 'd1_candidate',
            confidence: (fi.confidence || 0.9) * (aliasData.weight || 1.0),
            fdc_id: fi.fdc_id,
            form_tags: fi.form_tags,
            state: fi.state,
          };
        }
      }
    }
  } catch (err) {
    // Fail-open logging
    console.warn('[resolveInternalFood] DB resolution error (fallback to external):', err);
  }

  return null;
}

/**
 * Direct lookup of a compiled dish by canonical key.
 */
export async function lookupDishInCatalog(key: string): Promise<any | null> {
  if (!isD1Configured()) {
    return null;
  }

  try {
    const r = await d1Query<any>(
      'SELECT dish_key, display_name, core_nutrients, basis_type, serving_grams, confidence FROM dish_cache WHERE dish_key = ? AND status = ? LIMIT 1',
      [key, 'active']
    );
    const dish = r.results?.[0];
    if (dish) {
      return {
        ...dish,
        core_nutrients: typeof dish.core_nutrients === 'string' ? safeJsonParse(dish.core_nutrients, {}) : (dish.core_nutrients || {}),
      };
    }
  } catch (err) {
    console.warn(`[FoodCatalog] D1 dish lookup error for key ${key}:`, err);
  }

  return null;
}

export async function resolveDishCache(query: string): Promise<InternalDishMatch | null> {
  if (!query) return null;
  const key = normalizeDishKey(query);
  if (!key) return null;
  if (!isD1Configured()) {
    return null;
  }

  try {
    const r = await d1Query<any>('SELECT * FROM dish_cache WHERE dish_key = ? AND status = ? LIMIT 1', [key, 'active']);
    const dish = r.results?.[0];
    if (dish) {
      dish.core_nutrients = typeof dish.core_nutrients === 'string' ? safeJsonParse(dish.core_nutrients, {}) : (dish.core_nutrients || {});
      return {
        dish_key: dish.dish_key,
        display_name: dish.display_name,
        core_nutrients: dish.core_nutrients,
        basis_type: dish.basis_type || 'per_serving',
        serving_grams: dish.serving_grams || 100,
        confidence: dish.confidence || 0.9,
        source: 'd1_active',
      };
    }

    // Check dish_aliases
    const aRes = await d1Query<any>('SELECT dish_key FROM dish_aliases WHERE alias_key = ? LIMIT 1', [key]);
    const alias = aRes.results?.[0];

    if (alias?.dish_key) {
      const tRes = await d1Query<any>('SELECT * FROM dish_cache WHERE dish_key = ? AND status = ? LIMIT 1', [alias.dish_key, 'active']);
      const targetDish = tRes.results?.[0];
      if (targetDish) {
        targetDish.core_nutrients = typeof targetDish.core_nutrients === 'string' ? safeJsonParse(targetDish.core_nutrients, {}) : (targetDish.core_nutrients || {});
        return {
          dish_key: targetDish.dish_key,
          display_name: targetDish.display_name,
          core_nutrients: targetDish.core_nutrients,
          basis_type: targetDish.basis_type || 'per_serving',
          serving_grams: targetDish.serving_grams || 100,
          confidence: targetDish.confidence || 0.85,
          source: 'dish_alias',
        };
      }
    }
  } catch (err) {
    console.warn('[resolveDishCache] DB resolution error:', err);
  }

  return null;
}

export async function upsertFoodAlias(alias: {
  alias_key: string;
  food_key?: string;
  food_id?: string;
  weight?: number;
  source?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) {
    return { success: true };
  }
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    const normAlias = normalizeFoodKey(alias.alias_key);
    if (!normAlias) return { success: false, error: 'Alias key required' };

    const targetFoodId = alias.food_id || alias.food_key || normAlias;
    if (normAlias === targetFoodId) {
      // Issue #8: Generated redundant aliases for exact query strings. Add a local check to skip exact self-references.
      console.debug(`[upsertFoodAlias] Skipping self-referential alias: ${normAlias}`);
      return { success: true };
    }

    const upRes = await d1Query(
      `INSERT INTO food_aliases (alias_key, food_id, weight, source) VALUES (?, ?, ?, ?)
       ON CONFLICT(alias_key) DO UPDATE SET food_id = excluded.food_id, weight = excluded.weight, source = excluded.source`,
      [normAlias, targetFoodId, alias.weight ?? 1.0, alias.source || 'food_resolver']
    );
    if (!upRes.success) {
      console.warn(`[upsertFoodAlias] D1 notice: ${upRes.error}`);
      return { success: true };
    }
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); }
    else if (/fetch failed|TypeError|AbortError|network/i.test(err.message || String(err))) { console.debug('[upsertFoodAlias] D1 network notice:', err.message || String(err)); }
    return { success: true, error: err.message || String(err) };
  }
}

export async function upsertFoodItemCandidate(item: {
  food_id: string;
  food_key: string;
  display_name: string;
  nutrients_per_100g: Record<string, number>;
  fdc_id?: string;
  form_tags?: string[];
  state?: string;
  status?: string;
  confidence?: number;
  provenance?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    const normKey = normalizeFoodKey(item.food_key);
    const displayName = item.display_name || '';

    // Guard 1: Do not insert branded items into unbranded food_catalog (food_items); redirect to brand_menu_items
    if (isKnownDatabaseBrandSync(displayName) || isKnownDatabaseBrandSync(normKey) || isGroceryBrandSync(displayName)) {
      console.log(`[FoodCatalog] Redirecting branded candidate "${displayName}" to brand_menu_items...`);
      try {
        const { autoRegisterChainMenuItem, normalizeChainKey } = await import('./serverBrandMenu.js');
        const chainKey = normalizeChainKey(displayName) || normalizeChainKey(normKey) || 'sainsbury';
        const { isD1Configured } = await import('./server_d1.js');
        if (isD1Configured()) {
          await autoRegisterChainMenuItem(
            null,
            {
              chainName: chainKey,
              dishName: displayName,
              originalName: displayName,
              rawNutritionLabel: item.nutrients_per_100g || {},
              lockedNutrientKeys: Object.keys(item.nutrients_per_100g || {}),
              estimatedWeightGrams: 100
            },
            'GB',
            (msg: string) => console.log(msg)
          );
        }
      } catch (brandErr) {
        console.warn(`[FoodCatalog] Failed auto-registering branded item "${displayName}":`, brandErr);
      }
      return { success: true };
    }

    // Guard 2: Reject candidate items with zero calories and zero macros - REMOVED
    // We allow zero-macro candidate items (like water, black coffee, diet drinks)
    
    // Check if existing candidate to count captures and check Atwater (D1-only)
    if (!isD1Configured()) {
      return { success: true };
    }
    const byIdRes = await d1Query<any>('SELECT * FROM food_items WHERE food_id = ? LIMIT 1', [item.food_id]);
    const byKeyRes = await d1Query<any>('SELECT * FROM food_items WHERE food_key = ? LIMIT 1', [normKey]);
    const parseRow = (r: any): any => {
      if (!r) return r;
      return {
        ...r,
        nutrients_per_100g: typeof r.nutrients_per_100g === 'string' ? safeJsonParse(r.nutrients_per_100g, {}) : (r.nutrients_per_100g || {}),
        form_tags: Array.isArray(r.form_tags) ? r.form_tags : (typeof r.form_tags === 'string' ? safeJsonParse(r.form_tags, []) : []),
      };
    };
    const existingById = parseRow(byIdRes.results?.[0]);
    const existingByKey = parseRow(byKeyRes.results?.[0]);

    let finalKey = normKey;
    let existing = existingById || existingByKey;

    if (existingById) {
      // Keep original food_key of the existing food_id row to prevent UNIQUE violations or key changes
      finalKey = existingById.food_key;
      existing = existingById;
    } else if (existingByKey) {
      // The food_key is in use by another food_id. Make our new entry's key unique to prevent UNIQUE constraint violation.
      finalKey = `${normKey}_${item.food_id}`;
      existing = null;
    }

    let newStatus = item.status || 'candidate';
    let captureCount = 1;

    if (existing) {
      captureCount = (existing.capture_count || 1) + 1;
      const atwater = checkAtwaterValidity(item.nutrients_per_100g);
      if (captureCount >= 2 && atwater.valid && existing.status === 'candidate') {
        newStatus = 'active';
      }
    } else {
      const atwater = checkAtwaterValidity(item.nutrients_per_100g);
      const hasNutrients = Number(item.nutrients_per_100g?.calories || 0) > 0 &&
        (item.nutrients_per_100g?.protein != null || item.nutrients_per_100g?.carbohydrates != null || item.nutrients_per_100g?.totalFat != null);
      if (atwater.valid && hasNutrients && (item.provenance === 'food_resolver_agent' || item.provenance === 'food_resolver' || item.provenance === 'resolver_candidate' || (item.confidence && item.confidence >= 0.7))) {
        newStatus = 'active';
        recordSyncEvent({
          event_type: 'auto_promote',
          payload: { food_key: finalKey, food_id: item.food_id }
        }).catch(() => {});
      } else if (!atwater.valid) {
        newStatus = 'quarantine';
      }
    }

    const upRes = await d1Query(
      `INSERT INTO food_items (food_id, food_key, display_name, nutrients_per_100g, fdc_id, form_tags, state, status, capture_count, confidence, provenance, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(food_id) DO UPDATE SET
         food_key = excluded.food_key,
         display_name = excluded.display_name,
         nutrients_per_100g = excluded.nutrients_per_100g,
         fdc_id = excluded.fdc_id,
         form_tags = excluded.form_tags,
         state = excluded.state,
         status = excluded.status,
         capture_count = excluded.capture_count,
         confidence = excluded.confidence,
         provenance = excluded.provenance,
         updated_at = excluded.updated_at`,
      [
        item.food_id,
        finalKey,
        item.display_name,
        JSON.stringify(item.nutrients_per_100g),
        item.fdc_id || null,
        JSON.stringify(item.form_tags || []),
        item.state || null,
        newStatus,
        captureCount,
        item.confidence ?? 0.5,
        item.provenance || 'resolver_candidate',
      ]
    );

    if (!upRes.success) return { success: false, error: upRes.error };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export function checkAtwaterValidity(nutrients: Record<string, number>): { valid: boolean; diffRatio: number } {
  if (!nutrients) return { valid: true, diffRatio: 0 };
  const statedCals = Number(nutrients.calories || 0);
  const p = Number(nutrients.protein || 0);
  const c = Number(nutrients.carbohydrates || nutrients.carbs || 0);
  const f = Number(nutrients.totalFat || nutrients.fat || 0);
  const calcCals = p * 4 + c * 4 + f * 9;

  if (statedCals <= 20 && calcCals <= 20) {
    return { valid: true, diffRatio: 0 };
  }

  if (statedCals > 0 && calcCals === 0) {
    return { valid: false, diffRatio: 1.0 };
  }

  const diff = Math.abs(statedCals - calcCals);
  const ratio = statedCals > 0 ? diff / statedCals : 1.0;

  return {
    valid: ratio <= 0.35,
    diffRatio: ratio
  };
}

// F-4: measured alias hit rate + gated near-dup merges (dups gated, not silently merged).
export function computeAliasHitRate(rows: Array<{ hit_count?: number | null }>): {
  total: number;
  hitAliases: number;
  totalHits: number;
  hitRate: number;
} {
  const total = rows.length;
  let hitAliases = 0;
  let totalHits = 0;
  for (const r of rows) {
    const n = Number(r?.hit_count || 0);
    if (n > 0) hitAliases += 1;
    if (Number.isFinite(n) && n > 0) totalHits += n;
  }
  return { total, hitAliases, totalHits, hitRate: total > 0 ? hitAliases / total : 0 };
}

export interface NearDupCandidate {
  food_key?: string;
  display_name?: string;
  fdc_id?: string | null;
  nutrients_per_100g?: Record<string, number> | null;
}

function nearDupNameSim(a: string, b: string): number {
  const ta = new Set(normalizeFoodKey(a).split('_').filter(Boolean));
  const tb = new Set(normalizeFoodKey(b).split('_').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function nearDupCaloriesClose(
  na: Record<string, number> | null | undefined,
  nb: Record<string, number> | null | undefined
): boolean {
  const ca = Number(na?.calories || 0);
  const cb = Number(nb?.calories || 0);
  if (!(ca > 0) || !(cb > 0)) return false;
  return Math.abs(ca - cb) / Math.max(ca, cb) <= 0.35;
}

// NEAR_DUP_CLUSTER per FOOD.md 7.2: same fdc_id OR (high name sim + Atwater-close pair).
export function isNearDupCluster(a: NearDupCandidate, b: NearDupCandidate): { cluster: boolean; reason: string } {
  const fa = String(a?.fdc_id || '').trim();
  const fb = String(b?.fdc_id || '').trim();
  if (fa && fb && fa === fb) return { cluster: true, reason: 'same_fdc_id' };
  const sim = nearDupNameSim(String(a?.display_name || a?.food_key || ''), String(b?.display_name || b?.food_key || ''));
  const close = nearDupCaloriesClose(a?.nutrients_per_100g, b?.nutrients_per_100g);
  if (sim >= 0.5 && close) return { cluster: true, reason: `name_sim_${sim.toFixed(2)}_kcal_close` };
  return { cluster: false, reason: `name_sim_${sim.toFixed(2)}_kcal_${close ? 'close' : 'far'}` };
}

export const DEFAULT_CATEGORY_PROFILES: Record<string, Record<string, number>> = {
  leafy_greens: {
    calories: 20, protein: 1.5, carbohydrates: 3.5, totalFat: 0.2, saturatedFat: 0.03, unsaturatedFat: 0.15,
    sugar: 1.2, addedSugar: 0, totalFibre: 2.0, solubleFibre: 0.4, sodium: 25,
    potassium: 250, magnesium: 15, calcium: 40, iron: 1.0, zinc: 0.3, phosphorus: 30, selenium: 0.6, iodine: 3,
    vitaminA: 150, vitaminC: 15, vitaminK: 120, vitaminE: 0.5, folate: 60, vitaminB6: 0.08, thiamine: 0.05, riboflavin: 0.07, niacin: 0.4, vitaminD: 0, vitaminB12: 0
  },
  berries: {
    calories: 50, protein: 1.0, carbohydrates: 12.0, totalFat: 0.4, saturatedFat: 0.05, unsaturatedFat: 0.35,
    sugar: 7.5, addedSugar: 0, totalFibre: 4.5, solubleFibre: 0.9, sodium: 2,
    potassium: 160, magnesium: 18, calcium: 25, iron: 0.6, zinc: 0.3, phosphorus: 25, selenium: 0.5, iodine: 2,
    vitaminC: 25, vitaminA: 5, vitaminE: 0.7, vitaminK: 15, folate: 24, vitaminB6: 0.06, thiamine: 0.03, riboflavin: 0.04, niacin: 0.5, vitaminD: 0, vitaminB12: 0
  },
  dressing: {
    calories: 430, protein: 1.5, carbohydrates: 6.5, totalFat: 45.0, saturatedFat: 7.0, unsaturatedFat: 36.0,
    sugar: 3.5, addedSugar: 2.5, totalFibre: 0.2, solubleFibre: 0, sodium: 850,
    potassium: 75, calcium: 35, magnesium: 5, phosphorus: 40, iron: 0.3, zinc: 0.2, selenium: 1.5, iodine: 5,
    vitaminE: 3.5, vitaminK: 45, vitaminA: 20, vitaminB12: 0.1, vitaminB6: 0.02, folate: 6, riboflavin: 0.03, niacin: 0.1, thiamine: 0.02, vitaminC: 0.5, vitaminD: 0.1
  },
  seasoning: {
    calories: 2, protein: 0.1, carbohydrates: 0.5, totalFat: 0, saturatedFat: 0, unsaturatedFat: 0,
    sugar: 0, addedSugar: 0, totalFibre: 0.2, solubleFibre: 0, sodium: 3800,
    potassium: 10, calcium: 15, magnesium: 2, phosphorus: 2, iron: 0.1, zinc: 0.05, selenium: 0.1, iodine: 5,
    vitaminC: 0, vitaminA: 0, folate: 0, vitaminK: 0, vitaminE: 0, vitaminB6: 0, thiamine: 0, riboflavin: 0, niacin: 0, vitaminB12: 0, vitaminD: 0
  },
  seaweed_salad: {
    calories: 85, protein: 1.5, carbohydrates: 8.5, totalFat: 6.0, saturatedFat: 1.0, unsaturatedFat: 5.0,
    sugar: 3.0, addedSugar: 2.0, totalFibre: 1.5, solubleFibre: 0.3, sodium: 650,
    potassium: 150, calcium: 50, magnesium: 30, phosphorus: 40, iron: 1.0, zinc: 0.3, selenium: 1.0, iodine: 50,
    vitaminC: 5.0, vitaminA: 100, folate: 40, vitaminK: 80, vitaminE: 1.5, vitaminB6: 0.05, thiamine: 0.03, riboflavin: 0.05, niacin: 0.5, vitaminB12: 0.1, vitaminD: 0
  },
  sweet_spread: {
    calories: 250, protein: 0.4, carbohydrates: 65.0, totalFat: 0.1, saturatedFat: 0.02, unsaturatedFat: 0.08,
    sugar: 49.0, addedSugar: 40.0, totalFibre: 1.0, solubleFibre: 0.2, sodium: 15,
    potassium: 75, calcium: 15, magnesium: 5, phosphorus: 10, iron: 0.2, zinc: 0.1, selenium: 0.5, iodine: 1,
    folate: 5, vitaminC: 8.0, vitaminA: 5, vitaminB6: 0.02, vitaminB12: 0, thiamine: 0.01, riboflavin: 0.01, niacin: 0.2, vitaminE: 0.1, vitaminK: 1.0, vitaminD: 0
  },
  fat_spread: {
    calories: 620, protein: 0.5, carbohydrates: 0.5, totalFat: 68.0, saturatedFat: 42.0, unsaturatedFat: 24.0,
    sugar: 0.3, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 550,
    potassium: 25, calcium: 20, magnesium: 2, phosphorus: 15, iron: 0.05, zinc: 0.1, selenium: 0.3, iodine: 2,
    vitaminA: 600, vitaminD: 1.0, vitaminE: 2.0, vitaminK: 5.0, vitaminB12: 0, folate: 0, vitaminB6: 0, thiamine: 0, riboflavin: 0, niacin: 0, vitaminC: 0
  },
  oil_unsaturated: {
    calories: 884, protein: 0, carbohydrates: 0, totalFat: 100.0, saturatedFat: 9.0, unsaturatedFat: 91.0,
    sugar: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 0,
    potassium: 0, calcium: 0, magnesium: 0, phosphorus: 0, iron: 0, zinc: 0, selenium: 0, iodine: 0,
    vitaminA: 0, vitaminD: 0, vitaminE: 17.0, vitaminK: 25.0, vitaminB12: 0, folate: 0, vitaminB6: 0, thiamine: 0, riboflavin: 0, niacin: 0, vitaminC: 0
  },
  oil_saturated: {
    calories: 862, protein: 0, carbohydrates: 0, totalFat: 100.0, saturatedFat: 82.0, unsaturatedFat: 18.0,
    sugar: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 0,
    potassium: 0, calcium: 0, magnesium: 0, phosphorus: 0, iron: 0.04, zinc: 0, selenium: 0, iodine: 0,
    vitaminA: 0, vitaminD: 0, vitaminE: 0.5, vitaminK: 0.5, vitaminB12: 0, folate: 0, vitaminB6: 0, thiamine: 0, riboflavin: 0, niacin: 0, vitaminC: 0
  },
  jelly_dessert: {
    calories: 85, protein: 1.5, carbohydrates: 19.0, totalFat: 0.1, saturatedFat: 0, unsaturatedFat: 0.05,
    sugar: 16.0, addedSugar: 14.0, totalFibre: 0.3, solubleFibre: 0.1, sodium: 55,
    potassium: 30, calcium: 8, magnesium: 2, phosphorus: 10, iron: 0.2, zinc: 0.1, selenium: 0.5, iodine: 1,
    vitaminC: 1.0, vitaminA: 3, folate: 1, vitaminK: 0.1, vitaminE: 0.05, vitaminB6: 0.01, thiamine: 0.01, riboflavin: 0.02, niacin: 0.05, vitaminB12: 0, vitaminD: 0
  },
  mousse_dessert: {
    calories: 220, protein: 4.5, carbohydrates: 24.0, totalFat: 12.5, saturatedFat: 7.5, unsaturatedFat: 4.5,
    sugar: 20.0, addedSugar: 16.0, totalFibre: 1.2, solubleFibre: 0.3, sodium: 80,
    potassium: 190, calcium: 90, iron: 1.2, magnesium: 28, phosphorus: 110, zinc: 0.6, selenium: 4.0, iodine: 15,
    vitaminA: 85, vitaminD: 0.4, vitaminE: 0.6, vitaminK: 1.5, vitaminC: 0.5, folate: 18, vitaminB12: 0.35, vitaminB6: 0.05, thiamine: 0.04, riboflavin: 0.18, niacin: 0.4
  },
  produce: {
    calories: 40, protein: 1.0, carbohydrates: 9.0, totalFat: 0.2, saturatedFat: 0.05, unsaturatedFat: 0.15,
    sugar: 6.0, addedSugar: 0, totalFibre: 2.2, solubleFibre: 0.5, sodium: 10,
    potassium: 200, calcium: 25, magnesium: 15, phosphorus: 25, iron: 0.5, zinc: 0.2, selenium: 0.5, iodine: 2,
    vitaminC: 15, vitaminA: 30, folate: 25, vitaminK: 10, vitaminE: 0.4, vitaminB6: 0.08, thiamine: 0.04, riboflavin: 0.04, niacin: 0.5, vitaminB12: 0, vitaminD: 0
  },
  meat: {
    calories: 210, protein: 24.0, carbohydrates: 0, totalFat: 12.0, saturatedFat: 4.5, unsaturatedFat: 6.5,
    sugar: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 65,
    potassium: 310, phosphorus: 200, magnesium: 22, zinc: 4.5, iron: 2.2, selenium: 25, calcium: 12, iodine: 8,
    vitaminB12: 2.2, niacin: 5.5, vitaminB6: 0.4, riboflavin: 0.2, thiamine: 0.1, folate: 8, vitaminA: 5, vitaminE: 0.2, vitaminK: 1.2, vitaminD: 0.1, vitaminC: 0
  },
  poultry: {
    calories: 165, protein: 31.0, carbohydrates: 0, totalFat: 3.6, saturatedFat: 1.0, unsaturatedFat: 2.3,
    sugar: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 74,
    potassium: 256, magnesium: 29, calcium: 15, iron: 1.0, zinc: 1.0, phosphorus: 228, selenium: 27.6, iodine: 10,
    vitaminB6: 0.6, vitaminB12: 0.34, niacin: 13.7, riboflavin: 0.12, thiamine: 0.07, folate: 4, vitaminA: 6, vitaminD: 0.1, vitaminE: 0.3, vitaminK: 0.3, vitaminC: 0
  },
  fish: {
    calories: 140, protein: 20.0, carbohydrates: 0, totalFat: 6.0, saturatedFat: 1.2, unsaturatedFat: 4.5, omega3: 1.2,
    sugar: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 60,
    potassium: 380, phosphorus: 240, magnesium: 30, calcium: 15, iron: 0.8, zinc: 0.6, selenium: 36.5, iodine: 40,
    vitaminB12: 3.0, vitaminD: 4.5, niacin: 8.5, vitaminB6: 0.5, riboflavin: 0.15, thiamine: 0.1, folate: 10, vitaminA: 25, vitaminE: 1.0, vitaminK: 0.5, vitaminC: 0
  },
  egg: {
    calories: 155, protein: 12.6, carbohydrates: 1.1, totalFat: 10.6, saturatedFat: 3.3, unsaturatedFat: 6.5,
    sugar: 1.1, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 124,
    potassium: 126, magnesium: 10, calcium: 50, iron: 1.2, zinc: 1.1, phosphorus: 172, selenium: 30.8, iodine: 49,
    vitaminA: 149, vitaminD: 2.2, vitaminE: 1.0, vitaminB12: 1.1, riboflavin: 0.5, folate: 44, vitaminB6: 0.12, thiamine: 0.07, niacin: 0.06, vitaminK: 0.3, vitaminC: 0
  },
  nuts_seeds: {
    calories: 580, protein: 20.0, carbohydrates: 20.0, totalFat: 50.0, saturatedFat: 7.0, unsaturatedFat: 41.0,
    sugar: 4.5, addedSugar: 0, totalFibre: 8.0, solubleFibre: 1.5, sodium: 5,
    potassium: 600, magnesium: 220, calcium: 100, iron: 3.5, zinc: 3.2, phosphorus: 450, selenium: 10, iodine: 2,
    vitaminE: 12.0, folate: 80, vitaminB6: 0.3, thiamine: 0.4, riboflavin: 0.2, niacin: 3.0, vitaminK: 5.0, vitaminA: 2, vitaminB12: 0, vitaminC: 0.5, vitaminD: 0
  },
  dairy: {
    calories: 60, protein: 3.2, carbohydrates: 4.8, totalFat: 3.2, saturatedFat: 2.0, unsaturatedFat: 1.0,
    sugar: 4.8, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 45,
    potassium: 145, calcium: 120, magnesium: 11, phosphorus: 95, zinc: 0.4, selenium: 3.5, iodine: 30, iron: 0.05,
    vitaminB12: 0.45, riboflavin: 0.18, vitaminA: 35, vitaminD: 1.2, folate: 5, vitaminB6: 0.04, thiamine: 0.04, niacin: 0.1, vitaminC: 1.0, vitaminE: 0.05, vitaminK: 0.2
  },
  cheese: {
    calories: 300, protein: 18.0, carbohydrates: 2.0, totalFat: 24.0, saturatedFat: 15.0, unsaturatedFat: 7.5,
    sugar: 1.5, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 750,
    calcium: 450, phosphorus: 320, potassium: 70, magnesium: 15, zinc: 2.8, selenium: 14, iron: 0.4, iodine: 30,
    vitaminA: 180, vitaminB12: 1.4, riboflavin: 0.4, folate: 20, vitaminB6: 0.06, thiamine: 0.03, niacin: 0.2, vitaminD: 0.4, vitaminE: 0.3, vitaminK: 2.0, vitaminC: 0
  },
  beverage: {
    calories: 0, protein: 0, carbohydrates: 0, totalFat: 0, saturatedFat: 0, unsaturatedFat: 0,
    sugar: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 5,
    potassium: 10, calcium: 5, magnesium: 2, phosphorus: 0, iron: 0, zinc: 0, selenium: 0, iodine: 0,
    vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0, folate: 0, vitaminB6: 0, thiamine: 0, riboflavin: 0, niacin: 0, vitaminE: 0, vitaminK: 0
  },
  starch: {
    calories: 130, protein: 2.7, carbohydrates: 28.0, totalFat: 0.3, saturatedFat: 0.1, unsaturatedFat: 0.15,
    sugar: 0.5, addedSugar: 0, totalFibre: 1.5, solubleFibre: 0.3, sodium: 2,
    potassium: 120, magnesium: 25, phosphorus: 60, calcium: 10, iron: 0.8, zinc: 0.7, selenium: 8.0, iodine: 2,
    thiamine: 0.15, niacin: 1.5, riboflavin: 0.03, vitaminB6: 0.1, folate: 35, vitaminE: 0.1, vitaminK: 0.2, vitaminA: 0, vitaminB12: 0, vitaminC: 0, vitaminD: 0
  },
  cereal: {
    calories: 420, protein: 12.0, carbohydrates: 65.0, totalFat: 12.0, saturatedFat: 2.5, unsaturatedFat: 9.0,
    sugar: 16.0, addedSugar: 10.0, totalFibre: 7.5, solubleFibre: 2.2, sodium: 120,
    potassium: 350, magnesium: 95, phosphorus: 260, iron: 3.5, zinc: 2.5, calcium: 60, selenium: 15, iodine: 5,
    thiamine: 0.4, riboflavin: 0.3, niacin: 4.0, vitaminB6: 0.3, folate: 60, vitaminE: 2.0, vitaminB12: 0, vitaminC: 0.5, vitaminA: 10, vitaminD: 0, vitaminK: 2
  },
  legume: {
    calories: 160, protein: 8.5, carbohydrates: 25.0, totalFat: 3.0, saturatedFat: 0.4, unsaturatedFat: 2.3,
    sugar: 2.0, addedSugar: 0, totalFibre: 7.0, solubleFibre: 2.0, sodium: 200,
    potassium: 320, magnesium: 45, phosphorus: 140, calcium: 45, iron: 2.5, zinc: 1.4, selenium: 4.0, iodine: 3,
    folate: 120, thiamine: 0.12, vitaminB6: 0.15, riboflavin: 0.06, niacin: 0.8, vitaminE: 0.5, vitaminK: 5.0, vitaminA: 5, vitaminB12: 0, vitaminC: 1.0, vitaminD: 0
  },
  pastry: {
    calories: 410, protein: 8.0, carbohydrates: 46.0, totalFat: 21.0, saturatedFat: 12.0, unsaturatedFat: 8.0,
    sugar: 11.0, addedSugar: 6.5, totalFibre: 2.5, solubleFibre: 0.5, sodium: 450,
    potassium: 120, calcium: 40, iron: 2.2, magnesium: 16, phosphorus: 105, zinc: 0.8, selenium: 18.0, iodine: 12,
    thiamine: 0.35, riboflavin: 0.22, niacin: 2.4, folate: 70, vitaminA: 190, vitaminB6: 0.05, vitaminB12: 0.16, vitaminE: 0.9, vitaminK: 3.5, vitaminD: 0.2, vitaminC: 0.2
  },
  dessert: {
    calories: 450, protein: 5.0, carbohydrates: 55.0, totalFat: 24.0, saturatedFat: 12.0, unsaturatedFat: 10.5,
    sugar: 35.0, addedSugar: 30.0, totalFibre: 2.0, solubleFibre: 0.4, sodium: 200,
    potassium: 160, calcium: 60, iron: 1.8, magnesium: 25, phosphorus: 90, zinc: 0.7, selenium: 8.0, iodine: 10,
    thiamine: 0.15, riboflavin: 0.18, niacin: 1.2, folate: 35, vitaminA: 90, vitaminB6: 0.04, vitaminB12: 0.2, vitaminE: 0.8, vitaminK: 2.5, vitaminD: 0.1, vitaminC: 0.2
  },
  pickle: {
    calories: 15, protein: 0.5, carbohydrates: 2.5, totalFat: 0.2, saturatedFat: 0.05, unsaturatedFat: 0.1,
    sugar: 1.2, addedSugar: 0, totalFibre: 1.0, solubleFibre: 0.3, sodium: 800,
    potassium: 130, calcium: 40, iron: 0.4, magnesium: 10, phosphorus: 14, zinc: 0.2, selenium: 0.5, iodine: 1.0,
    vitaminC: 1.0, vitaminA: 15, folate: 10, vitaminK: 30.0, thiamine: 0.02, riboflavin: 0.02, niacin: 0.1, vitaminB6: 0.03, vitaminB12: 0.01, vitaminD: 0.01, vitaminE: 0.1
  },
  crispy_topping: {
    calories: 560, protein: 6.0, carbohydrates: 45.0, totalFat: 40.0, saturatedFat: 9.0, unsaturatedFat: 31.0,
    sugar: 4.0, addedSugar: 1.0, totalFibre: 3.5, solubleFibre: 0.8, sodium: 800,
    potassium: 200, calcium: 30, magnesium: 20, phosphorus: 70, iron: 1.8, zinc: 0.6, selenium: 5.0, iodine: 5,
    folate: 20, vitaminC: 2.0, vitaminA: 10, vitaminB6: 0.1, vitaminB12: 0.1, thiamine: 0.15, riboflavin: 0.1, niacin: 1.5, vitaminE: 3.5, vitaminK: 5.0, vitaminD: 0
  },
  general_dish: {
    calories: 150, protein: 7.0, carbohydrates: 18.0, totalFat: 5.5, saturatedFat: 1.8, unsaturatedFat: 3.2,
    sugar: 3.5, addedSugar: 1.0, totalFibre: 2.0, solubleFibre: 0.5, sodium: 320,
    potassium: 220, calcium: 40, magnesium: 20, phosphorus: 90, iron: 1.2, zinc: 0.8, selenium: 8.0, iodine: 10,
    folate: 25, vitaminC: 4.0, vitaminA: 35, vitaminB6: 0.12, vitaminB12: 0.3, thiamine: 0.08, riboflavin: 0.08, niacin: 1.2, vitaminE: 0.6, vitaminK: 8.0, vitaminD: 0.1
  }
};

export function getFallbackCategoryProfile(query: string): Record<string, number> {
  const q = (query || '').toLowerCase();
  let base: Record<string, number> = { ...DEFAULT_CATEGORY_PROFILES.general_dish };
  if (/\b(beverage|drink|water|tea|coffee|soda)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.beverage };
  else if (/\b(seaweed\s*salad|wakame|goma\s*wakame)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.seaweed_salad };
  else if (/\b(crispy\s*onion|fried\s*onion|french\s*fried\s*onion|croutons?|crispy\s*shallots?|fried\s*shallots?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.crispy_topping };
  else if (/\b(gherkins?|pickles?|pickled|cornichons?|relish)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.pickle };
  else if (/\b(ranch|dressing|vinaigrette|mayo|mayonnaise|sauce|caesar|condiment|gravy|aioli|dip|pesto)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.dressing };
  else if (/\b(jams?|preserves?|marmalades?|fruit\s*spreads?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.sweet_spread };
  else if (/\b(berr(?:y|ies)|strawberr(?:y|ies)|blueberr(?:y|ies)|raspberr(?:y|ies)|blackberr(?:y|ies)|cranberr(?:y|ies)|acai)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.berries };
  else if (/\b(salads?|mix\s*leaves|mixed\s*leaves|salad\s*leaves|lettuce|spinach|kale|arugula|greens|romaine|cabbage|slaw|watercress|bok\s*choy|pak\s*choi|caisim|choy\s*sum|gai\s*lan|chinese\s*greens)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.leafy_greens };
  else if (/\b(gelatin|jell-?o|jelly|jellies)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.jelly_dessert };
  else if (/\b(mousse|mousses)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.mousse_dessert };
  else if (/\b(salt|seasoning|spice|spices|pepper\s*flakes?|iodized)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.seasoning };
  else if (/\b(scallions?|spring\s*onions?|green\s*onions?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.produce };
  else if (/\b(spreadable|margarine|ghee)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.fat_spread };
  else if (/\b(coconut\s*oil|palm\s*oil|palm\s*kernel\s*oil|lard|shortening)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.oil_saturated };
  else if (/\b(oil|oils|canola|olive\s*oil|vegetable\s*oil|sunflower\s*oil|soybean\s*oil|corn\s*oil|rapeseed\s*oil|peanut\s*oil|sesame\s*oil|frying\s*oil|cooking\s*oil|grapeseed\s*oil|avocado\s*oil)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.oil_unsaturated };
  else if (/\b(brownies?|cakes?|cookies?|chocolates?|cand(?:y|ies)|pies?|tarts?|fudge|desserts?|sweets?|biscuits?|puddings?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.dessert };
  else if (/\b(croissants?|pastr(?:y|ies)|danish(?:es)?|muffins?|donuts?|doughnuts?|brioche|scones?|puffs?|bakery|bakeries|roll|swirl)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.pastry };
  else if (/\b(eggs?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.egg };
  else if (/\b(chicken|turkey|poultry)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.poultry };
  else if (/\b(fish|salmon|tuna|cod|shrimp|prawns?|seafood)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.fish };
  else if (/\b(beef|pork|steak|lamb|mutton|meat|bacon|empal|daging|blade|chuck|brisket|ribeye|sirloin|tenderloin|short\s*plate)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.meat };
  else if (/\b(feta|cheddar|mozzarella|parmesan|cheese)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.cheese };
  else if (/\b(butter)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.fat_spread };
  else if (/\b(milk|yogurt|yoghurt|greek|cream|dairy)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.dairy };
  else if (/\b(oats?|oatmeal|porridge|rolled\s*oats?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.cereal, sugar: 1.0, totalFibre: 10.0 };
  else if (/\b(granola|muesli|cereals?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.cereal };
  else if (/\b(chickpeas?|hummus|lentils?|beans?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.legume };
  else if (/\b(rice|bread|baguettes?|pasta|potatoe?s?|noodles?|starch)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.starch };
  else if (/\b(sesame|almonds?|walnuts?|cashews?|pistachios?|peanuts?|pecans?|hazelnuts?|seeds?|nuts?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.nuts_seeds };
  else if (/\b(cucumbers?|tomatoe?s?|apples?|bananas?|carrots?|olives?|broccoli|vegetables?|fruits?|produce|clementines?|oranges?|citrus|mandarins?|tangerines?|lemons?|limes?|grapefruits?|grapes?|peaches?|plums?|pears?|mangoes?|mangos?|kiwis?|pineapples?|melons?|watermelons?|cantaloupes?|honeydews?|nectarines?|apricots?|cherries|cherry|figs?|dates?|raisins?|avocados?|onions?|peppers?|garlics?|mushrooms?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.produce };

  const fullProfile: Record<string, number> = {};
  for (const k of NUTRIENT_KEYS) {
    fullProfile[k] = base[k] ?? 0;
  }
  return fullProfile;
}

const EMPTY_CATALOG_SYNC = {
  success: true,
  food_items: { total: 0, active: 0, candidate: 0 },
  dish_cache: { total: 0, active: 0 },
  open_deferred_gaps: 0,
  sync_failures: 0,
  resolver_call_count: 0,
  latest_sync_events: [] as any[],
};

export async function getCatalogSyncStatus(): Promise<any> {
  // D-2: D1-only metrics computed inline (real gap/failure/event counts).
  if (!isD1Configured()) {
    return { ...EMPTY_CATALOG_SYNC, offline: true };
  }
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    const count = async (sql: string, params: any[] = []): Promise<number> => {
      const r = await d1Query<any>(sql, params);
      return Number(r.results?.[0]?.n || 0);
    };
    const foodTotal = await count('SELECT COUNT(*) AS n FROM food_items');
    const foodActive = await count("SELECT COUNT(*) AS n FROM food_items WHERE status = 'active'");
    const foodCandidate = await count("SELECT COUNT(*) AS n FROM food_items WHERE status = 'candidate'");

    const dishTotal = await count('SELECT COUNT(*) AS n FROM dish_cache');
    const dishActive = await count("SELECT COUNT(*) AS n FROM dish_cache WHERE status = 'active'");

    const deferredGaps = await count("SELECT COUNT(*) AS n FROM food_observations WHERE event_type = 'deferred_gap'");
    const resolverCalls = await count("SELECT COUNT(*) AS n FROM food_observations WHERE event_type IN ('resolver_invoked', 'deferred_gap', 'food_resolver')");

    const syncEvts = await d1Query<any>('SELECT event_type FROM food_catalog_sync_events');
    const realFailures = ((syncEvts.results || []) as any[]).filter((e: any) => /fail|_failure/i.test(e.event_type || '')).length;

    const latestRes = await d1Query<any>('SELECT * FROM food_catalog_sync_events ORDER BY created_at DESC LIMIT 10');
    const latestEvents = latestRes.results || [];

    return {
      success: true,
      food_items: { total: foodTotal || 0, active: foodActive || 0, candidate: foodCandidate || 0 },
      dish_cache: { total: dishTotal || 0, active: dishActive || 0 },
      open_deferred_gaps: deferredGaps || 0,
      sync_failures: realFailures,
      resolver_call_count: resolverCalls || 0,
      latest_sync_events: latestEvents || []
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (/schema cache|does not exist|Could not find the table/i.test(msg)) {
      console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema");
      resetFoodCatalogSchemaEnsure();
      return { ...EMPTY_CATALOG_SYNC, schemaMissing: true };
    }
    return { success: false, error: msg };
  }
}

export async function mergeFoodCatalogItems(
  sourceKeyOrParams: string | { source_id?: string; target_id?: string; sourceKey?: string; targetKey?: string; form_tags_source?: string[]; form_tags_target?: string[] },
  targetKeyParam?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    let sourceKey = '';
    let targetKey = '';
    let passedSourceTags: string[] = [];
    let passedTargetTags: string[] = [];

    if (typeof sourceKeyOrParams === 'object' && sourceKeyOrParams !== null) {
      sourceKey = sourceKeyOrParams.source_id || sourceKeyOrParams.sourceKey || '';
      targetKey = sourceKeyOrParams.target_id || sourceKeyOrParams.targetKey || '';
      passedSourceTags = sourceKeyOrParams.form_tags_source || [];
      passedTargetTags = sourceKeyOrParams.form_tags_target || [];
    } else {
      sourceKey = String(sourceKeyOrParams || '');
      targetKey = String(targetKeyParam || '');
    }

    const normSource = normalizeFoodKey(sourceKey);
    const normTarget = normalizeFoodKey(targetKey);

    if (!normSource || !normTarget) {
      return { success: false, error: 'Source and target keys required' };
    }

    // Check explicitly passed tags first
    const sourceHasBar = passedSourceTags.includes('bar');
    const targetHasBar = passedTargetTags.includes('bar');
    const sourceHasLoose = passedSourceTags.includes('loose') || passedSourceTags.includes('loose/cup');
    const targetHasLoose = passedTargetTags.includes('loose') || passedTargetTags.includes('loose/cup');

    if ((sourceHasBar && targetHasLoose) || (sourceHasLoose && targetHasBar)) {
      return { success: false, error: 'Refused merge: Incompatible physical form tags (bar vs loose/cup)' };
    }

    if (!isD1Configured()) {
      return { success: true, message: 'Offline mode: merge skipped' };
    }

    const srcRes = await d1Query<any>('SELECT * FROM food_items WHERE food_key = ? LIMIT 1', [normSource]);
    const tgtRes = await d1Query<any>('SELECT * FROM food_items WHERE food_key = ? LIMIT 1', [normTarget]);
    const parseItem = (r: any): any => {
      if (!r) return r;
      return {
        ...r,
        nutrients_per_100g: typeof r.nutrients_per_100g === 'string' ? safeJsonParse(r.nutrients_per_100g, {}) : (r.nutrients_per_100g || {}),
        form_tags: Array.isArray(r.form_tags) ? r.form_tags : (typeof r.form_tags === 'string' ? safeJsonParse(r.form_tags, []) : []),
      };
    };
    const sourceItem = parseItem(srcRes.results?.[0]);
    const targetItem = parseItem(tgtRes.results?.[0]);

    if (sourceItem && targetItem) {
      const sourceTags = [...(sourceItem.form_tags || []), ...passedSourceTags];
      const targetTags = [...(targetItem.form_tags || []), ...passedTargetTags];
      const sourceIsBar = sourceTags.includes('bar') || /\bbar\b/i.test(sourceItem.display_name || '');
      const targetIsBar = targetTags.includes('bar') || /\bbar\b/i.test(targetItem.display_name || '');
      const sourceIsLoose = sourceTags.includes('loose') || sourceTags.includes('loose/cup') || /\b(loose|bowl|cup)\b/i.test(sourceItem.display_name || '');
      const targetIsLoose = targetTags.includes('loose') || targetTags.includes('loose/cup') || /\b(loose|bowl|cup)\b/i.test(targetItem.display_name || '');

      if ((sourceIsBar && targetIsLoose) || (sourceIsLoose && targetIsBar)) {
        return { success: false, error: 'Refused merge: Incompatible physical form tags (bar vs loose/cup)' };
      }

      // F-4: gate silent merges — both rows loaded with names + kcal means we can
      // demand a NEAR_DUP_CLUSTER (same fdc_id OR name-sim + kcal-close). Missing
      // data fails open for admin; clear non-dups are refused, not silently merged.
      const hasNames = Boolean(sourceItem.display_name || sourceItem.food_key)
        && Boolean(targetItem.display_name || targetItem.food_key);
      const hasKcal = Number(sourceItem.nutrients_per_100g?.calories || 0) > 0
        && Number(targetItem.nutrients_per_100g?.calories || 0) > 0;
      if (hasNames && hasKcal) {
        const dup = isNearDupCluster(
          {
            food_key: sourceItem.food_key,
            display_name: sourceItem.display_name,
            fdc_id: sourceItem.fdc_id,
            nutrients_per_100g: sourceItem.nutrients_per_100g,
          },
          {
            food_key: targetItem.food_key,
            display_name: targetItem.display_name,
            fdc_id: targetItem.fdc_id,
            nutrients_per_100g: targetItem.nutrients_per_100g,
          }
        );
        if (!dup.cluster) {
          return { success: false, error: `Refused merge: not a near-duplicate cluster (${dup.reason})` };
        }
      }
    }

    await d1Query(
      `INSERT INTO food_aliases (alias_key, food_id, weight, source) VALUES (?, ?, 1.0, 'admin_merge')
       ON CONFLICT(alias_key) DO UPDATE SET food_id = excluded.food_id, source = excluded.source`,
      [normSource, targetItem?.food_id || normTarget]
    );

    await d1Query(`UPDATE food_items SET status = 'merged', canonical_target_id = ?, updated_at = datetime('now') WHERE food_key = ?`, [
      targetItem?.food_id || normTarget,
      normSource,
    ]);

    await recordSyncEvent({
      event_type: 'item_merged',
      payload: { sourceKey: normSource, targetKey: normTarget }
    });

    return { success: true, message: `Merged ${normSource} into ${normTarget}` };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export async function quarantineAtwaterFailures(): Promise<{ success: boolean; quarantinedCount: number }> {
  try {
    if (!isD1Configured()) return { success: true, quarantinedCount: 0 };
    const candRes = await d1Query<any>(`SELECT food_key, nutrients_per_100g FROM food_items WHERE status = 'candidate' LIMIT 500`);
    const items = (candRes.results || []) as any[];
    let count = 0;
    if (items && items.length > 0) {
      for (const item of items) {
        const nuts = typeof item.nutrients_per_100g === 'string' ? safeJsonParse(item.nutrients_per_100g, {}) : (item.nutrients_per_100g || {});
        const { valid } = checkAtwaterValidity(nuts);
        if (!valid) {
          await d1Query(`UPDATE food_items SET status = 'quarantine', updated_at = datetime('now') WHERE food_key = ?`, [item.food_key]);
          count++;
          await recordSyncEvent({
            event_type: 'atwater_quarantine',
            payload: { food_key: item.food_key, nutrients: nuts }
          });
        }
      }
    }
    return { success: true, quarantinedCount: count };
  } catch (err: any) {
    return { success: false, quarantinedCount: 0 };
  }
}

export async function upsertDishCacheCandidate(dish: {
  dish_key: string;
  display_name: string;
  core_nutrients: Record<string, number>;
  basis_type?: string;
  serving_grams?: number;
  confidence?: number;
  provenance?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    if (!isD1Configured()) {
      return { success: true };
    }
    const key = normalizeDishKey(dish.dish_key);
    const upRes = await d1Query(
      `INSERT INTO dish_cache (dish_key, display_name, core_nutrients, basis_type, serving_grams, confidence, provenance, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
       ON CONFLICT(dish_key) DO UPDATE SET
         display_name = excluded.display_name,
         core_nutrients = excluded.core_nutrients,
         basis_type = excluded.basis_type,
         serving_grams = excluded.serving_grams,
         confidence = excluded.confidence,
         provenance = excluded.provenance,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [
        key,
        dish.display_name,
        JSON.stringify(dish.core_nutrients),
        dish.basis_type || 'per_serving',
        dish.serving_grams || 100,
        dish.confidence ?? 0.5,
        dish.provenance || 'resolver_dish_core',
      ]
    );

    if (!upRes.success) return { success: false, error: upRes.error };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export async function recordFoodObservation(obs: {
  idempotency_key?: string;
  event_type: string;
  snapshots?: any;
  payload?: any;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isD1Configured()) return { success: true };
    const id = `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ins = await d1Query(
      `INSERT INTO food_observations (id, idempotency_key, event_type, snapshots, payload) VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        obs.idempotency_key || null,
        obs.event_type,
        obs.snapshots != null ? JSON.stringify(obs.snapshots) : null,
        obs.payload != null ? JSON.stringify(obs.payload) : null,
      ]
    );

    if (!ins.success) return { success: false, error: ins.error };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export async function recordSyncEvent(evt: {
  event_type: string;
  payload?: any;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isD1Configured()) return { success: true };
    const id = `sev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ins = await d1Query(`INSERT INTO food_catalog_sync_events (id, event_type, payload) VALUES (?, ?, ?)`, [
      id,
      evt.event_type,
      evt.payload != null ? JSON.stringify(evt.payload) : null,
    ]);

    if (!ins.success) return { success: false, error: ins.error };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}


export async function searchFoodCatalog(query: string, limitCount = 5): Promise<any[]> {
  if (!isD1Configured()) {
    return [];
  }
  await ensureFoodCatalogSchema();
  try {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    const like = `%${q}%`;

    // First try food_items
    const foodRes = await d1Query<any>(`SELECT * FROM food_items WHERE display_name LIKE ? LIMIT ?`, [like, limitCount]);

    // Then try dish_cache
    const dishRes = await d1Query<any>(`SELECT * FROM dish_cache WHERE display_name LIKE ? LIMIT ?`, [like, limitCount]);

    const norm = (r: any): any => ({
      ...r,
      nutrients_per_100g: typeof r.nutrients_per_100g === 'string' ? safeJsonParse(r.nutrients_per_100g, {}) : (r.nutrients_per_100g || {}),
      core_nutrients: typeof r.core_nutrients === 'string' ? safeJsonParse(r.core_nutrients, {}) : (r.core_nutrients || {}),
    });
    const results = [];
    if (foodRes.success && foodRes.results) {
      results.push(...foodRes.results.map((f: any) => ({ ...norm(f), type: 'food' })));
    }
    if (dishRes.success && dishRes.results) {
      results.push(...dishRes.results.map((d: any) => ({ ...norm(d), type: 'dish' })));
    }

    return results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, limitCount);
  } catch (err) {
    console.error('[searchFoodCatalog] Exception:', err);
    return [];
  }
}
