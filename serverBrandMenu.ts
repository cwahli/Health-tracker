import type { Express, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { inferBasisFromServingText, toPer100g, parseNutrientNumber } from './server_nutrient_basis';
import { runBrandCuratorStage } from './src/server/food/brandCurator.js';
import { isD1Configured } from './server_d1.js';
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
      const existing = existingRes?.results || [];
      if (existing.length > 0 && (!existing[0].image_url || existing[0].image_url.trim() === '')) {
        await d1Query(
          'UPDATE brand_menu_items SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [photoUrl, existing[0].id]
        );
      }
    }

    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    if (supabaseAdmin) {
      const { data: existingSb } = await supabaseAdmin
        .from('brand_menu_items')
        .select('id, image_url')
        .eq('country_code', countryCode)
        .eq('chain_key', chainKey)
        .eq('dish_name_key', dishNameKey)
        .maybeSingle();

      if (existingSb && (!existingSb.image_url || existingSb.image_url.trim() === '')) {
        await supabaseAdmin
          .from('brand_menu_items')
          .update({ image_url: photoUrl, updated_at: new Date().toISOString() })
          .eq('id', existingSb.id);
      }
    }
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
  supabaseAdmin?: any;
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
  let admin = args.supabaseAdmin;
  if (!admin) {
    try {
      const mod: any = await import('./supabaseAdmin.js');
      admin = mod?.supabaseAdmin;
    } catch {
      return { ...EMPTY_COUNTS };
    }
  }
  if (!admin) return { ...EMPTY_COUNTS };

  // Status-column probe is implicit: this select fails when the F-11.1
  // migration has not run yet. Skip writes AND do not mark throttle.
  let items: any[];
  try {
    const { data, error } = await admin
      .from('brand_menu_items')
      .select(
        'id, country_code, chain_key, dish_name, dish_name_key, nutrients, capture_count, confidence, provenance, notes, updated_at, status'
      )
      .eq('country_code', country)
      .eq('chain_key', chainKey);
    if (error) throw error;
    items = Array.isArray(data) ? data : [];
  } catch (e: any) {
    log(
      `[BrandClean] ${scope}: cannot scan (${e?.message || e}). Run supabase/migrations/20260913_brand_menu_items_status.sql, then retry.`
    );
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
      const { error } = await admin
        .from('brand_menu_items')
        .update({ status: 'quarantined', updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
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
        const { error } = await admin
          .from('brand_menu_items')
          .update({ dish_name: cleanTitle, dish_name_key: cleanKey })
          .eq('id', item.id);
        if (error) throw error;
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
        adminClient: admin,
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
  supabaseAdmin: any,
  countryCode: string = 'GB',
  addDebugLog?: (msg: string) => void
): Promise<BrandCleanCounts> {
  // F-11.1: soft per-chain clean (was: whole-country hard delete).
  // Admin "Clean now" bypasses the per-chain throttle.
  const log = addDebugLog || console.log;
  const country = String(countryCode || 'GB').toUpperCase();
  const agg: BrandCleanCounts = {
    removedUnofficialCount: 0,
    deletedDuplicatesCount: 0,
    updatedChainsCount: 0,
    details: [],
  };
  if (!supabaseAdmin) {
    log(`[BrandClean] ${country}: supabaseAdmin is null; skipping database clean.`);
    return agg;
  }
  let chains: string[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('brand_menu_items')
      .select('chain_key')
      .eq('country_code', country);
    if (error) throw error;
    chains = [...new Set((Array.isArray(data) ? data : []).map((r: any) => r.chain_key).filter(Boolean))];
  } catch (e: any) {
    log(`[BrandClean] ${country}: cannot list chains (${e?.message || e}).`);
    return agg;
  }
  for (const chainKey of chains) {
    const r = await cleanBrandChain({
      supabaseAdmin,
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
  supabaseAdmin: any,
  item: any,
  countryCode: string,
  addDebugLog: (msg: string) => void
): Promise<void> {
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
        const sourceUrl = `crowdsourced://ocr/${chain_key}`;
        const nowIso = new Date().toISOString();
        await supabaseAdmin.from('chain_menu_sources').upsert({
          chain_key,
          country_code: countryCode,
          url: sourceUrl,
          status: 'ready',
          enabled: true,
          last_success_at: nowIso,
          updated_at: nowIso,
        }, { onConflict: 'country_code,chain_key,url' });
      } catch (e: any) {
        // Soft-fail OK
      }

      const { data: chainRows, error: lookupErr } = await supabaseAdmin
        .from('brand_menu_items')
        .select('id, dish_name, dish_name_key, basis_type, serving_grams, nutrients')
        .eq('country_code', countryCode)
        .eq('chain_key', chain_key);

      if (lookupErr) {
        addDebugLog(`[AutoChainRegister] lookup error, skipping: ${lookupErr.message}`);
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
          await supabaseAdmin.from('brand_menu_items').delete().in('id', extraIds);
        }
      }

      const isPlaceholderIngredientText = (s: any) => typeof s === 'string' && s.trim().toLowerCase().startsWith('auto-captured from photo ocr');
      const rawIngredients = item?.ingredientsList || item?.ingredients || rawLabel?.ingredients || null;
      const ingredients = isPlaceholderIngredientText(rawIngredients) ? null : rawIngredients;
      const isPartialLocked = lockedKeysList && lockedKeysList.length > 0 && Object.keys(nutrients).length < 4;

      if (!existing) {
        const row = {
          country_code: countryCode,
          chain_key,
          dish_name: dishName,
          dish_name_key,
          serving_grams,
          basis_type,
          nutrients,
          nutrients_per_100g,
          ingredients,
          provenance: isPartialLocked ? 'ocr_partial' : 'ocr_auto',
          confidence: isPartialLocked ? 0.45 : 0.55,
          capture_count: 1,
          source_url: `crowdsourced://ocr/${chain_key}`,
          notes: isPartialLocked
            ? `Auto-captured from photo OCR (Official printed keys: ${lockedKeysList.join(', ')})`
            : 'Auto-captured from photo OCR',
          enabled: true,
          updated_at: new Date().toISOString(),
        };
        const { error: insertErr } = await supabaseAdmin.from('brand_menu_items').insert(row);
        if (insertErr) {
          addDebugLog(`[AutoChainRegister] insert failed for "${dishName}": ${insertErr.message}`);
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
        const updatedConfidence = Math.min(0.95, (existing.confidence || 0.5) + 0.05);

        const updates: Record<string, any> = {
          dish_name: dishName,
          dish_name_key,
          nutrients: mergedNutrients,
          nutrients_per_100g: mergedNutrients100g,
          capture_count: updatedCaptureCount,
          confidence: updatedConfidence,
          updated_at: new Date().toISOString(),
        };

        if ((existing.serving_grams === null || existing.serving_grams === undefined) && serving_grams) {
          updates.serving_grams = serving_grams;
        }
        if (!existing.ingredients && ingredients) {
          updates.ingredients = ingredients;
        }

        const { error: updateErr } = await supabaseAdmin
          .from('brand_menu_items')
          .update(updates)
          .eq('id', existing.id);

        if (updateErr) {
          addDebugLog(`[AutoChainRegister] update failed for "${dishName}": ${updateErr.message}`);
        } else {
          addDebugLog(`[AutoChainRegister] Updated existing dish "${dishName}" (capture #${updatedCaptureCount}).`);
        }
      }

      cleanBrandChain({ supabaseAdmin, chainKey: chain_key, countryCode, onLog: addDebugLog }).catch(() => {});
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

async function maybeMarkChainReady(supabaseAdmin: any, chainKey: string, countryCode: string) {
  try {
    await supabaseAdmin
      .from('chain_menu_sources')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('chain_key', chainKey)
      .eq('country_code', countryCode);
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

      // 2. Save to Supabase if available
      try {
        const { supabaseAdmin } = await import('./supabaseAdmin.js');
        if (supabaseAdmin) {
          if (id) {
            const { data, error } = await supabaseAdmin
              .from('chain_menu_sources')
              .upsert(row, { onConflict: 'id' })
              .select('*')
              .single();
            if (!error && data) savedSource = data;
          } else {
            const { data, error } = await supabaseAdmin
              .from('chain_menu_sources')
              .upsert(row, { onConflict: 'country_code,chain_key,url' })
              .select('*')
              .single();
            if (!error && data) savedSource = data;
          }
        }
      } catch (sbErr) {
        console.warn('[chain-menu-sources/save] Supabase save warning:', sbErr);
      }

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

      // 1. Delete from D1 if configured
      if (isD1Configured()) {
        try {
          await d1DeleteChainMenuSource(id || chain_key);
        } catch (d1Err) {
          console.warn('[chain-menu-sources/delete] D1 delete warning:', d1Err);
        }
      }

      // 2. Delete from Supabase if available
      try {
        const { supabaseAdmin } = await import('./supabaseAdmin.js');
        if (supabaseAdmin) {
          if (id) {
            await supabaseAdmin.from('chain_menu_sources').delete().eq('id', id);
          }
          if (chain_key) {
            await supabaseAdmin.from('chain_menu_sources').delete().eq('chain_key', chain_key);
            await supabaseAdmin.from('brand_menu_items').delete().eq('chain_key', chain_key);
          }
        }
      } catch (sbErr) {
        console.warn('[chain-menu-sources/delete] Supabase delete warning:', sbErr);
      }

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

      // 2. Try Supabase if available and D1 didn't find items
      if (taggedItems.length === 0) {
        try {
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          if (supabaseAdmin) {
            let query = supabaseAdmin.from('brand_menu_items').select('*');
            if (chain_key) query = query.eq('chain_key', chain_key);
            if (country_code) query = query.eq('country_code', country_code);
            const { data, error } = await query.order('dish_name', { ascending: true });
            if (!error && data && data.length > 0) {
              taggedItems = data.map((it: any) => ({ ...it, _source: 'supabase' }));
            }
          }
        } catch (sbErr) {
          console.warn('[brand-menu-items] Supabase fetch warning:', sbErr);
        }
      }

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

    // 2. Search Supabase if available
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin
          .from('brand_menu_items')
          .select('*')
          .eq('country_code', country_code)
          .ilike('dish_name', `%${q}%`)
          .limit(50);
        if (!error && data) {
          results.push(...data.map((it: any) => ({ ...it, _source: 'supabase' })));
        }
      }
    } catch (e) {
      console.warn('[brand-menu-items/search] supabase query failed:', e);
    }

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

    if (isD1Configured()) {
      for (const row of rows) {
        try {
          await d1UpsertBrandMenuItem(row);
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

    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin
          .from('brand_menu_items')
          .upsert(rows, { onConflict: 'country_code,chain_key,dish_name_key' })
          .select('*');
        if (!error) {
          invalidateBrandCache();
          return res.json({ success: true, upserted: (data || []).length, items: data });
        }
      }
      return runLocalFallback();
    } catch (err: any) {
      return runLocalFallback();
    }
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
          await d1UpsertBrandMenuItem(row);
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
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          if (supabaseAdmin) await maybeMarkChainReady(supabaseAdmin, chain_key, country_code);
        } catch (_) {}
        return res.json({ success: true, item: { ...row, _source: 'local_fallback' }, parsed, fallback: true });
      };

      try {
        const { supabaseAdmin } = await import('./supabaseAdmin.js');
        if (supabaseAdmin) {
          const { data, error } = await supabaseAdmin
            .from('brand_menu_items')
            .upsert(row, { onConflict: 'country_code,chain_key,dish_name_key' })
            .select('*')
            .single();
          if (!error && data) {
            try {
              await maybeMarkChainReady(supabaseAdmin, chain_key, country_code);
            } catch (_) {}
            invalidateBrandCache();
            return res.json({ success: true, item: { ...data, _source: 'supabase' }, parsed });
          }
        }
      } catch (sbErr) {
        console.warn('[brand-menu-items/paste] Supabase upsert warning:', sbErr);
      }

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

        if (isD1Configured()) {
          try {
            await d1UpsertBrandMenuItem(row);
          } catch (e) {
            console.warn('[brand-menu-items/bulk-paste] D1 upsert warning:', e);
          }
        }

        let savedViaSupabase = false;
        try {
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          if (supabaseAdmin) {
            const { error } = await supabaseAdmin
              .from('brand_menu_items')
              .upsert(row, { onConflict: 'country_code,chain_key,dish_name_key' })
              .select('*')
              .single();
            if (!error) {
              results.push({ dish_name: dish.dish_name, status: 'saved', source: 'supabase', warnings: dish.warnings });
              savedViaSupabase = true;
            }
          }
        } catch (_) {}

        if (!savedViaSupabase) {
          const all = loadLocalItems();
          const idx = all.findIndex((it: any) =>
            it.country_code === row.country_code &&
            it.chain_key === row.chain_key &&
            it.dish_name_key === row.dish_name_key
          );
          if (idx >= 0) all[idx] = row;
          else all.push(row);
          saveLocalItems(all);
          results.push({ dish_name: dish.dish_name, status: 'saved', source: isD1Configured() ? 'd1' : 'local_fallback', warnings: dish.warnings });
        }
      }

      try {
        const { supabaseAdmin } = await import('./supabaseAdmin.js');
        if (supabaseAdmin) await maybeMarkChainReady(supabaseAdmin, chain_key, country_code);
      } catch (_) {}

      const savedToSupabase = results.filter((r) => r.source === 'supabase').length;
      const savedLocalOnly = results.filter((r) => r.source !== 'supabase' && r.status === 'saved').length;
      const errors = results.filter((r) => r.status === 'error').length;

      res.json({
        success: true,
        results,
        summary: { total: dishes.length, savedToSupabase, savedLocalOnly, errors },
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

    if (isD1Configured()) {
      try {
        await d1UpsertBrandMenuItem({
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

    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      if (supabaseAdmin) {
        const updatePayload: Record<string, any> = {
          dish_name,
          serving_grams,
          basis_type,
          nutrients,
          notes,
          ...(ingredients !== undefined ? { ingredients } : {}),
          updated_at: new Date().toISOString()
        };
        if (image_url !== undefined) {
          updatePayload.image_url = image_url;
        }
        const { data, error } = await supabaseAdmin
          .from('brand_menu_items')
          .update(updatePayload)
          .eq('country_code', country_code)
          .eq('chain_key', chain_key)
          .eq('dish_name_key', dish_name_key)
          .select('*')
          .single();

        if (!error && data) {
          return res.json({ success: true, item: data });
        }
      }
      return runLocalFallback();
    } catch (err: any) {
      return runLocalFallback();
    }
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
        const { d1Query } = await import('./server_d1.js');
        await d1Query('DELETE FROM brand_menu_items WHERE country_code = ? AND chain_key = ? AND (dish_name_key = ? OR dish_name = ?)', [country_code, chain_key, dish_name_key, dish_name_key]);
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

    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      if (supabaseAdmin) {
        const { error } = await supabaseAdmin
          .from('brand_menu_items')
          .delete()
          .eq('country_code', country_code)
          .eq('chain_key', chain_key)
          .eq('dish_name_key', dish_name_key);

        if (!error) {
          return res.json({ success: true });
        }
      }
      return runLocalFallback();
    } catch (err: any) {
      return runLocalFallback();
    }
  });

  /** Get recent meals with photos for admin photo-linking picker */
  app.get('/api/admin/meals-with-photos', async (_req: Request, res: Response) => {
    try {
      let meals: any[] = [];
      try {
        const { supabaseAdmin } = await import('./supabaseAdmin.js');
        if (supabaseAdmin) {
          const { data, error } = await supabaseAdmin
            .from('food_logs')
            .select('id, name, date, image_url, image_urls, calories, protein, carbohydrates, total_fat, saturated_fat, sodium, portion_grams')
            .not('image_url', 'is', null)
            .order('created_at', { ascending: false })
            .limit(50);
          if (!error && Array.isArray(data) && data.length > 0) {
            meals = data.map((d: any) => ({
              id: d.id,
              name: d.name,
              date: d.date,
              imageUrl: d.image_url,
              imageUrls: d.image_urls || (d.image_url ? [d.image_url] : []),
              calories: d.calories,
              protein: d.protein,
              carbohydrates: d.carbohydrates,
              totalFat: d.total_fat,
              saturatedFat: d.saturated_fat,
              sodium: d.sodium,
              portionGrams: d.portion_grams
            }));
          }
        }
      } catch (_) {}

      if (meals.length === 0 && isD1Configured()) {
        try {
          const { d1Query } = await import('./server_d1.js');
          const d1Res = await d1Query<any>(
            `SELECT id, name, date, image_url, image_urls, calories, protein, carbohydrates, total_fat, saturated_fat, sodium, portion_grams 
             FROM food_logs 
             WHERE (image_url IS NOT NULL AND image_url != '') 
                OR (image_urls IS NOT NULL AND image_urls != '') 
             ORDER BY created_at DESC 
             LIMIT 50`
          );
          const d1Meals = d1Res?.results || [];
          if (Array.isArray(d1Meals)) {
            meals = d1Meals.map(d => ({
              id: d.id,
              name: d.name,
              date: d.date,
              imageUrl: d.image_url,
              imageUrls: d.image_urls ? (typeof d.image_urls === 'string' ? JSON.parse(d.image_urls) : d.image_urls) : (d.image_url ? [d.image_url] : []),
              calories: d.calories,
              protein: d.protein,
              carbohydrates: d.carbohydrates,
              totalFat: d.total_fat,
              saturatedFat: d.saturated_fat,
              sodium: d.sodium,
              portionGrams: d.portion_grams
            }));
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
        try {
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('food_logs').select('*').eq('id', mealLogId).maybeSingle();
            if (data) mealData = data;
          }
        } catch (_) {}

        if (!mealData && isD1Configured()) {
          try {
            const { d1Query } = await import('./server_d1.js');
            const rowsRes = await d1Query<any>('SELECT * FROM food_logs WHERE id = ? LIMIT 1', [mealLogId]);
            const rows = rowsRes?.results || [];
            if (rows.length > 0) mealData = rows[0];
          } catch (_) {}
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

      const updateData: Record<string, any> = { image_url: photoUrl };
      if (copyNutrients && mealData) {
        const cal = Number(mealData.calories);
        const prot = Number(mealData.protein);
        const carb = Number(mealData.carbohydrates);
        const fat = Number(mealData.total_fat ?? mealData.fat);
        const sat = Number(mealData.saturated_fat ?? mealData.saturatedFat);
        const sod = Number(mealData.sodium);
        if (!isNaN(cal)) updateData.calories = cal;
        if (!isNaN(prot)) updateData.protein = prot;
        if (!isNaN(carb)) updateData.carbohydrates = carb;
        if (!isNaN(fat)) updateData.total_fat = fat;
        if (!isNaN(sat)) updateData.saturated_fat = sat;
        if (!isNaN(sod)) updateData.sodium = sod;
        updateData.nutrients = {
          ...(updateData.nutrients || {}),
          calories: cal,
          protein: prot,
          carbohydrates: carb,
          totalFat: fat,
          saturatedFat: sat,
          sodium: sod
        };
      }

      if (isD1Configured()) {
        try {
          const { d1Query } = await import('./server_d1.js');
          if (brandItemId) {
            await d1Query('UPDATE brand_menu_items SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [photoUrl, brandItemId]);
          } else if (chain_key && dish_name_key) {
            await d1Query(
              'UPDATE brand_menu_items SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE country_code = ? AND chain_key = ? AND (dish_name_key = ? OR dish_name = ?)',
              [photoUrl, country_code, chain_key, dish_name_key, dish_name_key]
            );
          }
        } catch (d1Err) {
          console.warn('[link-meal] D1 update warning:', d1Err);
        }
      }

      try {
        const { supabaseAdmin } = await import('./supabaseAdmin.js');
        if (supabaseAdmin) {
          let q = supabaseAdmin.from('brand_menu_items').update(updateData);
          if (brandItemId) {
            q = q.eq('id', brandItemId);
          } else if (chain_key && dish_name_key) {
            q = q.eq('country_code', country_code).eq('chain_key', chain_key).eq('dish_name_key', dish_name_key);
          }
          await q;
        }
      } catch (_) {}

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

  /** Push any local-fallback brand menu items into Supabase, removing them locally once synced */
  app.post('/api/brand-menu-items/sync-to-supabase', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const country_code = String(req.body?.country_code || 'GB');
      const chain_key = req.body?.chain_key ? String(req.body.chain_key).trim().toLowerCase() : null;

      const all = loadLocalItems();
      const toSync = all.filter((it: any) =>
        it.country_code === country_code && (!chain_key || it.chain_key === chain_key)
      );

      if (toSync.length === 0) {
        return res.json({ success: true, synced: 0, failed: 0, remainingLocalOnly: 0 });
      }

      let synced = 0;
      let failed = 0;
      const stillLocal: any[] = [];
      const sampleErrors: string[] = [];

      const ALLOWED_BRAND_MENU_ITEM_COLUMNS = new Set([
        'country_code',
        'chain_key',
        'dish_name',
        'dish_name_key',
        'serving_grams',
        'basis_type',
        'nutrients',
        'nutrients_per_100g',
        'ingredients',
        'provenance',
        'confidence',
        'capture_count',
        'source_url',
        'image_url',
        'notes',
        'enabled',
        'updated_at'
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

          const { error } = await supabaseAdmin
            .from('brand_menu_items')
            .upsert(payload, { onConflict: 'country_code,chain_key,dish_name_key' })
            .select('*')
            .single();
          if (error) throw error;
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

  /** Admin route: Trigger self-cleaning and database deduplication */
  app.post('/api/admin/db-clean', async (req: Request, res: Response) => {
    try {
      const { supabaseAdmin } = await import('./supabaseAdmin.js');
      const chainStats = await consolidateBrandMenuItemsAndChains(supabaseAdmin);
      const catalogStats = await cleanUnbrandedFoodCatalog(supabaseAdmin);
      res.json({
        success: true,
        chainStats,
        catalogStats,
        message: 'Self-cleaning database maintenance completed successfully.'
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Self-cleaning failed' });
    }
  });
}

export async function consolidateBrandMenuItemsAndChains(
  supabaseAdmin: any,
  addDebugLog?: (msg: string) => void
): Promise<{ mergedItemsCount: number; deletedDuplicatesCount: number; updatedChainsCount: number; duplicatesFound: { chain_key: string; dish_name: string; kept: number; removed: number }[] }> {
  let mergedItemsCount = 0;
  let deletedDuplicatesCount = 0;
  let updatedChainsCount = 0;
  const duplicatesFound: { chain_key: string; dish_name: string; kept: number; removed: number }[] = [];

  try {
    if (!supabaseAdmin) return { mergedItemsCount, deletedDuplicatesCount, updatedChainsCount, duplicatesFound };

    // 1. Fetch all brand menu items
    const { data: allItems, error: itemsErr } = await supabaseAdmin
      .from('brand_menu_items')
      .select('*');

    if (!itemsErr && Array.isArray(allItems) && allItems.length > 0) {
      const groups = new Map<string, any[]>();
      for (const item of allItems) {
        // Filter out zero-nutrient items
        const nuts = item.nutrients || {};
        const isZero = Object.values(nuts).every(v => Number(v) === 0 || v === null || v === undefined);
        const cal = Number(nuts.calories || 0);
        if (isZero || cal <= 0) {
          await supabaseAdmin.from('brand_menu_items').delete().eq('id', item.id);
          deletedDuplicatesCount++;
          if (addDebugLog) addDebugLog(`Deleted empty nutrient item: ${item.chain_key} - ${item.dish_name}`);
          continue;
        }
        const cCode = (item.country_code || 'GB').toUpperCase();
        const normChain = normalizeChainKey(item.chain_key || item.chain_name || '');
        const normDish = normalizeDishKey(item.dish_name || item.dish_name_key || '');
        if (!normChain || !normDish) continue;

        const missingBasis = !item.basis_type || String(item.basis_type).trim() === '';
        if (missingBasis) {
          await supabaseAdmin
            .from('brand_menu_items')
            .update({
              basis_type: 'per_dish',
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);
          item.basis_type = 'per_dish';
          updatedChainsCount++;
        }

        const groupKey = `${cCode}::${normChain}::${normDish}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(item);
      }

      for (const [groupKey, items] of groups.entries()) {
        const [cCode, normChain, normDish] = groupKey.split('::');

        if (items.length === 1) {
          const single = items[0];
          // Do NOT convert per_100g grocery labels to per_dish (that corrupted Co-op beef/yogurt).
          // Only normalize chain/dish keys when needed.
          if (single.chain_key !== normChain || single.dish_name_key !== normDish) {
            const { error: upErr } = await supabaseAdmin
              .from('brand_menu_items')
              .update({
                chain_key: normChain,
                dish_name_key: normDish,
                updated_at: new Date().toISOString()
              })
              .eq('id', single.id);
            if (!upErr) updatedChainsCount++;
          }
        } else if (items.length > 1) {
          items.sort((a, b) => {
            const aNutCount = Object.values(a.nutrients || {}).filter((v: any) => Number(v) > 0).length;
            const bNutCount = Object.values(b.nutrients || {}).filter((v: any) => Number(v) > 0).length;
            if (bNutCount !== aNutCount) return bNutCount - aNutCount;
            const aCapt = Number(a.capture_count || 1);
            const bCapt = Number(b.capture_count || 1);
            if (bCapt !== aCapt) return bCapt - aCapt;
            return new Date(b.created_at || b.updated_at || 0).getTime() - new Date(a.created_at || a.updated_at || 0).getTime();
          });

          const primary = items[0];
          const duplicates = items.slice(1);

          duplicatesFound.push({
            chain_key: normChain,
            dish_name: items[0].dish_name || normDish,
            kept: 1,
            removed: items.length - 1
          });

          const mergedNutrients = { ...(primary.nutrients || {}) };
          let totalCaptures = Number(primary.capture_count || 1);
          let mergedIngredients = primary.ingredients || null;

          for (const dup of duplicates) {
            totalCaptures += Number(dup.capture_count || 1);
            if (!mergedIngredients && dup.ingredients) {
              mergedIngredients = dup.ingredients;
            }
            if (dup.nutrients && typeof dup.nutrients === 'object') {
              for (const [k, v] of Object.entries(dup.nutrients)) {
                if ((mergedNutrients[k] === undefined || mergedNutrients[k] === null) && v !== null && v !== undefined) {
                  mergedNutrients[k] = Number(v);
                }
              }
            }
          }

          const { error: updatePrimaryErr } = await supabaseAdmin
            .from('brand_menu_items')
            .update({
              chain_key: normChain,
              dish_name_key: normDish,
              nutrients: mergedNutrients,
              ingredients: mergedIngredients,
              capture_count: totalCaptures,
              updated_at: new Date().toISOString()
            })
            .eq('id', primary.id);

          if (!updatePrimaryErr) {
            mergedItemsCount++;
            const dupIds = duplicates.map(d => d.id).filter(Boolean);
            if (dupIds.length > 0) {
              const { error: delErr } = await supabaseAdmin
                .from('brand_menu_items')
                .delete()
                .in('id', dupIds);
              if (!delErr) {
                deletedDuplicatesCount += dupIds.length;
              }
            }
          }
        }
      }
    }

    // 1B. Semantic dedup within each chain: catch the same product listed under different
    // names (e.g. a user-typed generic name vs. the official branded product name) by
    // comparing nutrient profiles. The exact-key merge above only catches formatting
    // variations of the SAME name; this catches DIFFERENT names for the SAME product.
    try {
      const { data: postMergeItems, error: postMergeErr } = await supabaseAdmin
        .from('brand_menu_items')
        .select('*');

      if (!postMergeErr && Array.isArray(postMergeItems) && postMergeItems.length > 1) {
        const chainGroups = new Map<string, any[]>();
        for (const item of postMergeItems) {
          const cCode = (item.country_code || 'GB').toUpperCase();
          const normChain = normalizeChainKey(item.chain_key || item.chain_name || '');
          if (!normChain) continue;
          const key = `${cCode}::${normChain}`;
          if (!chainGroups.has(key)) chainGroups.set(key, []);
          chainGroups.get(key)!.push(item);
        }

        // Heuristic: score how "official" a dish name looks vs. a user-typed generic label.
        // Signals for official: multi-word Title Case, retailer qualifiers ("Taste the
        // Difference", "Finest", "Extra Special"), longer descriptive names.
        // Signals for generic/user-typed: '+' separators, all-lowercase, very short.
        const officialNameScore = (name: string): number => {
          const n = String(name || '');
          let score = 0;
          if (/\+/.test(n)) score -= 3;
          if (n === n.toLowerCase()) score -= 2;
          const capWords = (n.match(/\b[A-Z][a-z]/g) || []).length;
          score += capWords;
          if (/taste the difference|finest|extra special|reserve|signature select/i.test(n)) score += 4;
          score += Math.min(n.length / 12, 3);
          return score;
        };

        // Nutrients must be within tolerance across the core macros to be considered the
        // same product; name similarity alone is never sufficient grounds to merge.
        const NUTRIENT_KEYS = ['calories', 'protein', 'carbohydrates', 'totalFat', 'totalFibre'];
        const withinTolerance = (a: any, b: any): boolean => {
          let comparable = 0;
          for (const k of NUTRIENT_KEYS) {
            const av = Number(a?.[k]);
            const bv = Number(b?.[k]);
            if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
            comparable++;
            const base = Math.max(Math.abs(av), Math.abs(bv), 1);
            if (Math.abs(av - bv) / base > 0.05) return false;
          }
          return comparable >= 3;
        };

        for (const [, items] of chainGroups.entries()) {
          if (items.length < 2) continue;
          const used = new Set<string>();
          for (let i = 0; i < items.length; i++) {
            const a = items[i];
            if (!a?.id || used.has(a.id)) continue;
            const semanticDupes: any[] = [];
            for (let j = i + 1; j < items.length; j++) {
              const b = items[j];
              if (!b?.id || used.has(b.id)) continue;
              // Items with identical dish_name_key were already merged in Step 1; only
              // look at genuinely different names here.
              if ((a.dish_name_key || '') === (b.dish_name_key || '')) continue;
              if (withinTolerance(a.nutrients || {}, b.nutrients || {})) {
                semanticDupes.push(b);
              }
            }
            if (semanticDupes.length === 0) continue;

            const candidates = [a, ...semanticDupes];
            candidates.sort((x, y) => officialNameScore(y.dish_name) - officialNameScore(x.dish_name));
            const primary = candidates[0];
            const dupes = candidates.slice(1);

            const mergedNutrients = { ...(primary.nutrients || {}) };
            let totalCaptures = Number(primary.capture_count || 1);
            let mergedIngredients = primary.ingredients || null;
            for (const dup of dupes) {
              totalCaptures += Number(dup.capture_count || 1);
              if (!mergedIngredients && dup.ingredients) mergedIngredients = dup.ingredients;
              if (dup.nutrients && typeof dup.nutrients === 'object') {
                for (const [k, v] of Object.entries(dup.nutrients)) {
                  if ((mergedNutrients[k] === undefined || mergedNutrients[k] === null) && v !== null && v !== undefined) {
                    mergedNutrients[k] = Number(v);
                  }
                }
              }
            }

            const { error: updatePrimaryErr } = await supabaseAdmin
              .from('brand_menu_items')
              .update({
                nutrients: mergedNutrients,
                ingredients: mergedIngredients,
                capture_count: totalCaptures,
                updated_at: new Date().toISOString()
              })
              .eq('id', primary.id);

            if (!updatePrimaryErr) {
              mergedItemsCount++;
              const dupIds = dupes.map(d => d.id).filter(Boolean);
              if (dupIds.length > 0) {
                const { error: delErr } = await supabaseAdmin
                  .from('brand_menu_items')
                  .delete()
                  .in('id', dupIds);
                if (!delErr) {
                  deletedDuplicatesCount += dupIds.length;
                  if (addDebugLog) {
                    addDebugLog(`[SelfCleaning:Semantic] Merged "${dupes.map(d => d.dish_name).join('", "')}" into "${primary.dish_name}" (nutrient match, ${dupIds.length} duplicate row(s) removed).`);
                  }
                }
              }
              used.add(a.id);
              dupes.forEach(d => used.add(d.id));
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[consolidateBrandMenuItemsAndChains:semantic] Error:', err);
    }

    // 2. Consolidate chain_menu_sources
    const { data: sources, error: sourcesErr } = await supabaseAdmin
      .from('chain_menu_sources')
      .select('*');

    if (!sourcesErr && Array.isArray(sources) && sources.length > 0) {
      const sourceGroups = new Map<string, any[]>();
      for (const s of sources) {
        const cCode = (s.country_code || 'GB').toUpperCase();
        const normChain = normalizeChainKey(s.chain_key || s.display_name || '');
        if (!normChain) continue;

        const groupKey = `${cCode}::${normChain}`;
        if (!sourceGroups.has(groupKey)) sourceGroups.set(groupKey, []);
        sourceGroups.get(groupKey)!.push(s);
      }

      for (const [groupKey, sList] of sourceGroups.entries()) {
        const [cCode, normChain] = groupKey.split('::');
        if (sList.length === 1) {
          const single = sList[0];
          if (single.chain_key !== normChain) {
            await supabaseAdmin
              .from('chain_menu_sources')
              .update({ chain_key: normChain, display_name: single.display_name || normChain, updated_at: new Date().toISOString() })
              .eq('id', single.id);
          }
        } else if (sList.length > 1) {
          // Sort to pick best primary source: prefers ready status, non-empty url, or most recently updated
          sList.sort((a, b) => {
            const aReady = a.status === 'ready' ? 1 : 0;
            const bReady = b.status === 'ready' ? 1 : 0;
            if (bReady !== aReady) return bReady - aReady;
            const aHasUrl = a.url ? 1 : 0;
            const bHasUrl = b.url ? 1 : 0;
            if (bHasUrl !== aHasUrl) return bHasUrl - aHasUrl;
            return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
          });

          const primary = sList[0];
          const duplicates = sList.slice(1);

          await supabaseAdmin
            .from('chain_menu_sources')
            .update({ chain_key: normChain, updated_at: new Date().toISOString() })
            .eq('id', primary.id);

          const dupIds = duplicates.map(d => d.id).filter(Boolean);
          if (dupIds.length > 0) {
            const { error: delErr } = await supabaseAdmin.from('chain_menu_sources').delete().in('id', dupIds);
            if (!delErr) {
              deletedDuplicatesCount += dupIds.length;
            }
          }
        }
      }
    }

    if (addDebugLog && (mergedItemsCount > 0 || deletedDuplicatesCount > 0 || updatedChainsCount > 0)) {
      addDebugLog(`[SelfCleaning] Consolidated brand menu items: ${updatedChainsCount} chain keys updated, ${mergedItemsCount} items merged, ${deletedDuplicatesCount} duplicate rows removed.`);
    }
  } catch (err: any) {
    console.warn('[consolidateBrandMenuItemsAndChains] Error:', err);
  }

  return { mergedItemsCount, deletedDuplicatesCount, updatedChainsCount, duplicatesFound };
}

export async function cleanUnbrandedFoodCatalog(
  supabaseAdmin: any,
  addDebugLog?: (msg: string) => void
): Promise<{ purgedBrandedCount: number; purgedZeroMacroCount: number }> {
  let purgedBrandedCount = 0;
  let purgedZeroMacroCount = 0;

  try {
    if (!supabaseAdmin) return { purgedBrandedCount, purgedZeroMacroCount };

    const { data: foodItems, error } = await supabaseAdmin
      .from('food_items')
      .select('*');

    if (error || !Array.isArray(foodItems) || foodItems.length === 0) {
      return { purgedBrandedCount, purgedZeroMacroCount };
    }

    const toDeleteIds: string[] = [];
    const toDeleteKeys: string[] = [];

    for (const fi of foodItems) {
      const name = fi.display_name || '';
      const key = fi.food_key || '';
      const nutrients = fi.nutrients_per_100g || {};
      const cals = Number(nutrients.calories || 0);
      const p = Number(nutrients.protein || 0);
      const c = Number(nutrients.carbohydrates || 0);
      const f = Number(nutrients.totalFat || 0);

      const isBranded = isKnownDatabaseBrandSync(name) || isKnownDatabaseBrandSync(key) || isGroceryBrandSync(name);
      const isZeroMacroCandidate = fi.status === 'candidate' && cals === 0 && p === 0 && c === 0 && f === 0;

      if (isBranded) {
        toDeleteIds.push(fi.food_id);
        toDeleteKeys.push(fi.food_key);
        purgedBrandedCount++;
      } else if (isZeroMacroCandidate) {
        toDeleteIds.push(fi.food_id);
        toDeleteKeys.push(fi.food_key);
        purgedZeroMacroCount++;
      } else {
        if (!fi.basis_type || String(fi.basis_type).trim() === '') {
          await supabaseAdmin
            .from('food_items')
            .update({
              basis_type: 'per_100g',
              updated_at: new Date().toISOString()
            })
            .eq('food_id', fi.food_id);
          fi.basis_type = 'per_100g';
        }
      }
    }

    if (toDeleteIds.length > 0) {
      await supabaseAdmin.from('food_items').delete().in('food_id', toDeleteIds);
      if (toDeleteKeys.length > 0) {
        await supabaseAdmin.from('food_aliases').delete().in('alias_key', toDeleteKeys);
      }
    }

    // Also clean up dish_cache basis_type defaults
    try {
      const { data: dishes, error: dishError } = await supabaseAdmin
        .from('dish_cache')
        .select('*');
      if (!dishError && Array.isArray(dishes)) {
        for (const d of dishes) {
          if (!d.basis_type || String(d.basis_type).trim() === '') {
            await supabaseAdmin
              .from('dish_cache')
              .update({
                basis_type: 'per_100g',
                updated_at: new Date().toISOString()
              })
              .eq('id', d.id);
          }
        }
      }
    } catch (dishErr) {
      console.warn('[cleanUnbrandedFoodCatalog] dish_cache fix error:', dishErr);
    }

    // Deduplicate food items
    const { data: deduplicatedItems, error: dedupErr } = await supabaseAdmin.from('food_items').select('*');
    if (!dedupErr && Array.isArray(deduplicatedItems)) {
      const groups = new Map<string, any[]>();
      for (const item of deduplicatedItems) {
        const key = item.food_key || '';
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }

      for (const [key, items] of groups.entries()) {
        if (items.length > 1) {
          items.sort((a, b) => {
             const aConf = a.confidence || 0;
             const bConf = b.confidence || 0;
             if (aConf !== bConf) return bConf - aConf;
             return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
          });
          const primary = items[0];
          const duplicates = items.slice(1);
          const dupIds = duplicates.map(d => d.food_id).filter(Boolean);
          if (dupIds.length > 0) {
            await supabaseAdmin.from('food_items').delete().in('food_id', dupIds);
            if (addDebugLog) addDebugLog(`[SelfCleaning] Deleted ${dupIds.length} duplicates for catalog item: ${key}`);
          }
        }
      }
    }

    if (addDebugLog && (purgedBrandedCount > 0 || purgedZeroMacroCount > 0)) {
      addDebugLog(`[SelfCleaning] Food Catalog Clean-up: Purged ${purgedBrandedCount} branded items and ${purgedZeroMacroCount} 0-macro candidates from unbranded food catalog.`);
    }
  } catch (err: any) {
    console.warn('[cleanUnbrandedFoodCatalog] Error:', err);
  }

  return { purgedBrandedCount, purgedZeroMacroCount };
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
      (resBmi.results || []).forEach((r: any) => {
        const name = (r.chain_name || '').toLowerCase().trim();
        const key = (r.chain_key || '').replace(/_/g, ' ').toLowerCase().trim();
        if (name) allBrands.add(name);
        if (key) allBrands.add(key);
      });
      const resCms = await d1Query<any>('SELECT display_name, chain_key FROM chain_menu_sources LIMIT 500');
      (resCms.results || []).forEach((r: any) => {
        const name = (r.display_name || '').toLowerCase().trim();
        const key = (r.chain_key || '').replace(/_/g, ' ').toLowerCase().trim();
        if (name) allBrands.add(name);
        if (key) allBrands.add(key);
      });
    } catch (d1Err) {
      console.warn('[fetchAllDatabaseBrands] D1 fetch warning:', d1Err);
    }
  }

  // 2. Fetch from Supabase if available
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    if (supabaseAdmin) {
      // Fetch from brand_menu_items
      const { data: bmi } = await supabaseAdmin
        .from('brand_menu_items')
        .select('chain_name, chain_key, category');
      if (bmi && Array.isArray(bmi)) {
        bmi.forEach((r: any) => {
          const name = (r.chain_name || '').toLowerCase().trim();
          const key = (r.chain_key || '').replace(/_/g, ' ').toLowerCase().trim();
          if (name) allBrands.add(name);
          if (key) allBrands.add(key);
          if (r.category && /grocery|supermarket|retail|store/i.test(r.category)) {
            if (name) groceryBrands.add(name);
            if (key) groceryBrands.add(key);
          }
        });
      }

      // Fetch from chain_menu_sources
      const { data: cms } = await supabaseAdmin
        .from('chain_menu_sources')
        .select('chain_name, chain_key, category');
      if (cms && Array.isArray(cms)) {
        cms.forEach((r: any) => {
          const name = (r.chain_name || '').toLowerCase().trim();
          const key = (r.chain_key || '').replace(/_/g, ' ').toLowerCase().trim();
          if (name) allBrands.add(name);
          if (key) allBrands.add(key);
          if (r.category && /grocery|supermarket|retail|store/i.test(r.category)) {
            if (name) groceryBrands.add(name);
            if (key) groceryBrands.add(key);
          }
        });
      }

      // Fetch from food_items (where brand_name is present)
      const { data: fi } = await supabaseAdmin
        .from('food_items')
        .select('brand_name')
        .not('brand_name', 'is', null)
        .limit(1000);
      if (fi && Array.isArray(fi)) {
        fi.forEach((r: any) => {
          if (r.brand_name) {
            const b = String(r.brand_name).toLowerCase().trim();
            if (b) allBrands.add(b);
          }
        });
      }
    }
  } catch (err) {
    console.warn('[fetchAllDatabaseBrands] Supabase fetch warning:', err);
  }

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

  let items: any[] = [];
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { data, error } = await supabaseAdmin.from('brand_menu_items').select('*');
    if (data && !error && Array.isArray(data)) {
      items = data;
    }
  } catch (err) {
    console.warn('[fetchAllBrandMenuItems] Supabase fetch warning:', err);
  }

  if (items.length === 0 && isD1Configured()) {
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


