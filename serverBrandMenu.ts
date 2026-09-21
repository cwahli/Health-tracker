import type { Express, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { inferBasisFromServingText, toPer100g, parseNutrientNumber } from './server_nutrient_basis';
import { runBrandCuratorStage } from './src/server/food/brandCurator.js';
import { isD1Configured, d1Query, safeJsonParse } from './server_d1.js';
import {
  d1GetChainMenuSources,
  d1UpsertChainMenuSource,
  d1DeleteChainMenuSource,
  d1GetBrandMenuItems,
  d1SearchBrandMenuItems,
  d1UpsertBrandMenuItem,
  d1DeleteBrandMenuItem
} from './server_db_d1.js';

function getFirestoreDb() {
  if (getApps().length === 0) {
    initializeApp();
  }
  let dbId: string | undefined = undefined;
  try {
    const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
    dbId = firebaseConfig.firestoreDatabaseId;
  } catch (e) {
    console.warn('Could not read firestoreDatabaseId from firebase-applet-config.json', e);
  }
  return getFirestore(getApps()[0], dbId);
}

export function sanitizeDishTitle(title: string): string {
  if (!title || typeof title !== 'string') return '';
  let cleaned = title.trim();

  // Strip leading portion patterns: 60g, 100g, 100.5g, 200ml, 1.5kg, 2oz, 1/2 cup, 1 cup, 2 servings, 3 slices, 1 bowl, 1 plate, etc.
  cleaned = cleaned.replace(/^\s*(\d+(\.\d+)?|\d+\/\d+)\s*(g|kg|ml|l|oz|lbs?|cups?|pack|pkg|servings?|slices?|pcs?|pieces?|bowls?|mugs?|plates?|tbsps?|tsps?)\b\s*(of\s+)?/gi, '');

  // Strip leading numbers followed by dot/dash/colon/space if followed by text (e.g. "1. Sainsbury oats")
  cleaned = cleaned.replace(/^\s*\d+[\s\-:\–\.]+\s*(?=[a-zA-Z])/, '');

  // Strip trailing portion descriptions like "(60g)", "(100 g)", "(1 serving)"
  cleaned = cleaned.replace(/\s*\(\s*(\d+(\.\d+)?|\d+\/\d+)\s*(g|kg|ml|l|oz|lbs?|cups?|pack|pkg|servings?|slices?|pcs?|pieces?|bowls?|mugs?|plates?|tbsps?|tsps?)\s*\)\s*$/gi, '');

  // Clean up extra spaces or trailing/leading punctuation
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/^[\s,.\-:_]+|[\s,.\-:_]+$/g, '').trim();

  return cleaned || title.trim();
}

export function normalizeDishKey(raw: string): string {
  if (!raw) return '';
  const sanitized = sanitizeDishTitle(raw);
  return sanitized
    .toLowerCase()
    .replace(/\s*\(v[eg]?\)\s*/gi, '') // strip (ve), (v), (vg) diet markers
    .replace(/['']/g, '')               // strip smart apostrophes
    .replace(/[^a-z0-9\s]/g, ' ')       // non-alphanumeric → space
    .replace(/\s+/g, '_')               // spaces → underscore
    .replace(/^_+|_+$/g, '');           // trim leading/trailing underscores
}

