import { isD1Configured } from './server_d1.js';

let ensurePromise: Promise<{ ok: boolean; method: string; error?: string }> | null = null;

/**
 * Food-catalog schema guard.
 *
 * D1 is the only SQL source of truth (Track D / DATA_PLANE). Its tables
 * (`food_items`, `dish_cache`, `food_cache`, `brand_menu_items`, …) are created
 * by `server_d1_schema.ts`, so there is nothing to self-heal here: when D1 is
 * configured the schema already exists, otherwise the app runs offline/local.
 *
 * The former Supabase PostgREST probe + `DATABASE_URL` DDL path was removed in
 * D-2 (it could only emit an `exceed_egress_quota` 402 once live).
 */
export async function ensureFoodCatalogSchema(): Promise<{ ok: boolean; method: string; error?: string }> {
  if (isD1Configured()) {
    return { ok: true, method: 'd1_mode' };
  }
  return { ok: true, method: 'offline_mode' };
}

/** Kept for callers that reset the memo after a failed ensure (no-op now). */
export function resetFoodCatalogSchemaEnsure() {
  ensurePromise = null;
}