export function normalizeChainKey(name: string): string {
  if (!name) return '';
  let str = String(name || '').trim().toLowerCase();
  
  // Remove apostrophes first: "Sainsbury's" -> "sainsburys", "Jack Daniel's" -> "jack daniels"
  str = str.replace(/['’]/g, '');

  // Explicit brand mappings for known chain variants
  if (/\b(sainsbury|sainsbury_s|sainsburys)\b/i.test(str) || str.includes('sainsbury')) return 'sainsbury';
  if (/\b(mcdonald|mcdonald_s|mcdonalds|maccas|麦当劳)\b/i.test(str) || str.includes('mcdonald')) return 'mcdonalds';
  if (/\b(jack_daniel|jack_daniel_s|jack_daniels)\b/i.test(str) || str.includes('jack_daniel') || str.includes('jack daniel')) return 'jack_daniels';
  if (/\b(honi_poke|honipoke)\b/i.test(str)) return 'honi_poke';
  if (/\b(coco_di_mama|cocodimama)\b/i.test(str)) return 'coco_di_mama';
  
  str = str.replace(/[^a-z0-9]+/g, '_');
  str = str.replace(/^_+|_+$/g, '');
  if (str.endsWith('_s')) {
    str = str.slice(0, -2);
  }
  return str;
}

/**
 * Resolves the appropriate photo URL for a brand item from a meal's uploaded photos.
 * Disambiguates multiple photos using sourceImageIndex and prevents false cross-assignment.
 */
export function resolvePhotoForBrandItem(
  imageUrls: string[] | undefined | null,
  sourceImageIndex?: number | null
): string | null {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) return null;

  const validPhotos = imageUrls.map(u => (typeof u === 'string' ? u.trim() : ''));
  const isValidPhoto = (u: string) =>
    Boolean(
      u &&
      !u.startsWith('data:') &&
      u !== '[base64_image_data_truncated]' &&
      (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('/photos/') || u.startsWith('photos/'))
    );

  if (sourceImageIndex != null && Number.isInteger(sourceImageIndex)) {
    if (sourceImageIndex >= 0 && sourceImageIndex < validPhotos.length) {
      const candidate = validPhotos[sourceImageIndex];
      return isValidPhoto(candidate) ? candidate : null;
    }
    return null;
  }

  if (validPhotos.length === 1) {
    const candidate = validPhotos[0];
    return isValidPhoto(candidate) ? candidate : null;
  }

  // Multiple photos without explicit, valid index: return null to avoid cross-contamination
  return null;
}

/**
 * Builds full overwrite fields for a brand menu item from a logged meal's nutrients and photo.
 */
export function buildBrandItemFromMealLog(
  mealData: any,
  chosenPhotoUrl: string,
  customNotes?: string
): Record<string, any> {
  const cal = Number(mealData?.calories);
  const prot = Number(mealData?.protein);
  const carb = Number(mealData?.carbohydrates);
  const fat = Number(mealData?.total_fat ?? mealData?.fat);
  const sat = Number(mealData?.saturated_fat ?? mealData?.saturatedFat);
  const sod = Number(mealData?.sodium);
  const serving = Number(mealData?.portion_grams ?? mealData?.weight_grams ?? mealData?.serving_grams) || 100;
  const notes = customNotes || mealData?.notes || mealData?.composition || '';

  const rawNuts = mealData?.nutrients || {};
  const nutrients = {
    ...rawNuts,
    calories: !isNaN(cal) ? cal : rawNuts.calories,
    protein: !isNaN(prot) ? prot : rawNuts.protein,
    carbohydrates: !isNaN(carb) ? carb : rawNuts.carbohydrates,
    totalFat: !isNaN(fat) ? fat : (rawNuts.totalFat ?? rawNuts.fat),
    saturatedFat: !isNaN(sat) ? sat : rawNuts.saturatedFat,
    sodium: !isNaN(sod) ? sod : rawNuts.sodium,
    salt: !isNaN(sod) ? Number((sod / 400).toFixed(2)) : rawNuts.salt,
  };

  return {
    image_url: chosenPhotoUrl,
    calories: !isNaN(cal) ? cal : null,
    protein: !isNaN(prot) ? prot : null,
    carbohydrates: !isNaN(carb) ? carb : null,
    total_fat: !isNaN(fat) ? fat : null,
    saturated_fat: !isNaN(sat) ? sat : null,
    sodium: !isNaN(sod) ? sod : null,
    serving_grams: serving,
    basis_type: 'per_dish',
    notes: notes || '',
    nutrients,
    updated_at: new Date().toISOString()
  };
}


/**
 * Automatically links a meal photo to a brand catalog item if it does not already have an image.
 */
export async function autoLinkBrandItemPhoto(args: {
  chainKey: string;
  dishNameKey?: string;
  dishName?: string;
  photoUrl: string;
  countryCode?: string;
}): Promise<boolean> {
  const { chainKey, photoUrl, countryCode = 'GB' } = args;
  if (!chainKey || !photoUrl) return false;
  const dishNameKey = args.dishNameKey || (args.dishName ? normalizeDishKey(args.dishName) : '');
  if (!dishNameKey) return false;

  try {
    if (isD1Configured()) {
      const { d1Query } = await import('./server_d1.js');
      const existingRes = await d1Query<any>(
        'SELECT id, image_url FROM brand_menu_items WHERE country_code = ? AND chain_key = ? AND (dish_name_key = ? OR dish_name = ?) LIMIT 1',
        [countryCode, chainKey, dishNameKey, args.dishName || dishNameKey]
      );
      if (!existingRes.success) {
        console.warn('[autoLinkBrandItemPhoto] D1 lookup failed, skipping photo link:', existingRes.error);
        return false;
      }
      const existing = existingRes.results || [];
      if (existing.length > 0 && (!existing[0].image_url || existing[0].image_url.trim() === '')) {
        await d1Query(
          'UPDATE brand_menu_items SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [photoUrl, existing[0].id]
        );
      }
    }
    // D-2: Supabase fallback removed. D1 is the only photo-link path (no 402).
    return true;
  } catch (err) {
    console.warn('[autoLinkBrandItemPhoto] Warning:', err);
    return false;
  }
}

const inFlightRegisterLocks = new Set<string>();

export function isUnofficialOrCompositeDish(
  dishName: string,
  chainKey?: string,
  provenance?: string,
  notes?: string,
  itemObj?: any
): { isUnofficial: boolean; reason?: string } {
  const name = String(dishName || '').trim();
  if (!name) return { isUnofficial: true, reason: 'Empty dish name' };
  const nameLower = name.toLowerCase();

  const normChain = chainKey ? normalizeChainKey(chainKey) : '';
  if (normChain && ['generic', 'unknown', 'home_cooked', 'estimated', 'none', 'home', 'custom'].includes(normChain)) {
    return { isUnofficial: true, reason: `Non-brand chain key "${chainKey}"` };
  }

  if (itemObj) {
    if (
      itemObj.isDecomposed === true ||
      itemObj.isCustomRecipe === true ||
      itemObj.isEstimated === true ||
      itemObj.isComputed === true ||
      itemObj.isUserPromptCombination === true ||
      itemObj.hasCompositeComponents === true
    ) {
      return { isUnofficial: true, reason: 'Item flagged as computed/decomposed/custom' };
    }

    if (Array.isArray(itemObj.components) && itemObj.components.length > 1) {
      return { isUnofficial: true, reason: `Item has ${itemObj.components.length} decomposed sub-components` };
    }

    const src = String(itemObj.source || '').toLowerCase();
    if (['visual', 'prompt', 'user_prompt', 'user', 'estimate', 'computed'].includes(src)) {
      return { isUnofficial: true, reason: `Item source is "${src}" (not official printed label)` };
    }
  }

  const provStr = String(provenance || '').toLowerCase();
  const notesStr = String(notes || '').toLowerCase();
  if (
    provStr.includes('decomposed') ||
    provStr.includes('user_prompt') ||
    provStr.includes('composite') ||
    provStr.includes('computed') ||
    notesStr.includes('decomposed') ||
    notesStr.includes('user_prompt') ||
    notesStr.includes('composite') ||
    notesStr.includes('computed')
  ) {
    return { isUnofficial: true, reason: 'Provenance or notes indicate composite or computed item' };
  }

  // Check if title starts with portion / weight specification (e.g. "60g Sainsbury oat")
  const leadingPortionRegex = /^\s*(\d+(\.\d+)?|\d+\/\d+)\s*(g|kg|ml|l|oz|lbs?|cups?|pack|pkg|servings?|slices?|pcs?|pieces?|bowls?|mugs?|plates?|tbsps?|tsps?)\b/i;
  if (leadingPortionRegex.test(name)) {
    return { isUnofficial: true, reason: `Title starts with portion size prefix ("${name.match(leadingPortionRegex)?.[0]}")` };
  }

  // Combination/composite modifier phrase (e.g. "oat with milk", "chicken plus rice", "cooked in butter")
  const combinationRegex = /\b(with|plus|\+|\&|and|cooked in|added|decomposed|served with)\s+(milk|butter|egg|cheese|sugar|honey|cream|water|oil|sauce|dressing|topping|side|bread|toast|chips|fries|rice)\b/i;
  if (combinationRegex.test(nameLower)) {
    return { isUnofficial: true, reason: `Title contains composite combination phrase ("${nameLower.match(combinationRegex)?.[0]}")` };
  }

  // Generic/recipe keywords
  const genericKeywordsRegex = /\b(homemade|custom|estimated|decomposed|combined|user_prompt|recipe|approx|approximate|computed|calculated)\b/i;
  if (genericKeywordsRegex.test(nameLower)) {
    return { isUnofficial: true, reason: `Title contains generic recipe/estimation keyword ("${nameLower.match(genericKeywordsRegex)?.[0]}")` };
  }

  return { isUnofficial: false };
}

/**
 * F-11.1 — brand catalog self-clean (Layer 1, TypeScript only).
 *
 * Replaces the old whole-country hard-delete pass. Scope is ONE chain in ONE
 * country, throttled per chain+country, soft-quarantine only (status column —
 * see supabase/migrations/20260913_brand_menu_items_status.sql), and it never
 * touches the row the current meal locked (usedRowIds).
 *
 * Provenance assumption (verify against live rows when Supabase is reachable):
 * every writer marks non-official rows (ocr_auto / ocr_partial / user_prompt /
 * estimate / computed / ...). Unmarked (null/empty) rows are therefore treated
 * as official imports: immune to regex quarantine and preferred in ties.
 */

export type BrandCleanCounts = {
  removedUnofficialCount: number;
  deletedDuplicatesCount: number;
  updatedChainsCount: number;
  details: string[];
};

const CHAIN_CLEAN_THROTTLE_MS = 60 * 60 * 1000; // 1 hour, per chain+country
const chainCleanLastRun = new Map<string, number>();

/** Meal/profile country with documented fallbacks (diary is ID + GB). */
export function resolveMealCountry(userProfile?: any): string {
  const explicit = String(userProfile?.country || userProfile?.countryCode || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  const tz = String(userProfile?.timezone || '');
  if (/jakarta|jayapura|makassar|pontianak/i.test(tz)) return 'ID';
  if (/london/i.test(tz)) return 'GB';
  const lang = String(userProfile?.language || '').toLowerCase();
  if (lang === 'id' || lang.startsWith('id-') || lang === 'in') return 'ID';
  return 'GB'; // legacy default until profiles carry an explicit country
}

function provenanceRank(p: unknown): number {
  const s = String(p || '').toLowerCase();
  if (!s) return 0; // unmarked: presumed official import (see assumption above)
  if (s.includes('official') || s.includes('verified') || s.includes('brand')) return 0;
  if (s.startsWith('ocr')) return 1;
  if (s.includes('user') || s.includes('prompt') || s.includes('estimate') || s.includes('computed')) return 2;
  return 3;
}

function isJunkMarked(p: unknown): boolean {
  const s = String(p || '').toLowerCase();
  return (
    s.includes('user') ||
    s.includes('prompt') ||
    s.includes('estimate') ||
    s.includes('computed') ||
    s.includes('decomposed') ||
    s.includes('composite')
  );
}

/** Official-immune rows: explicit official markers or unmarked (never junk-marked). */
function isProtectedOfficial(p: unknown): boolean {
  const s = String(p || '').toLowerCase();
  if (!s) return true;
  if (isJunkMarked(p)) return false;
  return s.includes('official') || s.includes('verified') || s.includes('brand');
}

export interface ChainCleanArgs {
  legacyDb?: any;
  chainKey: string;
  countryCode?: string;
  usedRowIds?: Array<string | number>;
  dishNameKey?: string | null;
  bindStatus?: 'HIT' | 'MULTI' | 'MISS' | 'SKIPPED' | null;
  candidateIds?: Array<string | number>;
  callLLMFn?: (prompt: string, sysInst: string) => Promise<string>;
  mode?: string;
  onLog?: (msg: string) => void;
  bypassThrottle?: boolean;
}

const EMPTY_COUNTS: BrandCleanCounts = {
  removedUnofficialCount: 0,
  deletedDuplicatesCount: 0,
  updatedChainsCount: 0,
  details: [],
};

export async function cleanBrandChain(args: ChainCleanArgs): Promise<BrandCleanCounts> {
  const chainKey = normalizeChainKey(args.chainKey || '');
  if (!chainKey) return { ...EMPTY_COUNTS };
  const country = String(args.countryCode || 'GB').toUpperCase();
  const log = args.onLog || console.log;
  const scope = `${country}:${chainKey}`;
  const now = Date.now();
  if (!args.bypassThrottle) {
    const last = chainCleanLastRun.get(scope) || 0;
    if (now - last < CHAIN_CLEAN_THROTTLE_MS) return { ...EMPTY_COUNTS };
  }
  // D-2: D1-only. `args.legacyDb` is ignored (legacy callers may still
  // pass it; the admin endpoints stop passing it in the follow-up commit).
  if (!isD1Configured()) {
    log(`[BrandClean] ${scope}: D1 not configured; skipping database clean (no 402).`);
    return { ...EMPTY_COUNTS };
  }

  // D1 brand_menu_items has no capture_count/confidence/provenance columns;
  // those rank inputs default (provenance '' = presumed official import).
  // nutrients arrives as JSON text — parse per row.
  let items: any[];
  try {
    const scanRes = await d1Query<any>(
      `SELECT id, country_code, chain_key, dish_name, dish_name_key, nutrients, notes, updated_at, status
       FROM brand_menu_items WHERE country_code = ? AND chain_key = ? LIMIT 2000`,
      [country, chainKey]
    );
    if (!scanRes.success) throw new Error(scanRes.error || 'D1 scan failed');
    items = (scanRes.results || []).map((r: any) => ({
      ...r,
      nutrients: typeof r.nutrients === 'string' ? safeJsonParse(r.nutrients, {}) : (r.nutrients || {}),
    }));
  } catch (e: any) {
    log(`[BrandClean] ${scope}: cannot scan (${e?.message || e}).`);
    return { ...EMPTY_COUNTS };
  }
  chainCleanLastRun.set(scope, now);

  const used = new Set((args.usedRowIds || []).map((v) => String(v)));
  const quarantineIds = new Set<string>();
  const details: string[] = [];
  const mark = (id: any, why: string) => {
    const sid = String(id);
    if (used.has(sid) || quarantineIds.has(sid)) return;
    quarantineIds.add(sid);
    if (details.length < 20) details.push(why);
  };

  const quarantine = async (ids: string[], what: string): Promise<number> => {
    if (ids.length === 0) return 0;
    try {
      // D1 binds chunking: keep IN lists small.
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const placeholders = chunk.map(() => '?').join(', ');
        const qRes = await d1Query(
          `UPDATE brand_menu_items SET status = 'quarantined', updated_at = datetime('now') WHERE id IN (${placeholders})`,
          chunk
        );
        if (!qRes.success) throw new Error(qRes.error || 'D1 quarantine failed');
      }
      log(`[BrandClean] ${scope}: quarantined ${ids.length} ${what} row(s).`);
      return ids.length;
    } catch (e: any) {
      log(`[BrandClean] ${scope}: quarantine write failed (${e?.message || e}).`);
      return 0;
    }
  };

  // 1. Stale dish_name_key rewrite (data repair, no status change).
  for (const item of items) {
    const cleanTitle = sanitizeDishTitle(item.dish_name);
    const cleanKey = normalizeDishKey(cleanTitle);
    if (item.dish_name !== cleanTitle || item.dish_name_key !== cleanKey) {
      try {
        const sRes = await d1Query(
          `UPDATE brand_menu_items SET dish_name = ?, dish_name_key = ? WHERE id = ?`,
          [cleanTitle, cleanKey, item.id]
        );
        if (!sRes.success) throw new Error(sRes.error || 'D1 sanitize failed');
        item.dish_name = cleanTitle;
        item.dish_name_key = cleanKey;
      } catch (e: any) {
        log(`[BrandClean] ${scope}: sanitize failed for ${item.id} (${e?.message || e}).`);
      }
    }
  }

  // 2. Quarantine unofficial / junk / empty rows (soft; official-immune; never usedRowId).
  for (const item of items) {
    const sid = String(item.id);
    if (used.has(sid)) continue;
    if (item.status === 'quarantined' || item.status === 'merged') continue;
    const kcal = Number(item?.nutrients?.calories ?? item?.nutrients?.energy ?? NaN);
    const hasMacros = ['protein', 'totalFat', 'carbohydrates'].some(
      (k) => Number(item?.nutrients?.[k] ?? 0) > 0
    );
    const emptyRow = !Number.isFinite(kcal) || kcal <= 0;
    const flagged = isUnofficialOrCompositeDish(
      item.dish_name,
      item.chain_key,
      item.provenance,
      item.notes,
      item
    );
    if ((emptyRow && !hasMacros) || (flagged.isUnofficial && !isProtectedOfficial(item.provenance))) {
      mark(item.id, `Quarantined unofficial "${item.dish_name}" (${item.chain_key}): ${flagged.isUnofficial ? flagged.reason : 'empty/0-kcal, no macros'}`);
    }
  }

  // 3. Same-key collapse: one live row per chain+country+dish key.
  const groups = new Map<string, any[]>();
  for (const item of items) {
    if (item.status === 'quarantined' || item.status === 'merged') continue;
    if (quarantineIds.has(String(item.id))) continue;
    const k = item.dish_name_key;
    if (!k) continue;
    const list = groups.get(k) || [];
    list.push(item);
    groups.set(k, list);
  }
  const rankRow = (r: any): number[] => [
    provenanceRank(r.provenance),
    -(Number(r.capture_count) || 0),
    -(Number(r.confidence) || 0),
    -(r.updated_at ? Date.parse(String(r.updated_at)) || 0 : 0),
  ];
  const rankCompare = (a: any, b: any): number => {
    const ra = rankRow(a);
    const rb = rankRow(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return String(a.id).localeCompare(String(b.id));
  };
  for (const [dkey, group] of groups.entries()) {
    if (group.length <= 1) continue;
    const usedInGroup = group.filter((g) => used.has(String(g.id)));
    let winner: any = null;
    if (usedInGroup.length > 0) {
      // Meal truth wins — unless it is junk-marked while a protected official
      // twin exists. Then skip the group: both rows must survive.
      const u = usedInGroup[0];
      const officialTwin = group.find(
        (g) => !used.has(String(g.id)) && isProtectedOfficial(g.provenance)
      );
      if (isJunkMarked(u.provenance) && officialTwin) {
        log(`[BrandClean] ${scope}: key "${dkey}" skipped — used row ${u.id} is unofficial, official twin ${officialTwin.id} must survive.`);
        continue;
      }
      winner = u;
    } else {
      const sorted = [...group].sort(rankCompare);
      const top = sorted[0];
      const officialLoser = sorted
        .slice(1)
        .find((g) => isProtectedOfficial(g.provenance));
      if (isJunkMarked(top.provenance) && officialLoser) {
        log(`[BrandClean] ${scope}: key "${dkey}" skipped — winner ${top.id} is unofficial, official row ${officialLoser.id} must survive.`);
        continue;
      }
      winner = top;
    }
    for (const loser of group) {
      if (String(loser.id) === String(winner.id)) continue;
      mark(loser.id, `Collapsed duplicate "${loser.dish_name}" (key ${dkey}, keeping ${winner.id})`);
    }
  }

  const ids = [...quarantineIds];
  const quarantined = await quarantine(ids, 'unofficial/duplicate');
  const counts: BrandCleanCounts = {
    removedUnofficialCount: quarantined,
    deletedDuplicatesCount: quarantined,
    updatedChainsCount: quarantined > 0 ? 1 : 0,
    details,
  };
  if (quarantined > 0) {
    log(`[BrandClean] ${scope}: complete — quarantined ${quarantined} row(s).`);
  }

  // F-11.2: Layer 2 Brand Curator LLM (runs only when G0-G4 and T1-T3 pass)
  if (args.callLLMFn) {
    try {
      const survivingRows = items.filter(
        (r) => !quarantineIds.has(String(r.id)) && r.status !== 'quarantined'
      );
      const curatorRes = await runBrandCuratorStage({
        eligibility: {
          chainKey,
          countryCode: country,
          mode: args.mode,
          bindStatus: args.bindStatus,
          dishNameKey: args.dishNameKey,
          candidateIds: args.candidateIds,
          usedRowIds: args.usedRowIds,
        },
        survivingRows,
        callLLMFn: args.callLLMFn,
        adminClient: null,
        onLog: log,
      });
      if (curatorRes.executed) {
        counts.deletedDuplicatesCount += curatorRes.quarantinedCount;
        counts.details.push(...curatorRes.details);
      }
    } catch (err: any) {
      log(`[BrandClean] ${scope}: Layer 2 Curator error: ${err?.message || err}`);
    }
  }

  return counts;
}

/** Fire-and-forget wrapper: the meal never waits on the clean. */
export function enqueueBrandClean(args: {
  chainKey?: string | null;
  countryCode?: string;
  usedRowIds?: Array<string | number>;
  dishNameKey?: string | null;
  bindStatus?: 'HIT' | 'MULTI' | 'MISS' | 'SKIPPED' | null;
  candidateIds?: Array<string | number>;
  callLLMFn?: (prompt: string, sysInst: string) => Promise<string>;
  mode?: string;
  onLog?: (msg: string) => void;
}): void {
  const chainKey = normalizeChainKey(args.chainKey || '');
  if (!chainKey) return;
  void cleanBrandChain({
    chainKey,
    countryCode: args.countryCode,
    usedRowIds: args.usedRowIds,
    dishNameKey: args.dishNameKey,
    bindStatus: args.bindStatus,
    candidateIds: args.candidateIds,
    callLLMFn: args.callLLMFn,
    mode: args.mode,
    onLog: args.onLog,
  }).catch((e: any) =>
    (args.onLog || console.log)(`[BrandClean] background error for ${chainKey}: ${e?.message || e}`)
  );
}

export async function selfCleanBrandDatabase(
  _legacyDb: any,
  countryCode: string = 'GB',
  addDebugLog?: (msg: string) => void
): Promise<BrandCleanCounts> {
  // F-11.1: soft per-chain clean (was: whole-country hard delete).
  // Admin "Clean now" bypasses the per-chain throttle.
  // D-2: D1-only. First arg is legacy (ignored) so existing callers keep
  // working until the admin-router follow-up stops passing it.
  const log = addDebugLog || console.log;
  const country = String(countryCode || 'GB').toUpperCase();
  const agg: BrandCleanCounts = {
    removedUnofficialCount: 0,
    deletedDuplicatesCount: 0,
    updatedChainsCount: 0,
    details: [],
  };
  if (!isD1Configured()) {
    log(`[BrandClean] ${country}: D1 not configured; skipping database clean (no 402).`);
    return agg;
  }
  let chains: string[] = [];
  try {
    const chainRes = await d1Query<any>(
      `SELECT DISTINCT chain_key FROM brand_menu_items WHERE country_code = ? LIMIT 500`,
      [country]
    );
    if (!chainRes.success) throw new Error(chainRes.error || 'D1 chain list failed');
    chains = [...new Set((chainRes.results || []).map((r: any) => r.chain_key).filter(Boolean))];
  } catch (e: any) {
    log(`[BrandClean] ${country}: cannot list chains (${e?.message || e}).`);
    return agg;
  }
  for (const chainKey of chains) {
    const r = await cleanBrandChain({
      chainKey,
      countryCode: country,
      onLog: log,
      bypassThrottle: true,
    });
    agg.removedUnofficialCount += r.removedUnofficialCount;
    agg.deletedDuplicatesCount += r.deletedDuplicatesCount;
    agg.updatedChainsCount += r.updatedChainsCount;
    agg.details.push(...r.details);
  }
  log(`[BrandClean] ${country}: complete — quarantined ${agg.removedUnofficialCount} row(s) across ${agg.updatedChainsCount} chain(s).`);
  return agg;
}

export async function autoRegisterChainMenuItem(
  _legacyDb: any,
  item: any,
  countryCode: string,
  addDebugLog: (msg: string) => void
): Promise<void> {
  // D-2: D1-only. First arg is legacy (ignored). D1 brand_menu_items has no
  // capture_count/confidence/provenance/nutrients_per_100g columns — those
  // rank inputs fall back to defaults; printed nutrients + notes persist.
  if (!isD1Configured()) {
    addDebugLog('[AutoChainRegister] D1 not configured; skipping (no 402).');
    return;
  }
  try {
    const rawChainName = String(item?.chainName || '').trim();
    const rawDishName = String(item?.originalName || item?.name || item?.dishName || '').trim();
    const dishName = sanitizeDishTitle(rawDishName);
    const rawLabel = item?.rawNutritionLabel;
    if (!rawChainName || !dishName || !rawLabel || typeof rawLabel !== 'object') return;

    const checkUnofficial = isUnofficialOrCompositeDish(rawDishName, rawChainName, item?.provenance, item?.notes, item);
    if (checkUnofficial.isUnofficial) {
      addDebugLog(`[AutoChainRegister] REJECTED unofficial/computed item "${rawDishName}" for chain "${rawChainName}": ${checkUnofficial.reason}`);
      return;
    }

    const chain_key = normalizeChainKey(rawChainName);
    const dish_name_key = normalizeDishKey(dishName);
    if (!chain_key || !dish_name_key || ['unknown', 'home_cooked', 'generic', 'estimated', 'none'].includes(chain_key)) return;

    const lockKey = `${countryCode}:${chain_key}:${dish_name_key}`;
    if (inFlightRegisterLocks.has(lockKey)) {
      addDebugLog(`[AutoChainRegister] Concurrent registration lock active for "${dishName}" (${chain_key}); skipping duplicate write.`);
      return;
    }
    inFlightRegisterLocks.add(lockKey);

    try {
      const lockedKeysList = Array.isArray(item?.lockedNutrientKeys) ? item.lockedNutrientKeys : null;
      const lockedKeysSet = lockedKeysList ? new Set(lockedKeysList.map((k: string) => k.toLowerCase())) : null;

      const nutrients: Record<string, number> = {};
      const fieldMap: Record<string, string> = {
        calories: 'calories', protein: 'protein', totalFat: 'totalFat',
        saturatedFat: 'saturatedFat', carbohydrates: 'carbohydrates', totalCarbohydrate: 'carbohydrates',
        sugar: 'sugar', totalFibre: 'totalFibre', sodium: 'sodium', salt: 'salt'
      };
      for (const [rawKey, outKey] of Object.entries(fieldMap)) {
        if (lockedKeysSet) {
          const normOutKey = outKey.toLowerCase();
          const isLockedField = lockedKeysSet.has(normOutKey) ||
            (normOutKey === 'carbohydrates' && (lockedKeysSet.has('carbohydrate') || lockedKeysSet.has('carbs'))) ||
            (normOutKey === 'totalfat' && lockedKeysSet.has('fat')) ||
            (normOutKey === 'totalfibre' && (lockedKeysSet.has('fiber') || lockedKeysSet.has('fibre')));

          if (!isLockedField) {
            addDebugLog(`[AutoChainRegister] Omitting AI-estimated field '${outKey}' from official brand database save for "${dishName}" (only printed truth is stored).`);
            continue;
          }
        }

        const n = parseNutrientNumber(rawLabel[rawKey]);
        if (n !== null) nutrients[outKey] = n;
      }
      if (Object.keys(nutrients).length === 0) return; // guard: at least one official nutrient required

      const ssRaw = String(rawLabel.servingSize || rawLabel.servingSizeRaw || '').trim();
      const estWeight = parseNutrientNumber(item?.estimatedWeightGrams);
      const ssLooksLikePackage100g =
        /100\s*g/i.test(ssRaw) ||
        /per\s*100/i.test(ssRaw) ||
        /^100(\.0+)?\s*g?$/i.test(ssRaw.trim());
      const assumeDishNotPackage = !ssRaw || (!ssLooksLikePackage100g && !/\d+\s*(g|ml)\b/i.test(ssRaw));
      const basisInfo = ssLooksLikePackage100g
        ? { basisType: 'per_100g' as const, servingGrams: 100 }
        : inferBasisFromServingText(ssRaw, estWeight, assumeDishNotPackage);
      const basis_type = basisInfo.basisType;
      const serving_grams = basisInfo.servingGrams;

      const nutrients_per_100g = toPer100g({
        basisType: basis_type,
        servingGrams: serving_grams,
        nutrients: nutrients,
      });

      // Upsert chain_menu_sources placeholder, marked ready since we have real captured data
      try {
        await d1UpsertChainMenuSource({
          chain_key,
          country_code: countryCode,
          display_name: rawChainName,
          url: `crowdsourced://ocr/${chain_key}`,
          source_kind: 'crowdsourced',
          status: 'ready',
          enabled: true,
          last_success_at: new Date().toISOString(),
        });
      } catch (e: any) {
        // Soft-fail OK
      }

      let chainRows: any[] = [];
      try {
        chainRows = await d1GetBrandMenuItems(chain_key, countryCode);
      } catch (lookupErr: any) {
        addDebugLog(`[AutoChainRegister] lookup error, skipping: ${lookupErr?.message || lookupErr}`);
        return;
      }

      let existing = null;
      let existingRows = [];
      if (chainRows && chainRows.length > 0) {
        // 1. Check for exact key match
        existingRows = chainRows.filter((r: any) => r.dish_name_key === dish_name_key);
        
        if (existingRows.length === 0) {
          // 2. Fuzzy dedup check
          const normalizeTokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length > 2);
          const newTokens = normalizeTokens(dishName);
          if (newTokens.length > 0) {
            let bestFuzzyMatch = null;
            let bestFuzzyScore = 0;
            
            for (const row of chainRows) {
              const existingTokens = normalizeTokens(row.dish_name);
              if (existingTokens.length === 0) continue;
              const overlap = newTokens.filter(t => existingTokens.includes(t)).length;
              const jaccard = overlap / (newTokens.length + existingTokens.length - overlap);
              
              if (jaccard > 0.65 || (overlap >= 2 && overlap === newTokens.length && existingTokens.length === newTokens.length + 1)) {
                if (jaccard > bestFuzzyScore) {
                  bestFuzzyScore = jaccard;
                  bestFuzzyMatch = row;
                }
              }
            }
            
            if (bestFuzzyMatch) {
              addDebugLog(`[AutoChainRegister] Fuzzy matched new dish "${dishName}" to existing "${bestFuzzyMatch.dish_name}" (score: ${bestFuzzyScore.toFixed(2)})`);
              existingRows = [bestFuzzyMatch];
            }
          }
        }
      }

      existing = existingRows.length > 0 ? existingRows[0] : null;

      if (existingRows && existingRows.length > 1) {
        const extraIds = existingRows.slice(1).map((r: any) => r.id).filter(Boolean);
        if (extraIds.length > 0) {
          addDebugLog(`[AutoChainRegister] Deleting ${extraIds.length} duplicate record(s) for "${dishName}" (${chain_key}).`);
          const placeholders = extraIds.map(() => '?').join(', ');
          await d1Query(`DELETE FROM brand_menu_items WHERE id IN (${placeholders})`, extraIds);
        }
      }

      const isPlaceholderIngredientText = (s: any) => typeof s === 'string' && s.trim().toLowerCase().startsWith('auto-captured from photo ocr');
      const rawIngredients = item?.ingredientsList || item?.ingredients || rawLabel?.ingredients || null;
      const ingredients = isPlaceholderIngredientText(rawIngredients) ? null : rawIngredients;
      const isPartialLocked = lockedKeysList && lockedKeysList.length > 0 && Object.keys(nutrients).length < 4;

      if (!existing) {
        const provTag = isPartialLocked ? 'ocr_partial' : 'ocr_auto';
        const newId = `ocr_${String(countryCode).toLowerCase()}_${chain_key}_${dish_name_key}`.slice(0, 120);
        const insertRes = await d1UpsertBrandMenuItem({
          id: newId,
          country_code: countryCode,
          chain_key,
          chain_name: rawChainName,
          dish_name: dishName,
          dish_name_key,
          basis_type,
          serving_grams,
          nutrients,
          ingredients: ingredients || '',
          source_url: `crowdsourced://ocr/${chain_key}`,
          notes: `${isPartialLocked
            ? `Auto-captured from photo OCR (Official printed keys: ${lockedKeysList.join(', ')})`
            : 'Auto-captured from photo OCR'} [${provTag}]`,
          enabled: true,
          status: 'active',
        });
        if (!insertRes.success) {
          addDebugLog(`[AutoChainRegister] insert failed for "${dishName}": ${insertRes.error}`);
        } else {
          invalidateBrandCache();
          addDebugLog(`[AutoChainRegister] Registered new dish "${dishName}" for chain "${chain_key}" with ${Object.keys(nutrients).length} official fields.`);
        }
      } else {
        const existingNutrients = existing.nutrients || {};
        const mergedNutrients: Record<string, number> = { ...existingNutrients };
        for (const [k, v] of Object.entries(nutrients)) {
          if (existingNutrients[k] === null || existingNutrients[k] === undefined) {
            mergedNutrients[k] = v;
          }
        }

        const mergedNutrients100g = toPer100g({
          basisType: existing.basis_type || basis_type,
          servingGrams: existing.serving_grams || serving_grams,
          nutrients: mergedNutrients,
        });

        const updatedCaptureCount = (existing.capture_count || 1) + 1;

        const mergedNutrientsJson = JSON.stringify(mergedNutrients);
        const updateSets: string[] = [
          'dish_name = ?', 'dish_name_key = ?', 'nutrients = ?', `updated_at = datetime('now')`
        ];
        const updateParams: any[] = [dishName, dish_name_key, mergedNutrientsJson];
        if ((existing.serving_grams === null || existing.serving_grams === undefined) && serving_grams) {
          updateSets.push('serving_grams = ?');
          updateParams.push(serving_grams);
        }
        if (!existing.ingredients && ingredients) {
          updateSets.push('ingredients = ?');
          updateParams.push(ingredients);
        }
        updateParams.push(existing.id);
        const updateRes = await d1Query(
          `UPDATE brand_menu_items SET ${updateSets.join(', ')} WHERE id = ?`,
          updateParams
        );

        if (!updateRes.success) {
          addDebugLog(`[AutoChainRegister] update failed for "${dishName}": ${updateRes.error}`);
        } else {
          addDebugLog(`[AutoChainRegister] Updated existing dish "${dishName}" (capture #${updatedCaptureCount}).`);
        }
      }

      cleanBrandChain({ chainKey: chain_key, countryCode, onLog: addDebugLog }).catch((e: any) => {
        addDebugLog(`[AutoChainRegister] background brand clean failed: ${e?.message || e}`);
      });
    } finally {
      inFlightRegisterLocks.delete(lockKey);
    }
  } catch (e: any) {
    addDebugLog(`[AutoChainRegister] unexpected error: ${e?.message || e}`);
  }
}

export function cleanDescriptionText(raw: string): string {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^description\s*:\s*/i, '');
  str = str.replace(/\s*salt:\s*[\d.]+g?\s*→\s*sodium\s*\d+mg.*$/i, '');
  str = str.replace(/\s*pasted from menu nutrition panel.*$/i, '');
  return str.trim();
}

async function maybeMarkChainReady(_legacyDb: any, chainKey: string, countryCode: string) {
  // D-2: D1-only status flip (raw UPDATE so display_name/url/priority are
  // never clobbered with upsert defaults). First arg is legacy (ignored).
  try {
    await d1Query(
      `UPDATE chain_menu_sources SET status = 'ready', updated_at = datetime('now') WHERE chain_key = ? AND country_code = ?`,
      [chainKey, countryCode]
    );
  } catch (e) {
    console.warn('maybeMarkChainReady failed:', e);
  }
}

/** Parse YOLK/VMOS-style pasted nutrition panel → dish + macros */
export function parseMenuNutritionPaste(raw: string): {
  dish_name: string;
  description: string;
  nutrients: Record<string, number>;
  serving_grams: number | null;
  notes: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const nonEmpty = String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!nonEmpty.length) {
    return { dish_name: '', description: '', nutrients: {}, serving_grams: null, notes: '', warnings: ['Empty paste'] };
  }

  const numFrom = (line: string): number | null => {
    const m = String(line).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
  };
  const energyFromText = (str: string): number | null => {
    const s = String(str).replace(/,/g, '').trim();
    const kcalMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kcal/i);
    if (kcalMatch) {
      const n = parseFloat(kcalMatch[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const kjMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kj/i);
    if (kjMatch) {
      const kj = parseFloat(kjMatch[1]);
      if (Number.isFinite(kj) && kj > 0) {
        return Math.round((kj / 4.184) * 10) / 10;
      }
    }
    return numFrom(s);
  };
  const isSectionHeader = (line: string) =>
    /^(overview|nutrition|allergens|ingredients|details)$/i.test(line.trim());
  const isNutrientLabel = (line: string): string | null => {
    const t = line.trim().toLowerCase().replace(/\s+/g, ' ');
    if (/^energy\s*\(kcal\)|^energy\s*kcal|^calories?\b/.test(t)) return 'calories';
    if (/^energy\s*\(kj\)|^energy\s*kj/.test(t)) return 'energyKj';
    if (/^fats?\b|^total\s*fat/.test(t) && !/saturat/.test(t)) return 'totalFat';
    if (/saturat/.test(t)) return 'saturatedFat';
    if (/^carbs?\b|^carbohydrates?\b/.test(t) && !/sugar/.test(t)) return 'carbohydrates';
    if (/sugar/.test(t)) return 'sugar';
    if (/^proteins?\b/.test(t)) return 'protein';
    if (/^fibres?\b|^fibers?\b|^total\s*fibre|^total\s*fiber/.test(t)) return 'totalFibre';
    if (/^salt\b/.test(t)) return 'salt';
    if (/^sodium\b/.test(t)) return 'sodium';
    if (/serving\s*size|portion/.test(t)) return 'serving';
    return null;
  };

  let dish_name = nonEmpty[0]
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || nonEmpty[0];

  const descParts: string[] = [];
  let i = 1;
  for (; i < nonEmpty.length; i++) {
    const line = nonEmpty[i];
    if (isSectionHeader(line)) {
      i++;
      break;
    }
    if (isNutrientLabel(line)) break;
    descParts.push(line);
  }
  while (i < nonEmpty.length && isSectionHeader(nonEmpty[i])) i++;

  const nutrients: Record<string, number> = {};
  let serving_grams: number | null = null;
  let saltG: number | null = null;

  for (; i < nonEmpty.length; i++) {
    const line = nonEmpty[i];
    if (isSectionHeader(line)) continue;

    const same = line.match(
      /^(energy\s*\(kcal\)|energy\s*kcal|calories?|fats?|total\s*fat|carbs?|carbohydrates?|proteins?|fibres?|fibers?|salt|sodium|of which saturates|saturated(?:\s*fat)?|of which sugars|sugars?|serving\s*size)\s*[:\s]+(.+)$/i
    );
    if (same) {
      const key = isNutrientLabel(same[1]) || isNutrientLabel(line);
      const val = key === 'calories' || key === 'energyKj' ? energyFromText(same[2]) : numFrom(same[2]);
      if (key && val != null) {
        if (key === 'serving') serving_grams = val;
        else if (key === 'salt') saltG = val;
        else if (key === 'calories' || key === 'energyKj') {
          if (nutrients.calories == null) nutrients.calories = val;
        } else nutrients[key] = val;
      }
      continue;
    }

    const key = isNutrientLabel(line);
    if (!key) continue;
    const next = nonEmpty[i + 1];
    if (!next || isNutrientLabel(next) || isSectionHeader(next)) continue;
    const val = key === 'calories' || key === 'energyKj' ? energyFromText(next) : numFrom(next);
    if (val == null) continue;
    i++;
    if (key === 'serving') serving_grams = val;
    else if (key === 'salt') saltG = val;
    else if (key === 'calories' || key === 'energyKj') {
      if (nutrients.calories == null) nutrients.calories = val;
    } else nutrients[key] = val;
  }

  if (saltG != null) {
    nutrients.salt = saltG;
    if (nutrients.sodium == null) {
      nutrients.sodium = Math.round(saltG * 400 * 10) / 10;
    }
  }
  if (nutrients.calories == null) warnings.push('No calories (kcal) found');
  if (nutrients.protein == null) warnings.push('No protein found');
  if (nutrients.carbohydrates == null) warnings.push('No carbs found');
  if (nutrients.totalFat == null) warnings.push('No fat found');

  const description = descParts.join(' ').replace(/\s+/g, ' ').trim();
  const cleanedDesc = cleanDescriptionText(description);

  return { dish_name, description: cleanedDesc, nutrients, serving_grams, notes: cleanedDesc, warnings };
}

/** Parse a multi-dish pasted menu blob (e.g. copy-pasted from a restaurant's website/PDF).
 *  Supports "Dish Name (XXX kcal)" headers followed by an "Ingredients:" line and an optional
 *  "Nutrient Profile:" line. Falls back to the single-item parser if no such headers are found,
 *  so pasting one dish still works exactly as before. Section-header-only lines (no kcal, no
 *  ingredients) are silently skipped. */
export function parseMenuNutritionBulkPaste(raw: string): {
  dishes: Array<{
    dish_name: string;
    description: string;
    nutrients: Record<string, number>;
    serving_grams: number | null;
    notes: string;
    warnings: string[];
  }>;
  warnings: string[];
} {
  const lines = String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  const dishHeaderRe = /^(.+?)\s*\((\d+(?:\.\d+)?)\s*kcal\)$/i;
  const headerIdxs: number[] = [];
  lines.forEach((l, idx) => {
    if (l && dishHeaderRe.test(l)) headerIdxs.push(idx);
  });

  if (headerIdxs.length === 0) {
    // Not bulk format — fall back to treating the whole paste as one dish.
    const single = parseMenuNutritionPaste(raw);
    return {
      dishes: single.dish_name ? [single] : [],
      warnings: single.dish_name ? [] : ['Could not detect any dish in paste'],
    };
  }

  const dishes: Array<{
    dish_name: string;
    description: string;
    nutrients: Record<string, number>;
    serving_grams: number | null;
    notes: string;
    warnings: string[];
  }> = [];
  const globalWarnings: string[] = [];

  for (let h = 0; h < headerIdxs.length; h++) {
    const startIdx = headerIdxs[h];
    const endIdx = h + 1 < headerIdxs.length ? headerIdxs[h + 1] : lines.length;
    const headerMatch = lines[startIdx].match(dishHeaderRe);
    if (!headerMatch) continue;

    const dish_name = headerMatch[1].trim();
    const calories = parseFloat(headerMatch[2]);
    const blockLines = lines.slice(startIdx + 1, endIdx).filter((l) => l.length > 0);

    let description = '';
    const nutrients: Record<string, number> = { calories };
    const warnings: string[] = [];

    for (const line of blockLines) {
      const ingMatch = line.match(/^ingredients\s*:\s*(.+)$/i);
      if (ingMatch) {
        description = ingMatch[1].trim();
        continue;
      }
      const profileMatch = line.match(/^nutrient\s*profile\s*:\s*(.+)$/i);
      if (profileMatch) {
        const parts = profileMatch[1].split('|').map((p) => p.trim());
        for (const part of parts) {
          const kv = part.match(/^([a-zA-Z ]+?)\s*:\s*([\d.]+)\s*g?\s*(?:\(sodium\s*:\s*([\d.]+)\s*mg\))?/i);
          if (!kv) continue;
          const label = kv[1].trim().toLowerCase();
          const val = parseFloat(kv[2]);
          if (isNaN(val)) continue;
          if (/protein/.test(label)) nutrients.protein = val;
          else if (/carb/.test(label)) nutrients.carbohydrates = val;
          else if (/saturated/.test(label)) nutrients.saturatedFat = val;
          else if (/^fats?$/.test(label)) nutrients.totalFat = val;
          else if (/sugar/.test(label)) nutrients.sugar = val;
          else if (/fib(re|er)/.test(label)) nutrients.totalFibre = val;
          else if (/salt/.test(label)) {
            nutrients.salt = val;
            if (kv[3]) nutrients.sodium = parseFloat(kv[3]);
          }
        }
        continue;
      }
      if (!description) description = line;
      else description += ' ' + line;
    }

    if (nutrients.protein == null) warnings.push('No protein found');
    if (nutrients.carbohydrates == null) warnings.push('No carbs found');
    if (nutrients.totalFat == null) warnings.push('No fat found');

    const cleanedDesc = cleanDescriptionText(description);
    dishes.push({
      dish_name,
      description: cleanedDesc,
      nutrients,
      serving_grams: null,
      notes: cleanedDesc,
      warnings,
    });
  }

  return { dishes, warnings: globalWarnings };
}

const LOCAL_FILE = path.join(process.cwd(), 'brand_menu_items_local.json');

export function loadLocalItems(): any[] {
  try {
    if (fs.existsSync(LOCAL_FILE)) {
      const text = fs.readFileSync(LOCAL_FILE, 'utf-8');
      return JSON.parse(text) || [];
    }
  } catch (e) {
    console.warn('loadLocalItems failed:', e);
  }
  return [];
}

function saveLocalItems(items: any[]) {
  try {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) {
    console.warn('saveLocalItems failed:', e);
  }
}

export function registerBrandMenuRoutes(app: Express) {
  /** Upsert or edit a chain menu source */
  app.post('/api/chain-menu-sources/save', async (req: Request, res: Response) => {
    try {
      const id = req.body?.id; // Optional, present if editing
      const chain_key = String(req.body?.chain_key || '').trim().toLowerCase();
      const display_name = String(req.body?.display_name || '').trim();
      const url = String(req.body?.url || '').trim();
      const country_code = String(req.body?.country_code || 'GB');

      if (!chain_key || !url) {
        return res.status(400).json({ error: 'chain_key and url are required' });
      }

      const row: any = {
        country_code,
        chain_key,
        display_name: display_name || chain_key,
        url,
        source_kind: req.body?.source_kind || 'unknown',
        status: req.body?.status || 'pending',
        priority: req.body?.priority || 100,
        enabled: req.body?.enabled !== false,
        updated_at: new Date().toISOString()
      };
      if (id) row.id = id;

      let savedSource = row;

      // 1. Save to D1 if configured
      if (isD1Configured()) {
        try {
          const d1Res = await d1UpsertChainMenuSource(row);
          if (d1Res.success && d1Res.data) savedSource = d1Res.data;
        } catch (d1Err) {
          console.warn('[chain-menu-sources/save] D1 save warning:', d1Err);
        }
      }

      // D-2: D1 is the only remote store (Supabase fallback removed, no 402).

      return res.json({ success: true, source: savedSource });
    } catch (err: any) {
      console.error('[chain_menu_sources/save] error:', err);
      res.status(500).json({ error: err?.message || 'Failed to save chain menu source' });
    }
  });

  /** Delete a chain menu source and cascade-delete its items */
  app.post('/api/chain-menu-sources/delete', async (req: Request, res: Response) => {
    try {
      const id = req.body?.id;
      const chain_key = String(req.body?.chain_key || '').trim().toLowerCase();
      const country_code = String(req.body?.country_code || 'GB');

      if (!id && !chain_key) {
        return res.status(400).json({ error: 'id or chain_key is required' });
      }

      // 1. Delete from D1 if configured (id and chain_key are separate
      // selectors — the helper cascades brand_menu_items on chain_key).
      if (isD1Configured()) {
        try {
          await d1DeleteChainMenuSource(id || undefined, chain_key || undefined);
        } catch (d1Err) {
          console.warn('[chain-menu-sources/delete] D1 delete warning:', d1Err);
        }
      }

      // D-2: D1 is the only remote store (Supabase fallback removed, no 402).

      // 3. Clean up local fallback storage if present
      if (chain_key) {
        const all = loadLocalItems();
        const filtered = all.filter((it: any) => it.chain_key !== chain_key);
        if (filtered.length !== all.length) {
          saveLocalItems(filtered);
        }
      }

      res.json({ success: true, chain_key, id });
    } catch (err: any) {
      console.error('[chain_menu_sources/delete] error:', err);
      const chain_key = String(req.body?.chain_key || '').trim().toLowerCase();
      if (chain_key) {
        const all = loadLocalItems();
        const filtered = all.filter((it: any) => it.chain_key !== chain_key);
        if (filtered.length !== all.length) {
          saveLocalItems(filtered);
        }
      }
      res.json({ success: true, fallback: true });
    }
  });

  app.get('/api/brand-menu-items', async (req: Request, res: Response) => {
    const chain_key = String(req.query.chain_key || '').trim().toLowerCase();
    const country_code = String(req.query.country_code || 'GB');

    const runLocalFallback = () => {
      let items = loadLocalItems();
      if (chain_key) items = items.filter((it: any) => it.chain_key === chain_key);
      if (country_code) items = items.filter((it: any) => it.country_code === country_code);
      items.sort((a: any, b: any) => String(a.dish_name || '').localeCompare(String(b.dish_name || '')));
      const taggedItems = items.map((it: any) => ({ ...it, _source: 'local_fallback' }));
      return res.json({ success: true, items: taggedItems, fallback: true });
    };

    try {
      let taggedItems: any[] = [];

      // 1. Try D1 if configured
      if (isD1Configured()) {
        try {
          const d1Items = await d1GetBrandMenuItems(chain_key || undefined, country_code || undefined);
          if (d1Items && d1Items.length > 0) {
            taggedItems = d1Items.map((it: any) => ({ ...it, _source: 'd1' }));
          }
        } catch (d1Err) {
          console.warn('[brand-menu-items] D1 fetch warning:', d1Err);
        }
      }

      // D-2: D1 is the only remote store (Supabase fallback removed, no 402).

      // 3. Fall back to local items if DBs have no data
      if (taggedItems.length === 0) {
        return runLocalFallback();
      }

      // Include locally-pending items not yet synced
      let pendingItems: any[] = [];
      try {
        let localItems = loadLocalItems();
        if (chain_key) localItems = localItems.filter((it: any) => it.chain_key === chain_key);
        if (country_code) localItems = localItems.filter((it: any) => it.country_code === country_code);
        const syncedKeys = new Set(
          taggedItems.map((it: any) => `${it.chain_key}::${it.dish_name_key || it.dish_name}`)
        );
        pendingItems = localItems
          .filter((it: any) => !syncedKeys.has(`${it.chain_key}::${it.dish_name_key || it.dish_name}`))
          .map((it: any) => ({ ...it, _source: 'local_pending' }));
      } catch (e) {
        console.warn('[brand-menu-items] pending item merge failed:', e);
      }

      res.json({ success: true, items: [...taggedItems, ...pendingItems] });
    } catch (err: any) {
      return runLocalFallback();
    }
  });

  /** Search brand menu items by dish name across ALL chains (one query, no N+1) */
  app.get('/api/brand-menu-items/search', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    const country_code = String(req.query.country_code || 'GB');
    if (!q) return res.json({ success: true, items: [] });

    const results: any[] = [];

    // 1. Search D1 if configured
    if (isD1Configured()) {
      try {
        const d1Items = await d1SearchBrandMenuItems(q, country_code);
        if (d1Items && d1Items.length > 0) {
          results.push(...d1Items.map((it: any) => ({ ...it, _source: 'd1' })));
        }
      } catch (e) {
        console.warn('[brand-menu-items/search] d1 query failed:', e);
      }
    }

    // D-2: D1 is the only remote store (Supabase search removed, no 402).

    // 3. Search local items
    try {
      const local = loadLocalItems().filter((it: any) =>
        it.country_code === country_code &&
        (it.dish_name || '').toLowerCase().includes(q.toLowerCase())
      );
      results.push(...local.map((it: any) => ({ ...it, _source: 'local_fallback' })));
    } catch (e) {
      console.warn('[brand-menu-items/search] local search failed:', e);
    }

    // Deduplicate by chain_key + dish_name
    const seen = new Set<string>();
    const deduplicated = results.filter((it: any) => {
      const key = `${it.chain_key}::${it.dish_name_key || it.dish_name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ success: true, items: deduplicated.slice(0, 50) });
  });

  app.post('/api/brand-menu-items/import', async (req: Request, res: Response) => {
    const { chain_key, country_code, items } = req.body;
    if (!chain_key || !Array.isArray(items)) {
      return res.status(400).json({ error: 'chain_key and items array required' });
    }
    const rows = items.map((it: any) => ({
      id: '',
      country_code: country_code || 'GB',
      chain_key: chain_key.trim().toLowerCase(),
      dish_name: it.dish_name,
      dish_name_key: normalizeDishKey(it.dish_name),
      serving_grams: it.serving_grams || null,
      nutrients: it.nutrients || {},
      source_url: it.source_url || null,
      notes: it.notes || '',
      enabled: true,
      updated_at: new Date().toISOString()
    }));

    // D-2: D1 is the only remote store (Supabase upsert removed, no 402).
    // Stable ids keep D1 upserts idempotent per chain+dish (matches the old
    // onConflict country/chain/dish_key).
    let d1Ok = false;
    if (isD1Configured()) {
      for (const row of rows) {
        try {
          if (!row.id) {
            row.id = `imp_${row.country_code}_${row.chain_key}_${row.dish_name_key}`.toLowerCase().slice(0, 120);
          }
          const upRes = await d1UpsertBrandMenuItem(row);
          if (upRes.success) d1Ok = true;
        } catch (e) {
          console.warn('[brand-menu-items/import] D1 upsert warning:', e);
        }
      }
    }

    const runLocalFallback = () => {
      const all = loadLocalItems();
      rows.forEach((row: any) => {
        const idx = all.findIndex((it: any) => 
          it.country_code === row.country_code && 
          it.chain_key === row.chain_key && 
          it.dish_name_key === row.dish_name_key
        );
        if (idx >= 0) all[idx] = row;
        else all.push(row);
      });
      saveLocalItems(all);
      return res.json({ success: true, upserted: rows.length, items: rows, fallback: true });
    };

    if (d1Ok) {
      invalidateBrandCache();
      return res.json({ success: true, upserted: rows.length, items: rows.map((r: any) => ({ ...r, _source: 'd1' })) });
    }
    return runLocalFallback();
  });

  /** Parse + save a pasted nutrition panel (YOLK-style) as one brand menu item */
  app.post('/api/brand-menu-items/paste', async (req: Request, res: Response) => {
    try {
      const chain_key = String(req.body?.chain_key || '').trim().toLowerCase();
      const country_code = String(req.body?.country_code || 'GB');
      const text = String(req.body?.text || req.body?.paste || '');
      if (!chain_key) return res.status(400).json({ error: 'chain_key required' });
      if (!text.trim()) return res.status(400).json({ error: 'paste text required' });

      const parsed = parseMenuNutritionPaste(text);
      if (!parsed.dish_name || parsed.dish_name.length < 2) {
        return res.status(400).json({ error: 'Could not parse dish name from paste', parsed });
      }
      if (parsed.nutrients.calories == null && Object.keys(parsed.nutrients).length === 0) {
        return res.status(400).json({ error: 'Could not parse nutrients from paste', parsed });
      }

      const dish_name_key = normalizeDishKey(parsed.dish_name);
      const row = {
        country_code,
        chain_key,
        dish_name: parsed.dish_name,
        dish_name_key,
        serving_grams: parsed.serving_grams,
        nutrients: parsed.nutrients,
        source_url: req.body?.source_url || null,
        notes: parsed.notes,
        enabled: true,
        updated_at: new Date().toISOString(),
      };

      if (isD1Configured()) {
        try {
          await d1UpsertBrandMenuItem({
            id: `paste_${country_code}_${chain_key}_${dish_name_key}`.toLowerCase().slice(0, 120),
            ...row,
          });
          try {
            await maybeMarkChainReady(null, chain_key, country_code);
          } catch (_) {}
          invalidateBrandCache();
          return res.json({ success: true, item: { ...row, _source: 'd1' }, parsed });
        } catch (e) {
          console.warn('[brand-menu-items/paste] D1 upsert warning:', e);
        }
      }

      const runLocalFallback = async () => {
        const all = loadLocalItems();
        const idx = all.findIndex((it: any) => 
          it.country_code === row.country_code && 
          it.chain_key === row.chain_key && 
          it.dish_name_key === row.dish_name_key
        );
        if (idx >= 0) all[idx] = row;
        else all.push(row);
        saveLocalItems(all);
        try {
          await maybeMarkChainReady(null, chain_key, country_code);
        } catch (_) {}
        return res.json({ success: true, item: { ...row, _source: 'local_fallback' }, parsed, fallback: true });
      };

      return await runLocalFallback();
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'paste failed' });
    }
  });

  /** Parse + save a multi-dish pasted menu blob as many brand menu items at once */
  app.post('/api/brand-menu-items/bulk-paste', async (req: Request, res: Response) => {
    try {
      const chain_key = String(req.body?.chain_key || '').trim().toLowerCase();
      const country_code = String(req.body?.country_code || 'GB');
      const text = String(req.body?.text || req.body?.paste || '');
      if (!chain_key) return res.status(400).json({ error: 'chain_key required' });
      if (!text.trim()) return res.status(400).json({ error: 'paste text required' });

      const { dishes, warnings } = parseMenuNutritionBulkPaste(text);
      if (dishes.length === 0) {
        return res.status(400).json({ error: 'Could not parse any dishes from paste', warnings });
      }

      const results: Array<{ dish_name: string; status: 'saved' | 'error'; source?: string; warnings: string[]; error?: string }> = [];

      for (const dish of dishes) {
        if (!dish.dish_name || dish.dish_name.length < 2) {
          results.push({ dish_name: dish.dish_name || '(unnamed)', status: 'error', warnings: dish.warnings, error: 'Missing dish name' });
          continue;
        }
        if (dish.nutrients.calories == null) {
          results.push({ dish_name: dish.dish_name, status: 'error', warnings: dish.warnings, error: 'No calories found' });
          continue;
        }

        const dish_name_key = normalizeDishKey(dish.dish_name);
        const row = {
          country_code,
          chain_key,
          dish_name: dish.dish_name,
          dish_name_key,
          serving_grams: dish.serving_grams,
          nutrients: dish.nutrients,
          source_url: req.body?.source_url || null,
          notes: dish.notes,
          enabled: true,
          updated_at: new Date().toISOString(),
        };

        // D-2: D1 is the remote store (stable id = idempotent upsert).
        let savedToD1 = false;
        if (isD1Configured()) {
          try {
            const upRes = await d1UpsertBrandMenuItem({
              id: `paste_${country_code}_${chain_key}_${dish_name_key}`.toLowerCase().slice(0, 120),
              ...row,
            });
            savedToD1 = upRes.success;
          } catch (e) {
            console.warn('[brand-menu-items/bulk-paste] D1 upsert warning:', e);
          }
        }

        if (savedToD1) {
          results.push({ dish_name: dish.dish_name, status: 'saved', source: 'd1', warnings: dish.warnings });
        } else {
          const all = loadLocalItems();
          const idx = all.findIndex((it: any) =>
            it.country_code === row.country_code &&
            it.chain_key === row.chain_key &&
            it.dish_name_key === row.dish_name_key
          );
          if (idx >= 0) all[idx] = row;
          else all.push(row);
          saveLocalItems(all);
          results.push({ dish_name: dish.dish_name, status: 'saved', source: 'local_fallback', warnings: dish.warnings });
        }
      }

      try {
        await maybeMarkChainReady(null, chain_key, country_code);
      } catch (_) {}

      const savedToD1Count = results.filter((r) => r.source === 'd1').length;
      const savedLocalOnly = results.filter((r) => r.source !== 'd1' && r.status === 'saved').length;
      const errors = results.filter((r) => r.status === 'error').length;

      res.json({
        success: true,
        results,
        summary: { total: dishes.length, savedToD1: savedToD1Count, savedLocalOnly, errors },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'bulk paste failed' });
    }
  });

  /** Edit/update a brand menu item */
  app.post('/api/brand-menu-items/edit', async (req: Request, res: Response) => {
    const country_code = String(req.body?.country_code || 'GB');
    const chain_key = String(req.body?.chain_key || '').trim().toLowerCase();
    const dish_name_key = String(req.body?.dish_name_key || '').trim();
    const dish_name = String(req.body?.dish_name || '').trim();
    const serving_grams = req.body?.serving_grams != null ? Number(req.body.serving_grams) : null;
    const basis_type = String(req.body?.basis_type || 'per_dish');
    const nutrients = req.body?.nutrients || {};
    const notes = String(req.body?.notes || '').trim();
    const ingredients = req.body?.ingredients != null ? String(req.body.ingredients).trim() : undefined;
    const image_url = req.body?.image_url != null ? String(req.body.image_url).trim() : (req.body?.imageUrl != null ? String(req.body.imageUrl).trim() : undefined);

    if (!chain_key || !dish_name_key) {
      return res.status(400).json({ error: 'chain_key and dish_name_key are required' });
    }

    // D-2: D1 is the remote store. Resolve the existing row id first so the
    // upsert updates in place instead of minting a duplicate row.
    if (isD1Configured()) {
      try {
        const existing = await d1GetBrandMenuItems(chain_key, country_code);
        const hit = (existing || []).find((r: any) => r.dish_name_key === dish_name_key || r.dish_name === dish_name);
        const upRes = await d1UpsertBrandMenuItem({
          ...(hit?.id ? { id: hit.id } : {}),
          country_code,
          chain_key,
          dish_name,
          dish_name_key,
          serving_grams,
          basis_type,
          nutrients,
          notes,
          ...(ingredients !== undefined ? { ingredients } : {}),
          ...(image_url !== undefined ? { image_url } : {}),
        });
        if (upRes.success) {
          invalidateBrandCache();
          return res.json({ success: true, item: { country_code, chain_key, dish_name, dish_name_key, serving_grams, basis_type, nutrients, notes, image_url, _source: 'd1' } });
        }
      } catch (d1Err) {
        console.warn('[brand-menu-items/edit] D1 update warning:', d1Err);
      }
    }

    const runLocalFallback = () => {
      const all = loadLocalItems();
      const idx = all.findIndex((it: any) => 
        it.country_code === country_code && 
        it.chain_key === chain_key && 
        it.dish_name_key === dish_name_key
      );
      if (idx >= 0) {
        const row = all[idx];
        row.dish_name = dish_name;
        row.serving_grams = serving_grams;
        row.basis_type = basis_type;
        row.nutrients = { ...row.nutrients, ...nutrients };
        row.notes = notes;
        if (ingredients !== undefined) {
          row.ingredients = ingredients;
        }
        if (image_url !== undefined) {
          row.image_url = image_url;
        }
        row.updated_at = new Date().toISOString();
        saveLocalItems(all);
        return res.json({ success: true, item: row, fallback: true });
      }
      return res.json({ success: true, item: { country_code, chain_key, dish_name, dish_name_key, serving_grams, basis_type, nutrients, notes, image_url } });
    };

    // D1 unavailable or upsert failed — local fallback.
    return runLocalFallback();
  });

  /** Delete a brand menu item */
  app.post('/api/brand-menu-items/delete', async (req: Request, res: Response) => {
    const country_code = String(req.body?.country_code || 'GB');
    const chain_key = String(req.body?.chain_key || '').trim().toLowerCase();
    const dish_name_key = String(req.body?.dish_name_key || '').trim();

    if (!chain_key || !dish_name_key) {
      return res.status(400).json({ error: 'chain_key and dish_name_key are required' });
    }

    if (isD1Configured()) {
      try {
        await d1Query('DELETE FROM brand_menu_items WHERE country_code = ? AND chain_key = ? AND (dish_name_key = ? OR dish_name = ?)', [country_code, chain_key, dish_name_key, dish_name_key]);
        invalidateBrandCache();
        return res.json({ success: true });
      } catch (d1Err) {
        console.warn('[brand-menu-items/delete] D1 delete warning:', d1Err);
      }
    }

    const runLocalFallback = () => {
      const all = loadLocalItems();
      const filtered = all.filter((it: any) => 
        !(it.country_code === country_code && 
          it.chain_key === chain_key && 
          it.dish_name_key === dish_name_key)
      );
      saveLocalItems(filtered);
      return res.json({ success: true, fallback: true });
    };

    // D-2: D1 is the only remote store (Supabase delete removed, no 402).
    return runLocalFallback();
  });

  /** Get recent meals with photos for admin photo-linking picker (D-2: D1-only) */
  app.get('/api/admin/meals-with-photos', async (_req: Request, res: Response) => {
    try {
      let meals: any[] = [];
      // D1 food_logs has image_urls (JSON text) + updated_at; macros other
      // than calories/saturated_fat/sodium live inside the nutrients JSON.
      if (isD1Configured()) {
        try {
          const d1Res = await d1Query<any>(
            `SELECT id, name, date, image_urls, calories, nutrients, weight_grams, updated_at
             FROM food_logs
             WHERE image_urls IS NOT NULL AND image_urls != '' AND image_urls != '[]'
             ORDER BY updated_at DESC
             LIMIT 50`
           );
          if (!d1Res.success) {
            throw new Error(d1Res.error || 'D1 query failed');
          }
          const d1Meals = d1Res.results || [];
          if (Array.isArray(d1Meals)) {
            meals = d1Meals.map((d: any) => {
              let urls: any[] = [];
              try {
                urls = typeof d.image_urls === 'string' ? safeJsonParse(d.image_urls, []) : (d.image_urls || []);
              } catch (_) { urls = []; }
              const nut = typeof d.nutrients === 'string' ? safeJsonParse(d.nutrients, {}) : (d.nutrients || {});
              return {
                id: d.id,
                name: d.name,
                date: d.date,
                imageUrl: urls[0] || null,
                imageUrls: urls,
                calories: d.calories,
                protein: nut.protein ?? null,
                carbohydrates: nut.carbohydrates ?? nut.carbs ?? null,
                totalFat: nut.totalFat ?? nut.fat ?? null,
                saturatedFat: nut.saturatedFat ?? null,
                sodium: nut.sodium ?? null,
                portionGrams: d.weight_grams ?? null
              };
            }).filter((m: any) => m.imageUrls.length > 0);
          }
        } catch (_) {}
      }

      res.json({ success: true, meals });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch meals with photos' });
    }
  });

  /** Link a meal photo (and optionally nutrients) to a brand item */
  app.post('/api/admin/brand-menu-items/link-meal', async (req: Request, res: Response) => {
    try {
      const brandItemId = req.body?.brandItemId ? String(req.body.brandItemId).trim() : '';
      const chain_key = String(req.body?.chain_key || req.body?.chainKey || '').trim().toLowerCase();
      const dish_name_key = String(req.body?.dish_name_key || req.body?.dishNameKey || '').trim();
      const country_code = String(req.body?.country_code || req.body?.countryCode || 'GB');
      const mealLogId = req.body?.mealLogId ? String(req.body.mealLogId).trim() : '';
      const photoIndex = req.body?.photoIndex != null ? Number(req.body.photoIndex) : 0;
      const copyNutrients = Boolean(req.body?.copyNutrients);
      let photoUrl = req.body?.photoUrl ? String(req.body.photoUrl).trim() : '';
      let mealData: any = null;

      if (mealLogId) {
        if (isD1Configured()) {
          try {
            const rowsRes = await d1Query<any>('SELECT * FROM food_logs WHERE id = ? LIMIT 1', [mealLogId]);
            if (!rowsRes.success) {
              console.warn('[link-meal] D1 meal lookup failed:', rowsRes.error);
            } else {
              const rows = rowsRes.results || [];
              if (rows.length > 0) mealData = rows[0];
            }
          } catch (e: any) {
            console.warn('[link-meal] D1 meal lookup threw:', e?.message || e);
          }
        }

        if (mealData) {
          const rawUrls = mealData.image_urls || mealData.imageUrls;
          let parsedUrls: string[] = [];
          if (Array.isArray(rawUrls)) parsedUrls = rawUrls;
          else if (typeof rawUrls === 'string') {
            try { parsedUrls = JSON.parse(rawUrls); } catch (_) { parsedUrls = [rawUrls]; }
          }
          if (parsedUrls.length === 0 && (mealData.image_url || mealData.imageUrl)) {
            parsedUrls = [mealData.image_url || mealData.imageUrl];
          }

          if (parsedUrls.length > 0) {
            const chosen = (photoIndex >= 0 && photoIndex < parsedUrls.length) ? parsedUrls[photoIndex] : parsedUrls[0];
            if (chosen) photoUrl = chosen;
          }
        }
      }

      if (!photoUrl) {
        return res.status(400).json({ error: 'No valid photo found for linking' });
      }

      const updateData = mealData
        ? buildBrandItemFromMealLog(mealData, photoUrl)
        : { image_url: photoUrl, updated_at: new Date().toISOString() };


      if (isD1Configured()) {
        try {
          const { d1Query } = await import('./server_d1.js');
          const d1NutrientsStr = JSON.stringify(updateData.nutrients || {});
          if (brandItemId) {
            await d1Query(
              `UPDATE brand_menu_items 
               SET image_url = ?, calories = ?, protein = ?, carbohydrates = ?, total_fat = ?, saturated_fat = ?, sodium = ?, serving_grams = ?, basis_type = ?, nutrients = ?, notes = ?, updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [
                updateData.image_url,
                updateData.calories,
                updateData.protein,
                updateData.carbohydrates,
                updateData.total_fat,
                updateData.saturated_fat,
                updateData.sodium,
                updateData.serving_grams,
                updateData.basis_type || 'per_dish',
                d1NutrientsStr,
                updateData.notes || '',
                brandItemId
              ]
            );
          } else if (chain_key && dish_name_key) {
            await d1Query(
              `UPDATE brand_menu_items 
               SET image_url = ?, calories = ?, protein = ?, carbohydrates = ?, total_fat = ?, saturated_fat = ?, sodium = ?, serving_grams = ?, basis_type = ?, nutrients = ?, notes = ?, updated_at = CURRENT_TIMESTAMP 
               WHERE country_code = ? AND chain_key = ? AND (dish_name_key = ? OR dish_name = ?)`,
              [
                updateData.image_url,
                updateData.calories,
                updateData.protein,
                updateData.carbohydrates,
                updateData.total_fat,
                updateData.saturated_fat,
                updateData.sodium,
                updateData.serving_grams,
                updateData.basis_type || 'per_dish',
                d1NutrientsStr,
                updateData.notes || '',
                country_code,
                chain_key,
                dish_name_key,
                dish_name_key
              ]
            );
          }
        } catch (d1Err) {
          console.warn('[link-meal] D1 update warning:', d1Err);
        }
      }

      // D-2: D1 is the only remote store (Supabase write removed, no 402).
      // d1Query is top-level imported.

      const all = loadLocalItems();
      const idx = all.findIndex((it: any) => 
        (brandItemId && it.id === brandItemId) || 
        (chain_key && it.chain_key === chain_key && (it.dish_name_key === dish_name_key || it.dish_name === dish_name_key))
      );
      if (idx >= 0) {
        all[idx] = { ...all[idx], ...updateData, updated_at: new Date().toISOString() };
        saveLocalItems(all);
      }

      return res.json({ success: true, photoUrl, copyNutrients, item: updateData });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to link meal to brand item' });
    }
  });

  /** Push any local-fallback brand menu items into D1, removing them locally once synced */
  app.post('/api/brand-menu-items/sync-to-supabase', async (req: Request, res: Response) => {
    // D-2: route name kept (admin UI calls it); the remote is D1 now.
    // Supabase upsert removed (no 402). Response shape unchanged.
    try {
      const country_code = String(req.body?.country_code || 'GB');
      const chain_key = req.body?.chain_key ? String(req.body.chain_key).trim().toLowerCase() : null;

      const all = loadLocalItems();
      const toSync = all.filter((it: any) =>
        it.country_code === country_code && (!chain_key || it.chain_key === chain_key)
      );

      if (toSync.length === 0) {
        return res.json({ success: true, synced: 0, failed: 0, remainingLocalOnly: 0 });
      }

      if (!isD1Configured()) {
        return res.json({ success: true, synced: 0, failed: toSync.length, remainingLocalOnly: toSync.length, sampleErrors: ['D1 not configured'] });
      }

      let synced = 0;
      let failed = 0;
      const stillLocal: any[] = [];
      const sampleErrors: string[] = [];

      const ALLOWED_BRAND_MENU_ITEM_COLUMNS = new Set([
        'country_code',
        'chain_key',
        'chain_name',
        'dish_name',
        'dish_name_key',
        'serving_grams',
        'basis_type',
        'nutrients',
        'ingredients',
        'source_url',
        'image_url',
        'notes',
        'enabled'
      ]);

      for (const item of toSync) {
        try {
          const payload: Record<string, any> = {};
          for (const [key, val] of Object.entries(item)) {
            if (ALLOWED_BRAND_MENU_ITEM_COLUMNS.has(key) && val !== undefined) {
              payload[key] = val;
            }
          }
          if (!payload.country_code) payload.country_code = country_code;
          if (!payload.chain_key && item.chain_name) {
            payload.chain_key = normalizeChainKey(item.chain_name);
          }
          if (!payload.dish_name_key && payload.dish_name) {
            payload.dish_name_key = normalizeDishKey(payload.dish_name);
          }
          const stableId = `sync_${payload.country_code}_${payload.chain_key}_${payload.dish_name_key}`.toLowerCase().slice(0, 120);

          const upRes = await d1UpsertBrandMenuItem({ id: stableId, ...payload });
          if (!upRes.success) throw new Error(upRes.error || 'D1 upsert failed');
          synced++;
        } catch (e: any) {
          failed++;
          stillLocal.push(item);
          const msg = e?.message || String(e);
          console.error('[sync-to-supabase] upsert failed for', item.dish_name_key, ':', msg);
          if (sampleErrors.length < 3 && !sampleErrors.includes(msg)) {
            sampleErrors.push(msg);
          }
        }
      }

      const untouched = all.filter((it: any) =>
        !(it.country_code === country_code && (!chain_key || it.chain_key === chain_key))
      );
      saveLocalItems([...untouched, ...stillLocal]);

      res.json({ success: true, synced, failed, remainingLocalOnly: stillLocal.length, sampleErrors });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'sync failed' });
    }
  });

  /** Preview parse only (no save) */
  app.post('/api/brand-menu-items/parse-paste', async (req: Request, res: Response) => {
    try {
      const text = String(req.body?.text || req.body?.paste || '');
      const parsed = parseMenuNutritionPaste(text);
      res.json({ success: true, parsed });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'parse failed' });
    }
  });
}
let cachedBrandSet: Set<string> | null = null;
let cachedGroceryBrandSet: Set<string> | null = null;
let lastBrandCacheTime = 0;
const BRAND_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours TTL

export async function fetchAllDatabaseBrands(): Promise<{ allBrands: Set<string>; groceryBrands: Set<string> }> {
  const now = Date.now();
  if (cachedBrandSet && cachedGroceryBrandSet && (now - lastBrandCacheTime < BRAND_CACHE_TTL_MS)) {
    return { allBrands: cachedBrandSet, groceryBrands: cachedGroceryBrandSet };
  }

  const allBrands = new Set<string>();
  const groceryBrands = new Set<string>();

  // Baseline seeds to ensure immediate availability before DB returns
  const defaultGrocery = ['sainsbury', 'sainsburys', "sainsbury's", 'tesco', 'asda', 'morrisons', 'aldi', 'lidl', 'waitrose', 'marks and spencer', 'm&s', 'co-op', 'coop', 'kroger', 'safeway', 'whole foods', 'trader joe'];
  const defaultChains = ['mcdonald', 'mcdonalds', "mcdonald's", 'kfc', 'burger king', 'subway', 'starbucks', 'domino', 'pizza hut', 'taco bell', 'popeyes', 'wendy', 'dunkin', 'greggs', 'nando', 'nandos', 'yolk', 'pret', 'itsu', 'wagamama'];

  defaultGrocery.forEach(b => { allBrands.add(b); groceryBrands.add(b); });
  defaultChains.forEach(b => { allBrands.add(b); });

  // 1. Fetch from D1 if configured
  if (isD1Configured()) {
    try {
      const { d1Query } = await import('./server_d1.js');
      const resBmi = await d1Query<any>('SELECT chain_name, chain_key FROM brand_menu_items LIMIT 500');
      if (!resBmi.success) {
        console.warn('[brand-menu] D1 brand fetch failed, using defaults only:', resBmi.error);
      } else {
        (resBmi.results || []).forEach((r: any) => {
          const name = (r.chain_name || '').toLowerCase().trim();
          const key = (r.chain_key || '').replace(/_/g, ' ').toLowerCase().trim();
          if (name) allBrands.add(name);
          if (key) allBrands.add(key);
        });
      }
      const resCms = await d1Query<any>('SELECT display_name, chain_key FROM chain_menu_sources LIMIT 500');
      if (!resCms.success) {
        console.warn('[brand-menu] D1 chain-source fetch failed, using defaults only:', resCms.error);
      } else {
        (resCms.results || []).forEach((r: any) => {
          const name = (r.display_name || '').toLowerCase().trim();
          const key = (r.chain_key || '').replace(/_/g, ' ').toLowerCase().trim();
          if (name) allBrands.add(name);
          if (key) allBrands.add(key);
        });
      }
    } catch (d1Err) {
      console.warn('[fetchAllDatabaseBrands] D1 fetch warning:', d1Err);
    }
  }

  // D-2: D1 + seeds + local only (Supabase brand fetch removed, no 402).
  // food_items brand_name sweep dropped with it (D1 food_items has no
  // brand column reads here; chain tables already cover the set).

  // 3. Fetch local fallback items
  try {
    const localItems = loadLocalItems();
    localItems.forEach((r: any) => {
      const name = (r.chain_name || '').toLowerCase().trim();
      const key = (r.chain_key || '').replace(/_/g, ' ').toLowerCase().trim();
      if (name) allBrands.add(name);
      if (key) allBrands.add(key);
      if (r.category && /grocery|supermarket|retail|store/i.test(r.category)) {
        if (name) groceryBrands.add(name);
        if (key) groceryBrands.add(key);
      }
    });
  } catch (_) {}

  cachedBrandSet = allBrands;
  cachedGroceryBrandSet = groceryBrands;
  lastBrandCacheTime = now;
  return { allBrands, groceryBrands };
}

export async function isKnownDatabaseBrand(text: string): Promise<boolean> {
  if (!text) return false;
  const { allBrands } = await fetchAllDatabaseBrands();
  const lower = text.toLowerCase();
  for (const b of allBrands) {
    if (!b || b.length < 2) continue;
    const regex = new RegExp(`\\b${b.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) return true;
  }
  return false;
}

const NEVER_A_BRAND = /^(sugar|salt|water|oil|flour|rice|pasta|ham|egg|eggs|butter|pepper|milk)$/i;

export function isKnownDatabaseBrandSync(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  if (NEVER_A_BRAND.test(lower)) return false;
  const set = cachedBrandSet;
  if (!set) {
    // Fallback if not initialized yet
    return /\b(sainsbury|tesco|asda|morrisons|aldi|lidl|waitrose|mcdonald|kfc|starbucks|pret|yolk|greg|nando)\b/i.test(lower);
  }
  for (const b of set) {
    if (!b || b.length < 2) continue;
    const regex = new RegExp(`\\b${b.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) return true;
  }
  return false;
}

export function isGroceryBrandSync(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const set = cachedGroceryBrandSet;
  if (!set || set.size === 0) {
    return /\b(sainsbury|tesco|asda|morrisons|aldi|lidl|waitrose|co-op|marks and spencer|m&s|kroger|safeway|whole foods|trader joe)\b/i.test(lower);
  }
  for (const b of set) {
    if (!b || b.length < 2) continue;
    const regex = new RegExp(`\\b${b.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) return true;
  }
  return false;
}

let cachedAllBrandItems: any[] | null = null;
let lastBrandItemsCacheTime = 0;
const BRAND_ITEMS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours TTL

export function invalidateBrandCache() {
  cachedAllBrandItems = null;
  cachedBrandSet = null;
  cachedGroceryBrandSet = null;
  lastBrandItemsCacheTime = 0;
  lastBrandCacheTime = 0;
}

export async function fetchAllBrandMenuItems(): Promise<any[]> {
  const now = Date.now();
  if (cachedAllBrandItems && (now - lastBrandItemsCacheTime < BRAND_ITEMS_CACHE_TTL_MS)) {
    return cachedAllBrandItems;
  }

  // D-2: D1-first, then local (Supabase fetch removed — client is 402-dead).
  let items: any[] = [];
  if (isD1Configured()) {
    try {
      const { d1GetBrandMenuItems } = await import('./server_db_d1.js');
      const d1Items = await d1GetBrandMenuItems();
      if (Array.isArray(d1Items) && d1Items.length > 0) {
        items = d1Items;
      }
    } catch (d1Err) {
      console.warn('[fetchAllBrandMenuItems] D1 fetch warning:', d1Err);
    }
  }

  try {
    const localItems = loadLocalItems();
    if (Array.isArray(localItems)) {
      const existingKeys = new Set(items.map(it => `${it.chain_key || ''}_${it.dish_name_key || normalizeDishKey(it.dish_name || '')}`));
      localItems.forEach(it => {
        const key = `${it.chain_key || ''}_${it.dish_name_key || normalizeDishKey(it.dish_name || '')}`;
        if (!existingKeys.has(key)) {
          items.push(it);
        }
      });
    }
  } catch (_) {}

  cachedAllBrandItems = items;
  lastBrandItemsCacheTime = now;
  return items;
}

const GENERIC_COMMODITY_FOODS = new Set([
  'milk', 'cow milk', 'whole milk', 'skim milk', 'semi skimmed milk', 'semi-skimmed milk', 'fresh milk', 'fluid milk',
  'water', 'tap water', 'spring water', 'mineral water',
  'egg', 'eggs', 'boiled egg', 'poached egg', 'fried egg', 'scrambled egg', 'raw egg',
  'apple', 'apples', 'banana', 'bananas', 'flat peach', 'peach', 'peaches', 'nectarine', 'nectarines',
  'grape', 'grapes', 'red grapes', 'green grapes', 'white grapes', 'plum', 'plums', 'berry', 'berries',
  'bread', 'toast', 'white bread', 'wholemeal bread', 'whole wheat bread',
  'rice', 'white rice', 'brown rice', 'cooked rice', 'steamed rice',
  'butter', 'unsalted butter', 'salted butter', 'margarine',
  'oil', 'olive oil', 'vegetable oil', 'cooking oil', 'sunflower oil',
  'salt', 'table salt', 'sea salt', 'black pepper', 'pepper', 'sugar', 'white sugar', 'brown sugar',
  'chicken', 'chicken breast', 'salmon', 'beef', 'pork',
  'ham', 'cooked ham', 'sliced ham', 'formed ham', 'reformed ham',
  'pasta', 'cooked pasta', 'lettuce', 'iceberg lettuce',
  'prawn', 'prawns', 'cooked prawns', 'shrimp', 'icing', 'frosting'
]);

/** Reject dry-cured / snack hits for generic cooked-ham queries. */
export function brandHitFitsQuery(query: string, hit: { name?: string; dish_name?: string; status?: string }): boolean {
  // F-11.1: quarantined/merged rows never match (soft-quarantine takes effect on reads).
  const st = String((hit as any)?.status || '').toLowerCase();
  if (st === 'quarantined' || st === 'merged') return false;
  const q = String(query || '').toLowerCase();
  const n = String(hit?.name || hit?.dish_name || '').toLowerCase();
  if (!q || !n) return true;
  if (/\b(cooked|reformed|formed)\s+ham\b/.test(q) || q === 'ham') {
    if (/serrano|iberico|ibérico|prosciutto|parma|jamon|jamón/.test(n) && !/reformed|formed|cooked/.test(n)) {
      return false;
    }
    if (/crisp|chip|chicken and ham/.test(n)) return false;
  }
  // Reject packaged crisps/chips snack products when the query itself is not
  // naming a crisps/chips snack (e.g. a "crispy onion" garnish/topping query
  // should not match a branded "Cheddar & Onion Crisps" snack just because
  // "crispy" and "crisps" share a word stem).
  if (/\bcrisps?\b|\bchips?\b/.test(n) && !/\bcrisps?\b|\bchips?\b/.test(q)) {
    return false;
  }
  return true;
}

export function isGenericCommodityFood(query: string): boolean {
  if (!query) return false;
  const qClean = query.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  if (GENERIC_COMMODITY_FOODS.has(qClean)) return true;
  const tokens = qClean.split(/\s+/).filter(Boolean);
  if (tokens.length <= 2 && tokens.every(t => GENERIC_COMMODITY_FOODS.has(t))) {
    return true;
  }
  return false;
}

const formatBrandHit = (matchedItem: any, query: string, matchScore: number, allItems: any[]) => {
    const cleanIngredients = cleanDescriptionText(matchedItem.ingredients || matchedItem.description || '');
    const saltG = matchedItem.nutrients?.salt ?? (matchedItem.nutrients?.sodium ? matchedItem.nutrients.sodium / 400 : undefined);
    const sodiumMg = matchedItem.nutrients?.sodium ?? (saltG ? Math.round(saltG * 400) : undefined);
    const cals = matchedItem.nutrients?.calories ?? null;
    const protein = matchedItem.nutrients?.protein ?? null;
    const fat = matchedItem.nutrients?.totalFat ?? matchedItem.nutrients?.fat ?? null;
    const satFat = matchedItem.nutrients?.saturatedFat ?? null;
    const carbs = matchedItem.nutrients?.carbohydrates ?? matchedItem.nutrients?.carbs ?? null;
    const sugar = matchedItem.nutrients?.sugar ?? null;
    const fiber = matchedItem.nutrients?.totalFibre ?? matchedItem.nutrients?.fiber ?? null;

    // OCR Duplicate Broadcast Scrape Detector:
    // Check if distinct items in the same chain share identical calorie values
    const chainItemsWithSameCals = allItems.filter(other =>
      other.id !== matchedItem.id &&
      (other.chain_key === matchedItem.chain_key || other.chain_name === matchedItem.chain_name) &&
      other.nutrients?.calories != null &&
      Number(other.nutrients.calories) === Number(cals) &&
      cals != null && Number(cals) > 0 &&
      other.dish_name !== matchedItem.dish_name
    );

    const normQ = normalizeDishKey(query);
    const isExactOrStrongMatch = matchScore >= 0.92 || normalizeDishKey(matchedItem.dish_name) === normQ;
    const isOcrCollision = !isExactOrStrongMatch && chainItemsWithSameCals.length >= 1;

    return {
      id: `brand_menu_${matchedItem.id || matchedItem.dish_name_key || normalizeDishKey(matchedItem.dish_name)}`,
      source: 'brand_official',
      brandPriority: true,
      searchQuery: query,
      name: matchedItem.dish_name,
      chainName: matchedItem.chain_name || matchedItem.chain_key || 'Brand',
      imageUrl: matchedItem.image_url || matchedItem.imageUrl || undefined,
      servingGrams: matchedItem.serving_grams || (matchedItem.basis_type === 'per_100g' ? 100 : null),
      calories: cals != null ? String(cals) : undefined,
      protein: protein != null ? Number(protein) : undefined,
      fat: fat != null ? Number(fat) : undefined,
      saturatedFat: satFat != null ? Number(satFat) : undefined,
      sodium: sodiumMg != null ? Number(sodiumMg) : undefined,
      salt: saltG != null ? Number(saltG) : undefined,
      carbohydrates: carbs != null ? Number(carbs) : undefined,
      sugar: sugar != null ? Number(sugar) : undefined,
      totalFibre: fiber != null ? Number(fiber) : undefined,
      isOcrCollision,
      anomalyFlags: isOcrCollision ? ['OCR_BROADCAST_COLLISION'] : [],
      nutrients: matchedItem.nutrients || {
        calories: cals,
        protein,
        totalFat: fat,
        saturatedFat: satFat,
        carbohydrates: carbs,
        sugar,
        sodium: sodiumMg,
        salt: saltG,
        totalFibre: fiber
      },
      ingredients: cleanIngredients,
      basisType: 'per_dish',
      sourceUrl: matchedItem.source_url || undefined,
      snippet: `${matchedItem.dish_name} (${matchedItem.chain_name || matchedItem.chain_key}): ${cleanIngredients}. Nutrition: ${cals} kcal, ${protein}g protein, ${carbs}g carbs (sugar ${sugar}g), ${fat}g fat, fiber ${fiber}g, salt ${saltG ?? '—'}g (sodium ${sodiumMg ?? '—'}mg)`
    };
  };

export async function getBrandMenuItemById(dbId: string): Promise<any | null> {
  const allItems = await fetchAllBrandMenuItems();
  if (!allItems || allItems.length === 0) return null;
  const rawId = dbId.startsWith('brand_menu_') ? dbId.slice(11) : dbId;
  const match = allItems.find(it => String(it.id) === rawId || it.dish_name_key === rawId || normalizeDishKey(it.dish_name) === rawId);
  if (match) {
    return formatBrandHit(match, match.dish_name, 1.0, allItems);
  }
  return null;
}


export async function searchBrandMenuItems(query: string, explicitChainKey?: string): Promise<any[]> {
  if (!query || query.trim().length < 2) return [];

  // Guard: generic commodity foods without explicit brand in query should never match branded menu items
  if (isGenericCommodityFood(query) && !isKnownDatabaseBrandSync(query)) {
    return [];
  }

  const allItems = await fetchAllBrandMenuItems();
  if (!allItems || allItems.length === 0) return [];

  const normQ = normalizeDishKey(query);
  const qLower = query.toLowerCase();

  const DISH_FORM_WORDS = new Set([
    'sandwich', 'side', 'cup', 'bites', 'bowl', 'salad', 'wrap', 'burger',
    'sub', 'roll', 'bar', 'shake', 'platter', 'box', 'meal'
  ]);

  const normalizeWordToken = (w: string): string => {
    let word = w.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    if (word.endsWith('ies') && word.length > 4) {
      word = word.slice(0, -3) + 'y';
    } else if (word.endsWith('es') && word.length > 4) {
      word = word.slice(0, -2);
    } else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
      word = word.slice(0, -1);
    }
    return word;
  };



  const scoreDishMatch = (queryKey: string, itemKey: string, chainKey?: string): number => {
    if (queryKey === itemKey) return 999;
    if (chainKey && queryKey === `${chainKey}_${itemKey}`) return 999;
    if (chainKey && itemKey === `${chainKey}_${queryKey}`) return 999;
    if (queryKey.includes(itemKey) && itemKey.length > 4) return 500;

    const rawQWords = queryKey.split('_').filter(w => w.length >= 2);
    const rawIWords = itemKey.split('_').filter(w => w.length >= 2);
    if (chainKey) {
      rawIWords.push(...chainKey.split('_'));
    }

    const qWords = new Set(rawQWords.map(normalizeWordToken).filter(w => w.length >= 2));
    const iWords = new Set(rawIWords.map(normalizeWordToken).filter(w => w.length >= 2));
    if (qWords.size === 0 || iWords.size === 0) return 0;

    // Guard: reject candidates whose dish "form" word (side/sandwich/cup/bowl/bites/etc.)
    // conflicts with the query's form word, even if other words overlap.
    const qForms = [...qWords].filter(w => DISH_FORM_WORDS.has(w));
    const iForms = [...iWords].filter(w => DISH_FORM_WORDS.has(w));
    if (qForms.length > 0 && iForms.length > 0 && !qForms.some(f => iForms.includes(f))) {
      return 0;
    }

    let shared = 0;
    qWords.forEach(qw => {
      if (iWords.has(qw) || [...iWords].some(iw => (iw.length > 3 && qw.length > 3 && (iw.startsWith(qw) || qw.startsWith(iw))))) {
        shared++;
      }
    });

    const qCoverage = shared / qWords.size; // How much of the query is satisfied
    const iCoverage = shared / iWords.size; // How specific the match is
    let score = (qCoverage * 0.7) + (iCoverage * 0.3);

    if (chainKey && (qLower.includes(chainKey.replace(/_/g, ' ')) || qLower.includes(chainKey))) {
      score *= 1.3;
    }
    return score;
  };

  const matches: Array<{ item: any; score: number }> = [];

  for (const it of allItems) {
    if (!it.dish_name) continue;
    const st = String(it.status || '').toLowerCase();
    if (st === 'quarantined' || st === 'merged') continue;

    const normItemKey = it.dish_name_key || normalizeDishKey(it.dish_name);
    const itemChainKey = (it.chain_key || it.chain_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');

    if (explicitChainKey && itemChainKey) {
      const expNorm = explicitChainKey.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      if (!itemChainKey.includes(expNorm) && !expNorm.includes(itemChainKey)) {
        continue;
      }
    }

    const score = scoreDishMatch(normQ, normItemKey, itemChainKey);
    const threshold = (explicitChainKey || (itemChainKey && qLower.includes(itemChainKey.replace(/_/g, ' ')))) ? 0.45 : 0.85;

    if (score >= threshold) {
      matches.push({ item: it, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 5).map(({ item: matchedItem, score: matchScore }) => {
    return formatBrandHit(matchedItem, query, matchScore, allItems);
  });
}


